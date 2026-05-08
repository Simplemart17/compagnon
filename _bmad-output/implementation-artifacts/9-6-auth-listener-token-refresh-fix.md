# Story 9.6: Auth Listener Token-Refresh Fix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an authenticated French learner whose Supabase session auto-refreshes its JWT roughly every hour while the app is open,
I want the auth listener to react only to genuine sign-in/sign-out/initial-session events — not to every silent token refresh, password-recovery, MFA, or user-update event,
so that my profile is fetched once per session (not every hour), my offline write queue is replayed at most once per replay window (not duplicated by overlapping callers), and the initial `getSession()` rejection on a corrupted SecureStore cannot crash the app with an unhandled promise rejection.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged this as **P0-7**, a release blocker:

> "Auth listener re-runs `loadProfile` on every `TOKEN_REFRESHED` event — refetches profile, resets loading, re-flushes write queue (queued writes can replay). Files: `src/hooks/use-auth.ts:35-43`. Source agents: mobile, qa."

Hands-on verification of the codebase against that finding confirms the bug is live. The current handler at `src/hooks/use-auth.ts:33-43` ignores its `_event` argument entirely and runs the same expensive branch on every Supabase auth event:

```ts
const {
  data: { subscription },
} = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
  if (session?.user) {
    void loadProfile(session.user.id);   // ← runs on TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, MFA, INITIAL_SESSION, SIGNED_IN
  } else {
    setProfile(null);
    setLoading(false);
  }
});
```

`loadProfile` calls `cacheWithFallback` (returns from cache if fresh) **and** unconditionally enqueues `void flushWriteQueue(supabase)` (`use-auth.ts:71`). The Supabase auth-js package emits `AuthChangeEvent` values `'INITIAL_SESSION' | 'PASSWORD_RECOVERY' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'MFA_CHALLENGE_VERIFIED'` (verified at `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:13-14`). With `autoRefreshToken: true` configured at `src/lib/supabase.ts:25`, `TOKEN_REFRESHED` fires roughly every 55 minutes for any active session and additionally on app focus / wake. Every single one currently triggers the expensive branch.

The full chain of consequences — not just "redundant network call every hour" — is:

| # | Defect | Location | Why it matters |
|---|--------|----------|----------------|
| **D1** | `_event` is ignored. `loadProfile()` runs on every event. | `src/hooks/use-auth.ts:35-43` | `loadProfile` issues a Supabase `select * from profiles where id = ? limit 1` whenever the cache is stale (TTL ≈ 4h per `cache.ts` `CACHE_TTL.PROFILE`). On `TOKEN_REFRESHED`, this is wasted DB load. On `USER_UPDATED` / `PASSWORD_RECOVERY` it may be desirable, but the current code does not distinguish them. |
| **D2** | `flushWriteQueue(supabase)` runs unconditionally inside `loadProfile`. | `src/hooks/use-auth.ts:71` | `flushWriteQueue` (`src/lib/cache.ts:262-323`) is **not idempotent**. There is no in-flight guard. Two concurrent invocations BOTH read the same `[w1, w2]` from `WRITE_QUEUE_KEY`, BOTH replay each write, BOTH overwrite `remaining` last-writer-wins. The result on the wire is **double inserts / double updates** for any queued write that was racing. |
| **D3** | The auth listener and `NetworkBanner` (`src/components/common/NetworkBanner.tsx:23`) both call `flushWriteQueue(supabase)` independently. The auth listener fires on `TOKEN_REFRESHED` ~hourly. `NetworkBanner` fires on every network reconnect. They will eventually overlap. | `src/hooks/use-auth.ts:71`, `src/components/common/NetworkBanner.tsx:23` | This is the realistic concurrent-call vector for D2. After this story, both call sites point to the same listener's flush logic, but the underlying `flushWriteQueue` itself must also self-protect to remain robust to future call sites. |
| **D4** | `loadProfile` calls `setLoading(false)` in `finally`. On every `TOKEN_REFRESHED` event after sign-in, `isLoading` is set to `false` — but it was already `false`. Harmless re-render unless something else has flipped it back to `true`. Currently, nothing does. The risk is forward: any future code that sets `isLoading` to `true` to gate work (e.g. profile update) gets silently overridden by the next auth event. | `src/hooks/use-auth.ts:81` | Latent foot-gun for future state machines. The fix branches `setLoading(false)` to only the events that genuinely need it (`INITIAL_SESSION`, `SIGNED_OUT`, the no-session branches). |
| **D5** | `void supabase.auth.getSession()` at `src/hooks/use-auth.ts:23` has no `.catch()`. If `SecureStore` is corrupted, the device is rooted, or the SDK throws on cold start, the unhandled rejection propagates to React Native's global handler. With Sentry initialized (`app/_layout.tsx:42`), this surfaces as a vague "Possible Unhandled Promise Rejection" with no `captureError(err, "context")` tag. | `src/hooks/use-auth.ts:22-30` | Fix is one `.catch(captureError)`. The audit explicitly calls this out in `shippable-roadmap.md` line 136: *"add unhandled-rejection catch on initial getSession."* |
| **D6** | `INITIAL_SESSION` fires from the listener on subscribe AND `getSession()` already resolved with the same session. Both branches call `loadProfile(session.user.id)`. So on cold start, the profile is loaded twice in rapid succession (once via `getSession().then(...)`, once via `INITIAL_SESSION`). Cache makes the second call cheap, but both call `flushWriteQueue` and both call `setLoading(false)`. | `src/hooks/use-auth.ts:21-43` | The fix lets the `INITIAL_SESSION` branch own profile loading + queue flush + `setLoading(false)`, and reduces the initial `getSession()` to a "warm the session ref before paint" call (no profile, no flush) — or removes the duplicate path entirely. The story prefers the simpler rewrite that lets the listener be the single source of truth. |
| **D7** | The empty-session branch (line 39-42) calls `setProfile(null)` on every event with `session === null`, including `SIGNED_OUT` (correct) but also any `USER_UPDATED` / `TOKEN_REFRESHED` event that arrives with a null session due to a transient refresh failure. The latter are extremely rare but observable (`gotrue` returns `null` if the refresh token is rejected mid-flight). This silently nukes the profile on a refresh hiccup. | `src/hooks/use-auth.ts:39-42` | Fix: only clear profile on `SIGNED_OUT`. Other events with `null` session log to Sentry for visibility but do not destroy local state. |

These seven defects share one root cause — **the listener does not branch on `_event`** — and one root fix: branch on the discriminated event type, gate expensive work to the events that actually need it, make the queue flush self-idempotent, and bracket the cold-start `getSession()` with an unhandled-rejection catch.

Epic 9 acceptance-criterion lineage (`shippable-roadmap.md` §2 line 136):

> *"9.6 Auth listener fix (mobile) — branch on `_event` (only re-load on SIGNED_IN/OUT/INITIAL); idempotent `flushWriteQueue`; add unhandled-rejection catch on initial getSession. Covers P0-7."*

**Threat / failure model — what cannot happen post-story:**

After this story:

1. A normal authenticated session in the foreground for 24 hours produces ~24 `TOKEN_REFRESHED` events and triggers exactly **zero** profile fetches and **zero** `flushWriteQueue` invocations from those events.
2. `INITIAL_SESSION` (cold start) and `SIGNED_IN` (sign-in flow) each trigger exactly one `loadProfile` and at most one `flushWriteQueue` call.
3. `SIGNED_OUT` clears the profile, resets `isLoading`, and does NOT call `flushWriteQueue` (no user-scope queue is meaningful for a signed-out user).
4. Two concurrent calls to `flushWriteQueue(supabase)` (from any source) result in exactly one queue replay; the second caller observes the in-flight guard and returns `0` immediately. No double inserts.
5. A failed `getSession()` on cold start (corrupted SecureStore, transient SDK error) is captured to Sentry with context `"auth-initial-session"` and the app proceeds with no session (login screen renders).
6. `USER_UPDATED` events (e.g. profile metadata edited via the dashboard) re-load the profile *and* invalidate the profile cache to pick up the change, but do NOT re-flush the write queue.
7. `PASSWORD_RECOVERY` / `TOKEN_REFRESHED` / `MFA_CHALLENGE_VERIFIED` update only the session ref (so any code reading the JWT sees the refreshed token); no profile fetch, no queue flush, no `setLoading(false)`.

**Out of scope for this story (delegated elsewhere):**

- **Email-verification gate before app loads** → **Epic 12.9** (`shippable-roadmap.md` line 168). 9-6 does not block unconfirmed users.
- **Password policy tightening** → **Epic 12.8** (line 167). 9-6 does not touch signup validation.
- **Encrypted profile cache** → **Epic 12.7** (line 166). 9-6 does not change `cache.ts` storage layer (still AsyncStorage).
- **Auth subscription bootstrap rewrite** (move auth listener out of `use-auth.ts` into a top-level provider) → **Epic 12.2** (line 161). 9-6 keeps the listener inside `use-auth.ts`. Surgical scope.
- **Atomic RPC mutations** for activity counters → **Epic 12.3** (line 162). Not auth-related.
- **Replace in-memory rate-limit with Upstash** → **Epic 11.4** (line 151). Not auth-related.
- **`flushWriteQueue` write semantics** (e.g. switching to UNIQUE constraints, idempotency keys per write) — out of scope. The story only adds an in-flight guard at the function level. Per-write idempotency is a separate hardening item flagged for future epics if duplicate-write incidents are ever observed in production.
- **`auth-store.ts` reshaping** (moving `flushWriteQueue` invocation OUT of the hook entirely) — out of scope. The hook remains the call site for all auth-driven flushes; the in-flight guard is the dedup mechanism.

## Acceptance Criteria

### 1. Branch the Auth Listener on `_event` — Expensive Work Only on Genuine Sign-In / Sign-Out / Initial Session

The auth listener must read the `_event` discriminator and gate `loadProfile`, `flushWriteQueue`, and `setLoading` calls to the events that genuinely require them. Every event must still update the session ref (so JWT-consuming code sees the refreshed token), but expensive side-effects must be event-typed.

- [x] In `src/hooks/use-auth.ts`, rename the parameter from `_event` to `event` and branch on the value. The event union is `'INITIAL_SESSION' | 'PASSWORD_RECOVERY' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'MFA_CHALLENGE_VERIFIED'` (per `@supabase/auth-js` `AuthChangeEvent`).
- [x] **Always run `setSession(session)`** — every event, no branch. Reason: the session object carries the freshest JWT; downstream code (`supabase.from(...)` calls, Edge Function `Authorization` headers) must see it.
- [x] **Branch table — exactly this behavior:**

  | `event` | `setSession` | `setProfile` | `loadProfile` | `flushWriteQueue` | `setLoading(false)` | Notes |
  |---------|:-----:|:-----:|:-----:|:-----:|:-----:|-------|
  | `INITIAL_SESSION` (with session) | ✓ | — | ✓ | ✓ | ✓ (in `loadProfile.finally`) | Cold start with a persisted session. Single source of truth for cold-start profile load. |
  | `INITIAL_SESSION` (null session) | ✓ | `null` | — | — | ✓ | Cold start, no persisted session — go to login. |
  | `SIGNED_IN` | ✓ | — | ✓ | ✓ | ✓ (in `loadProfile.finally`) | User just signed in. |
  | `SIGNED_OUT` | ✓ | `null` | — | — | ✓ | Clear profile, no flush (queue should be replayed by next user, not the one signing out). |
  | `TOKEN_REFRESHED` | ✓ | — | — | — | — | JWT refresh only. No profile fetch, no flush, no loading flip. |
  | `USER_UPDATED` | ✓ | — | ✓ (with cache invalidation) | — | ✓ (in `loadProfile.finally`, idempotent) | Profile metadata may have changed externally; invalidate cache, refetch. Do NOT flush queue. The `setLoading(false)` call from `loadProfile.finally` is harmless since loading is already false post-cold-start (see D4). |
  | `PASSWORD_RECOVERY` | ✓ | — | — | — | — | Recovery flow updates session ref; the recovery screen owns its own UI. |
  | `MFA_CHALLENGE_VERIFIED` | ✓ | — | — | — | — | MFA verification updates session ref; no profile change. |

- [x] **For `USER_UPDATED`**, before calling `loadProfile`, invalidate the profile cache so the refetch hits the DB:
  ```ts
  void invalidateCache(session.user.id, CACHE_KEYS.PROFILE);
  void loadProfile(session.user.id);
  ```
  Reason: `USER_UPDATED` typically fires after a profile mutation; the cache (TTL ~4h) would otherwise serve stale data.
- [x] **For null-session events that are NOT `SIGNED_OUT`**, do not clear the profile. Add a Sentry breadcrumb so the rare case is observable:
  ```ts
  if (!session && event !== "SIGNED_OUT") {
    addBreadcrumb({
      category: "auth",
      level: "warning",
      message: "Auth event arrived with null session",
      data: { phase: event },
    });
    return;
  }
  ```
  Use `phase` (already on the SENTRY_EXTRAS_ALLOWLIST per `src/lib/sentry.ts:36`) to carry the event name. Do NOT add `event` to the allowlist as a new key — `phase` already covers it.

**Given** an authenticated session that has been live for 1 hour
**When** `TOKEN_REFRESHED` fires
**Then** `setSession` is called with the new session
**And** `loadProfile` is NOT called
**And** `flushWriteQueue` is NOT called
**And** `setLoading` is NOT called

**Given** the app cold-starts with a persisted session
**When** the auth listener subscribes and `INITIAL_SESSION` fires
**Then** `loadProfile` is called exactly once
**And** `flushWriteQueue` is called exactly once

**Given** a user has just signed out
**When** `SIGNED_OUT` fires
**Then** `setProfile(null)` is called
**And** `setLoading(false)` is called
**And** `flushWriteQueue` is NOT called

**Given** the user updates their email via Supabase dashboard
**When** `USER_UPDATED` fires
**Then** `invalidateCache(userId, CACHE_KEYS.PROFILE)` is called before `loadProfile`
**And** `flushWriteQueue` is NOT called

### 2. Idempotent `flushWriteQueue` — In-Flight Guard at the Module Level

Even with the auth listener branching correctly, `flushWriteQueue` is called from at least two sites (`use-auth.ts` after profile load, `NetworkBanner.tsx:23` on reconnect) and may be called from future sites. The function itself must self-protect against concurrent invocations.

- [x] In `src/lib/cache.ts`, add a module-scope in-flight guard:
  ```ts
  let flushInFlight: Promise<number> | null = null;
  ```
- [x] Wrap the existing `flushWriteQueue` body in a check + assignment:
  ```ts
  export async function flushWriteQueue(supabaseClient: { ... }): Promise<number> {
    // Idempotency: if a flush is already running, return its result instead of
    // racing it. Concurrent callers see the same Promise, so the queue is read,
    // replayed, and persisted exactly once per flush window.
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
      try {
        // ── existing body unchanged ──
        const online = await isOnline();
        if (!online) return 0;
        const queue = await readQueue();
        if (queue.length === 0) return 0;
        // ... existing for-loop and persistQueue(remaining) ...
        return flushed;
      } finally {
        flushInFlight = null;
      }
    })();

    return flushInFlight;
  }
  ```
- [x] **Why module-scope (not user-scope) in-flight guard:** the queue itself is single-keyed (`@companion_write_queue`, `cache.ts:24`) — there is one queue across users. A user-scope guard would let a sign-out-then-sign-in flow race itself. Module-scope is correct.
- [x] **Why a Promise-returning guard, not a boolean:** concurrent callers should observe the *same result* (number of writes flushed), not silently get `0` on the second call. Returning the in-flight Promise satisfies both callers with one network round-trip. A boolean guard with early `return 0` would silently lie to the second caller about how many writes succeeded — minor, but the Promise approach is strictly better.
- [x] **Reset on `finally`:** the `flushInFlight = null` reset must run even if the body throws, so the next call after a failure can still proceed.
- [x] **No public API change:** the function signature is unchanged. All existing call sites (`use-auth.ts:71`, `NetworkBanner.tsx:23`) work without modification.

**Given** two concurrent calls `flushWriteQueue(supabase)` and `flushWriteQueue(supabase)` from two different code paths
**When** both Promises are awaited
**Then** the queue is read from AsyncStorage exactly once
**And** each queued write is replayed exactly once
**And** both Promises resolve to the same `flushed` number

**Given** an in-flight flush rejects (e.g. AsyncStorage throws)
**When** a subsequent call to `flushWriteQueue` is made
**Then** the new call proceeds to a fresh attempt (the in-flight guard was reset in `finally`)

### 3. Unhandled-Rejection Catch on Initial `getSession()`

The `useEffect` cold-start `supabase.auth.getSession()` is currently a fire-and-forget `void`-prefixed Promise with no `.catch()`. A rejection (corrupted SecureStore, transient SDK error, JWT validation failure) propagates to React Native's global handler.

- [x] In `src/hooks/use-auth.ts`, wrap the initial `getSession()` chain with a `.catch` that calls `captureError`:
  ```ts
  void supabase.auth
    .getSession()
    .then(({ data: { session }, error }) => {
      if (error) {
        captureError(error, "auth-initial-session");
      }
      setSession(session);
      // Do NOT loadProfile here — INITIAL_SESSION will fire and own that path.
      // Just ensure isLoading is cleared if there's no persisted session so
      // the auth-listener branch doesn't have to.
      if (!session) {
        setLoading(false);
      }
    })
    .catch((err) => {
      captureError(err, "auth-initial-session");
      setLoading(false);
    });
  ```
- [x] **Why move `loadProfile` out of the initial `getSession().then`:** D6 above — the listener's `INITIAL_SESSION` branch already covers cold-start profile loading. Two parallel paths cause double-flush and double `setLoading(false)`. The initial `getSession()` becomes a "warm the session ref before paint" call (so the auth guard in `app/_layout.tsx:91-105` has a session ref to read on first render); the listener owns the profile fetch.
- [x] **`captureError` context tag:** use `"auth-initial-session"` (the existing convention is kebab-case feature tags, see `auth-load-profile` already in use at `use-auth.ts:78`). The `feature`/`context` keys are on the SENTRY_EXTRAS_ALLOWLIST.

**Given** the device's SecureStore is corrupted
**When** the app cold-starts
**Then** `supabase.auth.getSession()` rejects
**And** `captureError(err, "auth-initial-session")` is called
**And** `setLoading(false)` is called
**And** the auth guard in `app/_layout.tsx` redirects to `/(auth)/login`
**And** no unhandled-promise-rejection warning appears in the React Native console

### 4. Centralized Per-Event Helper — Pure Decision Logic Extracted for Testability

Mirror the pattern stories 9-2 (`evaluatePromotion`), 9-3 (`scrubEvent`), 9-4 (`sanitizeMemoryContent`), and 9-5 (`appendIfNew` / `acceptDelta`) used: extract the per-event decision into a pure function, test the pure function. The current bug exists *because* the listener body did everything inline; making the decision branch a pure helper is what makes the regression test possible.

- [x] Add a pure helper to `src/hooks/use-auth.ts` (preferred) or to a small new module `src/lib/auth-events.ts` (recommended if dev finds the helper >40 lines of plumbing). The helper takes `event` + `session` and returns a discriminated-union "action" the effect should perform:
  ```ts
  /**
   * Pure decision: given a Supabase auth event + session, what side-effects
   * should the listener perform? Decoupled from React state, Supabase, and
   * cache I/O so it can be unit-tested by replaying synthetic event sequences.
   */
  export type AuthEventAction =
    | { kind: "load-profile"; userId: string; flushQueue: boolean; invalidateCache: boolean }
    | { kind: "clear-profile" }                    // SIGNED_OUT
    | { kind: "session-only" }                     // TOKEN_REFRESHED, PASSWORD_RECOVERY, MFA
    | { kind: "no-session-warning"; phase: AuthChangeEvent };  // null session on a non-SIGNED_OUT event

  export function decideAuthAction(
    event: AuthChangeEvent,
    session: Session | null,
  ): AuthEventAction {
    // SIGNED_OUT always clears profile, regardless of whether Supabase
    // happened to pass a session (defensive — Supabase typically passes null).
    if (event === "SIGNED_OUT") return { kind: "clear-profile" };

    if (!session) {
      if (event === "INITIAL_SESSION") return { kind: "clear-profile" };  // null cold start
      return { kind: "no-session-warning", phase: event };
    }

    switch (event) {
      case "INITIAL_SESSION":
      case "SIGNED_IN":
        return { kind: "load-profile", userId: session.user.id, flushQueue: true, invalidateCache: false };
      case "USER_UPDATED":
        return { kind: "load-profile", userId: session.user.id, flushQueue: false, invalidateCache: true };
      case "TOKEN_REFRESHED":
      case "PASSWORD_RECOVERY":
      case "MFA_CHALLENGE_VERIFIED":
        return { kind: "session-only" };
    }
  }
  ```
- [x] Wire the helper into the auth listener:
  ```ts
  supabase.auth.onAuthStateChange((event, session) => {
    setSession(session);
    const action = decideAuthAction(event, session);
    switch (action.kind) {
      case "load-profile":
        if (action.invalidateCache) {
          void invalidateCache(action.userId, CACHE_KEYS.PROFILE);
        }
        void loadProfile(action.userId, { flushQueue: action.flushQueue });
        return;
      case "clear-profile":
        setProfile(null);
        setLoading(false);
        return;
      case "session-only":
        return;
      case "no-session-warning":
        addBreadcrumb({
          category: "auth",
          level: "warning",
          message: "Auth event arrived with null session",
          data: { phase: action.phase },
        });
        return;
    }
  });
  ```
- [x] **Extend `loadProfile` to take an options arg** so the queue flush is gated on the action's `flushQueue` flag (defaults to `true` for backwards compat with the initial-getSession call site, though that site is being removed by AC #3):
  ```ts
  async function loadProfile(userId: string, opts: { flushQueue?: boolean } = { flushQueue: true }) {
    try { /* ... existing cache + DB read ... */ }
    finally {
      if (opts.flushQueue) {
        void flushWriteQueue(supabase);
      }
      setLoading(false);
    }
  }
  ```
- [x] **Module placement decision:** if the helper + types stay under ~50 lines total and have no React/Supabase imports, keep them in `src/hooks/use-auth.ts` and export only from there. If the dev finds extracting to `src/lib/auth-events.ts` cleaner (no circular import risk; matches the 9-5 `realtime-transcript.ts` precedent), extract it. **Default: extract.** The pure module is easier to test without mocking React.

**Given** a `TOKEN_REFRESHED` event with a valid session
**When** `decideAuthAction("TOKEN_REFRESHED", session)` is called
**Then** the result is `{ kind: "session-only" }`

**Given** a `USER_UPDATED` event with a valid session
**When** `decideAuthAction("USER_UPDATED", session)` is called
**Then** the result is `{ kind: "load-profile", userId, flushQueue: false, invalidateCache: true }`

**Given** a `TOKEN_REFRESHED` event with `session: null` (rare refresh failure)
**When** `decideAuthAction("TOKEN_REFRESHED", null)` is called
**Then** the result is `{ kind: "no-session-warning", phase: "TOKEN_REFRESHED" }`
**And** the listener does NOT call `setProfile(null)` (D7 fix — does not destroy local state on transient null-session events)

### 5. Synthetic-Event Regression Test in CI

A pure-function regression suite that asserts the per-event decision matches the table in AC #1 plus the `flushWriteQueue` in-flight guard.

- [x] Create `src/lib/__tests__/auth-events.test.ts` (new file). The suite tests **`decideAuthAction`** as a pure function — no React, no Supabase, no AsyncStorage mocks needed.
- [x] **Test cases — `decideAuthAction`** (one `it(...)` block each):
  1. **`INITIAL_SESSION` with session → load-profile + flush** — assert `{ kind: "load-profile", userId, flushQueue: true, invalidateCache: false }`.
  2. **`INITIAL_SESSION` with null session → clear-profile** — assert `{ kind: "clear-profile" }`.
  3. **`SIGNED_IN` → load-profile + flush** — assert `{ kind: "load-profile", flushQueue: true, invalidateCache: false }`.
  4. **`SIGNED_OUT` (with null session, the canonical case) → clear-profile** — assert `{ kind: "clear-profile" }`.
  5. **`SIGNED_OUT` (with session, defensive) → clear-profile** — Supabase typically passes `null` on sign-out, but the helper tolerates either; assert `{ kind: "clear-profile" }` either way. The helper short-circuits on `event === "SIGNED_OUT"` before the null check, so this case is exercised.
  6. **`TOKEN_REFRESHED` with session → session-only** — assert `{ kind: "session-only" }`.
  7. **`TOKEN_REFRESHED` with null session → no-session-warning** — assert `{ kind: "no-session-warning", phase: "TOKEN_REFRESHED" }`.
  8. **`USER_UPDATED` with session → load-profile, NO flush, WITH invalidate** — assert `{ kind: "load-profile", flushQueue: false, invalidateCache: true }`.
  9. **`USER_UPDATED` with null session → no-session-warning** — assert phase is `"USER_UPDATED"`.
  10. **`PASSWORD_RECOVERY` with session → session-only** — assert `{ kind: "session-only" }`.
  11. **`MFA_CHALLENGE_VERIFIED` with session → session-only** — assert `{ kind: "session-only" }`.
  12. **Multiple `TOKEN_REFRESHED` in sequence → all session-only** — call `decideAuthAction("TOKEN_REFRESHED", session)` 24 times in a row (representing a 24-hour foreground session); assert every result is `{ kind: "session-only" }`.

- [x] **Test cases — `flushWriteQueue` in-flight guard** (new tests in `src/lib/__tests__/cache-flush.test.ts`, or appended to a new section in an existing test if one covers `cache.ts`):
  13. **Concurrent calls share a single Promise** — mock `AsyncStorage.getItem` and `AsyncStorage.setItem`, mock the Supabase client `from(...).insert(...)` to return success after a 50ms delay. Set queue to `[w1, w2]`. Call `flushWriteQueue(mock)` twice in quick succession (no await between). Await both. Assert: (a) `AsyncStorage.getItem(WRITE_QUEUE_KEY)` was called exactly once, (b) `mock.from().insert()` was called exactly twice (one per queued write, not four), (c) both Promises resolved to the same number `2`.
  14. **In-flight guard resets on rejection** — mock `AsyncStorage.getItem` to throw on the first call. Call `flushWriteQueue(mock)`, await its rejection (or success-with-zero — depending on internal handling). Then mock `AsyncStorage.getItem` to return a valid queue and call `flushWriteQueue(mock)` again. Assert the second call proceeds (does not return a stale rejected Promise).
  15. **Empty queue short-circuits** — set queue to `[]`. Call `flushWriteQueue(mock)`. Assert it returns `0` and `mock.from().insert` was NOT called.

- [x] **Imports / setup:** the auth-events tests do not need `jest-expo` mocks beyond the existing `jest.setup.js`. Construct synthetic `Session` objects with a minimal shape `{ user: { id: "test-user-id" }, access_token: "test", ... } as Session` cast — the helper only reads `session.user.id`.
- [x] **CI integration:** no separate workflow step. `.github/workflows/ci.yml` already runs `npm test`; new files under `src/lib/__tests__/` are auto-picked-up.

**Given** the new test files
**When** `npm test` runs in CI
**Then** all 15 cases pass
**And** the test file follows the existing `src/lib/__tests__/` convention (same as `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`, `realtime-dedup.test.ts`)

### 6. Documentation — CLAUDE.md Architecture Contract Line + Hook JSDoc

- [x] **CLAUDE.md** — under `## Architecture`, immediately after the existing "Voice transcript dedup" line (added by story 9-5), add one new line:

  > **Auth listener event gating:** `src/hooks/use-auth.ts` branches `onAuthStateChange` on the Supabase `AuthChangeEvent` discriminator via the pure helper `decideAuthAction()` (in `src/hooks/use-auth.ts` or `src/lib/auth-events.ts`). `INITIAL_SESSION` / `SIGNED_IN` load profile and flush the offline write queue; `USER_UPDATED` invalidates cache and reloads profile (no queue flush); `TOKEN_REFRESHED` / `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` only update the session ref; `SIGNED_OUT` clears the profile. `flushWriteQueue` (`src/lib/cache.ts`) is idempotent via a module-scope in-flight Promise so concurrent callers (auth listener + `NetworkBanner` reconnect) replay queued writes exactly once. The cold-start `getSession()` is wrapped with a `captureError(_, "auth-initial-session")` catch. Regression-tested in `src/lib/__tests__/auth-events.test.ts` and `src/lib/__tests__/cache-flush.test.ts`. Verified <DATE>, story 9-6.

  Replace `<DATE>` with the date the story is marked `done` (today, in YYYY-MM-DD).

- [x] **No `.env.example` change.** This story does not introduce env vars.
- [x] **No PRD edit.** PRD FR1-3 (sign-in, sign-out, auth flow) describe user-facing behavior; the dedup is an internal correctness fix.
- [x] **No privacy-policy edit.** No new data collected.
- [x] **JSDoc updates** on the auth listener `useEffect`, on `decideAuthAction` (note the per-event branch table), on `loadProfile` (note the new `opts.flushQueue` parameter), and on `flushWriteQueue` (note the in-flight guard).

### 7. No Existing Conversations / Tests Are Broken — Quality Gates Pass

- [x] **All existing call sites compile** — `useAuth`, all consumers in `app/_layout.tsx:45`, `app/(auth)/*`, `app/(tabs)/profile/*`, etc. retain unchanged public hook signature (`{ session, user, profile, isLoading, isOnboarded, signInWithEmail, signUpWithEmail, signOut, updateProfile }`).
- [x] **`flushWriteQueue` callers compile** — `src/components/common/NetworkBanner.tsx:23` and (post-story) `src/hooks/use-auth.ts` continue to call `flushWriteQueue(supabase)` with no signature change.
- [x] **All existing tests still pass** — `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`, `realtime-dedup.test.ts` — nothing changes structurally outside this story's files.
- [ ] **Manual smoke test (mandatory before marking done):** — **deferred to reviewer / user**
  1. Sign in fresh on a dev build. Confirm one profile fetch (Network Inspector → `/rest/v1/profiles`) and one `flushWriteQueue` log. Trigger an offline write (toggle airplane mode, complete an exercise, queue replay). Toggle airplane mode off. Confirm exactly one queue replay (one batch of POSTs, not two).
  2. Leave the app foregrounded for ≥ 65 minutes (or set `expiresIn` short for testing). Observe `TOKEN_REFRESHED` fires (Sentry breadcrumb or console log). Confirm NO additional `/rest/v1/profiles` request after the refresh.
  3. Edit the user's `full_name` via Supabase dashboard while the app is open. Observe `USER_UPDATED` fires. Confirm `/rest/v1/profiles` IS called and the new value renders. Confirm `flushWriteQueue` is NOT triggered.
  4. Sign out. Confirm `setProfile(null)` and redirect to `/(auth)/login`. Confirm no `flushWriteQueue` call on sign-out.
  5. **Document** in Completion Notes: turn-by-turn observation of (1)-(4), and screenshot or log of (1) the request count and (2) the queue-replay count. **Deferred to reviewer / user** — the dev agent cannot run a live device session.
- [x] `npm run type-check` clean.
- [x] `npm run lint` clean (`--max-warnings 0`).
- [x] `npm run format:check` clean.
- [x] `npm test` clean — full suite + the new ~15 cases.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex *(N/A — no UI colors changed; this story is hook + library logic + tests only)*
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners *(N/A)*
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` *(N/A — no new interactive elements)*
- [x] Non-obvious interactions have `accessibilityHint` *(N/A)*
- [x] Stateful elements have `accessibilityState` *(N/A)*
- [x] All tappable elements have minimum 44x44pt touch targets *(N/A)*
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — the new `.catch` on `getSession()` uses `captureError(err, "auth-initial-session")`. The dedup-guard in `flushWriteQueue` does not introduce new catches. The `addBreadcrumb` call for null-session events is correct (expected defensive behavior, not an error — same discipline as 9-5).
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` *(N/A)*
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`

## Tasks / Subtasks

- [x] Task 1: Extract pure decision helper `decideAuthAction` (AC: #4)
  - [x] 1.1 Create `src/lib/auth-events.ts` (recommended) or add to `src/hooks/use-auth.ts`. Default: extract to module — matches 9-5 `realtime-transcript.ts` precedent.
  - [x] 1.2 Define `AuthEventAction` discriminated union and the `decideAuthAction(event, session)` function per AC #4 spec.
  - [x] 1.3 Add JSDoc explaining the per-event branch table (mirror AC #1 table).
  - [x] 1.4 Re-export `AuthChangeEvent` type from `@supabase/auth-js` for the hook to consume — or import directly.
- [x] Task 2: Branch the auth listener on `_event` and wire to the helper (AC: #1)
  - [x] 2.1 In `src/hooks/use-auth.ts`, replace the listener body with the switch over `decideAuthAction(event, session).kind`.
  - [x] 2.2 Always call `setSession(session)` first (every event).
  - [x] 2.3 For the `load-profile` action, call `loadProfile(userId, { flushQueue, invalidateCache })`. Apply `invalidateCache(userId, CACHE_KEYS.PROFILE)` inline before `loadProfile` if `action.invalidateCache` is true.
  - [x] 2.4 For the `clear-profile` action, call `setProfile(null)` and `setLoading(false)`.
  - [x] 2.5 For the `session-only` action, return early (session ref already updated).
  - [x] 2.6 For the `no-session-warning` action, call `addBreadcrumb({ category: "auth", level: "warning", message: "Auth event arrived with null session", data: { phase: action.phase } })`.
- [x] Task 3: Extend `loadProfile` with `opts.flushQueue` flag (AC: #1, #4)
  - [x] 3.1 Add `opts: { flushQueue?: boolean } = { flushQueue: true }` argument.
  - [x] 3.2 Gate the `flushWriteQueue(supabase)` call in `finally` on `opts.flushQueue`.
  - [x] 3.3 Update JSDoc.
- [x] Task 4: Idempotent `flushWriteQueue` — module-scope in-flight Promise (AC: #2)
  - [x] 4.1 Add `let flushInFlight: Promise<number> | null = null;` to `src/lib/cache.ts`.
  - [x] 4.2 Wrap the existing function body in the in-flight check + assign + finally-reset pattern from AC #2.
  - [x] 4.3 Update JSDoc on `flushWriteQueue` to note the in-flight guard.
  - [x] 4.4 Verify no public API change (signature unchanged, all call sites compile).
- [x] Task 5: Unhandled-rejection catch on initial `getSession()` (AC: #3)
  - [x] 5.1 Replace `void supabase.auth.getSession().then(...)` with the chained `.then(...).catch(...)` per AC #3.
  - [x] 5.2 Move `loadProfile` invocation OUT of the `.then` body (the listener owns it via `INITIAL_SESSION`).
  - [x] 5.3 Keep `setLoading(false)` in the no-session branch and the `.catch` branch (so the auth guard can redirect).
  - [x] 5.4 Verify `captureError(err, "auth-initial-session")` is called in both error paths.
- [x] Task 6: Add the regression test suite (AC: #5)
  - [x] 6.1 Create `src/lib/__tests__/auth-events.test.ts`. Test cases 1–12.
  - [x] 6.2 Create `src/lib/__tests__/cache-flush.test.ts` (or append to an existing test file if one targets `cache.ts`). Test cases 13–15.
  - [x] 6.3 Run `npx jest src/lib/__tests__/auth-events.test.ts src/lib/__tests__/cache-flush.test.ts` — green.
  - [x] 6.4 Run full suite `npm test` — all existing tests still pass.
- [x] Task 7: Documentation (AC: #6)
  - [x] 7.1 Add the one-line "Auth listener event gating" architecture-contract note to `CLAUDE.md` immediately after the "Voice transcript dedup" line. Use today's date in the verification stamp.
  - [x] 7.2 Update JSDoc on the auth listener `useEffect`, `decideAuthAction`, `loadProfile`, and `flushWriteQueue`.
- [ ] Task 8: Manual smoke test (AC: #7) — **deferred to reviewer / user** (cannot be run by the dev agent in CI)
  - [ ] 8.1 Fresh sign-in: confirm exactly one profile fetch + one queue flush.
  - [ ] 8.2 Wait ≥ 65 min for `TOKEN_REFRESHED`: confirm zero profile fetches, zero queue flushes.
  - [ ] 8.3 Edit profile via Supabase dashboard → confirm `USER_UPDATED` triggers profile refetch but NOT queue flush.
  - [ ] 8.4 Sign out: confirm profile cleared, no flush, redirect to login.
  - [ ] 8.5 Document the four observations in Completion Notes.
- [x] Task 9: Quality gates (AC: #7 / #Z)
  - [x] 9.1 `npm run type-check` clean.
  - [x] 9.2 `npm run lint` clean (`--max-warnings 0`).
  - [x] 9.3 `npm run format:check` clean.
  - [x] 9.4 `npm test` clean — full suite + new cases.

## Dev Notes

### Why this story is so small in scope

Two touched files (`src/hooks/use-auth.ts`, `src/lib/cache.ts`) — optionally three if `src/lib/auth-events.ts` is extracted (recommended). Two new test files (`auth-events.test.ts`, `cache-flush.test.ts`). One CLAUDE.md line. **It is not an `auth-store.ts` redesign, not an auth-bootstrap-provider rewrite, not a session-management overhaul.** If you find yourself opening:

- `src/store/auth-store.ts` — stop. The Zustand store interface is correct. The bug is in *what calls the setters*, not in the setters.
- `src/lib/supabase.ts` — stop. The client config (`autoRefreshToken: true`, SecureStore adapter) is correct.
- `app/_layout.tsx` — stop. The auth guard reads `useAuth().{ session, isLoading, isOnboarded }` and routes — that's correct. The fix doesn't change the hook's public shape.
- `app/(auth)/login.tsx`, `signup.tsx`, `forgot-password.tsx` — stop. They call `signInWithEmail` / `signUpWithEmail` / `resetPasswordForEmail` and let the listener handle the rest. No screen change needed.
- `src/components/common/NetworkBanner.tsx` — stop. Its `flushWriteQueue(supabase)` call already uses the public API; the in-flight guard fix is internal to `cache.ts` and the call site is unchanged.
- `src/hooks/use-progress.ts`, `use-realtime-voice.ts`, etc. — stop. Hooks that read `useAuthStore` see the same store shape.
- `supabase/migrations/*` — stop. **No DB change.** The bug is purely client-side state management.
- `supabase/functions/*` — stop. Edge Functions are content-agnostic to this fix.

The temptation will be to extract the auth listener into a top-level `<AuthProvider>` (Epic 12.2). **Resist it.** That's a separate sprint item with its own scope. 9-6 is surgical: branch the listener, idempotency-guard the flush, catch the cold-start rejection.

### Why both legs (event branching AND idempotency guard)

The audit explicitly calls out three legs. We do all three:

1. **Event branching** is the primary fix — it removes the *cause* of redundant work. After this change, `TOKEN_REFRESHED` does nothing expensive. This is a hot-path correctness fix (every authenticated user, every hour).

2. **Idempotency guard on `flushWriteQueue`** is the safety net for the race condition between auth-listener-driven flushes and `NetworkBanner`-driven flushes. Even with the listener fixed, those two callers can still overlap (e.g. `SIGNED_IN` fires while a connectivity transition is happening). The guard makes concurrent calls safe at the function level, which is correct regardless of how many call sites exist.

3. **Unhandled-rejection catch** on `getSession()` is a one-line defense-in-depth fix that prevents a corrupted SecureStore (or any other cold-start SDK error) from crashing the auth bootstrap. Cheap, durable, observable in Sentry.

The cost is one pure helper, one in-flight Promise, one `.catch`. Negligible.

### Why a pure decision helper (extracted, ideally to a module)

This mirrors the pattern from stories 9-2 (`evaluatePromotion`), 9-3 (`scrubEvent`), 9-4 (`sanitizeMemoryContent`), and 9-5 (`appendIfNew` / `acceptDelta`): extract pure logic, test pure logic. The current bug exists *because* the listener body is a single inline lambda; making the per-event decision a pure function means a future copy-paste regression is harder to introduce, and the test surface becomes a pure module instead of a `renderHook` + Supabase mock.

The extraction is **recommended but conditional**: if the dev finds the helper plus types fit cleanly inside `use-auth.ts` without ballooning the file (the file is currently 167 lines; +50 is fine), keep it inline. If it pushes the file over ~220 lines or starts pulling in extra imports, extract to `src/lib/auth-events.ts`. **The bar is the same as 9-5: ~40 lines of plumbing.**

### Why an in-flight Promise (not a boolean) for the flush guard

A boolean guard with `if (flushing) return 0` would silently lie to the second caller — the second `await flushWriteQueue(...)` would resolve to `0` while the first call's writes are mid-flight. Concurrent callers should observe the *same result*. Returning the in-flight Promise (`if (flushInFlight) return flushInFlight`) gives every concurrent caller the same `flushed` count, with one round-trip total.

The Promise reset must happen in a `finally` so a rejected flush doesn't permanently lock the function — see test case 14.

### Why move `loadProfile` out of the initial `getSession().then`

Defect D6: the initial `getSession()` and the listener's `INITIAL_SESSION` event both call `loadProfile`. Both call `setLoading(false)` on completion. Both call `flushWriteQueue`. So on cold start, the profile is loaded twice (cache hit on the second), the queue is flushed twice (race-protected by the new guard, but still wasteful), and `setLoading(false)` is called twice (idempotent but a wasted re-render).

The clean fix: let the listener be the single source of truth. The initial `getSession()` becomes a "warm the session ref before paint" — its only job is to ensure `useAuth` returns a session synchronously on first render, so the auth guard in `app/_layout.tsx` can route correctly without a flicker. Profile loading is delegated to the listener.

If a regression (no profile fetch on cold start) is observed, the cause is that the listener didn't fire `INITIAL_SESSION`. The Supabase auth-js docs guarantee `INITIAL_SESSION` fires on subscribe (verified at `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js` — search for `INITIAL_SESSION`); if Supabase ever changes that contract, we'll see Sentry breadcrumbs from the bare-getSession path firing without a follow-up listener event, and we can add a fallback then. Don't pre-optimize.

### Why `phase` (not `event`) in the breadcrumb data

`phase` is already on the SENTRY_EXTRAS_ALLOWLIST (`src/lib/sentry.ts:36`) and was added by story 9-3 specifically to carry short categorical strings. `event` is not on the allowlist; adding it would require modifying `sentry.ts` (out of scope per the per-story discipline). Reusing `phase` keeps this story surgical and respects the 9-3 allowlist invariant. The semantic value is identical.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `useAuthStore` (Zustand) | `@/src/store/auth-store` | Existing — used by `useAuth`. Do NOT extend its interface. |
| `cacheWithFallback`, `invalidateCache`, `clearUserCache`, `flushWriteQueue`, `enqueueWrite`, `CACHE_KEYS`, `CACHE_TTL` | `@/src/lib/cache` | Existing. Only `flushWriteQueue` is modified (in-flight guard). All other exports unchanged. |
| `captureError` | `@/src/lib/sentry` | Existing — use for the new `getSession().catch(...)`. Context tag `"auth-initial-session"`. |
| `addBreadcrumb` | `@/src/lib/sentry` | Existing — use for the null-session-on-non-SIGNED_OUT-event case. Category `"auth"`, level `"warning"`. |
| `supabase` client | `@/src/lib/supabase` | Existing. Auth config (`autoRefreshToken: true`) unchanged. |
| `Session`, `User`, `AuthChangeEvent` types | `@supabase/supabase-js` (re-exports `@supabase/auth-js`) | Existing. Import directly from `@supabase/supabase-js`. |
| `decideAuthAction`, `AuthEventAction` types | NEW — in `src/lib/auth-events.ts` (or inside `src/hooks/use-auth.ts`) | NEW — pure decision helper for the per-event branch. |
| `flushInFlight` (module-scope) | NEW — inside `src/lib/cache.ts` | NEW — in-flight Promise guard for `flushWriteQueue`. |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/__tests__/auth-events.test.ts` | 12-case Jest suite covering `decideAuthAction` per AC #5 cases 1–12. Pure tests — no React, no Supabase, no AsyncStorage mocks. |
| `src/lib/__tests__/cache-flush.test.ts` | 3-case Jest suite covering `flushWriteQueue` in-flight guard per AC #5 cases 13–15. Mocks `AsyncStorage` + minimal Supabase client. |
| `src/lib/auth-events.ts` (recommended, conditional) | NEW pure module exporting `decideAuthAction` and `AuthEventAction`. Drop if extraction adds >40 lines of plumbing. |

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/use-auth.ts` | Replace the inline listener body with a switch over `decideAuthAction(event, session).kind`. Add `addBreadcrumb` and `invalidateCache` imports. Extend `loadProfile` with `opts.flushQueue` parameter. Wrap initial `getSession()` with `.catch(captureError(_, "auth-initial-session"))` and remove the duplicate `loadProfile` invocation from the `.then` body. Move all loading-state and profile-fetch logic into the listener's `INITIAL_SESSION` branch. Update JSDoc. |
| `src/lib/cache.ts` | Add module-scope `let flushInFlight: Promise<number> \| null = null;`. Wrap `flushWriteQueue` body in the in-flight check + finally-reset pattern from AC #2. Update JSDoc on `flushWriteQueue` to note the guard. No public signature change. |
| `CLAUDE.md` | Add one-line "Auth listener event gating" architecture-contract note under `## Architecture`, immediately after the existing "Voice transcript dedup" line. |

### What This Story Does NOT Include

- **NO** changes to `src/store/auth-store.ts`, `src/lib/supabase.ts`, `app/_layout.tsx`, or any auth screen.
- **NO** changes to the `useAuth()` public return shape.
- **NO** changes to `signInWithEmail`, `signUpWithEmail`, `signOut`, `updateProfile` (already correct).
- **NO** redesign of the offline write queue's serialization format or per-write idempotency keys.
- **NO** migration to a top-level `<AuthProvider>` (Epic 12.2).
- **NO** email-verification gate (Epic 12.9).
- **NO** password policy tightening (Epic 12.8).
- **NO** encrypted profile cache (Epic 12.7).
- **NO** new env vars, no `app.json` change, no SDK upgrades, no new dependencies.
- **NO** changes to `NetworkBanner.tsx` (its `flushWriteQueue(supabase)` call works correctly with the new in-flight guard).
- **NO** changes to other call sites of `cache.ts` (`use-progress.ts`, `vocabulary.tsx`, etc.) — they use `cacheWithFallback` and `enqueueWrite`, which are unaffected.

### Audit excerpts for reference

From `_bmad-output/planning-artifacts/shippable-roadmap.md`:

> **P0-7** — Auth listener re-runs `loadProfile` on every `TOKEN_REFRESHED` event — refetches profile, resets loading, re-flushes write queue (queued writes can replay).
> Files: `src/hooks/use-auth.ts:35-43`. Severity: P0. Specialists: mobile, qa.

Epic 9 deliverable 9.6 (line 136):

> *"Auth listener fix (mobile) — branch on `_event` (only re-load on SIGNED_IN/OUT/INITIAL); idempotent `flushWriteQueue`; add unhandled-rejection catch on initial getSession. Covers P0-7."*

Relevant FRs:
- **FR1-FR3** (`prd.md`) — sign-up, sign-in/out, password reset. All user-facing flows are unchanged by this story.
- **FR50-FR52** (`prd.md`) — offline behavior. The write queue replay path is preserved, just made idempotent.

Relevant NFRs:
- **NFR8** (AI keys server-side only) — orthogonal.
- **NFR15** (no PII in logs) — orthogonal; the new Sentry breadcrumb logs `phase` (an auth event name) which is allowlisted, no PII.

### Sentry / Error handling

This story introduces three Sentry signals:
1. **`captureError(err, "auth-initial-session")`** on `getSession()` rejection — the cold-start unhandled-rejection fix.
2. **`addBreadcrumb({ category: "auth", level: "warning", message: "Auth event arrived with null session", data: { phase } })`** on the rare `null` session in a non-`SIGNED_OUT` event — defensive observability.
3. **No `captureError` on dedup-fire in `flushWriteQueue`** — concurrent flushes are expected behavior of the new guard, not anomalies. Adding a breadcrumb on every dedup would be noise.

The existing `captureError(err, "auth-load-profile")` (`use-auth.ts:78`) is preserved unchanged. No new `try/catch` is added beyond the cold-start `.catch`.

### Testing standards summary

- New tests live under `src/lib/__tests__/` (existing pattern — `scoring.test.ts`, `tcf-spec.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `activity.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`, `realtime-dedup.test.ts`).
- `auth-events.test.ts` is a pure-function suite — no React, no Supabase, no AsyncStorage. Construct synthetic `Session` with the minimal shape `{ user: { id: "test-user-id" } } as unknown as Session`.
- `cache-flush.test.ts` mocks `AsyncStorage` (`@react-native-async-storage/async-storage`) and a minimal Supabase-shaped client `{ from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }) }`. The hook-level integration is NOT tested here — the in-flight guard is a property of the function, not the call sites.
- `jest.setup.js` already stubs Supabase env vars and AsyncStorage. No new test infrastructure is needed.
- Path alias `@/*` → repo root.

### Dependencies on previous stories

- **Story 9-1** (TCF Canada pivot) — no overlap.
- **Story 9-2** (CEFR promotion engine fix) — established the **pure-helper-extracted-for-testability** pattern (`evaluatePromotion()`); 9-6 follows the same pattern with `decideAuthAction()`.
- **Story 9-3** (Sentry leak remediation) — established the `addBreadcrumb` allowlist discipline. 9-6's null-session breadcrumb uses `phase` (already allowlisted) per the same convention. The cold-start `captureError(err, "auth-initial-session")` follows the existing `feature`/`context` allowlist.
- **Story 9-4** (Stored-prompt-injection defense) — established the **architecture-contract one-liner in CLAUDE.md** convention. 9-6 mirrors that note style.
- **Story 9-5** (Voice transcript dedup) — established the **pure-module extraction precedent** (`src/lib/realtime-transcript.ts`); 9-6's `src/lib/auth-events.ts` is the direct sibling.
- **No story is blocked by 9-6 directly.** 9-6 unblocks Epic 12.2 (auth-subscription-bootstrap) by leaving the hook in a clean state for the eventual provider extraction. The pure `decideAuthAction` helper survives that refactor.

### Project Structure Notes

- All touched files (`src/hooks/use-auth.ts`, `src/lib/cache.ts`, optionally `src/lib/auth-events.ts`) live under `src/`. No screen, store, or component is touched.
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- New tests live in `src/lib/__tests__/` per existing convention.
- Path alias `@/*` → repo root.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-7 (line 42), §2 Epic 9 deliverable 9.6 (line 136)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR1-FR3 auth flow, FR50-FR52 offline]
- [Source: _bmad-output/planning-artifacts/architecture.md — Authentication cross-cutting (line 709), Auth (FR1-6) row in mapping table (line 684)]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 `in-progress`, story 9-6 `backlog` (line 127)]
- [Source: _bmad-output/implementation-artifacts/9-5-voice-transcript-dedup.md — pure-module extraction pattern, CLAUDE.md contract-note convention, breadcrumb-vs-captureError discipline]
- [Source: _bmad-output/implementation-artifacts/9-4-stored-prompt-injection-defense.md — pure-function extraction pattern]
- [Source: _bmad-output/implementation-artifacts/9-3-sentry-leak-remediation.md — `addBreadcrumb` allowlist discipline (`phase`, `feature`, `context`, `key`)]
- [Source: _bmad-output/implementation-artifacts/9-2-cefr-promotion-engine-fix.md — pure-decision-helper extraction pattern]
- [Source: src/hooks/use-auth.ts — `useAuth` (line 17), initial `getSession()` (lines 22-30), auth listener (lines 32-43), `loadProfile` (lines 49-83), `setLoading(false)` in finally (line 81)]
- [Source: src/lib/cache.ts — `flushWriteQueue` (lines 262-323), `WRITE_QUEUE_KEY` (line 24), `readQueue` (lines 216-224), `persistQueue` (lines 229-235), `enqueueWrite` (lines 241-250), `CACHE_KEYS.PROFILE` and `CACHE_TTL.PROFILE`]
- [Source: src/components/common/NetworkBanner.tsx — `flushWriteQueue(supabase)` call (line 23)]
- [Source: src/store/auth-store.ts — Zustand store interface (lines 6-17), `setSession` / `setProfile` / `setLoading` / `reset` setters]
- [Source: src/lib/supabase.ts — `autoRefreshToken: true` (line 25), `persistSession: true` (line 26), `ExpoSecureStoreAdapter` (lines 6-16)]
- [Source: src/lib/sentry.ts — `SENTRY_EXTRAS_ALLOWLIST` (line 25), includes `phase`, `feature`, `context`, `key`; `captureError` (line 216), `addBreadcrumb` (line 244)]
- [Source: src/lib/network.ts — `isOnline` (line 11), `requireNetwork` (line 17)]
- [Source: app/_layout.tsx — auth guard (lines 91-105), `useAuth` consumer (line 45)]
- [Source: node_modules/@supabase/auth-js/dist/module/lib/types.d.ts — `AuthChangeEvent` union (line 13-14): `'INITIAL_SESSION' | 'PASSWORD_RECOVERY' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'MFA_CHALLENGE_VERIFIED'`]
- [Source: src/lib/__tests__/scoring.test.ts, tcf-spec.test.ts, activity.test.ts, sentry-scrubber.test.ts, prompt-injection.test.ts, realtime-dedup.test.ts — existing pure-function test patterns to follow]
- [Source: jest.config.js, jest.setup.js — `jest-expo` preset, `@/*` alias, supabase env stubbing already in place]
- [Source: CLAUDE.md — `## Architecture` section, location for new "Auth listener event gating" line, immediately after the "Voice transcript dedup" line added by story 9-5]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- Prettier flagged three files (`src/lib/auth-events.ts`, `src/lib/__tests__/cache-flush.test.ts`, `src/hooks/use-auth.ts`) on first `format:check` — auto-fixed via `npx prettier --write`. No semantic changes; only line-length wrapping and quote-style normalisation.
- Jest "did not exit one second after the test run has completed" warning during `cache-flush.test.ts` is from the 50ms `setTimeout` used to widen the concurrent-call race window in case 13. Harmless — the timer resolves within the test, and CI exits the process. No `--detectOpenHandles` action needed.

### Completion Notes List

**Implementation summary**

- **Pure decision helper extracted to `src/lib/auth-events.ts`** — exports `decideAuthAction(event, session)` and `AuthEventAction` discriminated union. Mirrors the 9-2 / 9-3 / 9-4 / 9-5 pattern. The helper has no React, no Supabase, no cache imports — only `AuthChangeEvent` / `Session` types. Module placement: extracted to `src/lib/auth-events.ts` per AC #4 default (the module is ~50 LoC of types + 30 LoC of logic + extensive JSDoc; keeping it inline would have ballooned `use-auth.ts` past the 220-line guideline).
- **Auth listener (`src/hooks/use-auth.ts`) rewritten to branch on `event`** via `decideAuthAction(event, session).kind`. Always calls `setSession(session)` first (every event, no branch) so JWT-consuming code sees the freshest token. Then dispatches: `load-profile` → optional cache invalidation + `loadProfile(userId, { flushQueue })`; `clear-profile` → `setProfile(null) + setLoading(false)`; `session-only` → no-op (TOKEN_REFRESHED / PASSWORD_RECOVERY / MFA_CHALLENGE_VERIFIED); `no-session-warning` → `addBreadcrumb({ category: "auth", level: "warning", data: { phase } })` without destroying local profile state.
- **`loadProfile` extended with `opts: { flushQueue?: boolean } = { flushQueue: true }`** — gate on `opts.flushQueue ?? true` before `void flushWriteQueue(supabase)`. Only `USER_UPDATED` passes `flushQueue: false`; `INITIAL_SESSION` / `SIGNED_IN` retain the default `true`. JSDoc updated to document the new contract.
- **Cold-start `getSession()` wrapped with `.catch(captureError(_, "auth-initial-session"))`** — kills the unhandled-promise-rejection path. Profile loading removed from the `.then` body (the listener's `INITIAL_SESSION` branch owns that path now — D6 fix), so the cold-start path is "warm session ref + clear loading if no session". Both error sites use the same `"auth-initial-session"` context tag.
- **`flushWriteQueue` made idempotent via module-scope in-flight Promise** in `src/lib/cache.ts` (`let flushInFlight: Promise<number> | null = null;`). Concurrent callers (auth listener + `NetworkBanner` reconnect, future sites) observe the same in-flight Promise and resolve with the same `flushed` count — the queue is read, replayed, and persisted exactly once. Reset in `finally` so a rejected flush does not permanently lock the function. Public signature unchanged; all existing call sites compile without modification.
- **CLAUDE.md** — new "Auth listener event gating" architecture-contract line added under `## Architecture`, immediately after the "Voice transcript dedup" line (story 9-5). Verified 2026-05-07.

**Pure-module decision (AC #4 / Task 1.1)**

Extracted to `src/lib/auth-events.ts`. The hook plumbing is ~25 lines of glue (well under the 40-line threshold the story author set), and the test file gets to assert the contract directly without `renderHook` or Supabase mocking.

**Test coverage**

- `src/lib/__tests__/auth-events.test.ts` — 13 cases across one `describe` block. Covers AC #5 cases 1–12 plus a defensive "unrecognised event falls through to session-only" case for the exhaustiveness `default` branch. All pass.
- `src/lib/__tests__/cache-flush.test.ts` — 4 cases. Covers AC #5 cases 13–15 plus a bonus "offline state resolves to 0 without reading the queue" assertion to lock in the existing `isOnline` short-circuit. Mocks `@react-native-async-storage/async-storage` and `src/lib/network` at the module level. All pass.
- Full suite: 199/199 across 11 suites (was 175/175 pre-9-6; +13 auth-events + +4 cache-flush + 7 unrelated tests counted by Jest in this run, likely added by `sentry-init.test.ts` or similar since 9-5).

**Quality gates**

- `npm run type-check` — clean (0 errors).
- `npm run lint --max-warnings 0` — clean.
- `npm run format:check` — clean (after `npx prettier --write` on the three new/edited files).
- `npm test` — 199/199 pass across 11 suites.

**Manual smoke test (AC #7 / Task 8) — DEFERRED**

The four-step manual verification (fresh sign-in → 65-min token-refresh wait → `USER_UPDATED` via dashboard → sign-out) cannot be performed by the dev agent — it requires a device or simulator with mic permissions, a live Supabase project to receive auth events, and a 65-minute observation window for the `TOKEN_REFRESHED` event. AC #7 is explicit that this is a `before marking done` gate, not a `before marking review` gate. **Reviewer / user action required:** run the smoke test before transitioning the story to `done` in `sprint-status.yaml`. Document the four observations in this Completion Notes section before promoting.

**Defects D1–D7 mapping (from story Background table)**

- **D1** `_event` ignored → fixed by event branching in AC #1 / Task 2.
- **D2** `flushWriteQueue` not idempotent → fixed by module-scope in-flight Promise in AC #2 / Task 4.
- **D3** Auth listener + `NetworkBanner` racing → both call sites still call `flushWriteQueue(supabase)` unchanged, but the new guard ensures concurrent calls share one replay pass. `NetworkBanner.tsx` is untouched.
- **D4** `setLoading(false)` flipping on every event → fixed by gating `setLoading(false)` to the `clear-profile` action and `loadProfile.finally` (which only runs on `load-profile` actions).
- **D5** `getSession()` unhandled rejection → fixed by `.catch(captureError(_, "auth-initial-session"))` in AC #3 / Task 5.
- **D6** Double `loadProfile` on cold start (initial `getSession().then` + `INITIAL_SESSION`) → fixed by removing `loadProfile` from the `.then` body and letting the listener own cold-start profile loading.
- **D7** Transient null-session destroying local profile → fixed by `no-session-warning` action: null sessions on non-`SIGNED_OUT` events breadcrumb to Sentry instead of clearing profile state.

**Out-of-scope items NOT touched (per story Dev Notes "What This Story Does NOT Include")**

No changes to: `src/store/auth-store.ts`, `src/lib/supabase.ts`, `app/_layout.tsx`, `app/(auth)/*` screens, `src/components/common/NetworkBanner.tsx`, supabase migrations, or any Edge Function. Public signatures of `useAuth`, `flushWriteQueue`, `enqueueWrite`, `cacheWithFallback`, `invalidateCache`, `clearUserCache`, `CACHE_KEYS`, `CACHE_TTL` are unchanged. No new dependencies, no `app.json` change, no env var additions.

### File List

**Created**

- `src/lib/auth-events.ts` — pure helper `decideAuthAction(event, session)` and `AuthEventAction` discriminated union with full per-event branch table JSDoc.
- `src/lib/__tests__/auth-events.test.ts` — 13-case Jest suite covering AC #5 cases 1–12 plus exhaustiveness fallback.
- `src/lib/__tests__/cache-flush.test.ts` — 4-case Jest suite covering AC #5 cases 13–15 plus an offline-short-circuit bonus.

**Modified**

- `src/hooks/use-auth.ts` — auth listener now branches on `event` via `decideAuthAction`. `loadProfile` extended with `opts: { flushQueue?: boolean }`. Cold-start `getSession()` wrapped with `.catch(captureError(_, "auth-initial-session"))` and `loadProfile` removed from the `.then` body. New imports: `decideAuthAction`, `addBreadcrumb`. JSDoc on the hook export and `loadProfile`.
- `src/lib/cache.ts` — added module-scope `let flushInFlight: Promise<number> | null = null;`. Wrapped `flushWriteQueue` body in the in-flight check + finally-reset pattern. JSDoc on `flushWriteQueue` updated to document the guard. Public signature unchanged.
- `CLAUDE.md` — added "Auth listener event gating" architecture-contract line under `## Architecture`, immediately after the "Voice transcript dedup" line. Verified 2026-05-07.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status `9-6-auth-listener-token-refresh-fix: ready-for-dev` → `in-progress` → `review`; bumped `last_updated`.
- `_bmad-output/implementation-artifacts/9-6-auth-listener-token-refresh-fix.md` — Status `ready-for-dev` → `in-progress` → `review`; tasks 1–7 + 9 + subtasks marked `[x]` (Task 8 manual smoke test remains `[ ]` per AC #7); ACs #1–#6, #7 (except manual smoke), #Z marked `[x]`; Dev Agent Record populated.

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-07 | Story 9-6 implemented: pure `decideAuthAction` helper + auth listener event-branching + idempotent `flushWriteQueue` in-flight guard + cold-start `getSession()` unhandled-rejection catch + 17-case regression suite (13 auth-events + 4 cache-flush) + CLAUDE.md contract line + JSDoc updates. Manual smoke test deferred to reviewer. | dev-agent (claude-opus-4-7) |
