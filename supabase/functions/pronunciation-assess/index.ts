/**
 * Pronunciation Assessment Edge Function
 *
 * Proxies Azure Speech Service pronunciation assessment calls
 * so the Azure API key never leaves the server.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  checkDailyCostBudget,
  checkRateLimit,
  dailyCostCapResponse,
  rateLimitResponse,
  recordDailyCost,
} from "../_shared/rate-limit-db.ts";
import { estimateAzureSpeechCostCents } from "../_shared/cost-table.ts";
import { errorResponse, parseUpstreamError, timeoutResponse } from "../_shared/errors.ts";
import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  fetchWithTimeout,
  isUpstreamTimeoutError,
} from "../_shared/fetch-with-timeout.ts";

const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY");
const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION") ?? "westeurope";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

/** Max audio size: 5 MB base64 (~3.75 MB raw audio, ~3 minutes at 16kHz PCM16) */
const MAX_AUDIO_BASE64_BYTES = 5 * 1024 * 1024;

/** Rate limit: 20 assessments per minute per user */
const RATE_LIMIT = { requests: 20, windowSeconds: 60 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify required environment variables
    if (!AZURE_SPEECH_KEY) {
      return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: AZURE_SPEECH_KEY not set", status: 500, corsHeaders });
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: Supabase env vars not set", status: 500, corsHeaders });
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse({ code: "AUTH_MISSING", message: "Missing authorization header", status: 401, corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse({ code: "AUTH_INVALID", message: "Invalid or expired token", status: 401, corsHeaders });
    }

    // Rate limiting — Postgres-backed via Story 11-4 (cross-isolate-correct).
    const { allowed, remaining, resetIn } = await checkRateLimit(
      supabase,
      user.id,
      "pronunciation",
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse({ code: "INVALID_PARAMS", message: "Request body must be valid JSON", status: 400, corsHeaders });
    }

    const { referenceText, audioBase64 } = body as { referenceText?: string; audioBase64?: string };

    if (!referenceText || !audioBase64) {
      return errorResponse({ code: "INVALID_PARAMS", message: "Missing referenceText or audioBase64", status: 400, corsHeaders });
    }

    // Audio size guard — prevent oversized uploads
    if (audioBase64.length > MAX_AUDIO_BASE64_BYTES) {
      return errorResponse({ code: "BODY_TOO_LARGE", message: "Audio file too large (max 5 MB)", status: 413, corsHeaders });
    }

    // Decode base64 audio to binary
    let bytes: Uint8Array;
    try {
      const binaryString = atob(audioBase64);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      return errorResponse({ code: "INVALID_PARAMS", message: "Invalid base64 audio data", status: 400, corsHeaders });
    }

    // Estimate audio duration from PCM16 byte count (16kHz mono):
    // 2 bytes/sample × 16000 samples/sec = 32000 bytes/sec → minutes = bytes / 32000 / 60.
    // Pessimistic estimate (over-counts duration if encoding includes headers).
    const estimatedAudioMinutes = bytes.byteLength / 32000 / 60;
    const estimatedCents = estimateAzureSpeechCostCents(estimatedAudioMinutes);

    // Pre-check daily AI spend cap (Story 11-4).
    const budgetCheck = await checkDailyCostBudget(supabase, user.id, estimatedCents);
    if (!budgetCheck.allowed) {
      return dailyCostCapResponse(corsHeaders, {
        totalTodayCents: budgetCheck.totalTodayCents,
        limitCents: budgetCheck.limitCents,
      });
    }

    const pronunciationConfig = {
      ReferenceText: referenceText,
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: true,
    };

    const pronunciationHeader = btoa(JSON.stringify(pronunciationConfig));

    const endpoint = `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;

    let azureResponse: Response;
    try {
      azureResponse = await fetchWithTimeout(
        "azure-pronunciation",
        `${endpoint}?language=fr-FR&format=detailed`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
            "Pronunciation-Assessment": pronunciationHeader,
            Accept: "application/json",
          },
          body: bytes.buffer,
        },
        DEFAULT_UPSTREAM_TIMEOUT_MS
      );
    } catch (err) {
      if (isUpstreamTimeoutError(err)) {
        return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
      }
      throw err;
    }

    if (!azureResponse.ok) {
      const upstreamMessage = await parseUpstreamError(azureResponse);
      return errorResponse({ code: "UPSTREAM_ERROR", message: `Azure Speech error: ${upstreamMessage}`, status: azureResponse.status, corsHeaders });
    }

    const result = await azureResponse.json();

    // Record actual cost to the daily ledger (Story 11-4 post-record).
    // Best-effort; errors logged + swallowed.
    await recordDailyCost(supabase, user.id, estimatedCents);

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": String(remaining),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse({ code: "INTERNAL_ERROR", message, status: 500, corsHeaders });
  }
});
