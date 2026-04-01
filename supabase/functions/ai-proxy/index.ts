/**
 * AI Proxy Edge Function
 *
 * Securely proxies OpenAI API calls so API keys never leave the server.
 * Supports: chat completions, TTS, and embeddings.
 * Validates the user's Supabase JWT before forwarding requests.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse, parseUpstreamError } from "../_shared/errors.ts";

const ALLOWED_MODELS = ["gpt-4o", "gpt-4o-mini"];

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

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

    // Rate limiting
    const { allowed, remaining, resetIn } = checkRateLimit(
      user.id,
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
        openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: chatModel,
            messages: params.messages,
            temperature: params.temperature ?? 0.7,
            max_completion_tokens: params.maxTokens ?? 2048,
            response_format: params.responseFormat
              ? { type: params.responseFormat }
              : undefined,
          }),
        });
        break;
      }

      case "tts": {
        if (!params.input || typeof params.input !== "string") {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing or invalid 'input' string for TTS", status: 400, corsHeaders });
        }
        openaiResponse = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            input: params.input,
            voice: params.voice ?? "coral",
            speed: params.speed ?? 1.0,
            response_format: "mp3",
          }),
        });

        if (!openaiResponse.ok) {
          const upstreamMessage = await parseUpstreamError(openaiResponse);
          return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI TTS error: ${upstreamMessage}`, status: openaiResponse.status, corsHeaders });
        }

        // Return audio as binary
        const audioBuffer = await openaiResponse.arrayBuffer();
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
        // Hardcode embedding model — ignore any client-provided model
        openaiResponse = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: params.input,
          }),
        });
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

        // Use generic octet-stream MIME — Whisper detects format from file headers
        // (iOS sends WAV, Android sends M4A/AAC)
        const audioBlob = new Blob([audioBytes], { type: "application/octet-stream" });

        const formData = new FormData();
        formData.append("file", audioBlob, "audio.bin");
        formData.append("model", "whisper-1");
        formData.append("language", (params.language as string) ?? "fr");
        formData.append("response_format", "json");

        openaiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: formData,
        });

        if (!openaiResponse.ok) {
          const upstreamMessage = await parseUpstreamError(openaiResponse);
          return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI Whisper error: ${upstreamMessage}`, status: openaiResponse.status, corsHeaders });
        }

        const transcriptionData = await openaiResponse.json();
        const transcribedText = transcriptionData?.text;
        if (typeof transcribedText !== "string") {
          return errorResponse({ code: "UPSTREAM_ERROR", message: "Whisper returned no transcription text", status: 502, corsHeaders });
        }

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
      const upstreamMessage = await parseUpstreamError(openaiResponse);
      return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI error: ${upstreamMessage}`, status: openaiResponse.status, corsHeaders });
    }

    const data = await openaiResponse.json();
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
