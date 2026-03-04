/**
 * Realtime Session Edge Function
 *
 * Issues ephemeral tokens for OpenAI Realtime API WebSocket connections.
 * The client uses this token to connect directly to the Realtime API
 * without exposing the actual API key.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse } from "../_shared/errors.ts";

const ALLOWED_REALTIME_MODELS = ["gpt-4o-realtime-preview", "gpt-4o-mini-realtime-preview"];

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    // Request ephemeral token from OpenAI
    const body = await req.json();
    // Validate model against allowlist — default to gpt-4o-realtime-preview if not allowed
    const model = ALLOWED_REALTIME_MODELS.includes(body.model)
      ? body.model
      : "gpt-4o-realtime-preview";
    const voice = body.voice ?? "nova";

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return errorResponse({ code: "UPSTREAM_ERROR", message: errorText, status: response.status, corsHeaders });
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
