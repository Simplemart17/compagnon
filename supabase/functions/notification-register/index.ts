/**
 * Notification Register Edge Function
 *
 * Manages push notification device tokens and preferences.
 * Supports: register, unregister, preferences, get-preferences actions.
 *
 * Rate limited to 10 requests per minute.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse } from "../_shared/errors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

/** Rate limit: 10 requests per minute per user. */
const RATE_LIMIT = { requests: 10, windowSeconds: 60 };

/** Expo push token format: ExponentPushToken[...] */
const EXPO_TOKEN_REGEX = /^ExponentPushToken\[.+\]$/;

const VALID_PLATFORMS = ["ios", "android"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    // 1. Verify required environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return errorResponse({
        code: "INTERNAL_ERROR",
        message: "Server misconfiguration: Supabase env vars not set",
        status: 500,
        corsHeaders,
      });
    }

    // 2. Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse({
        code: "AUTH_MISSING",
        message: "Missing authorization header",
        status: 401,
        corsHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse({
        code: "AUTH_INVALID",
        message: "Invalid or expired token",
        status: 401,
        corsHeaders,
      });
    }

    // 3. Rate limiting
    const { allowed, resetIn } = checkRateLimit(
      user.id,
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds,
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    // 4. Parse request body and dispatch action
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse({
        code: "INVALID_PARAMS",
        message: "Request body must be valid JSON",
        status: 400,
        corsHeaders,
      });
    }
    const { action } = body;

    switch (action) {
      case "register": {
        const { token, platform, deviceName } = body;

        if (!token || !EXPO_TOKEN_REGEX.test(token)) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message:
              "Invalid or missing token. Expected format: ExponentPushToken[...]",
            status: 400,
            corsHeaders,
          });
        }

        if (!platform || !VALID_PLATFORMS.includes(platform)) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "Invalid or missing platform. Must be 'ios' or 'android'",
            status: 400,
            corsHeaders,
          });
        }

        const { error: upsertError } = await supabase
          .from("device_tokens")
          .upsert(
            {
              user_id: user.id,
              token,
              platform,
              device_name: deviceName ?? null,
            },
            { onConflict: "user_id,token" },
          );

        if (upsertError) {
          console.error(
            `[${requestId}] register failed: ${upsertError.message}`,
          );
          return errorResponse({
            code: "INTERNAL_ERROR",
            message: "Failed to register device token",
            status: 500,
            corsHeaders,
          });
        }

        return new Response(
          JSON.stringify({ success: true, message: "Device registered" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      case "unregister": {
        const { token } = body;

        if (!token) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "Missing token",
            status: 400,
            corsHeaders,
          });
        }

        const { error: deleteError } = await supabase
          .from("device_tokens")
          .delete()
          .eq("user_id", user.id)
          .eq("token", token);

        if (deleteError) {
          console.error(
            `[${requestId}] unregister failed: ${deleteError.message}`,
          );
          return errorResponse({
            code: "INTERNAL_ERROR",
            message: "Failed to unregister device token",
            status: 500,
            corsHeaders,
          });
        }

        return new Response(
          JSON.stringify({ success: true, message: "Device unregistered" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      case "preferences": {
        const { streakAlerts, srsReminders } = body;

        if (streakAlerts === undefined && srsReminders === undefined) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message:
              "At least one preference must be provided: streakAlerts or srsReminders",
            status: 400,
            corsHeaders,
          });
        }

        if (
          (streakAlerts !== undefined && typeof streakAlerts !== "boolean") ||
          (srsReminders !== undefined && typeof srsReminders !== "boolean")
        ) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "streakAlerts and srsReminders must be boolean values",
            status: 400,
            corsHeaders,
          });
        }

        const updates: Record<string, boolean> = {};
        if (streakAlerts !== undefined) updates.streak_alerts = streakAlerts;
        if (srsReminders !== undefined) updates.srs_reminders = srsReminders;

        const { data: profile, error: updateError } = await supabase
          .from("profiles")
          .update(updates)
          .eq("id", user.id)
          .select("streak_alerts, srs_reminders")
          .single();

        if (updateError || !profile) {
          console.error(
            `[${requestId}] preferences update failed: ${updateError?.message}`,
          );
          return errorResponse({
            code: "INTERNAL_ERROR",
            message: "Failed to update preferences",
            status: 500,
            corsHeaders,
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            streakAlerts: profile.streak_alerts,
            srsReminders: profile.srs_reminders,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      case "get-preferences": {
        const { data: profile, error: fetchError } = await supabase
          .from("profiles")
          .select("streak_alerts, srs_reminders")
          .eq("id", user.id)
          .single();

        if (fetchError || !profile) {
          return errorResponse({
            code: "INTERNAL_ERROR",
            message: "Failed to fetch preferences",
            status: 500,
            corsHeaders,
          });
        }

        return new Response(
          JSON.stringify({
            streakAlerts: profile.streak_alerts,
            srsReminders: profile.srs_reminders,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      default:
        return errorResponse({
          code: "INVALID_PARAMS",
          message: `Unknown action: ${typeof action === "string" ? action.slice(0, 50) : "invalid"}`,
          status: 400,
          corsHeaders,
        });
    }
  } catch (err) {
    console.error(
      `[${requestId}] notification-register unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return errorResponse({
      code: "INTERNAL_ERROR",
      message: "Internal error",
      status: 500,
      corsHeaders,
    });
  }
});
