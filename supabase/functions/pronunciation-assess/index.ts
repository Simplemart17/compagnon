/**
 * Pronunciation Assessment Edge Function
 *
 * Proxies Azure Speech Service pronunciation assessment calls
 * so the Azure API key never leaves the server.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse } from "../_shared/errors.ts";

const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY")!;
const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION") ?? "westeurope";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    // Rate limiting
    const { allowed, remaining, resetIn } = checkRateLimit(
      user.id,
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    const body = await req.json();
    const { referenceText, audioBase64 } = body;

    if (!referenceText || !audioBase64) {
      return errorResponse({ code: "INVALID_PARAMS", message: "Missing referenceText or audioBase64", status: 400, corsHeaders });
    }

    // Audio size guard — prevent oversized uploads
    if (audioBase64.length > MAX_AUDIO_BASE64_BYTES) {
      return errorResponse({ code: "BODY_TOO_LARGE", message: "Audio file too large (max 5 MB)", status: 413, corsHeaders });
    }

    // Decode base64 audio to binary
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
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

    const azureResponse = await fetch(
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
      }
    );

    if (!azureResponse.ok) {
      const errorText = await azureResponse.text();
      return errorResponse({ code: "UPSTREAM_ERROR", message: errorText, status: azureResponse.status, corsHeaders });
    }

    const result = await azureResponse.json();
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
