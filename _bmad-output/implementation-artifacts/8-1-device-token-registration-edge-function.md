# Story 8.1: Device Token Registration & Edge Function

Status: done

## Story

As a developer setting up push notification infrastructure,
I want a secure device token storage system and registration endpoint,
So that the app can reliably deliver push notifications to registered devices.

## Acceptance Criteria

### 1. Database Migration — `device_tokens` Table

- [x] Migration file `supabase/migrations/20260401000000_device_tokens.sql` creates `device_tokens` table
- [x] Columns: `id` (uuid PK, default `gen_random_uuid()`), `user_id` (uuid FK → `auth.users(id)` ON DELETE CASCADE), `token` (text NOT NULL), `platform` (text NOT NULL, CHECK IN ('ios', 'android')), `device_name` (text, nullable), `created_at` (timestamptz, default `now()`), `updated_at` (timestamptz, default `now()`)
- [x] UNIQUE constraint on `(user_id, token)` — prevents duplicate token registrations
- [x] RLS enabled: `auth.uid() = user_id` on SELECT, INSERT, UPDATE, DELETE (4 separate policies)
- [x] Index: `idx_device_tokens_user_id` on `user_id` for fast lookups
- [x] `updated_at` trigger reuses existing `set_updated_at()` function from migration `20260303000000`
- [x] `notification_preferences` columns on `profiles` table: `streak_alerts` (boolean, default true), `srs_reminders` (boolean, default true)

**Given** the Supabase database  
**When** the migration is applied  
**Then** the `device_tokens` table exists with all columns, constraints, RLS policies, and indexes  
**And** the `profiles` table has `streak_alerts` and `srs_reminders` boolean columns

### 2. Edge Function — `notification-register`

- [x] File: `supabase/functions/notification-register/index.ts`
- [x] Follows Edge Function template exactly: JSDoc header, `_shared/` imports, CORS preflight, env var verification, JWT auth via `supabase.auth.getUser()`, rate limiting (10/min), try/catch with `errorResponse()`, `corsHeaders` on every response
- [x] Action `register`: upserts device token into `device_tokens` (insert or update `updated_at` if existing via `onConflict`)
- [x] Action `unregister`: deletes a specific device token for the authenticated user
- [x] Action `preferences`: updates `streak_alerts` and/or `srs_reminders` on `profiles` table, returns current preferences
- [x] Action `get-preferences`: returns current notification preferences from `profiles`
- [x] Validates Expo push token format: `ExponentPushToken[...]` regex before inserting
- [x] Validates `platform` is `'ios'` or `'android'`
- [x] Returns `AUTH_MISSING` error for requests without valid JWT
- [x] Returns `INVALID_PARAMS` error for malformed tokens, missing fields, or unknown actions

**Given** the `notification-register` Edge Function  
**When** a request is made with valid JWT and action `register` with `{ token, platform, deviceName? }`  
**Then** the token is upserted into `device_tokens`  
**And** the response confirms registration with `corsHeaders`

**Given** the `notification-register` Edge Function  
**When** a request is made with valid JWT and action `preferences` with `{ streak_alerts?, srs_reminders? }`  
**Then** the preferences are updated on the user's `profiles` row  
**And** the response returns current preference values

**Given** the `notification-register` Edge Function  
**When** a request is made without a valid JWT  
**Then** an `AUTH_MISSING` error is returned

### 3. Account Deletion Cascade

- [x] `device_tokens.user_id` FK has `ON DELETE CASCADE` — tokens auto-deleted when account is deleted via `account-delete` Edge Function
- [x] No changes needed to `account-delete/index.ts` — PostgreSQL cascade handles cleanup

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex (N/A — no client UI in this story)
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners (N/A — no client UI)
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` (N/A — no client UI)
- [x] Non-obvious interactions have `accessibilityHint` (N/A — no client UI)
- [x] Stateful elements have `accessibilityState` (N/A — no client UI)
- [x] All tappable elements have minimum 44x44pt touch targets (N/A — no client UI)
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` (N/A — Edge Function uses console.error + errorResponse)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` (N/A — no client UI)
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`

## Tasks / Subtasks

- [x] Task 1: Create database migration (AC: #1)
  - [x] 1.1 Create `supabase/migrations/20260401000000_device_tokens.sql`
  - [x] 1.2 Define `device_tokens` table with all columns and constraints
  - [x] 1.3 Enable RLS with 4 policies (SELECT, INSERT, UPDATE, DELETE) using `auth.uid() = user_id`
  - [x] 1.4 Create `idx_device_tokens_user_id` index
  - [x] 1.5 Attach `set_updated_at()` trigger to `device_tokens`
  - [x] 1.6 ALTER `profiles` table to add `streak_alerts` (boolean DEFAULT true) and `srs_reminders` (boolean DEFAULT true)
- [x] Task 2: Create `notification-register` Edge Function (AC: #2)
  - [x] 2.1 Create `supabase/functions/notification-register/index.ts` following exact Edge Function template
  - [x] 2.2 Implement `register` action: validate token format (`/^ExponentPushToken\[.+\]$/`), validate platform, upsert to `device_tokens`
  - [x] 2.3 Implement `unregister` action: delete token by `(user_id, token)`
  - [x] 2.4 Implement `preferences` action: update `profiles.streak_alerts` / `profiles.srs_reminders`
  - [x] 2.5 Implement `get-preferences` action: read preferences from `profiles`
  - [x] 2.6 Add rate limiting at 10 requests/minute per user
- [x] Task 3: Verify cascade behavior (AC: #3)
  - [x] 3.1 Confirm `ON DELETE CASCADE` on `user_id` FK ensures tokens are cleaned up on account deletion

## Dev Notes

### Edge Function Template (MANDATORY — follow exactly)

Copy the structure from `supabase/functions/account-delete/index.ts`:

```typescript
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
    // 1. Verify env vars
    // 2. Extract + validate JWT via supabaseUser.auth.getUser()
    // 3. Rate limit via checkRateLimit(user.id, ...)
    // 4. Parse body, switch on action
    // 5. Return success with corsHeaders
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse({ code: "INTERNAL_ERROR", message, status: 500, corsHeaders });
  }
});
```

### Request/Response Contracts

**Register action:**
```json
// Request
{ "action": "register", "token": "ExponentPushToken[xxx]", "platform": "ios", "deviceName": "iPhone 15" }
// Response 200
{ "success": true, "message": "Device registered" }
```

**Unregister action:**
```json
// Request
{ "action": "unregister", "token": "ExponentPushToken[xxx]" }
// Response 200
{ "success": true, "message": "Device unregistered" }
```

**Preferences action:**
```json
// Request
{ "action": "preferences", "streakAlerts": true, "srsReminders": false }
// Response 200
{ "success": true, "streakAlerts": true, "srsReminders": false }
```

**Get-preferences action:**
```json
// Request
{ "action": "get-preferences" }
// Response 200
{ "streakAlerts": true, "srsReminders": true }
```

### Database Naming Conventions (NON-NEGOTIABLE)

- SQL identifiers: `snake_case` — `device_tokens`, `user_id`, `created_at`
- FK pattern: `<referenced_table_singular>_id` — `user_id`
- Index: `idx_<table>_<columns>` — `idx_device_tokens_user_id`
- JSONB keys (if any): `camelCase`
- RLS policies: descriptive names like `"Users can read own device tokens"`

### Migration Pattern

Follow existing migration style from `20260301000000_initial_schema.sql`:
- Use `gen_random_uuid()` for PK defaults
- FK with `REFERENCES auth.users(id) ON DELETE CASCADE`
- RLS: separate policies for SELECT, INSERT, UPDATE, DELETE
- `USING (auth.uid() = user_id)` for read/delete policies
- `WITH CHECK (auth.uid() = user_id)` for insert/update policies
- Existing `set_updated_at()` trigger function is defined in `20260303000000_triggers_indexes_cleanup.sql` — reuse it, do NOT recreate

### Existing Shared Utilities — DO NOT Recreate

| Utility | Location | Purpose |
|---------|----------|---------|
| `errorResponse()` | `supabase/functions/_shared/errors.ts` | Structured error response with `ErrorCode` |
| `checkRateLimit()` | `supabase/functions/_shared/rate-limit.ts` | Sliding window rate limiter |
| `rateLimitResponse()` | `supabase/functions/_shared/rate-limit.ts` | 429 response builder |
| `ErrorCode` type | `supabase/functions/_shared/errors.ts` | `AUTH_MISSING`, `AUTH_INVALID`, `RATE_LIMITED`, `INVALID_PARAMS`, etc. |

### Token Validation

Expo push tokens follow this format: `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`

```typescript
const EXPO_TOKEN_REGEX = /^ExponentPushToken\[.+\]$/;
```

Reject tokens that don't match — return `INVALID_PARAMS` error.

### What This Story Does NOT Include

- NO client-side code (hooks, screens, UI) — that's story 8-3
- NO notification sending logic — that's story 8-2
- NO `expo-notifications` installation — that's story 8-3
- NO Expo Push API integration — that's story 8-2
- This story is purely: migration + Edge Function for token CRUD + preference storage

### EAS Project ID

The EAS projectId is already configured: `ce8862a4-5a0a-4276-8cb6-24faeaee424a` (in `app.json` → `extra.eas.projectId`). Story 8-3 will use this for `getExpoPushTokenAsync({ projectId })`.

### Deployment Reminder

After implementation, deploy with:
```bash
supabase db push                              # Apply migration
supabase functions deploy notification-register  # Deploy Edge Function
```

### Project Structure Notes

- Edge Function location: `supabase/functions/notification-register/index.ts` — matches architecture spec
- Migration: `supabase/migrations/20260401000000_device_tokens.sql` — next sequential timestamp
- No new client-side files in this story
- No changes to `app.json`, `package.json`, or any `src/` files

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 8, Story 8.1 (lines 1467-1505)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Edge Function Structure Pattern (lines 321-370)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Data Architecture Phase 2 (lines 187-190)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Authentication & Security (lines 192-207)]
- [Source: _bmad-output/planning-artifacts/architecture.md — Naming Patterns (lines 280-294)]
- [Source: _bmad-output/planning-artifacts/architecture.md — API & Communication Patterns (lines 213-223)]
- [Source: supabase/functions/account-delete/index.ts — Reference Edge Function implementation]
- [Source: supabase/functions/_shared/errors.ts — ErrorCode type and errorResponse()]
- [Source: supabase/functions/_shared/rate-limit.ts — checkRateLimit() and rateLimitResponse()]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Created `device_tokens` table migration with all columns (id, user_id, token, platform, device_name, created_at, updated_at), UNIQUE constraint on (user_id, token), RLS (4 policies), index, and updated_at trigger reusing existing `set_updated_at()` function
- Added `streak_alerts` and `srs_reminders` boolean columns to `profiles` table (both default true)
- Created `notification-register` Edge Function following the `account-delete` template exactly: JSDoc, _shared imports, CORS preflight, env var check, JWT auth, rate limiting (10/min), try/catch with errorResponse
- Implemented 4 actions: `register` (upsert with Expo token regex validation + platform validation), `unregister` (delete by user_id + token), `preferences` (update + return current), `get-preferences` (read current)
- `ON DELETE CASCADE` on user_id FK ensures automatic cleanup when account is deleted — no changes to account-delete needed
- All quality gates pass: type-check, lint, format:check

### Change Log

- 2026-04-01: Implemented story 8-1 — database migration for device_tokens table + notification preferences columns, and notification-register Edge Function with register/unregister/preferences/get-preferences actions

### File List

- `supabase/migrations/20260401000000_device_tokens.sql` (NEW)
- `supabase/functions/notification-register/index.ts` (NEW)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)
- `_bmad-output/implementation-artifacts/8-1-device-token-registration-edge-function.md` (MODIFIED)
