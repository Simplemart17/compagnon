/**
 * AI Proxy Edge Function
 *
 * Securely proxies OpenAI API calls so API keys never leave the server.
 * Supports: chat completions, TTS, and embeddings.
 * Validates the user's Supabase JWT before forwarding requests.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  checkDailyCostBudget,
  checkRateLimit,
  dailyCostCapResponse,
  rateLimitResponse,
  recordDailyCost,
} from "../_shared/rate-limit-db.ts";
import {
  actualChatCostCents,
  estimateChatCostCents,
  estimateTtsCostCents,
  estimateWhisperCostCents,
  MODEL_RATES,
} from "../_shared/cost-table.ts";
import { errorResponse, parseUpstreamError, timeoutResponse } from "../_shared/errors.ts";
import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  WHISPER_UPSTREAM_TIMEOUT_MS,
  fetchWithTimeout,
  isUpstreamTimeoutError,
  withTimeout,
} from "../_shared/fetch-with-timeout.ts";

const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini"];

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY");
const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION") ?? "westeurope";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

/** Allowed Azure French neural voices, mapped from short client-side names */
const AZURE_VOICES: Record<string, string> = {
  denise: "fr-FR-DeniseNeural",
  henri: "fr-FR-HenriNeural",
  vivienne: "fr-FR-VivienneMultilingualNeural",
  brigitte: "fr-FR-BrigitteNeural",
  remy: "fr-FR-RemyMultilingualNeural",
  eloise: "fr-FR-EloiseNeural",
};
const DEFAULT_AZURE_VOICE = "denise";

/** Max characters for a single TTS request (Azure soft limit ~10k) */
const MAX_TTS_CHARS = 4000;

/**
 * Rough heuristic: OpenAI estimates ~4 characters per token for English/French.
 * Used for pessimistic pre-flight cost estimation only; actual cost is
 * recorded from the response usage object after the call succeeds.
 */
function estimateTokensFromMessages(messages: unknown[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg === "object" && msg !== null) {
      const content = (msg as { content?: unknown }).content;
      if (typeof content === "string") totalChars += content.length;
    }
  }
  return Math.ceil(totalChars / 4);
}

/** Escape characters that have special meaning inside SSML/XML */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Max request body size: 50 KB for text, 5 MB for audio (transcription) */
const MAX_BODY_BYTES = 50 * 1024;
const MAX_AUDIO_BODY_BYTES = 5 * 1024 * 1024;

/** Rate limit: 30 requests per minute per user */
const RATE_LIMIT = { requests: 30, windowSeconds: 60 };

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
    if (!OPENAI_API_KEY) {
      return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: OPENAI_API_KEY not set", status: 500, corsHeaders });
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
    // Single budget covers all ai-proxy actions (chat / tts / embedding / transcribe)
    // matching pre-11-4 semantics. Per-action cost-cap pre/post is added inside
    // each switch branch below.
    const { allowed, remaining, resetIn } = await checkRateLimit(
      supabase,
      user.id,
      "ai-proxy",
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    // Pre-parse size guard using content-length (best-effort, header may be absent)
    const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_AUDIO_BODY_BYTES) {
      return errorResponse({ code: "BODY_TOO_LARGE", message: `Request body too large (max ${MAX_AUDIO_BODY_BYTES / 1024} KB)`, status: 413, corsHeaders });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse({ code: "INVALID_PARAMS", message: "Request body must be valid JSON", status: 400, corsHeaders });
    }
    const { action, ...params } = body;

    // Post-parse size guard for non-audio actions (stricter limit)
    if (action !== "transcribe" && contentLength > MAX_BODY_BYTES) {
      return errorResponse({ code: "BODY_TOO_LARGE", message: "Request body too large (max 50 KB)", status: 413, corsHeaders });
    }

    let openaiResponse: Response;

    switch (action) {
      case "chat": {
        if (!params.messages || !Array.isArray(params.messages)) {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing or invalid 'messages' array", status: 400, corsHeaders });
        }
        // Validate model against allowlist — default to gpt-4o if not allowed
        const chatModel = ALLOWED_MODELS.includes(params.model) ? params.model : "gpt-4o";

        // Story 11-4 — pre-check daily AI spend cap (pessimistic estimate).
        const chatInputTokens = estimateTokensFromMessages(params.messages);
        // Story 11-5 review patch P7: server-side default mirrors the
        // client-side `chatCompletion` default (also 800) so a future caller
        // that bypasses the client wrapper still gets the right-sized
        // budget for the daily-cost-cap pre-check.
        const chatMaxOutput = (typeof params.maxTokens === "number" ? params.maxTokens : 800);
        const chatEstimate = estimateChatCostCents(chatModel, chatInputTokens, chatMaxOutput);
        const chatBudget = await checkDailyCostBudget(supabase, user.id, chatEstimate);
        if (!chatBudget.allowed) {
          return dailyCostCapResponse(corsHeaders, {
            totalTodayCents: chatBudget.totalTodayCents,
            limitCents: chatBudget.limitCents,
          });
        }

        try {
          openaiResponse = await fetchWithTimeout(
            "openai-chat",
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: chatModel,
                messages: params.messages,
                temperature: params.temperature ?? 0.7,
                // Story 11-5 review patch P7: server-side default 800 matches
                // the client-side `chatCompletion` default (no drift).
                max_completion_tokens: params.maxTokens ?? 800,
                response_format: params.responseFormat
                  ? { type: params.responseFormat }
                  : undefined,
              }),
            },
            DEFAULT_UPSTREAM_TIMEOUT_MS
          );
        } catch (err) {
          if (isUpstreamTimeoutError(err)) {
            return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
          }
          throw err;
        }
        break;
      }

      case "tts": {
        if (!AZURE_SPEECH_KEY) {
          return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: AZURE_SPEECH_KEY not set", status: 500, corsHeaders });
        }
        if (!params.input || typeof params.input !== "string") {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing or invalid 'input' string for TTS", status: 400, corsHeaders });
        }
        if (params.input.length > MAX_TTS_CHARS) {
          return errorResponse({ code: "BODY_TOO_LARGE", message: `TTS input too long (max ${MAX_TTS_CHARS} chars)`, status: 413, corsHeaders });
        }

        const voiceKey = typeof params.voice === "string" ? params.voice.toLowerCase() : DEFAULT_AZURE_VOICE;
        const azureVoice = AZURE_VOICES[voiceKey] ?? AZURE_VOICES[DEFAULT_AZURE_VOICE];

        // Clamp speed to Azure's safe range
        const rawSpeed = typeof params.speed === "number" ? params.speed : 1.0;
        const rate = Math.min(Math.max(rawSpeed, 0.5), 2.0);

        const ssml = `<speak version="1.0" xml:lang="fr-FR"><voice name="${azureVoice}"><prosody rate="${rate}">${escapeXml(params.input)}</prosody></voice></speak>`;

        // Story 11-4 — pre-check daily AI spend cap. TTS is priced per
        // input character: $16/1M chars → 0.0016¢/char.
        const ttsEstimate = estimateTtsCostCents(params.input.length);
        const ttsBudget = await checkDailyCostBudget(supabase, user.id, ttsEstimate);
        if (!ttsBudget.allowed) {
          return dailyCostCapResponse(corsHeaders, {
            totalTodayCents: ttsBudget.totalTodayCents,
            limitCents: ttsBudget.limitCents,
          });
        }

        let azureTtsResponse: Response;
        try {
          azureTtsResponse = await fetchWithTimeout(
            "azure-tts",
            `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            {
              method: "POST",
              headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "companion-app",
              },
              body: ssml,
            },
            DEFAULT_UPSTREAM_TIMEOUT_MS
          );
        } catch (err) {
          if (isUpstreamTimeoutError(err)) {
            return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
          }
          throw err;
        }

        if (!azureTtsResponse.ok) {
          const upstreamMessage = await parseUpstreamError(azureTtsResponse, "azure-tts");
          return errorResponse({ code: "UPSTREAM_ERROR", message: `Azure TTS error: ${upstreamMessage}`, status: azureTtsResponse.status, corsHeaders });
        }

        // Return audio as binary. Wrap the arrayBuffer read with withTimeout
        // so a slow body stream (Azure TTS audio can be ~200KB) can't wedge
        // the isolate past the budget. Story 11-3 review patch P1.
        let audioBuffer: ArrayBuffer;
        try {
          audioBuffer = await withTimeout(
            "azure-tts-body",
            azureTtsResponse.arrayBuffer(),
            DEFAULT_UPSTREAM_TIMEOUT_MS
          );
        } catch (err) {
          if (isUpstreamTimeoutError(err)) {
            return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
          }
          throw err;
        }
        // Story 11-4 — post-record TTS cost (best-effort).
        await recordDailyCost(supabase, user.id, ttsEstimate);

        return new Response(audioBuffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": "audio/mpeg",
            "X-RateLimit-Remaining": String(remaining),
          },
        });
      }

      case "embedding": {
        if (!params.input) {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing 'input' for embedding", status: 400, corsHeaders });
        }

        // Story 11-4 — pre-check daily AI spend cap. Embeddings are cheap
        // (0.002¢/1K tokens) but we still pre-check for the daily cap.
        const embedInputStr = typeof params.input === "string" ? params.input : JSON.stringify(params.input);
        const embedInputTokens = Math.ceil(embedInputStr.length / 4);
        const embedEstimate = estimateChatCostCents("text-embedding-3-small", embedInputTokens, 0);
        const embedBudget = await checkDailyCostBudget(supabase, user.id, embedEstimate);
        if (!embedBudget.allowed) {
          return dailyCostCapResponse(corsHeaders, {
            totalTodayCents: embedBudget.totalTodayCents,
            limitCents: embedBudget.limitCents,
          });
        }

        // Hardcode embedding model — ignore any client-provided model
        try {
          openaiResponse = await fetchWithTimeout(
            "openai-embedding",
            "https://api.openai.com/v1/embeddings",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "text-embedding-3-small",
                input: params.input,
              }),
            },
            DEFAULT_UPSTREAM_TIMEOUT_MS
          );
        } catch (err) {
          if (isUpstreamTimeoutError(err)) {
            return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
          }
          throw err;
        }
        break;
      }

      case "transcribe": {
        if (!params.audio || typeof params.audio !== "string" || params.audio.length === 0) {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing or empty 'audio' base64 string for transcription", status: 400, corsHeaders });
        }

        // Convert base64 audio to binary — guard against invalid base64
        let audioBytes: Uint8Array;
        try {
          const binaryStr = atob(params.audio as string);
          audioBytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            audioBytes[i] = binaryStr.charCodeAt(i);
          }
        } catch {
          return errorResponse({ code: "INVALID_PARAMS", message: "Invalid base64 audio data", status: 400, corsHeaders });
        }

        // Story 11-4 — pre-check daily AI spend cap. Whisper is priced
        // per audio minute. We don't know the audio duration without
        // decoding it server-side, so we estimate from byte count using
        // the densest common encoding (PCM16 16kHz mono = 1,920,000
        // bytes/min, as used by `pronunciation-assess` and iOS WAV
        // recordings) as the divisor — this UNDER-estimates duration for
        // compressed formats (32 kbit AAC, Opus) but never OVER-denies
        // legitimate users. Story 11-4 review patch P5: switched from
        // 240,000 (32 kbit AAC) which was 8× over-estimating PCM16
        // duration and locking out iOS users after a few uploads.
        // Trade-off: AAC uploads are under-charged on the cap meter
        // (post-record uses the same estimate); acceptable for v1, and
        // Whisper's per-minute pricing is small enough that the slip is
        // bounded.
        const transcribeMinutes = audioBytes.byteLength / 1_920_000;
        const transcribeEstimate = estimateWhisperCostCents(transcribeMinutes);
        const transcribeBudget = await checkDailyCostBudget(supabase, user.id, transcribeEstimate);
        if (!transcribeBudget.allowed) {
          return dailyCostCapResponse(corsHeaders, {
            totalTodayCents: transcribeBudget.totalTodayCents,
            limitCents: transcribeBudget.limitCents,
          });
        }

        // Use generic octet-stream MIME — Whisper detects format from file headers
        // (iOS sends WAV, Android sends M4A/AAC)
        const audioBlob = new Blob([audioBytes], { type: "application/octet-stream" });

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.bin");
        formData.append("model", "whisper-1");
        formData.append("language", (params.language as string) ?? "fr");
        formData.append("response_format", "json");

        try {
          openaiResponse = await fetchWithTimeout(
            "openai-whisper",
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
              body: formData,
            },
            WHISPER_UPSTREAM_TIMEOUT_MS
          );
        } catch (err) {
          if (isUpstreamTimeoutError(err)) {
            return timeoutResponse(corsHeaders, { upstream: err.upstream, timeoutMs: err.timeoutMs });
          }
          throw err;
        }

        if (!openaiResponse.ok) {
          const upstreamMessage = await parseUpstreamError(openaiResponse, "openai-whisper");
          return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI Whisper error: ${upstreamMessage}`, status: openaiResponse.status, corsHeaders });
        }

        const transcriptionData = await openaiResponse.json();
        const transcribedText = transcriptionData?.text;
        if (typeof transcribedText !== "string") {
          return errorResponse({ code: "UPSTREAM_ERROR", message: "Whisper returned no transcription text", status: 502, corsHeaders });
        }

        // Story 11-4 — post-record Whisper cost (best-effort).
        await recordDailyCost(supabase, user.id, transcribeEstimate);

        return new Response(JSON.stringify({ text: transcribedText }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(remaining),
          },
        });
      }

      default:
        return errorResponse({ code: "UNKNOWN_ACTION", message: `Unknown action: ${action}`, status: 400, corsHeaders });
    }

    if (!openaiResponse.ok) {
      const upstreamMessage = await parseUpstreamError(openaiResponse, "openai-chat-or-embedding");
      return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI error: ${upstreamMessage}`, status: openaiResponse.status, corsHeaders });
    }

    const data = await openaiResponse.json();

    // Story 11-4 — post-record actual cost from OpenAI's usage object for
    // chat + embedding (the two switch branches that fall through here).
    // TTS records inline (above) using the pessimistic input-char estimate
    // since Azure TTS responses don't carry per-call usage tokens.
    const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    if (usage?.prompt_tokens !== undefined) {
      const model = (action === "embedding"
        ? "text-embedding-3-small"
        : ALLOWED_MODELS.includes(params.model)
          ? params.model
          : "gpt-4o");
      const actualCents = actualChatCostCents(
        model,
        usage.prompt_tokens ?? 0,
        usage.completion_tokens ?? 0
      );
      await recordDailyCost(supabase, user.id, actualCents);
    }

    return new Response(JSON.stringify(data), {
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
