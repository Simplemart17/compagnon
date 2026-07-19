/**
 * Notification Register Edge Function
 *
 * Manages push notification device tokens and preferences.
 * Supports: register, unregister, preferences, get-preferences actions.
 *
 * Rate limited to 10 requests per minute.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit-db.ts";
import { errorResponse } from "../_shared/errors.ts";
import { getSupabasePublishableKey } from "../_shared/supabase-keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// Prefer the new publishable key (SUPABASE_PUBLISHABLE_KEYS); fall back to the
// legacy SUPABASE_ANON_KEY. Both resolve to the anon/authenticated role.
const SUPABASE_ANON_KEY = getSupabasePublishableKey();

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
      // App tables + RPCs live under the `companion` schema (shared project).
      db: { schema: "companion" },
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

    // 3. Rate limiting — Postgres-backed counter via Story 11-4 (cross-isolate-correct).
    const { allowed, resetIn } = await checkRateLimit(
      supabase,
      user.id,
      "notification-register",
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
        // Story 18-3: dailyNudge (boolean) + nudgeUtcHour (0-23 integer,
        // client-converted from the user's local choice) join the two
        // existing boolean prefs.
        const { streakAlerts, srsReminders, dailyNudge, nudgeUtcHour, tzOffsetMinutes } = body;

        if (
          streakAlerts === undefined &&
          srsReminders === undefined &&
          dailyNudge === undefined &&
          nudgeUtcHour === undefined &&
          tzOffsetMinutes === undefined
        ) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message:
              "At least one preference must be provided: streakAlerts, srsReminders, dailyNudge, or nudgeUtcHour",
            status: 400,
            corsHeaders,
          });
        }

        if (
          (streakAlerts !== undefined && typeof streakAlerts !== "boolean") ||
          (srsReminders !== undefined && typeof srsReminders !== "boolean") ||
          (dailyNudge !== undefined && typeof dailyNudge !== "boolean")
        ) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "streakAlerts, srsReminders, and dailyNudge must be boolean values",
            status: 400,
            corsHeaders,
          });
        }

        if (
          nudgeUtcHour !== undefined &&
          (typeof nudgeUtcHour !== "number" ||
            !Number.isInteger(nudgeUtcHour) ||
            nudgeUtcHour < 0 ||
            nudgeUtcHour > 23)
        ) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "nudgeUtcHour must be an integer between 0 and 23",
            status: 400,
            corsHeaders,
          });
        }

        // Story 18-3 R1: client-reported getTimezoneOffset() (minutes WEST
        // of UTC) — lets the nudge RPC compare last_active_date (a
        // client-LOCAL date per Story 9-2) against the user's LOCAL today.
        if (
          tzOffsetMinutes !== undefined &&
          (typeof tzOffsetMinutes !== "number" ||
            !Number.isInteger(tzOffsetMinutes) ||
            tzOffsetMinutes < -720 ||
            tzOffsetMinutes > 840)
        ) {
          return errorResponse({
            code: "INVALID_PARAMS",
            message: "tzOffsetMinutes must be an integer between -720 and 840",
            status: 400,
            corsHeaders,
          });
        }

        const updates: Record<string, boolean | number> = {};
        if (streakAlerts !== undefined) updates.streak_alerts = streakAlerts;
        if (srsReminders !== undefined) updates.srs_reminders = srsReminders;
        if (dailyNudge !== undefined) updates.daily_nudge = dailyNudge;
        if (nudgeUtcHour !== undefined) updates.nudge_utc_hour = nudgeUtcHour;
        if (tzOffsetMinutes !== undefined) updates.tz_offset_minutes = tzOffsetMinutes;

        // Story 18-3 R1 deploy-order armor: this function auto-deploys on
        // merge while the schema is a manual Dashboard SQL run. If the
        // nudge columns don't exist yet (Postgres 42703), retry with the
        // legacy column set so the PRE-EXISTING streak/SRS toggles keep
        // working; nudge fields degrade to undefined until the SQL lands.
        let profile: Record<string, unknown> | null = null;
        let updateError: { code?: string; message?: string } | null = null;
        {
          const res = await supabase
            .from("profiles")
            .update(updates)
            .eq("id", user.id)
            .select("streak_alerts, srs_reminders, daily_nudge, nudge_utc_hour")
            .single();
          profile = res.data;
          updateError = res.error;
          if (updateError && updateError.code === "42703") {
            const legacyUpdates: Record<string, boolean | number> = {};
            if (streakAlerts !== undefined) legacyUpdates.streak_alerts = streakAlerts;
            if (srsReminders !== undefined) legacyUpdates.srs_reminders = srsReminders;
            if (Object.keys(legacyUpdates).length === 0) {
              return errorResponse({
                code: "INTERNAL_ERROR",
                message: "Nudge preferences require a schema update that has not been applied yet",
                status: 500,
                corsHeaders,
              });
            }
            const legacy = await supabase
              .from("profiles")
              .update(legacyUpdates)
              .eq("id", user.id)
              .select("streak_alerts, srs_reminders")
              .single();
            profile = legacy.data;
            updateError = legacy.error;
            console.warn(`[${requestId}] nudge columns missing (42703) — legacy prefs path used`);
          }
        }

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
            dailyNudge: profile.daily_nudge,
            nudgeUtcHour: profile.nudge_utc_hour,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      case "get-preferences": {
        // Story 18-3 R1: same 42703 deploy-order armor as the write path.
        let profile: Record<string, unknown> | null = null;
        let fetchError: { code?: string; message?: string } | null = null;
        {
          const res = await supabase
            .from("profiles")
            .select("streak_alerts, srs_reminders, daily_nudge, nudge_utc_hour")
            .eq("id", user.id)
            .single();
          profile = res.data;
          fetchError = res.error;
          if (fetchError && fetchError.code === "42703") {
            const legacy = await supabase
              .from("profiles")
              .select("streak_alerts, srs_reminders")
              .eq("id", user.id)
              .single();
            profile = legacy.data;
            fetchError = legacy.error;
            console.warn(`[${requestId}] nudge columns missing (42703) — legacy prefs path used`);
          }
        }

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
            dailyNudge: profile.daily_nudge,
            nudgeUtcHour: profile.nudge_utc_hour,
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
