# Story 12.2: Move Auth Subscription to One-Time Bootstrap + Convert `useAuth` to a Pure Consumer Hook

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose auth listener at [`src/hooks/use-auth.ts:75-158`](src/hooks/use-auth.ts) is installed inside `useAuth()`'s `useEffect(() => { ... return () => subscription.unsubscribe(); }, [])` — meaning **every component that calls `useAuth()` installs its OWN `supabase.auth.onAuthStateChange` subscription** — and `useAuth()` is currently called by **7 different consumers**: `app/_layout.tsx:47` (the auth guard; mounted always), `app/(tabs)/profile/settings.tsx:106` (mounted when user is on settings), `app/(tabs)/profile/index.tsx:158` (mounted when user is on profile), `app/(auth)/login.tsx:30`, `app/(auth)/signup.tsx:31`, `app/onboarding/placement-test.tsx:352`, and `app/onboarding/index.tsx:128` — so at any moment that 2+ of these are mounted (common: `_layout.tsx` is ALWAYS mounted as the root, so any other screen using `useAuth` runs as the SECOND subscriber simultaneously), **the same Supabase auth event fan-outs to 2+ subscribers** that ALL run `decideAuthAction(event, session)` and ALL dispatch `loadProfile(action.userId)` against the same userId producing **N concurrent `cacheWithFallback` calls + N concurrent Supabase `profiles.select(...).eq("id", userId).single()` queries + N concurrent `flushWriteQueue` invocations** on every `INITIAL_SESSION` / `SIGNED_IN` / `USER_UPDATED` event — N being the number of currently-mounted `useAuth()` consumers, AND (a) the `flushWriteQueue` idempotency contract (Story 9-6's module-scope in-flight Promise — `let inFlight: Promise<number> | null = null; if (inFlight) return inFlight`) catches the duplicated calls BUT each subscriber's `useEffect` still pays the cost of running the `decideAuthAction` switch + the `loadProfile` async setup overhead (`Promise.race` for cache, supabase client allocation, etc.) before the idempotency Promise gate fires — so a SIGNED_IN event with 3 mounted consumers triggers 3 simultaneous in-flight `cacheWithFallback` calls, the first of which races to populate the cache while the other 2 read-then-overwrite the same cache entry within 100ms of each other (cache write is NOT idempotent — concurrent writes can interleave), (b) the **per-render allocation cost** of `useAuth()` includes its `useAuthStore()` selector subscription + the destructure of 8 store fields + the `useEffect` boundary check + 7 new function closures (`loadProfile`, `retryProfileFetch`, `signInWithEmail`, `signUpWithEmail`, `signOut`, `updateProfile`, and the listener callback) on every render of every consumer — for a screen like `app/(tabs)/profile/index.tsx` which re-renders on every state field change in the auth store, this is **7 new closures allocated per render × 5-10 renders per minute = 35-70 allocations/minute** just from `useAuth()` instantiation, (c) **Story 9-6's auth listener event gating + Story 9-10's `applyProfileIfFresh` staleness check + Story 9-10's `profileFetchFailed` retry-flag contract** all assume there's ONE listener orchestrating the auth flow — when N listeners race, the `setProfileFetchFailed(true)` from one listener's failed `loadProfile` can be overwritten by another listener's successful `loadProfile` clearing the flag, masking real failures from `ProfileRetryScreen`; AND the listener's `decideAuthAction` returns `kind: "load-profile"` with `invalidateCache: true` on `USER_UPDATED` so N listeners all `invalidateCache` the same key concurrently (idempotent but wasteful), (d) the audit P0-7 row at [`shippable-roadmap.md` line 44](_bmad-output/planning-artifacts/shippable-roadmap.md) ("Auth listener re-runs `loadProfile` on every `TOKEN_REFRESHED` event") was closed by Story 9-6 via per-event branching in `decideAuthAction`, but the **structural cause** — multiple subscribers — remained; the Epic 12.2 deliverable at [`shippable-roadmap.md` line 205](_bmad-output/planning-artifacts/shippable-roadmap.md) names the architectural fix explicitly: **"Move auth subscription to one-time bootstrap in Zustand store; consumers read state only. Covers P0-7 deepening."** + the "one-time bootstrap" pattern is established by React Native / Expo SDK 55 idiom (module-load-time `useAuthStore.setState({...})` initialization runs ONCE per app lifetime per JS bundle), AND **Story 12-1's `RealtimeOrchestrator` already proved the class-singleton + thin-hook split works for state-binding** — Story 12-2 applies the same architecture to auth: bootstrap-once, consume-many,

I want (a) a **new module `src/lib/auth-bootstrap.ts`** that exports a single `bootstrapAuth(): () => void` function which (i) installs the `supabase.auth.onAuthStateChange` listener ONCE per app lifetime (idempotent — calling `bootstrapAuth()` a second time returns the same teardown closure without re-subscribing), (ii) runs the cold-start `supabase.auth.getSession()` promise with the existing Story 9-6 unhandled-rejection catch, (iii) owns the `loadProfile(userId, opts)` async helper + the `retryProfileFetch()` exposed-action helper + the `decideAuthAction` dispatch — i.e., everything currently inside the `useEffect` in `use-auth.ts` moves to module-load-time of `auth-bootstrap.ts` (or per-call inside `bootstrapAuth()`); (b) **`app/_layout.tsx` calls `bootstrapAuth()` ONCE at module load time (top-level `const teardownAuth = bootstrapAuth();` outside the component function)** so the listener installs synchronously on JS-bundle parse, before React even renders the auth guard — the call returns a teardown closure which the layout's `useEffect` registers as its cleanup, so on rare full-bundle-reload scenarios (Fast Refresh in dev, OTA update mid-session) the listener unsubscribes cleanly; the module-level call also means `bootstrapAuth()` runs **exactly once per app session** regardless of how many `useAuth()` consumers mount; (c) **`useAuth()` becomes a pure consumer hook** at `src/hooks/use-auth.ts` — its `useEffect` and `subscription.unsubscribe()` cleanup are DELETED, `loadProfile` and `retryProfileFetch` are RE-EXPORTED from `auth-bootstrap.ts` (preserving the existing public API surface so the 7 consumer files don't need changes), and the hook body simplifies to: `const { session, user, profile, isLoading, isOnboarded, profileFetchFailed } = useAuthStore(); const setProfile = useAuthStore((s) => s.setProfile); return { session, user, profile, isLoading, isOnboarded, profileFetchFailed, retryProfileFetch, signInWithEmail, signUpWithEmail, signOut, updateProfile };` (where `signInWithEmail` / `signUpWithEmail` / `signOut` / `updateProfile` / `retryProfileFetch` are STATIC module-level exports from `auth-bootstrap.ts` or a sibling `auth-actions.ts` — they don't need to be inside the hook closure since they don't read `user` from React state, they read it from `useAuthStore.getState().user` directly); (d) **all 7 existing consumers (`app/_layout.tsx` + 6 screens) compile and run with ZERO changes** because the public hook return shape is preserved verbatim; (e) **Story 9-6 invariants preserved by construction** — `decideAuthAction` continues to be the per-event branching helper; the listener still calls `setSession(session)` first; `INITIAL_SESSION` / `SIGNED_IN` / `USER_UPDATED` still re-load the profile; `TOKEN_REFRESHED` / `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` still session-only; `SIGNED_OUT` still clears the profile + clears `profileFetchFailed` (Story 9-10 P5); null sessions on non-`SIGNED_OUT` events still emit the breadcrumb; the Story 9-7 `profileFetchFailed` flag's read-modify-write semantics now operate on a SINGLE-source-of-truth subscriber so the N-listener race vanishes by construction; (f) **Story 9-10 invariants preserved** — `applyProfileIfFresh` continues to gate the `setProfile` + `flushWriteQueue` + `setProfileFetchFailed` writes against the userId-guard; the breadcrumb shape (`phase: "load-profile-stale"`) is unchanged; `retryProfileFetch` continues to call `loadProfile(user.id, { flushQueue: false })`; (g) **the `cold-start getSession()` call also moves to bootstrap** — pre-12-2 it ran inside `useAuth()`'s `useEffect` so every consumer mount re-ran it (the auth-js subscribe contract emits `INITIAL_SESSION` synchronously inside `subscribe`, so the cold-start `.then` only fired its `setLoading(false)` no-session safety net — but it STILL ran 7 times across N consumers; post-12-2 it runs ONCE); (h) **a one-call-guard via a module-level `bootstrapPromise: Promise<{ teardown: () => void }> | null = null` variable** ensures `bootstrapAuth()` is idempotent even under React StrictMode's intentional double-mount in dev — second call returns the cached teardown without re-subscribing; (i) **regression tests cover** (i) the bootstrap-once contract: 2 simultaneous `bootstrapAuth()` calls install only ONE `supabase.auth.onAuthStateChange` subscription, (ii) the per-event branching contract: re-runs Story 9-6's tests against the bootstrap module's listener to prove no regression, (iii) the consumer-pure-hook contract: `useAuth()` post-12-2 does NOT call `useEffect` at all (negative-guard via source-grep + a runtime test that mocks `useEffect` and asserts it's not invoked from inside `useAuth()`), (iv) the public API surface: re-renders the hook and asserts the return shape matches the pre-12-2 contract exactly (TypeScript-level pin + runtime), (v) the listener-fan-out delta: mock `supabase.auth.onAuthStateChange` to verify it's subscribed-to exactly ONCE across the lifecycle of N hook mounts (the centerpiece performance claim of this story), (vi) the `loadProfile` invocation count: simulate a `SIGNED_IN` event and assert `loadProfile` runs exactly ONCE (pre-12-2 would have run N times for N mounted consumers), (vii) the StrictMode-double-mount idempotence: simulate dev-mode double-bootstrap and assert only ONE subscription is created,

so that **audit finding P0-7's structural cause closes architecturally** (Story 9-6 closed the per-event branching; Story 12-2 closes the multiple-subscribers cause); the auth flow has a **clean class-singleton-style architectural seam** that future stories (Epic 12.X tier-aware routing, Epic 16.X paid-tier metadata, etc.) can build on without re-disturbing the 7 consumer call sites; the **per-event allocation cost drops from N closures × 7 consumers to 0 closures inside `useAuth()`** (action methods are static module-level exports); the **concurrent-`loadProfile`-on-SIGNED_IN race** that Story 9-6's idempotent `flushWriteQueue` Promise gate caught DOWNSTREAM is now caught UPSTREAM at the subscription level (single subscriber → single `loadProfile` call by construction); the verified-correct surfaces NOT touched are Story 9-3 Sentry telemetry allowlist (no new feature tags), Story 9-4 stored-prompt-injection defense (orthogonal), Story 9-5 voice transcript dedup (orthogonal), Story 9-6 auth listener event gating (`decideAuthAction` + per-event semantics preserved by construction — the bootstrap module IS the new home of the listener), Story 9-7 Zod schema retry contract (orthogonal), Story 9-8 / 10-6 speaking pipeline (orthogonal), Story 9-9 deploy substrate (orthogonal), Story 9-10 auth + cache race hardening (`applyProfileIfFresh` userId-guard + `profileFetchFailed` flag + `flushWriteQueue` idempotency all preserved), Story 10-X surfaces (prompts + scoring + dedup orthogonal), Story 11-1 through 11-8 + Story 12-1 (the new `RealtimeOrchestrator` consumes `useAuthStore.getState().user` at construction time per Story 12-1 review-round-1 P17 — that pattern continues working unchanged because the orchestrator reads from the store directly, not via the hook).

## Background — Why This Story Exists

### What audit finding P0-7 owns to this story

[`shippable-roadmap.md` line 44](_bmad-output/planning-artifacts/shippable-roadmap.md): "P0-7 — Auth listener re-runs `loadProfile` on every `TOKEN_REFRESHED` event — refetches profile, resets loading, re-flushes write queue (queued writes can replay)."

Story 9-6 closed the **per-event branching** portion (only re-load on SIGNED_IN/OUT/INITIAL/USER_UPDATED; idempotent `flushWriteQueue`; unhandled-rejection catch). Story 12.2 closes the **structural cause** that 9-6 left intact: the listener is installed inside `useAuth()`'s `useEffect`, which means every consumer mount installs its own listener.

[`shippable-roadmap.md` line 205](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 12.2 deliverable: "Move auth subscription to one-time bootstrap in Zustand store; consumers read state only. **Covers P0-7 deepening.**"

### Current state — `useAuth()` installs a listener PER CONSUMER

[`src/hooks/use-auth.ts:88-156`](src/hooks/use-auth.ts):

```typescript
export function useAuth() {
  const { session, user, profile, isLoading, /* ... */ } = useAuthStore();

  useEffect(() => {
    // Cold-start getSession()
    void supabase.auth.getSession().then(/* ... */);

    // Install listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      const action = decideAuthAction(event, session);
      switch (action.kind) {
        case "load-profile": void loadProfile(action.userId, { flushQueue: action.flushQueue }); return;
        // ... 3 other branches
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ... 5 more closures returned in hook surface

  return { /* ... */ };
}
```

### Current state — 7 `useAuth()` consumers across the app

Verified via `grep -rn "useAuth()" src/ app/`:

| Consumer | Mounting profile |
|---|---|
| `app/_layout.tsx:47` | **Always mounted** (root layout) |
| `app/(tabs)/profile/settings.tsx:106` | Mounted when on settings |
| `app/(tabs)/profile/index.tsx:158` | Mounted when on profile tab |
| `app/(auth)/login.tsx:30` | Mounted on login screen |
| `app/(auth)/signup.tsx:31` | Mounted on signup screen |
| `app/onboarding/placement-test.tsx:352` | Mounted on placement test |
| `app/onboarding/index.tsx:128` | Mounted on onboarding |

Since `_layout.tsx` is the always-mounted root, ANY other screen using `useAuth()` runs as the SECOND subscriber simultaneously. A `SIGNED_IN` event fired during onboarding triggers 2+ concurrent `loadProfile(userId)` calls.

### The N-listener race + 12-2 design

The same Supabase auth event fan-outs to N subscribers:

```
SIGNED_IN event
  ├── _layout.tsx listener   → decideAuthAction → loadProfile(uid)   → cacheWithFallback... 
  ├── onboarding listener    → decideAuthAction → loadProfile(uid)   → cacheWithFallback... 
  └── settings listener      → decideAuthAction → loadProfile(uid)   → cacheWithFallback... 
                                                  ↓ all 3 in-flight concurrently
```

Story 9-6's `flushWriteQueue` idempotency catches the duplicate flushes via a module-scope `inFlight` Promise. But `loadProfile` itself is NOT module-scope idempotent — N concurrent Supabase `profiles.select()` queries fire, and the 3 `cacheWithFallback` writes race to the same AsyncStorage key.

**12-2 collapses the fan-out to 1:**

```
SIGNED_IN event
  └── bootstrap listener     → decideAuthAction → loadProfile(uid)   → cacheWithFallback...   
                                                  ↓ single in-flight
```

### Architecture — `src/lib/auth-bootstrap.ts`

New module exports:

```typescript
// One-call-guard for idempotent bootstrap.
let bootstrapState: { teardown: () => void } | null = null;

/**
 * Install the supabase.auth.onAuthStateChange listener + cold-start
 * getSession once per app lifetime. Returns a teardown closure that
 * unsubscribes the listener. Idempotent — a second call returns the
 * cached teardown without re-subscribing.
 *
 * Called ONCE at module-load time of app/_layout.tsx (or other root).
 */
export function bootstrapAuth(): () => void {
  if (bootstrapState) return bootstrapState.teardown;
  // ... cold-start getSession() + listener install + loadProfile dispatch ...
  bootstrapState = { teardown: () => subscription.unsubscribe() };
  return bootstrapState.teardown;
}

/**
 * Internal: load user profile (with offline cache fallback) and optionally
 * flush the offline write queue. Story 9-6 + 9-10 contract preserved verbatim.
 */
async function loadProfile(userId: string, opts: { flushQueue?: boolean } = { flushQueue: true }): Promise<void> {
  // ... unchanged Story 9-10 implementation ...
}

/**
 * Public: retry a previously failed profile load (Story 9-10 AC #3).
 */
export async function retryProfileFetch(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await loadProfile(user.id, { flushQueue: false });
}

// Static action methods — pure async functions; no React state captured.
export async function signInWithEmail(email: string, password: string) { /* ... */ }
export async function signUpWithEmail(email: string, password: string, fullName: string) { /* ... */ }
export async function signOut() { /* ... */ }
export async function updateProfile(updates: Partial<UserProfile>) { /* ... */ }
```

### Architecture — `src/hooks/use-auth.ts` post-12-2

```typescript
import {
  retryProfileFetch,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  updateProfile,
} from "@/src/lib/auth-bootstrap";
import { useAuthStore } from "@/src/store/auth-store";

/**
 * Pure consumer hook — reads auth state from Zustand store + exposes static
 * action methods. The `onAuthStateChange` listener is installed once by
 * `bootstrapAuth()` (called from `app/_layout.tsx` module load).
 *
 * Post-12-2: zero `useEffect`, zero closures per render, zero per-consumer
 * listener installation. Pre-12-2 surface preserved verbatim.
 */
export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isOnboarded = useAuthStore((s) => s.isOnboarded);
  const profileFetchFailed = useAuthStore((s) => s.profileFetchFailed);

  return {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    profileFetchFailed,
    retryProfileFetch,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
  };
}
```

Target hook line count: ~40-60 lines (pre-12-2: 359 lines; ~85-90% reduction).

### Architecture — `app/_layout.tsx` bootstrap call

```typescript
// At module-load (top-level, outside the component function):
import { bootstrapAuth } from "@/src/lib/auth-bootstrap";
bootstrapAuth(); // idempotent — safe to call from module-load

export default function RootLayout() {
  useAuth(); // pure consumer now
  // ... rest of layout
}
```

The bootstrap runs at JS-bundle parse time (before any React render), so the listener is installed before the first `<RootLayout>` mount. StrictMode's double-mount in dev re-runs the module-load code via re-import? **No** — module load is cached per JS instance. The one-call guard inside `bootstrapAuth()` defends against any pathological re-call.

### Why "module-load" vs "useEffect-in-store"

The spec roadmap line 205 phrases the destination as "one-time bootstrap in Zustand store". Two equivalent implementations:

1. **Module-load `bootstrapAuth()` call from `_layout.tsx`** (chosen here) — simpler; aligns with Expo's "module-load = bundle-parse-time" idiom.
2. **Inside Zustand store's `create()` callback** — possible but creates side-effects at store-import time, which loads the supabase client + installs the listener even in tests that don't need auth. Side-effects in module load are generally fine, but doing them inside a Zustand store factory makes the store harder to mock in unit tests.

Option 1 keeps the store pure (just state + setters) and isolates the side-effect to a dedicated bootstrap module that consumers call explicitly.

### Threat / failure model — what cannot happen post-story

After this story:

1. **N-listener fan-out cannot happen** — the module-level `bootstrapState` one-call guard ensures only ONE `supabase.auth.onAuthStateChange` subscription exists per app lifetime.

2. **Concurrent `loadProfile` calls collapse to 1** — single subscriber means single dispatch. Story 9-6's `flushWriteQueue` idempotency Promise remains as defense-in-depth but is no longer load-bearing.

3. **`profileFetchFailed` flag race resolved** — Story 9-10's read-modify-write of the flag now operates on a single-source-of-truth subscriber. No more "listener A's failed loadProfile sets flag = true; listener B's successful loadProfile clears it" overwrite race.

4. **`useAuth()` per-render allocation drops to ~0** — pre-12-2 7 closures created per render; post-12-2 0 closures (action methods are module-level statics).

5. **Story 9-6 invariants preserved** — `decideAuthAction` is the unchanged per-event branching helper. The listener still calls `setSession(session)` first. All 4 action kinds (`load-profile` / `clear-profile` / `session-only` / `no-session-warning`) preserved verbatim.

6. **Story 9-10 invariants preserved** — `applyProfileIfFresh` userId-guard + `profileFetchFailed` flag + `flushWriteQueue` idempotency contract all flow through unchanged. Re-tested against the new bootstrap module.

7. **All 7 consumer call sites work unchanged** — public hook return shape is verbatim. TypeScript pin + runtime assertion.

8. **StrictMode-safe** — module-load happens once per JS instance; the one-call guard handles the rare re-call case (Fast Refresh in dev, OTA hot-swap).

9. **`useAuthStore` selector-pattern** — pre-12-2 the hook destructured 8 fields from `useAuthStore()` (single selector subscribing to whole store; causes re-render on ANY store field change). Post-12-2 uses 6 per-field selectors (`useAuthStore((s) => s.session)` × 6) so consumers re-render only when their consumed field changes. Performance win for `app/(tabs)/profile/index.tsx` which renders on profile-only changes today but would re-render on `isLoading` changes too pre-12-2.

10. **Story 12-1 `RealtimeOrchestrator`'s direct `useAuthStore.getState().user` read continues working** — the orchestrator reads from the store, not from the hook. Bootstrap installs the listener; the listener updates the store; the orchestrator reads the store. Same data flow, less indirection.

### Out of scope for this story (delegated elsewhere)

- **Server-side session management** — Supabase auth-js owns the JWT refresh schedule; this story doesn't change refresh logic.
- **Encrypted profile cache** — Story 12-7 owns the SecureStore-wrapped adapter for the `cacheWithFallback` payload.
- **Atomic-RPC mutations for `updateProfile`** — `updateProfile`'s upsert-fallback logic stays sequential. Story 12-3 owns the broader atomic-RPC migration.
- **Multi-account support / account-switching UX** — not in scope.
- **Email verification gate before app loads** — Story 12-9.
- **Password policy tightening** — Story 12-8.
- **Move auth state outside Zustand entirely** (e.g., to React Context) — Zustand is the existing pattern; not changing it.
- **Strict-mode double-mount audit of the bootstrap teardown** — module-load happens once; teardown is registered on `_layout.tsx`'s useEffect cleanup but rarely fires in practice. Defensive but not load-bearing.

## Acceptance Criteria

### 1. Create `src/lib/auth-bootstrap.ts` module

- [ ] **CREATE** `src/lib/auth-bootstrap.ts` exporting:
  - `bootstrapAuth(): () => void` — idempotent install of the auth listener + cold-start getSession. Returns a teardown closure.
  - `retryProfileFetch(): Promise<void>` — exposed retry action for ProfileRetryScreen.
  - `signInWithEmail(email, password): Promise<{ error }>`
  - `signUpWithEmail(email, password, fullName): Promise<{ data, error }>`
  - `signOut(): Promise<{ error }>`
  - `updateProfile(updates): Promise<{ data, error }>`
- [ ] **MIGRATE** Story 9-6's `decideAuthAction`-dispatch listener + Story 9-10's `applyProfileIfFresh`-gated `loadProfile` from `use-auth.ts` to the new module verbatim. Preserve every `captureError` site, every `addBreadcrumb` site, and the exact shape of the listener callback.
- [ ] **MODULE-LEVEL `bootstrapState`** one-call guard:

  ```typescript
  let bootstrapState: { teardown: () => void } | null = null;
  export function bootstrapAuth(): () => void {
    if (bootstrapState) return bootstrapState.teardown;
    // ... install listener + cold-start getSession ...
    bootstrapState = { teardown: () => subscription.unsubscribe() };
    return bootstrapState.teardown;
  }
  ```

- [ ] **`__resetBootstrapForTests()`** test-only escape hatch exported under a clearly-named guard so unit tests can reset the singleton between tests:

  ```typescript
  /** @internal — test-only. Resets the one-call guard so tests don't leak subscriptions. */
  export function __resetBootstrapForTests(): void {
    bootstrapState?.teardown();
    bootstrapState = null;
  }
  ```

**Given** `bootstrapAuth()` is called twice
**When** the second call dispatches
**Then** the same teardown closure is returned AND `supabase.auth.onAuthStateChange` was invoked EXACTLY ONCE.

### 2. Rewrite `src/hooks/use-auth.ts` as a pure consumer hook

- [ ] **DELETE** the entire `useEffect(() => { ... })` block, the listener installation, the cold-start `getSession()` call, and the inline `loadProfile` / `retryProfileFetch` / `signInWithEmail` / `signUpWithEmail` / `signOut` / `updateProfile` closures.
- [ ] **REIMPORT** the 5 action functions + `retryProfileFetch` from `auth-bootstrap.ts`.
- [ ] **SIMPLIFY** the hook to 6 per-field `useAuthStore((s) => s.X)` selectors + return the same surface. Target ~40-60 lines.
- [ ] **PRESERVE** the `applyProfileIfFresh` export — it stays in `use-auth.ts` because tests at `src/lib/__tests__/auth-load-profile-stale.test.ts` import it from the hook module (verify via grep; if the import path changed in 9-10, point to the new location).
- [ ] **VERIFY** all 7 consumer call sites compile with zero changes via TypeScript.

**Given** the hook is post-12-2
**When** a `useAuth()` consumer mounts
**Then** the hook body does NOT call `useEffect` AND does NOT call `supabase.auth.onAuthStateChange` AND returns the same `UseAuthReturn` shape as pre-12-2.

### 3. Wire `bootstrapAuth()` into `app/_layout.tsx`

- [ ] **UPDATE** [`app/_layout.tsx`](app/_layout.tsx) to import + call `bootstrapAuth()` at module-load time (top-level, outside the component function):

  ```typescript
  import { bootstrapAuth } from "@/src/lib/auth-bootstrap";

  // Module-load idempotent bootstrap — installs the auth listener once.
  // The returned teardown is registered on the root layout's unmount.
  const teardownAuth = bootstrapAuth();

  export default function RootLayout() {
    // ... existing layout body, including useAuth() ...
  }
  ```

- [ ] **OPTIONAL — register `teardownAuth` on a `useEffect` cleanup** if the bundle ever fully reloads (rare; Fast Refresh, OTA hot-swap). Acceptable to omit if the cleanup contract is awkward to wire into the existing layout.

**Given** the app boots
**When** the JS bundle parses
**Then** `bootstrapAuth()` is called exactly once AND the auth listener is installed before the first `<RootLayout>` render.

### 4. Tests

- [ ] **CREATE** `src/lib/__tests__/auth-bootstrap.test.ts` (~12 cases):

  - **Bootstrap idempotence:**
    - 2 simultaneous `bootstrapAuth()` calls install only ONE `supabase.auth.onAuthStateChange` subscription.
    - Second `bootstrapAuth()` returns the SAME teardown closure (referential equality).
    - `__resetBootstrapForTests()` clears the singleton (tests can run in clean isolation).
  - **Story 9-6 invariants preserved:**
    - `INITIAL_SESSION` → `loadProfile(userId, { flushQueue: true })` fires.
    - `SIGNED_IN` → `loadProfile(userId, { flushQueue: true })` fires + `invalidateCache(userId, PROFILE)` does NOT fire (cache is fresh).
    - `USER_UPDATED` → `loadProfile(userId, { flushQueue: false })` fires + `invalidateCache(userId, PROFILE)` fires.
    - `SIGNED_OUT` → `setProfile(null)` + `setProfileFetchFailed(false)` + `setLoading(false)` fires.
    - `TOKEN_REFRESHED` / `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` → `setSession` only; NO loadProfile, NO flushQueue.
    - Null session on non-SIGNED_OUT event → breadcrumb fires; local profile NOT destroyed.
  - **Story 9-10 invariants preserved:**
    - `applyProfileIfFresh` gates the `setProfile` + `flushWriteQueue` + `setProfileFetchFailed` writes against userId mismatch (test via simulated mid-flight sign-out).
    - `profileFetchFailed` flag set on catch path; cleared on successful applied load.
    - `retryProfileFetch` calls `loadProfile(user.id, { flushQueue: false })`.

- [ ] **CREATE** `src/hooks/__tests__/use-auth.test.tsx` (~6 cases via `react-test-renderer`):

  - Hook returns the verbatim pre-12-2 `UseAuthReturn` shape (TypeScript-level + runtime).
  - Hook does NOT call `useEffect` (negative-guard via spying on React's useEffect during hook invocation — or via source-grep drift detector).
  - Multiple `useAuth()` consumers mounted concurrently share the SAME bootstrap (no per-consumer listener subscription).
  - Action methods (`signInWithEmail` / `signUpWithEmail` / `signOut` / `updateProfile` / `retryProfileFetch`) are imported from the bootstrap module + their identity is stable across renders.
  - `useAuthStore` per-field selectors fire only on the consumed field change (verify via a render-counting consumer).
  - Hook compiles with the unchanged pre-12-2 consumer call sites (TypeScript pin).

- [ ] **CREATE** `src/hooks/__tests__/use-auth-line-budget.test.ts` (~6 drift-detector cases):

  - Line count ≤ ~80 lines (target ~40-60; budget 80).
  - Hook imports from `@/src/lib/auth-bootstrap`.
  - Negative-guards: hook does NOT import `supabase` directly; does NOT call `onAuthStateChange`; does NOT call `getSession`; does NOT contain `useEffect`.

- [ ] **VERIFY existing tests stay green** — `auth-events.test.ts` (Story 9-6) + `auth-load-profile-stale.test.ts` (Story 9-10) + `cache-flush.test.ts` (Story 9-10) all pass unchanged.

- [ ] **Target test count:** 1260 → ~1280 (+~20 from the new modules).

### 5. Update CLAUDE.md

- [ ] Add a new architecture line **after** the Story 12-1 paragraph documenting: (a) the new `src/lib/auth-bootstrap.ts` module + the one-call `bootstrapState` guard, (b) the `bootstrapAuth()` call at `app/_layout.tsx` module-load time, (c) the pure-consumer-hook refactor of `useAuth()` to ~40-60 lines, (d) the N-listener → 1-listener fan-out collapse + the resulting `loadProfile` deduplication, (e) Story 9-6 + 9-10 invariants preserved by construction, (f) cross-story invariants (Story 11-1 through 12-1 unchanged).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-2 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [ ] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — preserve every pre-12-2 catch site verbatim.
- [ ] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [ ] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [ ] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass.
- [ ] **Story 9-3 Sentry allowlist contract holds** — no new `feature` strings; pre-12-2 `auth-initial-session` + `auth-load-profile` tags preserved.
- [ ] **Story 9-4 / 9-5 / 9-7 / 9-8 / 9-9 / 10-X / 11-X / 12-1 surfaces** — orthogonal; no shared state.
- [ ] **Story 9-6 auth listener event gating contract holds** — `decideAuthAction` continues to be the single per-event branching point.
- [ ] **Story 9-10 auth + cache race hardening contract holds** — `applyProfileIfFresh` + `profileFetchFailed` flag + `flushWriteQueue` idempotency all preserved.
- [ ] **Story 12-1 `RealtimeOrchestrator` direct store-read pattern holds** — orchestrator reads `useAuthStore.getState().user` at construction; bootstrap installs listener; listener updates store; orchestrator reads store. Same data flow, less indirection.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files".
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/12-2-auth-subscription-bootstrap.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Create `src/lib/auth-bootstrap.ts`** (AC #1)
  - [ ] Migrate the listener + cold-start `getSession()` from `use-auth.ts`'s `useEffect` to the new module.
  - [ ] Migrate `loadProfile` + `retryProfileFetch` + `signInWithEmail` + `signUpWithEmail` + `signOut` + `updateProfile`.
  - [ ] Add `bootstrapState` one-call guard.
  - [ ] Add `__resetBootstrapForTests` escape hatch.

- [ ] **Task 2: Rewrite `src/hooks/use-auth.ts` as a pure consumer hook** (AC #2)
  - [ ] Delete the `useEffect` + all closures + listener install.
  - [ ] Switch from single `useAuthStore()` destructure to 6 per-field selectors.
  - [ ] Re-import the 5 action functions + `retryProfileFetch` from the bootstrap module.
  - [ ] Preserve the public `UseAuthReturn` shape verbatim.
  - [ ] Preserve the `applyProfileIfFresh` export (or move it to a dedicated module + update consumer test imports).

- [ ] **Task 3: Wire `bootstrapAuth()` into `app/_layout.tsx`** (AC #3)
  - [ ] Add module-load-time `const teardownAuth = bootstrapAuth();` at top of file.
  - [ ] Optionally register teardown on root-layout unmount.

- [ ] **Task 4: Tests** (AC #4)
  - [ ] CREATE `src/lib/__tests__/auth-bootstrap.test.ts` (~12 cases).
  - [ ] CREATE `src/hooks/__tests__/use-auth.test.tsx` (~6 cases via react-test-renderer).
  - [ ] CREATE `src/hooks/__tests__/use-auth-line-budget.test.ts` (~6 drift-detector cases).
  - [ ] Target test count: 1260 → ~1280.

- [ ] **Task 5: Update CLAUDE.md** (AC #5)

- [ ] **Task 6: Quality gates** (AC #Z)
  - [ ] type-check / lint / format / test / colors all green.
  - [ ] CI Sentry DSN + Submit credentials leak guards pass.
  - [ ] `git status` shows the story file as untracked-but-not-ignored.
  - [ ] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Module-load bootstrap singleton** — mirrors Story 12-1's `RealtimeOrchestrator` class-singleton + thin-hook pattern, applied to auth. The bootstrap module owns the side effect; the hook is pure consumption.
- **One-call guard via module-level `let bootstrapState`** — same pattern as Story 9-6's `flushWriteQueue` `let inFlight: Promise<number> | null = null`. Idempotency at the module level catches re-invocation without re-installing.
- **Static action methods over hook-closure methods** — `signInWithEmail` / `signOut` / etc. don't need React state, so they're module-level pure exports. Pre-12-2 they were created on every hook render (7 closures × N renders = expensive); post-12-2 they're imported once per module-load.
- **Per-field selectors over single destructure** — `useAuthStore((s) => s.session)` vs `useAuthStore().session`. The selector pattern fires re-renders only on the consumed field change; the destructure fires on any field change. Aligns with the Zustand performance idiom.
- **Test-only escape hatch (`__resetBootstrapForTests`)** — namespaced with `__` prefix per JS convention; clearly-marked `@internal` JSDoc. Pattern matches Story 11-2's `_triggerStateChange` test helper at `RealtimeSession`.
- **Story 9-6 + 9-10 invariants preserved by construction** — the migration is pure call-site relocation. The `decideAuthAction` per-event branching switch, the `applyProfileIfFresh` userId-guard, the `profileFetchFailed` flag semantics all flow through unchanged.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section.
- **Epic 9 + 10 + 11 + 12-1 retros A3** (review-patch budget): Story 12-2 has **MEDIUM** risk surface — central auth flow, but the refactor is contained to 1 new module + 1 hook rewrite + 1 layout edit. Expect **6-9 review patches**. Medium-risk:
  - (a) `bootstrapAuth()` called from module-load could fire before the JS environment is ready (e.g., supabase client not yet imported). Verify import order.
  - (b) `__resetBootstrapForTests` could leak between Jest test files if not called in `beforeEach`. Test isolation.
  - (c) The cold-start `getSession()` was inside `useEffect` pre-12-2 — moving it to module-load means it fires synchronously during bundle parse. If `supabase.auth.getSession()` is heavy (it shouldn't be — it's a SecureStore read), this could affect startup time. Measure or document.
  - (d) Per-field selectors `useAuthStore((s) => s.X)` — Zustand uses Object.is equality by default, which is correct for primitives + the profile object reference. The pre-12-2 destructure was a single shallow-comparison; post-12-2 6 selectors each independent. Subtle but the Zustand idiom is well-established.
  - (e) Story 9-10's `applyProfileIfFresh` export location — pre-12-2 it was in `use-auth.ts`. Post-12-2 it MAY move to the bootstrap module. If tests import from the hook, update the import path OR keep `applyProfileIfFresh` in `use-auth.ts` and have the bootstrap module import it back.
  - (f) `app/_layout.tsx` module-load order — `bootstrapAuth()` runs at parse time; if any earlier module-load code (e.g., a Sentry init) depends on auth state, ordering matters. Audit.
  - (g) The `useAuth()`-without-`useEffect` pattern means consumers don't have a cleanup boundary — the bootstrap's teardown is registered on `_layout.tsx`'s mount, not on individual consumer mounts. Document.
- **Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 lesson** (drift detector for source-of-truth invariants): Add a drift-detector test reading `use-auth.ts` from disk and asserting line count + negative guards.
- **Story 12-1 lesson** (hook-binding tests via react-test-renderer): The new hook test file uses the same pattern.

### Anticipated File List

**Created:**

- `src/lib/auth-bootstrap.ts` (~250 lines — absorbs the listener + cold-start + 5 action methods + retry helper)
- `src/lib/__tests__/auth-bootstrap.test.ts` (~12 cases)
- `src/hooks/__tests__/use-auth.test.tsx` (~6 cases)
- `src/hooks/__tests__/use-auth-line-budget.test.ts` (~6 cases)

**Modified:**

- `src/hooks/use-auth.ts` — slimmed from 359 to ~40-60 lines
- `app/_layout.tsx` — add module-load `bootstrapAuth()` call
- `CLAUDE.md` — architecture paragraph
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status flip

**Deleted:**

- The `useEffect` + listener install + 5 action closures + `loadProfile` + `retryProfileFetch` from `use-auth.ts` (migrated to bootstrap; not aliased).

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-13 | Story 12-2 story file created; closes audit P0-7 deepening (auth listener installed per-consumer → installed once at bootstrap); spec target `useAuth.ts` becomes pure consumer hook (~40-60 lines); MEDIUM risk surface (~6-9 review patches anticipated per Epic 9/10/11/12 retro). |
