/**
 * Send Notifications Edge Function
 *
 * Server-to-server function invoked by pg_cron every hour.
 * Queries eligible users for streak-at-risk and SRS vocabulary review
 * notifications, then delivers via Expo Push API.
 *
 * Authentication: X-Cron-Secret header (NOT user JWT).
 * Rate limited to 5 requests per minute.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
// Pinned to 3.15.0 — unpinned esm.sh resolved to a newer release that transitively
// imported undici@7.25.0 → node:sqlite, which esm.sh can't polyfill for Deno.
// Use npm: specifier so Deno's native Node compat handles built-ins.
import Expo from "npm:expo-server-sdk@3.15.0";
import type {
  ExpoPushMessage,
  ExpoPushTicket,
  ExpoPushReceipt,
} from "npm:expo-server-sdk@3.15.0";
import {
  checkRateLimit,
  rateLimitResponse,
  CRON_SENTINEL_USER_ID,
} from "../_shared/rate-limit-db.ts";
import { errorResponse } from "../_shared/errors.ts";
import { getSupabaseSecretKey } from "../_shared/supabase-keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// Prefer the new secret key (SUPABASE_SECRET_KEYS); fall back to the legacy
// SUPABASE_SERVICE_ROLE_KEY. Both bypass RLS (server-only).
const SUPABASE_SERVICE_ROLE_KEY = getSupabaseSecretKey();
const CRON_SECRET = Deno.env.get("CRON_SECRET");

/** Rate limit: 5 requests per minute (prevents accidental rapid re-invocation). */
const RATE_LIMIT = { requests: 5, windowSeconds: 60 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

interface StreakRow {
  user_id: string;
  streak_days: number;
  token: string;
  platform: string;
}

interface SrsRow {
  user_id: string;
  due_count: number;
  token: string;
  platform: string;
}

interface NudgeRow {
  user_id: string;
  streak_days: number;
  token: string;
  platform: string;
  top_error_description: string | null;
}

/** Story 18-3: lock-screen-safe truncation for the error-pattern snippet. */
const NUDGE_ERROR_SNIPPET_MAX = 60;

/**
 * Story 18-3: compose the daily-nudge body. Contextual when the user has a
 * top unresolved error pattern (study metadata — deliberately never
 * companion_memory content: memories are private life details and this
 * renders on the LOCK SCREEN); otherwise a warm generic invitation.
 * EN chrome per the Story 14-1 language strategy.
 */
function composeNudgeBody(row: NudgeRow): string {
  if (row.top_error_description && row.top_error_description.trim().length > 0) {
    let snippet = row.top_error_description.trim();
    if (snippet.length > NUDGE_ERROR_SNIPPET_MAX) {
      // R1: code-POINT slice (spread iterates by code point) — a bare
      // .slice() can split a UTF-16 surrogate pair at the cut, rendering
      // U+FFFD on the lock screen or invalidating the Expo chunk. Same
      // invariant the client pins in truncateToBytes (Story 11-7).
      snippet = `${[...snippet].slice(0, NUDGE_ERROR_SNIPPET_MAX).join("")}…`;
    }
    return `Ready for 10 minutes of French? "${snippet}" could use a rematch.`;
  }
  if (row.streak_days >= 3) {
    return `A quick chat keeps your ${row.streak_days}-day streak going — your Companion is ready.`;
  }
  return "Time for a quick French chat — your Companion is ready when you are.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    // 1. Verify required environment variables
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse({
        code: "INTERNAL_ERROR",
        message: "Server misconfiguration: Supabase env vars not set",
        status: 500,
        corsHeaders,
      });
    }
    if (!CRON_SECRET) {
      return errorResponse({
        code: "INTERNAL_ERROR",
        message: "Server misconfiguration: CRON_SECRET not set",
        status: 500,
        corsHeaders,
      });
    }

    // 2. Authenticate via X-Cron-Secret header (constant-time comparison)
    const requestSecret = req.headers.get("X-Cron-Secret");
    if (!requestSecret || !timingSafeEqual(requestSecret, CRON_SECRET)) {
      return errorResponse({
        code: "AUTH_MISSING",
        message: "Invalid cron secret",
        status: 401,
        corsHeaders,
      });
    }

    // 3. Create admin Supabase client (bypasses RLS for cross-user queries).
    //    Created here (before the rate-limit check) because Story 11-4's
    //    Postgres-backed rate-limit RPC needs a Supabase client to invoke.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // App tables + RPCs (notification targets, rate-limit) live under the
      // `companion` schema (shared project).
      db: { schema: "companion" },
    });

    // 4. Rate limiting — server-to-server with sentinel user_id + "cron" key.
    //    Postgres-backed counter via Story 11-4 (cross-isolate-correct).
    const { allowed, resetIn } = await checkRateLimit(
      supabaseAdmin,
      CRON_SENTINEL_USER_ID,
      "cron",
      RATE_LIMIT.requests,
      RATE_LIMIT.windowSeconds,
    );
    if (!allowed) {
      return rateLimitResponse(corsHeaders, resetIn);
    }

    const expo = new Expo();

    // 4b. Check receipts from previous run's tickets
    let receiptsChecked = 0;
    let receiptInvalidTokens: string[] = [];
    try {
      const { data: uncheckedTickets } = await supabaseAdmin
        .from("notification_log")
        .select("id, ticket_id, token")
        .eq("receipt_checked", false)
        .not("ticket_id", "is", null)
        .lt("sent_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

      if (uncheckedTickets && uncheckedTickets.length > 0) {
        const ticketIds = uncheckedTickets
          .map((t: { ticket_id: string }) => t.ticket_id)
          .filter(Boolean);

        if (ticketIds.length > 0) {
          const receiptMap: Record<string, ExpoPushReceipt> =
            await expo.getPushNotificationReceiptsAsync(ticketIds);

          const tokenMap = new Map<string, string>();
          for (const t of uncheckedTickets) {
            if (t.ticket_id && t.token) tokenMap.set(t.ticket_id, t.token);
          }

          for (const [ticketId, receipt] of Object.entries(receiptMap)) {
            if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
              const token = tokenMap.get(ticketId);
              if (token) receiptInvalidTokens.push(token);
            }
          }

          // Mark all as checked
          const checkedIds = uncheckedTickets.map((t: { id: string }) => t.id);
          await supabaseAdmin
            .from("notification_log")
            .update({ receipt_checked: true })
            .in("id", checkedIds);

          receiptsChecked = ticketIds.length;
        }
      }
    } catch (receiptErr) {
      console.error(`[${requestId}] receipt check failed:`, receiptErr);
    }

    // 5. Query streak-at-risk users
    let queryErrors = 0;
    const { data: streakRows, error: streakError } = await supabaseAdmin
      .rpc("get_streak_notification_targets") as { data: StreakRow[] | null; error: unknown };

    if (streakError) {
      queryErrors++;
      console.error(`[${requestId}] streak query failed:`, streakError);
    }

    // 6. Query SRS due-cards users
    const { data: srsRows, error: srsError } = await supabaseAdmin
      .rpc("get_srs_notification_targets") as { data: SrsRow[] | null; error: unknown };

    if (srsError) {
      queryErrors++;
      console.error(`[${requestId}] SRS query failed:`, srsError);
    }

    // 6b. Story 18-3: query daily-nudge targets. The RPC enforces the
    // per-user hour window + no-practice-today + the 20h one-per-day cap.
    const { data: nudgeRows, error: nudgeError } = await supabaseAdmin
      .rpc("get_nudge_notification_targets") as { data: NudgeRow[] | null; error: unknown };

    if (nudgeError) {
      queryErrors++;
      console.error(`[${requestId}] nudge query failed:`, nudgeError);
    }

    // 7. Cross-run idempotency: exclude users already notified within the past hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentLogs } = await supabaseAdmin
      .from("notification_log")
      .select("user_id, type")
      .gte("sent_at", oneHourAgo);

    const recentlyNotified = new Set<string>();
    if (recentLogs) {
      for (const log of recentLogs) {
        recentlyNotified.add(`${log.user_id}:${log.type}`);
      }
    }

    // 8. Build notification messages
    const messages: ExpoPushMessage[] = [];
    const streakTokensSent = new Set<string>();
    const srsTokensSent = new Set<string>();
    const streakUserIds: string[] = [];
    const srsUserIds: string[] = [];

    // Streak notifications
    if (streakRows) {
      for (const row of streakRows) {
        if (recentlyNotified.has(`${row.user_id}:streak`)) continue;
        if (streakTokensSent.has(row.token)) continue;
        if (!Expo.isExpoPushToken(row.token)) {
          console.warn(`[${requestId}] Invalid Expo token for user ${row.user_id}: ${row.token}`);
          continue;
        }
        messages.push({
          to: row.token,
          title: "Don't break your streak! \u{1F525}",
          body: `Your ${row.streak_days}-day streak is waiting! A quick practice keeps it alive.`,
          sound: "default",
          priority: "high",
          data: { screen: "home" },
        });
        streakTokensSent.add(row.token);
        streakUserIds.push(row.user_id);
      }
    }

    // SRS notifications
    if (srsRows) {
      for (const row of srsRows) {
        if (recentlyNotified.has(`${row.user_id}:srs`)) continue;
        if (srsTokensSent.has(row.token)) continue;
        if (!Expo.isExpoPushToken(row.token)) {
          console.warn(`[${requestId}] Invalid Expo token for user ${row.user_id}: ${row.token}`);
          continue;
        }
        messages.push({
          to: row.token,
          title: "Vocabulary review time \u{1F4DA}",
          body: `You have ${row.due_count} vocabulary cards ready for review.`,
          sound: "default",
          priority: "high",
          data: { screen: "vocabulary" },
        });
        srsTokensSent.add(row.token);
        srsUserIds.push(row.user_id);
      }
    }

    // Story 18-3: daily-nudge notifications
    const nudgeTokensSent = new Set<string>();
    const nudgeUserIds: string[] = [];
    if (nudgeRows) {
      for (const row of nudgeRows) {
        if (recentlyNotified.has(`${row.user_id}:nudge`)) continue;
        if (nudgeTokensSent.has(row.token)) continue;
        if (!Expo.isExpoPushToken(row.token)) {
          console.warn(`[${requestId}] Invalid Expo token for user ${row.user_id}: ${row.token}`);
          continue;
        }
        messages.push({
          to: row.token,
          title: "Your Companion is waiting \u{1F4AC}",
          body: composeNudgeBody(row),
          sound: "default",
          priority: "high",
          data: { screen: "conversation" },
        });
        nudgeTokensSent.add(row.token);
        nudgeUserIds.push(row.user_id);
      }
    }

    // 8. Send notifications via Expo Push API
    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    const ticketTokenPairs: { ticketId: string; token: string }[] = [];

    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const tickets: ExpoPushTicket[] =
            await expo.sendPushNotificationsAsync(chunk);

          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const token = (chunk[i] as ExpoPushMessage).to as string;
            if (ticket.status === "ok") {
              sent++;
              // Store ticket ID for receipt checking in the next run
              if ("id" in ticket && ticket.id) {
                ticketTokenPairs.push({ ticketId: ticket.id, token });
              }
            } else {
              failed++;
              // Check for DeviceNotRegistered to clean up invalid tokens
              if (
                ticket.status === "error" &&
                ticket.details?.error === "DeviceNotRegistered"
              ) {
                invalidTokens.push(token);
              }
            }
          }
        } catch (chunkError) {
          console.error(`[${requestId}] chunk send failed:`, chunkError);
          failed += chunk.length;
        }
      }
    }

    // 10. Log sent notifications for cross-run idempotency (with ticket IDs for receipt checking)
    const logEntries: { user_id: string; type: string; ticket_id?: string; token?: string }[] = [];
    const uniqueStreakUsers = [...new Set(streakUserIds)];
    const uniqueSrsUsers = [...new Set(srsUserIds)];

    // Build a token→ticketId map for enriching log entries
    const tokenToTicket = new Map<string, string>();
    for (const pair of ticketTokenPairs) {
      tokenToTicket.set(pair.token, pair.ticketId);
    }

    // Build a token→userId map from the original notification data
    const tokenToUser = new Map<string, string>();
    if (streakRows) {
      for (const row of streakRows) tokenToUser.set(row.token, row.user_id);
    }
    if (srsRows) {
      for (const row of srsRows) tokenToUser.set(row.token, row.user_id);
    }
    if (nudgeRows) {
      for (const row of nudgeRows) tokenToUser.set(row.token, row.user_id);
    }

    for (const uid of uniqueStreakUsers) {
      logEntries.push({ user_id: uid, type: "streak" });
    }
    for (const uid of uniqueSrsUsers) {
      logEntries.push({ user_id: uid, type: "srs" });
    }
    const uniqueNudgeUsers = [...new Set(nudgeUserIds)];
    for (const uid of uniqueNudgeUsers) {
      logEntries.push({ user_id: uid, type: "nudge" });
    }

    // Enrich log entries with ticket IDs where available
    for (const entry of logEntries) {
      for (const [token, userId] of tokenToUser.entries()) {
        if (userId === entry.user_id) {
          const ticketId = tokenToTicket.get(token);
          if (ticketId) {
            entry.ticket_id = ticketId;
            entry.token = token;
            break;
          }
        }
      }
    }

    if (logEntries.length > 0) {
      const { error: logError } = await supabaseAdmin
        .from("notification_log")
        .insert(logEntries);
      if (logError) {
        console.error(`[${requestId}] notification_log insert failed:`, logError);
      }
    }

    // 11. Clean up invalid tokens (from both send tickets and receipt checks)
    const allInvalidTokens = [...new Set([...invalidTokens, ...receiptInvalidTokens])];
    let tokensCleanedUp = 0;
    if (allInvalidTokens.length > 0) {
      const { error: deleteError, count } = await supabaseAdmin
        .from("device_tokens")
        .delete()
        .in("token", allInvalidTokens);

      if (deleteError) {
        console.error(`[${requestId}] token cleanup failed:`, deleteError);
      } else {
        tokensCleanedUp = count ?? allInvalidTokens.length;
        console.log(
          `[${requestId}] cleaned up ${tokensCleanedUp} invalid tokens: ${allInvalidTokens.join(", ")}`,
        );
      }
    }

    // 12. Return summary
    const summary = {
      sent,
      failed,
      tokensCleanedUp,
      receiptsChecked,
      queryErrors,
      streakNotifications: streakTokensSent.size,
      srsNotifications: srsTokensSent.size,
      nudgeNotifications: nudgeTokensSent.size,
      timestamp: new Date().toISOString(),
    };

    console.log(`[${requestId}] notification run complete:`, JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(
      `[${requestId}] send-notifications unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return errorResponse({
      code: "INTERNAL_ERROR",
      message: "Notification delivery failed",
      status: 500,
      corsHeaders,
    });
  }
});
