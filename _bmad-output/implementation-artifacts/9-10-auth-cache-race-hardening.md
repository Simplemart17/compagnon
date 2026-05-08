# Story 9.10: Auth + Cache Race Hardening

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an authenticated French learner whose app is exposed to real-world signal-flow conditions — flaky network during cold start, rapid sign-out/sign-in toggles on a shared device, an offline cache occasionally corrupted by a force-quit, and concurrent writes to the offline queue while a flush is mid-flight,
I want the auth listener and the offline write queue to be defensive against the four concurrency / state-correctness races that the 9-6 code review surfaced as pre-existing issues,
so that signing out actually clears the profile (no stale-render leak), no offline write is silently dropped because a flush was racing an enqueue, a corrupted profile cache does not route me into the onboarding wizard I already completed, and a transient `flushWriteQueue` rejection does not corrupt the in-flight Promise contract for concurrent callers.

## Background — Why This Story Exists

The 9-6 code review (Blind Hunter / Edge Case Hunter / Acceptance Auditor parallel run on 2026-05-07) surfaced four pre-existing race conditions in `src/hooks/use-auth.ts` and `src/lib/cache.ts` that 9-6 did not introduce but also did not fix. Each was deferred from 9-6 with the understanding that they would be tracked as a follow-up. This story is that follow-up.

| # | Defect | Source | Severity | Location |
|---|--------|--------|:--------:|----------|
| **D1** | In-flight `loadProfile` resolves AFTER `SIGNED_OUT` → calls `setProfile(profile)` and re-installs the cleared profile in memory. Auth guard already routed the user to login (it only checks `session`), but `profile` lingers until the next event and could leak via any consumer that reads `profile` without checking `session`. | Edge E1 + Blind H3 | HIGH (latent) | `src/hooks/use-auth.ts:74-77` (the `void loadProfile(...)` call site) and `:120-138` (the `clear-profile` action) |
| **D2** | `enqueueWrite` called WHILE `flushWriteQueue` is mid-flight is silently destroyed. Sequence: flush reads `[w1, w2]` → user enqueues `w3` (its own read-modify-write writes `[w1, w2, w3]`) → flush replays `w1`/`w2` and calls `persistQueue([])`, OVERWRITING `w3`. Pre-existing read-modify-write race in `cache.ts`; the 9-6 in-flight guard handles concurrent flushes but does not coordinate with concurrent enqueues. | Edge E2 | HIGH (data loss) | `src/lib/cache.ts:241-250` (`enqueueWrite`) + `:283-329` (`flushWriteQueue` IIFE) |
| **D3** | `cacheWithFallback` rethrows when both network AND cache fail (e.g. corrupted cache + offline cold start). `loadProfile` catches and treats it as "expected degradation" — `profile` stays null, `isOnboarded` stays false, and the auth guard at `app/_layout.tsx:99-101` routes the user to `/onboarding` for an already-onboarded user. No "profile unavailable, retry" state. | Edge E6 | MED (UX regression) | `src/hooks/use-auth.ts:143-149`; cascade via `app/_layout.tsx:99-101` |
| **D4** | `flushInFlight` rejection propagates to every concurrent caller. If `isOnline` throws (NOT swallowed by `readQueue`'s `try/catch`), the IIFE rejects, all `await`-ing callers receive the rejection. Today no caller `await`s `flushWriteQueue` (all use `void`), so it's theoretical — but a future caller that awaits will see other callers' transient failures. | Edge E7 | MED (defensive) | `src/lib/cache.ts:283-329` |

D1 and D2 are HIGH-severity but pre-existed 9-6 in the same form. D3 is a pre-existing UX bug. D4 is a defensive hardening item that the 9-6 in-flight guard surfaced but did not introduce.

**Threat / failure model — what cannot happen post-story:**

After this story:

1. A `loadProfile` call started by `INITIAL_SESSION` or `SIGNED_IN` for user A, and resolving after `SIGNED_OUT` fires, does NOT re-install user A's profile. The result is dropped silently with a Sentry breadcrumb.
2. An `enqueueWrite` issued during a `flushWriteQueue` replay is preserved across the flush boundary — either it lands in the post-flush queue state, or it is replayed on the next flush, never silently destroyed.
3. A profile fetch that fails on both network and cache (offline + corrupted cache) puts the auth state into an explicit `profileFetchFailed: true` flag. The auth guard observes this flag and routes to a retry surface (or holds on the splash with a retry CTA) instead of the onboarding wizard.
4. A `flushWriteQueue` IIFE that throws internally (e.g. from `isOnline`) resolves to `0` for all concurrent callers instead of rejecting. Concurrent callers see "no writes flushed this round" but do not propagate the inner failure.

**Out of scope for this story (delegated elsewhere):**

- **Auth subscription bootstrap rewrite** (move auth listener out of the hook into a top-level provider) → **Epic 12.2**. 9-10 keeps the listener inside `use-auth.ts`. Surgical scope.
- **Per-write idempotency keys + database UNIQUE constraints** → out of scope. The application-tier merge is the right layer for now; UNIQUE would block legitimate identical writes.
- **Encrypted profile cache** → **Epic 12.7**. 9-10 does not change `cache.ts` storage layer.
- **Decomposing `flushWriteQueue` into a per-table queue** → out of scope. Single queue with merge-on-persist is the minimal fix.
- **A full `<AuthProvider>` redesign or epoch-based session tracking** → out of scope. A `userId === currentUserId` guard at the `setProfile` call site is the minimal fix.
- **Rewriting `cacheWithFallback` to expose a tri-state result (`{ data, fromCache, failed }`)** → out of scope; we add a `profileFetchFailed` flag in `auth-store` instead.

## Acceptance Criteria

### 1. UserId Guard on `setProfile` — In-Flight `loadProfile` Cannot Clobber a Cleared Profile (D1)

The `loadProfile` call site that lands the profile must verify the userId is still the current user before applying the result.

- [x] In `src/hooks/use-auth.ts` `loadProfile`, before `setProfile(profile)` (line 132-134), check that the `useAuthStore.getState().user?.id === userId`. If not, drop the result silently and add a Sentry breadcrumb:
  ```ts
  if (profile) {
    const currentUserId = useAuthStore.getState().user?.id;
    if (currentUserId !== userId) {
      addBreadcrumb({
        category: "auth",
        level: "info",
        message: "loadProfile result dropped — user changed mid-flight",
        data: { phase: "load-profile-stale" },
      });
      return; // do not apply or flush, the in-flight context is stale
    }
    setProfile(profile);
  }
  ```
- [x] Apply the same guard before `flushWriteQueue(supabase)` (line 140) — do not flush a queue that belongs to user A on behalf of user B's listener event.
- [x] **Reuse the existing `phase` allowlist key**: `phase: "load-profile-stale"` (allowlisted per `src/lib/sentry.ts:36`). Do NOT add new keys.
- [x] **Why userId-guard, not AbortController**: AbortController requires propagating a signal through `cacheWithFallback` and the Supabase query — invasive. The userId comparison is two lines, has no signature changes, and covers the realistic race (sign-out clears `user.id` → guard fails). For the rare case where two users have the same id (impossible by Supabase contract), the guard is moot, but no real failure mode.

**Given** a `loadProfile(userIdA)` call is awaiting Supabase
**When** `SIGNED_OUT` fires and the listener calls `setProfile(null)`
**And** the in-flight `loadProfile` then resolves with user A's profile
**Then** the guard observes `useAuthStore.getState().user?.id === undefined`
**And** `setProfile(profile)` is NOT called
**And** `flushWriteQueue` is NOT called
**And** a Sentry breadcrumb is recorded with `phase: "load-profile-stale"`

### 2. Atomic Queue Merge on `persistQueue` After Flush — `enqueueWrite` Mid-Flight Is Not Lost (D2)

The flush's terminal `persistQueue(remaining)` call must merge with any writes added to the queue after the flush's initial `readQueue`. The minimal fix is: re-read the queue inside the IIFE just before persisting, identify writes whose `id` is not in the original snapshot, and append them to `remaining`.

- [x] In `src/lib/cache.ts` `flushWriteQueue` (the IIFE body, around line 320 where `persistQueue(remaining)` is called today), replace the bare `await persistQueue(remaining);` with a merge step:
  ```ts
  // Atomically reconcile with any writes enqueued during the flush.
  // The flush snapshot was the queue at the start (`queue` from line 305).
  // Any writes whose id is NOT in the snapshot were enqueued mid-flight
  // and must be preserved.
  const snapshotIds = new Set(queue.map((w) => w.id));
  const currentQueue = await readQueue();
  const newWrites = currentQueue.filter((w) => !snapshotIds.has(w.id));
  await persistQueue([...remaining, ...newWrites]);
  ```
- [x] **Why merge by id (not full re-read)**: the snapshot's `remaining` carries the failure state of the writes the flush tried to replay. A full re-read would lose the failure tracking. The merge appends only the truly-new writes to `remaining`.
- [x] **Concurrent enqueueWrite-vs-enqueueWrite race**: still exists — two concurrent enqueueWrites both read `[]`, both push, both persist with one entry only. Out of scope; flagged as future hardening. The realistic exposure of THIS race is when a flush is running, so fixing the flush-side merge handles the practically-observable case.
- [x] **Why not a mutex around the entire queue surface**: a serialization lock at the AsyncStorage layer would be cleaner architecturally but would require reworking `enqueueWrite`'s contract (today it's fire-and-forget for callers like `use-progress.ts`); the merge-on-persist fix is one-file and preserves all existing call sites.

**Given** the queue starts at `[w1, w2]`
**When** `flushWriteQueue` reads the snapshot, replays `w1` (success), and is about to replay `w2`
**And** `enqueueWrite(w3)` runs concurrently and persists `[w1, w2, w3]`
**And** `flushWriteQueue` then completes `w2` (success) with `remaining = []`
**When** the merge step re-reads the queue and identifies `w3` as not-in-snapshot
**Then** `persistQueue([w3])` is called
**And** `w3` is preserved for the next flush

### 3. `profileFetchFailed` Flag — Corrupted-Cache Offline Path Doesn't Misroute to Onboarding (D3)

Add an explicit error flag to `auth-store` that the auth guard reads. When `loadProfile` catches the "both network and cache failed" path (currently a silent degradation at `use-auth.ts:142-149`), set the flag. When the auth guard sees `session && !profile && profileFetchFailed`, route to a retry surface — NOT onboarding.

- [x] In `src/store/auth-store.ts`, extend `AuthState`:
  ```ts
  interface AuthState {
    // ... existing fields ...
    profileFetchFailed: boolean;
    setProfileFetchFailed: (failed: boolean) => void;
  }
  ```
  Initial value `false`. The setter clears or sets the flag. `reset()` resets it to `false`.
- [x] In `src/hooks/use-auth.ts` `loadProfile`, in the `catch` block (after the `isNetworkError` check), set the flag:
  ```ts
  } catch (err) {
    const isNetworkError =
      err instanceof Error && /network|fetch|failed to fetch|offline/i.test(err.message);
    if (!isNetworkError) {
      captureError(err, "auth-load-profile");
    }
    // Mark profile fetch as failed so the auth guard can route to retry
    // instead of onboarding.
    useAuthStore.getState().setProfileFetchFailed(true);
  } finally { ... }
  ```
- [x] On successful profile load (after `setProfile(profile)`), clear the flag:
  ```ts
  if (profile) {
    setProfile(profile);
    useAuthStore.getState().setProfileFetchFailed(false);
  }
  ```
- [x] In `app/_layout.tsx` auth guard (lines 91-105), add a branch:
  ```ts
  const { session, isLoading, isOnboarded, profileFetchFailed, profile } = useAuth();
  // ...
  if (session && !profile && profileFetchFailed && !inAuthGroup) {
    // Profile fetch failed (offline + corrupted cache). Hold on splash
    // with a retry CTA rather than routing to onboarding.
    return; // splash continues to render; retry UI is conditionally shown below
  }
  ```
  Retry UI: a small banner at the top of the splash with a "Retry" button that re-invokes `loadProfile(user.id)`. Implementation owns the layout decision; the spec only mandates the routing branch.
- [x] **Extend `useAuth` return shape** to expose `profileFetchFailed: boolean` and `retryProfileFetch: () => Promise<void>` (the latter wraps `loadProfile(user.id, { flushQueue: false })`).
- [x] **Why a flag (not a tri-state result)**: a flag is one boolean in Zustand, observable by any subscriber (including the auth guard and a future retry component). A tri-state `{ data, fromCache, failed }` from `cacheWithFallback` would require changing the function's signature and propagating through `loadProfile` — invasive.

**Given** the user is signed in, has completed onboarding, and the device is offline
**And** the profile cache is corrupted (e.g. invalid JSON)
**When** `loadProfile` is called and both `cacheWithFallback`'s network and cache reads fail
**Then** `useAuthStore.getState().profileFetchFailed === true`
**And** the auth guard does NOT route to `/onboarding`
**And** the user sees a "Profile unavailable, retry" UI

**Given** `profileFetchFailed === true`
**When** the user taps Retry and `loadProfile(user.id, { flushQueue: false })` succeeds
**Then** `setProfile(profile)` is called
**And** `profileFetchFailed` is cleared to `false`
**And** the auth guard routes normally to `/(tabs)/home` (or `/onboarding` if genuinely not onboarded)

### 4. `flushInFlight` IIFE Catches Internal Errors — Concurrent Callers Resolve to 0, Don't Reject (D4)

The IIFE body must wrap its work in a try/catch so a thrown `isOnline` (or any future internal error) resolves to `0` instead of rejecting. This preserves the in-flight Promise contract: concurrent callers see consistent behavior.

- [x] In `src/lib/cache.ts` `flushWriteQueue`, wrap the IIFE body in a try/catch around the work, keeping the existing `finally` for the in-flight reset:
  ```ts
  flushInFlight = (async (): Promise<number> => {
    try {
      const online = await isOnline();
      if (!online) return 0;
      // ... existing replay loop and persistQueue+merge from AC #2 ...
      return flushed;
    } catch (err) {
      // Internal error during flush (e.g. isOnline threw, AsyncStorage
      // panic). Capture for visibility and resolve to 0 — concurrent
      // callers should not be poisoned by a transient internal failure.
      captureError(err, "cache-flush-internal");
      return 0;
    } finally {
      flushInFlight = null;
    }
  })();
  ```
- [x] **Why catch-and-return-0 instead of catch-and-rethrow**: the public contract of `flushWriteQueue` is "returns the number of successfully flushed writes" — `0` is a legal value meaning "no writes flushed this round." A reject would force every caller to handle the case, but the realistic recovery is "try again later" — exactly what a `0` return signals.
- [x] **Update test Case 14** (post-9-6, currently asserts `await flushWriteQueue(...)` REJECTS when `isOnline` throws) to assert it resolves to `0` instead. The "guard resets after a true rejection" semantics are preserved (the `finally` still runs), but the observable behavior changes from rejection to `0`.

**Given** two concurrent `flushWriteQueue(client)` calls
**When** `isOnline` throws on the first call's IIFE
**Then** both Promises resolve to `0`
**And** neither Promise rejects
**And** `captureError` is invoked with context `"cache-flush-internal"`
**And** `flushInFlight` is reset to `null` so a third call proceeds

### 5. Regression Test Suite

Pure-function suites where possible; minimal Supabase / AsyncStorage mocks where state interaction is required.

- [x] **`auth-events.test.ts`** — no new cases needed (the helper is unchanged; D1 is a wiring concern, not a decision concern).

- [x] **New file: `src/lib/__tests__/auth-load-profile-stale.test.ts`** — tests the userId guard from AC #1.
  - [x] Mock `useAuthStore` and `supabase` minimally; render the hook with `@testing-library/react-native` `renderHook`. (If renderHook is too invasive, extract the userId-guard logic into a pure helper `applyProfileIfFresh(userId, profile, currentUserId)` and test that pure function.)
  - [x] **Test cases:**
    1. **In-flight loadProfile resolves while user is signed in** — `currentUserId === userId` → `setProfile` IS called.
    2. **In-flight loadProfile resolves AFTER sign-out** — `currentUserId === undefined` → `setProfile` is NOT called, breadcrumb is recorded with `phase: "load-profile-stale"`.
    3. **In-flight loadProfile resolves after sign-in as a different user** — `currentUserId === userIdB`, original was `userIdA` → `setProfile` is NOT called.
  - [x] **Recommended: extract the guard logic to a tiny pure helper** so the test file does not need React. Per the 9-2/9-3/9-4/9-5/9-6 precedent.

- [x] **Append to `cache-flush.test.ts`** — three new cases for AC #2 + AC #4.
  - [x] **Case 16 (AC #2): enqueue-during-flush is preserved** — set queue to `[w1, w2]`. Use `insertDelayMs=50` to widen the flush window. Start `flushWriteQueue` (don't await yet). After 25ms, call `enqueueWrite(w3)`. Then await the flush. Assert: client received exactly 2 inserts (`w1`, `w2`); the queue in storage now contains `[w3]` (preserved); calling `flushWriteQueue` again replays `w3`.
  - [x] **Case 17 (AC #4): IIFE rejection resolves to 0 (not reject)** — replace the existing Case 14 (rejection-from-isOnline) assertion. Mock `isOnline` to throw. Assert: `await flushWriteQueue(client)` resolves to `0` (not throws). Assert `captureError` was called with `"cache-flush-internal"`. Assert a subsequent call (with `isOnline` restored) proceeds normally.
  - [x] **Case 18 (AC #4): two concurrent rejections see consistent 0** — set queue to `[wA]`. Mock `isOnline` to throw on both calls. Concurrently `Promise.all([flushWriteQueue(c1), flushWriteQueue(c2)])`. Assert both resolve to `0`, neither rejects, `flushInFlight` is null after.

- [x] **New file: `src/lib/__tests__/profile-fetch-failed-flag.test.ts`** — tests the AC #3 flag wiring on the auth-store.
  - [x] Test cases:
    1. **Initial state** — `profileFetchFailed === false` on a fresh store.
    2. **Setter flips** — `setProfileFetchFailed(true)` makes the value `true`; `setProfileFetchFailed(false)` returns to `false`.
    3. **`reset()` clears the flag** — set to `true`, call `reset()`, assert `false`.
  - [x] The auth-guard route branch from AC #3 is integration territory — covered manually by smoke test, not in this unit suite.

- [x] **CI integration:** no new workflow steps. `npm test` auto-picks up new files under `src/lib/__tests__/`.

**Given** the new test files
**When** `npm test` runs in CI
**Then** all new cases pass
**And** the full suite (199 + new ~9 cases) passes

### 6. Documentation — CLAUDE.md Architecture Contract Line + JSDoc

- [x] **CLAUDE.md** — under `## Architecture`, immediately after the existing "Auth listener event gating" line (added by story 9-6), add one new line:

  > **Auth + cache race hardening:** `src/hooks/use-auth.ts` `loadProfile` guards `setProfile` and `flushWriteQueue` with a `useAuthStore.getState().user?.id === userId` check so an in-flight load that resolves after `SIGNED_OUT` does not clobber the cleared profile (drops result + breadcrumb). `src/lib/cache.ts` `flushWriteQueue` merges any writes added to the queue between the snapshot read and the post-flush persist (atomic `persistQueue([...remaining, ...newWrites])`) so an `enqueueWrite` mid-flight is preserved. The IIFE wraps its body in `try/catch` and resolves to `0` on internal errors (e.g. `isOnline` throwing), preserving the in-flight Promise contract for concurrent callers. `src/store/auth-store.ts` exposes a `profileFetchFailed` flag set by `loadProfile`'s catch path; the auth guard at `app/_layout.tsx` reads the flag and routes to a retry surface instead of `/onboarding` when both network and cache reads fail. Regression-tested in `src/lib/__tests__/auth-load-profile-stale.test.ts`, `src/lib/__tests__/cache-flush.test.ts` (Cases 16–18), `src/lib/__tests__/profile-fetch-failed-flag.test.ts`. Verified 2026-05-07, story 9-10.

  Replace `<DATE>` with the date the story is marked `done` (today, in YYYY-MM-DD).

- [x] **No `.env.example` change.** No env vars introduced.
- [x] **No PRD edit.** Internal correctness fix.
- [x] **No privacy-policy edit.** No new data collected.
- [x] **JSDoc updates** on `loadProfile` (note the userId guard contract), `flushWriteQueue` (note the merge step + try/catch resolution to 0), `auth-store.ts` (note the `profileFetchFailed` semantics), and the auth guard branch in `app/_layout.tsx` (note the retry-route condition).

### 7. No Existing Conversations / Tests Are Broken — Quality Gates Pass

- [x] **All existing call sites compile** — `useAuth`, all consumers in `app/_layout.tsx`, `app/(auth)/*`, `app/(tabs)/profile/*`, etc. retain unchanged public hook signature plus the new `profileFetchFailed` and `retryProfileFetch` returns.
- [x] **`flushWriteQueue` callers compile** — `src/components/common/NetworkBanner.tsx:23` and `src/hooks/use-auth.ts` continue to call `flushWriteQueue(supabase)` with no signature change.
- [x] **All existing tests still pass** — `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`, `realtime-dedup.test.ts`, `auth-events.test.ts`, `cache-flush.test.ts`. Note: Case 14 in `cache-flush.test.ts` is REPLACED by Case 17 per AC #4.
- [ ] **Manual smoke test (mandatory before marking done):** _Deferred to reviewer / user — the dev agent cannot run a live device session._
  1. **D1 verification**: sign in on slow network (Network Link Conditioner "3G"). While `loadProfile` is in-flight (network log shows pending `/rest/v1/profiles`), sign out. Confirm: profile in Zustand store is null; no `setProfile(profile)` call after sign-out; Sentry breadcrumb with `phase: "load-profile-stale"` is emitted.
  2. **D2 verification**: with airplane mode on, complete an exercise (queues `enqueueWrite`). Toggle airplane mode off — the queue starts to flush. While the flush is mid-replay (visible in network inspector), complete a SECOND exercise (another `enqueueWrite`). Observe: both writes land in the database. Repeat 3× to confirm reliability.
  3. **D3 verification**: with airplane mode on, manually corrupt the profile cache via dev console: `AsyncStorage.setItem('@companion_cache:<userId>:profile', 'INVALID_JSON')`. Cold-start the app. Confirm: app does NOT route to onboarding; instead shows a "Profile unavailable, Retry" UI. Toggle airplane mode off, tap Retry. Confirm: profile loads, app routes to home.
  4. **D4 verification**: with `isOnline` mocked to throw via dev hook (`require('@/src/lib/network').isOnline = () => Promise.reject(new Error('test'))`), invoke `flushWriteQueue` from two concurrent contexts. Confirm: both `await` calls resolve to `0`, no unhandled rejection in console, Sentry has one `cache-flush-internal` event.
  5. **Document** in Completion Notes: turn-by-turn observation of (1)-(4). Deferred to reviewer / user — the dev agent cannot run a live device session.
- [x] `npm run type-check` clean.
- [x] `npm run lint` clean (`--max-warnings 0`).
- [x] `npm run format:check` clean.
- [x] `npm test` clean — full suite + the new ~9 cases.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — *the AC #3 retry UI uses `Colors.error` background + `Colors.textOnDark`. No hardcoded hex.*
- [x] All loading states use skeleton animations — *N/A; the retry UI is a static banner, not a loading state.*
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — *the retry button must have `accessibilityRole="button"` and `accessibilityLabel="Retry profile load"`.*
- [x] Non-obvious interactions have `accessibilityHint` — *retry button: `accessibilityHint="Tries to load your profile again. Requires network connection."`*
- [x] Stateful elements have `accessibilityState` — *retry button: `accessibilityState={{ disabled: isRetrying }}` while retry is in flight.*
- [x] All tappable elements have minimum 44x44pt touch targets — *retry button must be at least 44x44.*
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — *new contexts: `"cache-flush-internal"` (AC #4). Existing contexts preserved.*
- [x] All text uses `Typography.*` presets — *retry banner text uses `Typography.body`, button label uses `Typography.label`.*
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`.

## Tasks / Subtasks

- [x] Task 1: UserId guard on `setProfile` / `flushWriteQueue` in `loadProfile` (AC: #1)
  - [x] 1.1 Add the userId comparison before `setProfile(profile)` in `src/hooks/use-auth.ts`.
  - [x] 1.2 Add the same comparison before `flushWriteQueue(supabase)` to skip stale flushes.
  - [x] 1.3 Add `addBreadcrumb` with `phase: "load-profile-stale"` on guard fire.
  - [x] 1.4 Optional: extract the guard to a pure helper (`applyProfileIfFresh`) for cleaner unit testing.
- [x] Task 2: Atomic merge in `flushWriteQueue` (AC: #2)
  - [x] 2.1 In `src/lib/cache.ts`, add the snapshot-id Set + post-flush re-read + merge step before `persistQueue(remaining)`.
  - [x] 2.2 Update JSDoc on `flushWriteQueue` to note the merge contract.
- [x] Task 3: `profileFetchFailed` flag wiring (AC: #3)
  - [x] 3.1 Extend `AuthState` in `src/store/auth-store.ts` with `profileFetchFailed: boolean` + `setProfileFetchFailed`. Reset to `false` in `reset()`.
  - [x] 3.2 In `src/hooks/use-auth.ts` `loadProfile`, set the flag on `catch` and clear on success.
  - [x] 3.3 Extend `useAuth` return with `profileFetchFailed` and `retryProfileFetch`.
  - [x] 3.4 In `app/_layout.tsx`, add the auth-guard branch that holds the splash + retry UI when `session && !profile && profileFetchFailed`.
  - [x] 3.5 Build the retry UI component (or inline) with `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, `Colors.*`, `Typography.*` per Z.
- [x] Task 4: IIFE try/catch in `flushWriteQueue` (AC: #4)
  - [x] 4.1 Wrap the IIFE body in `try/catch`, resolving to `0` on internal error and `captureError(_, "cache-flush-internal")`.
  - [x] 4.2 Update JSDoc on `flushWriteQueue` to note the catch-and-return-0 semantics.
- [x] Task 5: Regression tests (AC: #5)
  - [x] 5.1 Create `src/lib/__tests__/auth-load-profile-stale.test.ts` — 3 cases per AC #5.
  - [x] 5.2 Create `src/lib/__tests__/profile-fetch-failed-flag.test.ts` — 3 cases per AC #5.
  - [x] 5.3 Append Cases 16–18 to `cache-flush.test.ts`. REPLACE the existing Case 14 (rejection asserts) with Case 17 (resolves-to-0 asserts) per AC #4.
  - [x] 5.4 Run `npx jest` — green for new files + full suite.
- [x] Task 6: Documentation (AC: #6)
  - [x] 6.1 Add the one-line "Auth + cache race hardening" architecture-contract note to `CLAUDE.md` immediately after the 9-6 line. Use today's date in the verification stamp.
  - [x] 6.2 Update JSDoc on `loadProfile`, `flushWriteQueue`, `auth-store.ts`, and the auth-guard branch in `app/_layout.tsx`.
- [ ] Task 7: Manual smoke test (AC: #7) — **deferred to reviewer / user**
  - [ ] 7.1 D1 verification: sign in on slow network, sign out mid-flight, observe no clobber + breadcrumb.
  - [ ] 7.2 D2 verification: enqueue during flush 3× consecutively, verify both writes land.
  - [ ] 7.3 D3 verification: corrupted-cache cold start shows retry UI, retry succeeds.
  - [ ] 7.4 D4 verification: concurrent flushes with `isOnline` throwing both resolve to 0.
  - [ ] 7.5 Document the four observations in Completion Notes.
- [x] Task 8: Quality gates (AC: #7 / #Z)
  - [x] 8.1 `npm run type-check` clean.
  - [x] 8.2 `npm run lint` clean (`--max-warnings 0`).
  - [x] 8.3 `npm run format:check` clean.
  - [x] 8.4 `npm test` clean — full suite + new cases.

## Dev Notes

### Why this story is so small in scope

Three touched files (`src/hooks/use-auth.ts`, `src/lib/cache.ts`, `src/store/auth-store.ts`), one screen-level branch in `app/_layout.tsx`, three new/edited test files. **It is not a `<AuthProvider>` rewrite, not a queue-mutex redesign, not a tri-state cache result type.** Each AC is the minimal fix for a discrete defect. If you find yourself reaching for a cross-cutting refactor, stop — those belong in Epic 12.2 (auth bootstrap) and a future write-queue redesign story.

### Why a userId comparison (not AbortController, not epoch) for D1

AbortController requires propagating a signal through `cacheWithFallback` and the Supabase query — a lot of plumbing for a low-frequency race. Epoch counter requires a new ref + bump-on-event pattern that has its own correctness pitfalls (epoch drift, off-by-one). The userId comparison is two lines, has no signature changes, and covers the realistic race exactly: when `SIGNED_OUT` clears `user`, `useAuthStore.getState().user?.id === undefined`, and the guard fires.

### Why merge-on-persist (not a queue mutex) for D2

A serialization mutex around `enqueueWrite` + `flushWriteQueue` would be cleaner architecturally but requires reworking the contract for callers who fire-and-forget enqueues (`use-progress.ts`, `use-exercise.ts`, `vocabulary.tsx`). The merge-on-persist fix is one file (`cache.ts`), one commit, no API change. The remaining race (two concurrent `enqueueWrite`s) is a smaller window than enqueue-during-flush and is flagged for a future hardening pass.

### Why a Zustand flag (not a tri-state result type) for D3

A tri-state `{ data, fromCache, failed }` from `cacheWithFallback` would propagate through `loadProfile` and require callers to handle the new shape. A boolean flag in the auth store is observable by the auth guard via `useAuth()` (already a consumer), zero callsite churn. The flag also opens the door for a future "stale data" badge or telemetry on cache-fail rates without further plumbing.

### Why catch-and-return-0 (not catch-and-rethrow) for D4

The public contract of `flushWriteQueue` is "returns the number of successfully flushed writes." `0` is a legal value meaning "no writes flushed this round." Rejecting forces every caller to handle the case, but the realistic recovery is "try again later" — exactly what `0` signals. The `captureError` ensures observability without poisoning concurrent callers.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `useAuthStore` (Zustand) | `@/src/store/auth-store` | Existing — extend with `profileFetchFailed` per AC #3. |
| `cacheWithFallback`, `invalidateCache`, `clearUserCache`, `flushWriteQueue`, `enqueueWrite`, `CACHE_KEYS`, `CACHE_TTL` | `@/src/lib/cache` | Existing. Modify `flushWriteQueue` only (merge + try/catch). All other exports unchanged. |
| `decideAuthAction`, `AuthEventAction` | `@/src/lib/auth-events` | Existing — story 9-6's pure helper. Unchanged by 9-10. |
| `captureError`, `addBreadcrumb`, `SENTRY_EXTRAS_ALLOWLIST` | `@/src/lib/sentry` | Existing. New context tags `"cache-flush-internal"` and `"load-profile-stale"` (use existing `feature`/`context`/`phase` allowlist). |
| `supabase` client | `@/src/lib/supabase` | Existing. No config changes. |
| `Session`, `User`, `AuthChangeEvent` types | `@supabase/supabase-js` | Existing. |
| `applyProfileIfFresh` (extracted helper, optional) | NEW — in `src/lib/auth-events.ts` or `src/hooks/use-auth.ts` | NEW — pure userId-guard helper for testability. |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/__tests__/auth-load-profile-stale.test.ts` | 3-case suite for AC #1 userId guard. |
| `src/lib/__tests__/profile-fetch-failed-flag.test.ts` | 3-case suite for AC #3 store flag wiring. |

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/use-auth.ts` | Add userId guard before `setProfile` and `flushWriteQueue` in `loadProfile`. Set/clear `profileFetchFailed` flag in catch/success paths. Extend `useAuth` return with `profileFetchFailed` + `retryProfileFetch`. JSDoc updates. |
| `src/lib/cache.ts` | Add atomic merge step before `persistQueue` in `flushWriteQueue`. Wrap IIFE body in try/catch resolving to `0` + `captureError("cache-flush-internal")`. JSDoc updates. |
| `src/store/auth-store.ts` | Extend `AuthState` with `profileFetchFailed` + `setProfileFetchFailed`. Reset in `reset()`. |
| `src/lib/__tests__/cache-flush.test.ts` | Append Cases 16, 17, 18. REPLACE existing Case 14 with Case 17 (rejection-resolves-to-0). |
| `app/_layout.tsx` | Add auth-guard branch for `session && !profile && profileFetchFailed`. Build retry UI with full a11y. |
| `CLAUDE.md` | New "Auth + cache race hardening" architecture-contract line under `## Architecture`, immediately after the 9-6 line. |

### What This Story Does NOT Include

- **NO** `<AuthProvider>` extraction (Epic 12.2).
- **NO** queue-mutex redesign — only flush-side merge.
- **NO** per-write idempotency keys or DB UNIQUE constraints.
- **NO** AbortController plumbing through `cacheWithFallback` / Supabase queries.
- **NO** epoch-counter session tracking.
- **NO** changes to `auth-events.ts`, `decideAuthAction`, or any 9-6 contract.
- **NO** changes to `NetworkBanner`, `realtime.ts`, `realtime-transcript.ts`, or any non-auth/non-cache file.
- **NO** new env vars, no `app.json` change, no SDK upgrades, no new dependencies.
- **NO** changes to the offline write queue's serialization format (`@companion_write_queue` key, JSON layout) — backward-compatible.

### Audit excerpts for reference

From the 9-6 code review (`Edge Case Hunter Findings`, 2026-05-07):

> **E1**: `loadProfile` started by `INITIAL_SESSION`/`SIGNED_IN` resolves AFTER a subsequent `SIGNED_OUT`, clobbering the cleared profile. There is no per-load epoch / cancellation token.

> **E2**: `enqueueWrite` called WHILE `flushWriteQueue` is mid-flight — the new write is dropped from the in-flight pass and then OVERWRITTEN by `persistQueue(remaining)`. Pre-existing read-modify-write race.

> **E6**: `cacheWithFallback` rethrows when both network AND cache fail; the `loadProfile` catch swallows it as "expected degradation" and never sets a profile error. They land in onboarding for a user who has already onboarded.

> **E7**: `flushInFlight` never-rejects guarantee is violated by an unhandled rejection inside the IIFE. Concurrent callers awaiting the same `flushInFlight` promise BOTH get the rejection.

Story 9-6's Dev Notes "What This Story Does NOT Include" explicitly out-of-scoped these defenses; 9-10 picks them up.

### Sentry / Error handling

Three new Sentry signals introduced by 9-10:
1. **`addBreadcrumb({ category: "auth", level: "info", message: "loadProfile result dropped — user changed mid-flight", data: { phase: "load-profile-stale" } })`** on the userId guard fire (AC #1). Info-level because the event is expected behavior of the guard, not an anomaly.
2. **`captureError(err, "cache-flush-internal")`** on the IIFE try/catch (AC #4).
3. **No new captureError on the D3 path** — the existing `captureError(err, "auth-load-profile")` (in `loadProfile`'s catch) is preserved; the new `profileFetchFailed` flag is observable via Sentry breadcrumbs at flag-set time but does not warrant its own capture.

The 9-3 allowlist discipline is preserved — only `phase`, `feature`, `context` keys (already allowlisted) are used in `data`.

### Testing standards summary

- New tests live under `src/lib/__tests__/` per existing convention.
- Pure-helper tests preferred (extract `applyProfileIfFresh` for AC #1 if it cleans up the test). Otherwise, `@testing-library/react-native` `renderHook` against `useAuth` with mocked Supabase + Zustand.
- AsyncStorage and `isOnline` mocking patterns are established by `cache-flush.test.ts` from 9-6 — reuse them for Cases 16–18.
- Path alias `@/*` → repo root.

### Dependencies on previous stories

- **Story 9-6** (auth listener event-gating + flushWriteQueue idempotency) — direct parent. 9-10 builds on the in-flight Promise guard introduced in 9-6 by adding the try/catch and merge-on-persist. The userId-guard pattern in AC #1 sits inside `loadProfile`, which 9-6 extended with `opts.flushQueue`. The 9-6 contract is preserved.
- **Story 9-2** (`evaluatePromotion`), **9-3** (`scrubEvent`), **9-4** (`sanitizeMemoryContent`), **9-5** (`appendIfNew`/`acceptDelta`) — established the pure-helper-extracted-for-testability pattern. AC #1's `applyProfileIfFresh` extraction follows the same pattern.
- **No story is blocked by 9-10 directly.** 9-10 closes out the deferred items from 9-6's review and unblocks Epic 9 retrospective.

### Project Structure Notes

- All touched files (`src/hooks/use-auth.ts`, `src/lib/cache.ts`, `src/store/auth-store.ts`, `app/_layout.tsx`, `CLAUDE.md`) are existing locations. New tests in `src/lib/__tests__/` per convention.
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- Path alias `@/*` → repo root.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-7 (line 42), §2 Epic 9 deliverable 9.6 (line 136)]
- [Source: _bmad-output/implementation-artifacts/9-6-auth-listener-token-refresh-fix.md — story 9-6 Dev Notes "What This Story Does NOT Include" deferral list]
- [Source: PR #42 code review notes (2026-05-07) — Blind Hunter / Edge Case Hunter / Acceptance Auditor findings, deferred items D1–D4]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 in-progress, story 9-10 backlog (added 2026-05-07)]
- [Source: src/hooks/use-auth.ts — `loadProfile` (lines 112-153), userId-guard insertion points at lines 132-134 and 140]
- [Source: src/lib/cache.ts — `flushWriteQueue` IIFE (lines 283-329), `persistQueue` (lines 229-235), `readQueue` (lines 216-224), `enqueueWrite` (lines 241-250)]
- [Source: src/store/auth-store.ts — `AuthState` interface (lines 6-17), `reset()` (lines 40-47)]
- [Source: app/_layout.tsx — auth guard (lines 91-105)]
- [Source: src/lib/__tests__/cache-flush.test.ts — existing Cases 13/14/15 for in-flight guard; Case 14 to be REPLACED by Case 17 per AC #4]
- [Source: CLAUDE.md `## Architecture` section — location for new "Auth + cache race hardening" line, immediately after the 9-6 line added by story 9-6]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `npm run type-check` — clean (0 errors).
- `npm run lint` — clean (0 errors, 0 warnings, `--max-warnings 0`).
- `npm run format:check` — clean.
- `npm test` — 13 test suites, 207 passing tests (was 199 pre-9-10; +3 cases for `auth-load-profile-stale.test.ts`, +3 for `profile-fetch-failed-flag.test.ts`, +2 net for `cache-flush.test.ts` — Cases 16 and 18 added, Case 14 replaced by Case 17).

### Completion Notes List

**AC #1 — UserId guard on `setProfile` / `flushWriteQueue` (D1)**

- Added a pure decision helper `applyProfileIfFresh(loadedUserId, currentUserId)` exported from `src/hooks/use-auth.ts`. Returns `"apply"` or `"drop-stale"` — keeps the test suite React-free.
- Wired into `loadProfile`: a guard before `setProfile(profile)` (drops result + emits Sentry breadcrumb with `phase: "load-profile-stale"` when stale) and a separate guard before `flushWriteQueue(supabase)` so the flush is also skipped if the user changed mid-flight (covers the rare null-profile-but-stale case where the early return doesn't fire).
- Reused the existing `phase` allowlist key per `src/lib/sentry.ts:36` — no new Sentry keys.

**AC #2 — Atomic merge in `flushWriteQueue` (D2)**

- Inside the IIFE, just before the terminal `persistQueue`, we now compute `snapshotIds = new Set(queue.map(w => w.id))`, re-read the queue, identify writes whose id is not in the snapshot (mid-flight `enqueueWrite` calls), and persist `[...remaining, ...newWrites]`.
- `remaining` continues to carry the failure state of writes the flush attempted, so failures still survive into the next flush.
- The concurrent-`enqueueWrite`-vs-`enqueueWrite` race is acknowledged out-of-scope per the spec; the practically-observable enqueue-during-flush case is now safe.

**AC #3 — `profileFetchFailed` flag (D3)**

- Extended `AuthState` in `src/store/auth-store.ts` with `profileFetchFailed: boolean` (initial `false`) and `setProfileFetchFailed(failed)`. `reset()` now also resets the flag (so sign-out clears it).
- `loadProfile`'s catch block sets the flag (after the `isNetworkError` branch); the success path clears it (inside `if (profile)`).
- `useAuth` return now exposes `profileFetchFailed` and `retryProfileFetch` (a flush-skipping `loadProfile` re-invocation).
- `app/_layout.tsx`:
  - Auth-guard `useEffect` now early-returns when `session && !profile && profileFetchFailed` (added `profile` and `profileFetchFailed` to the deps array so re-evaluation runs on retry success).
  - Renders a new local `ProfileRetryScreen` component when in this state — `Colors.bgDark` background, `Colors.error` banner, `Colors.accent` CTA, `Typography.body` / `Typography.label`, `Pressable` with `accessibilityRole="button"`, `accessibilityLabel="Retry profile load"`, `accessibilityHint="Tries to load your profile again. Requires network connection."`, `accessibilityState={{ disabled: isRetrying }}`, min 44x44pt target, opacity 0.6 + label "Retrying…" while in flight.

**AC #4 — IIFE try/catch in `flushWriteQueue` (D4)**

- Wrapped the IIFE body in `try { ... } catch (err) { captureError(err, "cache-flush-internal"); return 0; } finally { flushInFlight = null; }`.
- Concurrent callers awaiting the same in-flight Promise now both resolve to `0` instead of receiving the underlying rejection.
- Existing Case 14 (asserted rejection) was replaced by Case 17 (asserts resolution to 0 + captureError context). Two new cases added: Case 16 (enqueue-during-flush preserved) and Case 18 (concurrent rejection both see 0).

**Files / call sites verified unchanged:**

- `src/components/common/NetworkBanner.tsx:23` — still calls `flushWriteQueue(supabase)`; signature unchanged.
- `src/hooks/use-auth.ts` — listener wiring (`onAuthStateChange` + `decideAuthAction`) unchanged from 9-6.
- `src/lib/auth-events.ts` — untouched per the spec's "What This Story Does NOT Include" list.
- All other consumers of `useAuth()` retain their existing destructuring; the new fields (`profileFetchFailed`, `retryProfileFetch`) are additive.

**Manual smoke test (AC #7) — DEFERRED to reviewer / user.**

The dev agent cannot run a live device session for D1 (slow-network sign-out race), D2 (airplane-mode enqueue-during-flush), D3 (corrupted-cache cold start observation of the retry UI), or D4 (in-app `isOnline` mock). Cases 16, 17, 18 in `cache-flush.test.ts` exercise the D2/D4 logic at the unit level; Case 1–3 in `auth-load-profile-stale.test.ts` exercise the D1 guard decision; Cases 1–3 in `profile-fetch-failed-flag.test.ts` exercise the D3 flag contract. The retry-route branch in `app/_layout.tsx` is integration territory and falls to the smoke test.

**Post-review patches (P1–P10) — applied 2026-05-07 after the bmad-code-review pass.**

The parallel adversarial review surfaced 41 raw findings across Blind Hunter, Edge Case Hunter, and Acceptance Auditor. After triage (16 rejected, 11 deferred as pre-existing or out-of-scope), 10 patches were applied on this branch before merge:

- **P1** — `loadProfile` catch's `setProfileFetchFailed(true)` is now gated on `applyProfileIfFresh(userId, current)`; a stale-context catch no longer pollutes a new user's session with the previous user's failure flag.
- **P2** — The merge step before `persistQueue` is wrapped in its own `try/catch`. If `currentQueue.filter`/`new Set` throws (e.g. malformed JSON), `mergedQueue` falls back to `remaining` and the persist always runs, so consumed writes never get re-replayed as duplicates.
- **P3** — `flushed` and `remaining` are hoisted outside the IIFE try; the catch path returns the true count (not 0) and persists `[remaining + currentQueue\snapshot]` so successful inserts always come off the on-disk queue.
- **P4** — `setProfileFetchFailed(false)` now fires on any successful resolution (network OK, freshness OK), not only when the resolved profile is truthy. A retry that legitimately resolves with `null` (row missing / RLS-filtered) clears the flag instead of pinning the user on `ProfileRetryScreen` forever.
- **P5** — The auth listener's `clear-profile` action also clears `profileFetchFailed`. Auto-emitted `SIGNED_OUT` events (token expiry / refresh failure / server-side revocation) bypass `signOut()`'s `reset()` call; this ensures the flag does not leak across sessions.
- **P6** — `ProfileRetryScreen` uses a `useRef` (`retryingRef`) for the synchronous double-tap gate; React's async state batching no longer lets two synchronous taps both pass the `isRetrying` guard.
- **P7** — The retry-render branch is wrapped in `<AppErrorBoundary>` so a render error inside `ProfileRetryScreen` cannot crash the app uncaught.
- **P8** — `readQueue` defensively returns `[]` when `JSON.parse` yields a non-array (poison-pill protection); downstream `.map` / `.filter` cannot throw on a malformed write-queue entry.
- **P9** — The auth-guard early-return adds the `!inAuthGroup` clause that AC #3's spec example specified; a user on `(auth)/login` with a session and a stale flag is no longer pinned on the retry surface.
- **P10** — Test Case 17 now asserts `mockedCaptureError.toHaveBeenCalledTimes(1)` after the recovery flush — a regression that emitted `captureError("cache-flush-internal")` on every flush would now fail this case.

**Quality gates after patches (2026-05-07):** type-check ✓, lint --max-warnings 0 ✓, format:check ✓, npm test 207/207 ✓.

### File List

**New files:**

- `src/lib/__tests__/auth-load-profile-stale.test.ts` — 3 cases for the AC #1 userId-guard helper.
- `src/lib/__tests__/profile-fetch-failed-flag.test.ts` — 3 cases for the AC #3 store flag wiring.

**Modified files:**

- `src/hooks/use-auth.ts` — added `applyProfileIfFresh` pure helper, userId guards in `loadProfile`, `profileFetchFailed` set/clear, `retryProfileFetch`, extended return shape, expanded JSDoc.
- `src/lib/cache.ts` — atomic merge step in `flushWriteQueue` IIFE; IIFE try/catch resolving to 0 with `captureError("cache-flush-internal")`; expanded JSDoc.
- `src/store/auth-store.ts` — added `profileFetchFailed` field, `setProfileFetchFailed` setter, `reset()` clears the flag; added field-level JSDoc.
- `app/_layout.tsx` — auth-guard early-return for the retry state; new `ProfileRetryScreen` render branch and component; added `profile` and `profileFetchFailed` to the routing `useEffect` deps.
- `src/lib/__tests__/cache-flush.test.ts` — added Sentry mock + `mockedCaptureError`; replaced Case 14 with Case 17 (resolves-to-0); added Case 16 (enqueue-during-flush merge) and Case 18 (concurrent rejection both 0); updated Case 13's queue-read count from 1→2 (snapshot + merge re-read).
- `CLAUDE.md` — added the `**Auth + cache race hardening:**` architecture-contract line under `## Architecture` immediately after the 9-6 line, dated 2026-05-07.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-10-auth-cache-race-hardening` set to `review`; `last_updated` bumped.

## Change Log

| Date       | Author        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-07 | dev-agent     | Story 9-10 implemented. AC #1: `applyProfileIfFresh` userId guard wired into `loadProfile` for both `setProfile` and `flushWriteQueue` call sites; stale results breadcrumb to Sentry with `phase: "load-profile-stale"`. AC #2: atomic merge before `persistQueue` in `flushWriteQueue` so mid-flight `enqueueWrite` calls survive. AC #3: `profileFetchFailed` flag added to auth-store; auth guard renders `ProfileRetryScreen` instead of misrouting to `/onboarding`. AC #4: IIFE try/catch in `flushWriteQueue` resolves to `0` on internal error with `captureError("cache-flush-internal")`. +8 net new test cases across 3 test files (207 total tests passing). CLAUDE.md architecture-contract line added. |
| 2026-05-07 | dev-agent     | Addressed bmad-code-review findings — 10 patches applied (P1–P10): stale-userId catch guard, merge-throw persist safety, flushed-count preservation, null-profile success flag clear, clear-profile listener flag clear, useRef double-tap gate, AppErrorBoundary wrap on retry render, `readQueue` `Array.isArray` validation, `!inAuthGroup` early-return clause, Case 17 captureError-count assertion. 16 review findings rejected as noise; 11 deferred as pre-existing or out-of-scope. Quality gates re-clean (207/207). |
