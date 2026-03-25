/**
 * Realtime Session Edge Function
 *
 * Issues ephemeral client secrets for OpenAI Realtime API WebSocket connections.
 * Uses the GA endpoint: POST /v1/realtime/client_secrets
 * The client uses the returned token to connect directly to the Realtime API
 * without exposing the actual API key.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse, parseUpstreamError } from "../_shared/errors.ts";

const ALLOWED_REALTIME_MODELS = ["gpt-realtime", "gpt-realtime-mini", "gpt-4o-realtime-preview", "gpt-4o-mini-realtime-preview"];

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

/**
 * Rate limit: 10 sessions per minute per user.
 * Realtime sessions are expensive — enforce strict limits.
 */
const RATE_LIMIT = { requests: 10, windowSeconds: 60 };

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

    // Rate limiting — sessions are expensive, limit strictly
    const { allowed, remaining, resetIn } = checkRateLimit(
      user.id,
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

    // Request ephemeral token from OpenAI GA endpoint
    // Validate model against allowlist — default to gpt-realtime if not allowed
    const model = ALLOWED_REALTIME_MODELS.includes(body.model as string)
      ? body.model
      : "gpt-realtime";
    const voice = (body.voice as string) ?? "coral";

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          audio: {
            output: { voice },
          },
        },
      }),
    });

    if (!response.ok) {
      const upstreamMessage = await parseUpstreamError(response);
      return errorResponse({ code: "UPSTREAM_ERROR", message: `OpenAI Realtime error: ${upstreamMessage}`, status: response.status, corsHeaders });
    }

    const sessionData = await response.json();

    return new Response(JSON.stringify(sessionData), {
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
