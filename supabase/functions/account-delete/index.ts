/**
 * Account Delete Edge Function
 *
 * Permanently deletes a user's account and all associated data.
 * Uses the Supabase service role key to call auth.admin.deleteUser(),
 * which cascades to all tables via FK ON DELETE CASCADE.
 *
 * Rate limited to 1 request per minute (destructive operation).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse } from "../_shared/errors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Rate limit: 1 request per minute per user (destructive operation). */
const RATE_LIMIT = { requests: 1, windowSeconds: 60 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate user via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse({
        code: "AUTH_MISSING",
        message: "Missing authorization header",
        status: 401,
        corsHeaders,
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return errorResponse({
        code: "AUTH_INVALID",
        message: "Invalid or expired token",
        status: 401,
        corsHeaders,
      });
    }

    // 2. Rate limiting — this is destructive, limit strictly
    const { allowed, resetIn } = checkRateLimit(
      user.id,
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    // 3. Delete the auth user using admin API (service role)
    //    FK ON DELETE CASCADE ensures all user data is removed automatically.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return errorResponse({
        code: "INTERNAL_ERROR",
        message: "Failed to delete account. Please try again or contact support.",
        status: 500,
        corsHeaders,
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: "Account deleted successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse({
      code: "INTERNAL_ERROR",
      message,
      status: 500,
      corsHeaders,
    });
  }
});
