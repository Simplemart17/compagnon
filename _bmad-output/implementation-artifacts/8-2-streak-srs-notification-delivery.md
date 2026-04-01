# Story 8.2: Streak & SRS Notification Delivery

Status: done

## Story

As a learner who might forget to practice,
I want to receive gentle push notifications when my streak is at risk or vocabulary cards are due,
So that I maintain my learning habit without needing to remember to open the app.

## Acceptance Criteria

### 1. Edge Function — `send-notifications`

- [ ] File: `supabase/functions/send-notifications/index.ts`
- [ ] Follows Edge Function template: JSDoc header, `_shared/` imports, CORS preflight, env var verification (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), try/catch with `errorResponse()`, `corsHeaders` on every response
- [ ] Uses `SUPABASE_SERVICE_ROLE_KEY` to create an admin Supabase client (bypasses RLS to query all users)
- [ ] Authentication: validates that the caller is the pg_cron scheduler via a shared secret header (`X-Cron-Secret`) matching `Deno.env.get("CRON_SECRET")` — NOT user JWT auth (this is a server-to-server call)
- [ ] Rate limited to 5 requests/minute (prevents accidental rapid re-invocation)

**Given** the `send-notifications` Edge Function
**When** invoked by pg_cron with the correct `X-Cron-Secret` header
**Then** it queries eligible users and sends push notifications via Expo Push API
**And** returns a summary of notifications sent and failures

**Given** the `send-notifications` Edge Function
**When** invoked without the correct `X-Cron-Secret` header
**Then** an `AUTH_MISSING` error is returned

### 2. Streak-At-Risk Notifications

- [ ] Query: users where `profiles.streak_days > 0` AND `profiles.last_active_date < CURRENT_DATE` AND `profiles.streak_alerts = true`
- [ ] Message body: `"Your [N]-day streak is waiting! A quick practice keeps it alive."` (replace `[N]` with actual `streak_days`)
- [ ] Message title: `"Don't break your streak! 🔥"`
- [ ] Notification tone is encouraging, never punitive — no "You're about to LOSE your streak!"
- [ ] Notification `data` payload includes `{ screen: "home" }` for deep linking

**Given** a user with `streak_days = 5`, `last_active_date = yesterday`, `streak_alerts = true`
**When** the notification job runs today
**Then** a streak notification is sent: title "Don't break your streak! 🔥", body "Your 5-day streak is waiting! A quick practice keeps it alive."

**Given** a user with `streak_alerts = false`
**When** the streak notification would fire
**Then** no streak notification is sent for that user

**Given** a user with `streak_days = 0` (no active streak)
**When** the notification job runs
**Then** no streak notification is sent (nothing to protect)

### 3. SRS Vocabulary Review Reminders

- [ ] Query: count of `vocabulary` rows where `next_review <= NOW()` per user, grouped by `user_id`
- [ ] Threshold: send reminder only when due count >= 10
- [ ] Filter: only users where `profiles.srs_reminders = true`
- [ ] Message body: `"You have [N] vocabulary cards ready for review."` (replace `[N]` with actual count)
- [ ] Message title: `"Vocabulary review time 📚"`
- [ ] Notification `data` payload includes `{ screen: "vocabulary" }` for deep linking

**Given** a user with 15 vocabulary cards where `next_review <= NOW()` and `srs_reminders = true`
**When** the notification job runs
**Then** an SRS reminder is sent: title "Vocabulary review time 📚", body "You have 15 vocabulary cards ready for review."

**Given** a user with 5 due cards (below threshold of 10)
**When** the notification job runs
**Then** no SRS reminder is sent

**Given** a user with `srs_reminders = false`
**When** the SRS notification would fire
**Then** no SRS notification is sent for that user

### 4. Notification Delivery via Expo Push API

- [ ] Uses `expo-server-sdk` imported via `https://esm.sh/expo-server-sdk` in Deno
- [ ] Validates tokens with `Expo.isExpoPushToken()` before sending
- [ ] Uses `expo.chunkPushNotifications()` to batch messages (max 100 per chunk)
- [ ] Sends each chunk via `expo.sendPushNotificationsAsync()`
- [ ] All messages include: `sound: "default"`, `priority: "high"`

**Given** a user with 2 registered devices (device_tokens)
**When** a notification is triggered for that user
**Then** the notification is sent to both device tokens

**Given** 50 users eligible for notifications
**When** the notification job runs
**Then** messages are batched efficiently via `chunkPushNotifications()` (not one API call per user)

### 5. Invalid Token Cleanup

- [ ] After sending, inspect push tickets for `status: "error"` with `details.error === "DeviceNotRegistered"`
- [ ] Delete invalid tokens from `device_tokens` table using admin client
- [ ] Log cleaned-up tokens with request ID for debugging

**Given** a push ticket returns `DeviceNotRegistered` for a token
**When** the cleanup logic runs
**Then** that token is deleted from `device_tokens`
**And** the deletion is logged

### 6. Database Migration — pg_cron Scheduling

- [ ] Migration file: `supabase/migrations/20260402000000_notification_cron.sql`
- [ ] Enables `pg_cron` and `pg_net` extensions (idempotent `CREATE EXTENSION IF NOT EXISTS`)
- [ ] Creates a cron job `send-push-notifications` running every hour (`'0 * * * *'`)
- [ ] The cron job calls `net.http_post()` to invoke the `send-notifications` Edge Function
- [ ] Uses Supabase Vault for storing the project URL and cron secret (not hardcoded in cron.job table)
- [ ] Vault secrets: `project_url` (Supabase project URL), `cron_secret` (shared secret for auth)

**Given** the migration is applied
**When** the hour mark is reached
**Then** pg_cron fires `net.http_post()` to the `send-notifications` Edge Function
**And** the request includes `X-Cron-Secret` header from Vault

### 7. Deduplication

- [ ] If a user qualifies for BOTH streak and SRS notifications, send only ONE combined notification or TWO separate notifications (prefer separate for clarity — each notification has distinct `data.screen` for deep linking)
- [ ] Within a single run, each user receives at most one streak notification and one SRS notification
- [ ] The Edge Function is idempotent — running it multiple times in the same hour should not send duplicate notifications (use a simple `notification_log` approach or time-window check)

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (N/A — no client UI in this story)
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners (N/A — no client UI)
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` (N/A — no client UI)
- [x] Non-obvious interactions have `accessibilityHint` (N/A — no client UI)
- [x] Stateful elements have `accessibilityState` (N/A — no client UI)
- [x] All tappable elements have minimum 44x44pt touch targets (N/A — no client UI)
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` (N/A — Edge Function uses `console.error` + `errorResponse`)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` (N/A — no client UI)
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Create `send-notifications` Edge Function (AC: #1, #2, #3, #4, #5)
  - [x] 1.1 Create `supabase/functions/send-notifications/index.ts` following Edge Function template
  - [x] 1.2 Implement cron secret authentication via `X-Cron-Secret` header (NOT JWT — server-to-server)
  - [x] 1.3 Create admin Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS for cross-user queries)
  - [x] 1.4 Implement streak-at-risk query: `profiles` where `streak_days > 0 AND last_active_date < CURRENT_DATE AND streak_alerts = true`, joined with `device_tokens`
  - [x] 1.5 Implement SRS due-cards query: count `vocabulary` where `next_review <= NOW()` grouped by `user_id`, filter `count >= 10`, join `profiles` where `srs_reminders = true`, join `device_tokens`
  - [x] 1.6 Build `ExpoPushMessage[]` array with proper title, body, sound, priority, data (deep link screen)
  - [x] 1.7 Import `expo-server-sdk` via `https://esm.sh/expo-server-sdk`, create Expo client, chunk and send notifications
  - [x] 1.8 Implement invalid token cleanup: scan tickets for `DeviceNotRegistered`, delete from `device_tokens`
  - [x] 1.9 Return JSON summary: `{ sent: N, failed: N, tokensCleanedUp: N }`
  - [x] 1.10 Add rate limiting at 5 requests/minute via `checkRateLimit("cron", 5, 60)`
- [x] Task 2: Create database migration for pg_cron scheduling (AC: #6)
  - [x] 2.1 Create `supabase/migrations/20260402000000_notification_cron.sql`
  - [x] 2.2 Enable `pg_cron` and `pg_net` extensions (`CREATE EXTENSION IF NOT EXISTS`)
  - [x] 2.3 Insert Vault secrets for `project_url` and `cron_secret`
  - [x] 2.4 Schedule cron job `send-push-notifications` with `'0 * * * *'` calling `net.http_post()` to Edge Function with `X-Cron-Secret` header
- [x] Task 3: Add `CRON_SECRET` to Edge Function environment (AC: #1)
  - [x] 3.1 Document that deployer must run `supabase secrets set CRON_SECRET=<random-value>` and insert matching value in Vault
  - [x] 3.2 Add `CRON_SECRET` to the deployment documentation in Dev Notes

## Dev Notes

### Edge Function Template (MANDATORY — follow exactly)

Copy the structure from `supabase/functions/account-delete/index.ts` but with these key differences:

1. **Authentication is NOT JWT-based** — this function is called by pg_cron, not a user. Use a shared secret:
   ```typescript
   const cronSecret = Deno.env.get("CRON_SECRET");
   const requestSecret = req.headers.get("X-Cron-Secret");
   if (!cronSecret || requestSecret !== cronSecret) {
     return errorResponse({ code: "AUTH_MISSING", message: "Invalid cron secret", status: 401, corsHeaders });
   }
   ```

2. **Admin client required** — use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS and query all users:
   ```typescript
   const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
     auth: { autoRefreshToken: false, persistSession: false },
   });
   ```
   This pattern is established in `account-delete/index.ts`.

3. **No per-user JWT extraction** — the function queries across all users.

### expo-server-sdk Import for Deno

```typescript
import Expo from "https://esm.sh/expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket, ExpoPushSuccessTicket } from "https://esm.sh/expo-server-sdk";
```

Key API:
- `Expo.isExpoPushToken(token)` — validate before sending
- `expo.chunkPushNotifications(messages)` — batch into 100-message chunks
- `expo.sendPushNotificationsAsync(chunk)` — send a chunk, returns tickets
- Ticket `status: "error"` with `details.error === "DeviceNotRegistered"` → delete the token

### Streak-At-Risk Query Pattern

```sql
-- Users with active streak who haven't practiced today
SELECT p.id AS user_id, p.streak_days, dt.token, dt.platform
FROM profiles p
JOIN device_tokens dt ON dt.user_id = p.id
WHERE p.streak_days > 0
  AND p.last_active_date < CURRENT_DATE
  AND p.streak_alerts = true;
```

**Important:** `last_active_date` is a DATE column updated by `src/lib/activity.ts` using local date strings. The cron job runs server-side in UTC. This means:
- A user in UTC-8 who practices at 11 PM their time has `last_active_date` = today (their local date)
- The cron job at midnight UTC sees `last_active_date < CURRENT_DATE` which may be false (CURRENT_DATE is UTC)
- This is acceptable: the cron runs hourly, so the user will eventually be caught. Perfect timezone handling would require storing user timezone — defer to a future enhancement.

### SRS Due Cards Query Pattern

```sql
-- Users with 10+ due vocabulary cards
SELECT v.user_id, COUNT(*) AS due_count, dt.token, dt.platform
FROM vocabulary v
JOIN profiles p ON p.id = v.user_id
JOIN device_tokens dt ON dt.user_id = v.user_id
WHERE v.next_review <= NOW()
  AND p.srs_reminders = true
GROUP BY v.user_id, dt.token, dt.platform
HAVING COUNT(*) >= 10;
```

### Notification Message Templates

```typescript
// Streak notification
{
  to: token,
  title: "Don't break your streak! 🔥",
  body: `Your ${streakDays}-day streak is waiting! A quick practice keeps it alive.`,
  sound: "default",
  priority: "high",
  data: { screen: "home" },
}

// SRS reminder
{
  to: token,
  title: "Vocabulary review time 📚",
  body: `You have ${dueCount} vocabulary cards ready for review.`,
  sound: "default",
  priority: "high",
  data: { screen: "vocabulary" },
}
```

### pg_cron Migration Pattern

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Store secrets in Vault (values must be replaced at deploy time)
-- The deployer must:
-- 1. supabase secrets set CRON_SECRET=<generated-random-string>
-- 2. Update Vault secrets via SQL or Dashboard with actual project URL and matching cron secret

SELECT cron.schedule(
  'send-push-notifications',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := jsonb_build_object('time', now()::text),
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
```

### Existing Shared Utilities — DO NOT Recreate

| Utility | Location | Purpose |
|---------|----------|---------|
| `errorResponse()` | `supabase/functions/_shared/errors.ts` | Structured error response with `ErrorCode` |
| `checkRateLimit()` | `supabase/functions/_shared/rate-limit.ts` | Sliding window rate limiter |
| `rateLimitResponse()` | `supabase/functions/_shared/rate-limit.ts` | 429 response builder |
| `ErrorCode` type | `supabase/functions/_shared/errors.ts` | `AUTH_MISSING`, `AUTH_INVALID`, `RATE_LIMITED`, `INVALID_PARAMS`, etc. |

### Environment Variables Required

| Variable | Source | Purpose |
|----------|--------|---------|
| `SUPABASE_URL` | Auto-provided | Database/API URL |
| `SUPABASE_ANON_KEY` | Auto-provided | Anon key (unused in this function) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided | Admin access (bypasses RLS) |
| `CRON_SECRET` | Manual: `supabase secrets set` | Shared secret for pg_cron auth |

Note: `EXPO_ACCESS_TOKEN` is optional — Expo Push API works without it for projects using EAS. Only needed if push security is enabled in Expo dashboard.

### What This Story Does NOT Include

- NO client-side code (hooks, screens, UI) — that's story 8-3
- NO `expo-notifications` client-side installation — that's story 8-3
- NO notification preferences UI — that's story 8-3
- NO device token registration logic (already done in story 8-1)
- NO receipt checking (future enhancement — can add a second cron job later)
- This story is purely: Edge Function for sending notifications + pg_cron scheduling migration

### What Story 8-1 Already Provides (DO NOT Recreate)

- `device_tokens` table with RLS, indexes, cascade delete
- `profiles.streak_alerts` and `profiles.srs_reminders` boolean columns (both default true)
- `notification-register` Edge Function for token CRUD and preference management
- Expo push token format validation regex
- Request/response contracts for register/unregister/preferences/get-preferences

### Database Table Schemas (Reference)

**profiles (relevant columns):**
- `id` (uuid PK, FK → auth.users)
- `streak_days` (integer, default 0)
- `last_active_date` (date)
- `streak_alerts` (boolean, default true)
- `srs_reminders` (boolean, default true)

**device_tokens:**
- `id` (uuid PK)
- `user_id` (uuid FK → auth.users, ON DELETE CASCADE)
- `token` (text, NOT NULL)
- `platform` (text: 'ios' or 'android')
- `device_name` (text, nullable)
- UNIQUE on (user_id, token)

**vocabulary (relevant columns):**
- `user_id` (uuid FK → profiles)
- `next_review` (timestamptz, default NOW())
- UNIQUE on (user_id, french_word)

**daily_activity:**
- `user_id` (uuid FK → profiles)
- `date` (date, NOT NULL, default CURRENT_DATE)
- UNIQUE on (user_id, date)

### Deployment Steps

After implementation:
```bash
# 1. Set cron secret
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)

# 2. Deploy Edge Function
supabase functions deploy send-notifications

# 3. Apply migration (enables pg_cron + schedules job)
supabase db push

# 4. Insert Vault secrets via Supabase SQL Editor or Dashboard:
#    - project_url: https://<project-ref>.supabase.co
#    - cron_secret: <same value from step 1>
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<cron-secret-value>', 'cron_secret');

# 5. Verify cron job is scheduled
SELECT * FROM cron.job;
```

### Project Structure Notes

- Edge Function: `supabase/functions/send-notifications/index.ts` — new file, alongside existing `notification-register/`
- Migration: `supabase/migrations/20260402000000_notification_cron.sql` — next sequential timestamp after `20260401000000`
- No new client-side files in this story
- No changes to `app.json`, `package.json`, or any `src/` files

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Edge Function Structure Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture Phase 2]
- [Source: _bmad-output/planning-artifacts/prd.md — FR58 (streak notifications), FR59 (SRS notifications)]
- [Source: supabase/functions/notification-register/index.ts — Story 8-1 implementation (token CRUD)]
- [Source: supabase/functions/account-delete/index.ts — Admin client pattern with SERVICE_ROLE_KEY]
- [Source: supabase/functions/_shared/errors.ts — ErrorCode type and errorResponse()]
- [Source: supabase/functions/_shared/rate-limit.ts — checkRateLimit() and rateLimitResponse()]
- [Source: supabase/migrations/20260401000000_device_tokens.sql — device_tokens table + preference columns]
- [Source: src/lib/activity.ts — Streak tracking logic, last_active_date usage]
- [Source: src/lib/srs.ts — SM-2 algorithm, next_review field, due cards logic]
- [Source: expo-server-sdk docs — chunkPushNotifications, sendPushNotificationsAsync, DeviceNotRegistered handling]
- [Source: Supabase docs — pg_cron + pg_net for scheduled Edge Function invocation]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Implemented `send-notifications` Edge Function following the `account-delete` template pattern with cron secret auth instead of JWT
- Created SQL functions `get_streak_notification_targets()` and `get_srs_notification_targets()` as SECURITY DEFINER with search_path set, revoked from public/anon/authenticated — called via RPC from Edge Function since profiles and device_tokens lack a direct FK relationship for PostgREST joins
- Streak notifications: queries users with active streak who haven't practiced today (UTC date comparison, hourly cron catches timezone drift)
- SRS notifications: queries users with 10+ due vocabulary cards, respects `srs_reminders` preference
- Expo Push API: validates tokens with `Expo.isExpoPushToken()`, chunks via `chunkPushNotifications()`, sends via `sendPushNotificationsAsync()`
- Invalid token cleanup: scans push tickets for `DeviceNotRegistered` errors, deletes from `device_tokens` table
- Deduplication: within-run (Set-based token tracking) AND cross-run (`notification_log` table with 1-hour time-window check)
- `notification_log` table added with auto-cleanup cron (daily, removes entries older than 24h)
- Rate limited to 5 requests/minute using shared `checkRateLimit()` utility with "cron" key
- Constant-time secret comparison via `crypto.subtle.timingSafeEqual`
- Response summary includes `queryErrors` count to distinguish "nothing to send" from "queries failed"
- pg_cron migration: enables `pg_cron` + `pg_net`, schedules hourly job using Vault secrets for project URL and cron secret
- Deployment: `CRON_SECRET` must be set via `supabase secrets set` and matching value inserted in Vault
- All quality gates pass: type-check, lint, format:check

### Change Log

- 2026-04-01: Initial implementation of story 8-2 — Edge Function + migration + deployment docs
- 2026-04-01: Code review fixes — cross-run idempotency via notification_log, constant-time secret comparison, query error reporting in summary

### File List

- `supabase/functions/send-notifications/index.ts` (NEW)
- `supabase/migrations/20260402000000_notification_cron.sql` (NEW)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)
- `_bmad-output/implementation-artifacts/8-2-streak-srs-notification-delivery.md` (MODIFIED)
