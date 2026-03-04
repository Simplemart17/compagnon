/**
 * AI Proxy Edge Function
 *
 * Securely proxies OpenAI API calls so API keys never leave the server.
 * Supports: chat completions, TTS, and embeddings.
 * Validates the user's Supabase JWT before forwarding requests.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse } from "../_shared/errors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/** Max request body size: 50 KB (prevents prompt injection via massive payloads) */
const MAX_BODY_BYTES = 50 * 1024;

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

    // Request size guard
    const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return errorResponse({ code: "BODY_TOO_LARGE", message: "Request body too large (max 50 KB)", status: 413, corsHeaders });
    }

    const body = await req.json();
    const { action, ...params } = body;

    let openaiResponse: Response;

    switch (action) {
      case "chat": {
        if (!params.messages || !Array.isArray(params.messages)) {
          return errorResponse({ code: "INVALID_PARAMS", message: "Missing or invalid 'messages' array", status: 400, corsHeaders });
        }
        openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: params.model ?? "gpt-4o",
            messages: params.messages,
            temperature: params.temperature ?? 0.7,
            max_tokens: params.maxTokens ?? 2048,
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
            model: "tts-1",
            input: params.input,
            voice: params.voice ?? "nova",
            speed: params.speed ?? 1.0,
            response_format: "mp3",
          }),
        });

        if (!openaiResponse.ok) {
          const errorText = await openaiResponse.text();
          return errorResponse({ code: "UPSTREAM_ERROR", message: errorText, status: openaiResponse.status, corsHeaders });
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

      default:
        return errorResponse({ code: "UNKNOWN_ACTION", message: `Unknown action: ${action}`, status: 400, corsHeaders });
    }

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      return errorResponse({ code: "UPSTREAM_ERROR", message: errorText, status: openaiResponse.status, corsHeaders });
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
