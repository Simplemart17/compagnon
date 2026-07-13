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
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit-db.ts";
import { errorResponse } from "../_shared/errors.ts";
import { getSupabasePublishableKey, getSupabaseSecretKey } from "../_shared/supabase-keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// New publishable/secret keys with legacy anon/service_role fallback.
const SUPABASE_ANON_KEY = getSupabasePublishableKey();
const SUPABASE_SERVICE_ROLE_KEY = getSupabaseSecretKey();

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

  // Generate a request ID for structured logging
  const requestId = crypto.randomUUID();

  try {
    // Verify required environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: Supabase env vars not set", status: 500, corsHeaders });
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse({ code: "INTERNAL_ERROR", message: "Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set", status: 500, corsHeaders });
    }

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
      // App tables + RPCs (rate-limit) live under the `companion` schema.
      db: { schema: "companion" },
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

    // 2. Rate limiting — this is destructive, limit strictly.
    //    Postgres-backed counter via Story 11-4; cross-isolate-correct.
    const { allowed, resetIn } = await checkRateLimit(
      supabaseUser,
      user.id,
      "account-delete",
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    // 3. Delete the auth user using admin API (service role)
    //    FK ON DELETE CASCADE ensures all user data is removed automatically.
    //    PostgreSQL cascades are transactional — if any cascade fails, the
    //    entire deletion rolls back, so partial orphans cannot occur.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Consistent schema routing (this client is used for auth.admin only,
      // but keep it aligned in case a future `.from()`/`.rpc()` is added).
      db: { schema: "companion" },
    });

    const { error: deleteError } =
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error(`[${requestId}] account-delete failed for user ${user.id}: ${deleteError.message}`);
      return errorResponse({
        code: "INTERNAL_ERROR",
        message: "Failed to delete account",
        status: 500,
        corsHeaders,
      });
    }

    // 4. Verify cascade completed — profile should be gone
    const { data: orphanCheck } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (orphanCheck) {
      console.error(`[${requestId}] cascade incomplete: profile still exists for deleted user ${user.id}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Account deleted successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(`[${requestId}] account-delete unexpected error:`, err instanceof Error ? err.message : err);
    return errorResponse({
      code: "INTERNAL_ERROR",
      message: "Failed to delete account",
      status: 500,
      corsHeaders,
    });
  }
});
