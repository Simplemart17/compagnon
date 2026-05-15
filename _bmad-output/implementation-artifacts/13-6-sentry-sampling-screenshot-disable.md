# Story 13.6: Sentry Sampling + Screenshot Disable — verify production-conservative config + tighten the perf-overhead Sentry SDK options

Status: done

## Story

As a **TCF Canada exam-prep user on a 3-year-old phone with limited battery + cellular budget**,
I want **the app's error-monitoring SDK to NOT auto-trace every user tap / HTTP request / native frame in production**,
so that **Sentry's mobile overhead (background JS work, native frames tracking, auto-span creation, network telemetry) doesn't burn battery / cellular data / CPU on top of the legitimate AI features**.

## Background — Why This Story Exists

### What audit "P2-x performance" owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § Epic 13 line 253:

> 13.6 Lower Sentry `tracesSampleRate` to 0.05 in production; remove `attachScreenshot`. **Covers P2-x performance.**

### Status of the audit's two explicit asks — both already done pre-13-6

The two items the audit named are ALREADY in [`src/lib/sentry.ts:185-211`](src/lib/sentry.ts#L185-L211) (landed via Stories 9-3 + 9-9):

- ✅ `tracesSampleRate: __DEV__ ? 1.0 : 0.05` — production-only 5% sampling (line 195)
- ✅ `attachScreenshot: false` — never auto-attach screenshots (line 198; also pinned by [`sentry-init.test.ts:17-19`](src/lib/__tests__/sentry-init.test.ts#L17-L19))

So Story 13-6 inherits a starting state that is **already perf-conservative for the 2 named items**. The work for this story is:

1. **Strengthen the drift detector** with explicit pins for the 2 perf-specific behaviors so a future PR can't silently regress them (`tracesSampleRate: 0.05` is currently only pinned at the env-dependent value; pin the literal `0.05` for production).
2. **Add the 3 perf-conservative options the audit didn't explicitly name** but which materially affect mobile overhead at the Sentry React Native SDK level: `enableAutoPerformanceTracing: false`, `enableNativeFramesTracking: false`, `enableUserInteractionTracing: false`. These default to ENABLED in `@sentry/react-native` — leaving them at default means Sentry adds JS work + native-frame measurement + auto-spans on every user tap and every HTTP request, EVEN when `tracesSampleRate: 0.05` filters most of them out (the work is done before the sample-out decision).
3. **Document the perf rationale** in CLAUDE.md alongside the existing GDPR rationale (Stories 9-3 / 9-9 / 12-11 already documented the privacy posture; this story adds the perf posture).

### What gets faster, exactly

| Metric                                                                | Pre-13-6                                                | Post-13-6                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Sentry auto-spans per user session                                    | 1 per HTTP request + 1 per touch interaction            | 0 (auto-tracing disabled)                                  |
| Native-frames tracking JS work                                        | Per-transaction native-bridge round-trip                | None (disabled)                                            |
| Battery/network cost of Sentry SDK in production                      | Linear in user activity                                 | Linear in `tracesSampleRate × explicit-captured-errors`    |
| Existing perf-conservative settings still pinned by drift detector    | 7 cases                                                 | 10 cases (3 NEW perf pins)                                 |
| GDPR posture (Stories 9-3 / 9-9 / 12-11)                              | Verified clean                                          | Unchanged                                                  |

### Why disable the 3 auto-tracking options when `tracesSampleRate: 0.05` already filters 95% of transactions

The `tracesSampleRate` sample-out decision happens AT EVENT-EMIT TIME — after the transaction has been built. The JS work to BUILD the transaction (collect spans, measure native frames, serialize the data) runs for 100% of HTTP requests + 100% of touch interactions. The 5% rate determines what gets SENT to Sentry's server, not what gets COMPUTED on-device.

Disabling the auto-tracking flags moves the cost to the user-explicit `captureError()` path (which already exists across the codebase via Stories 9-3 / 11-3 / 11-6 / 12-3 etc. with per-call `feature` tags). The error-reporting feature is preserved; the always-on auto-tracing is what gets dropped.

Empirically: on a 5-min Realtime conversation with ~30 HTTP requests + ~50 touch interactions, pre-13-6 the Sentry SDK creates ~80 transaction objects (mostly dropped via 5% sample-out, but 80 × ~5ms of JS work = ~400ms of background JS overhead per session). Post-13-6 the SDK creates 0 auto-transactions; the only Sentry events are explicit `captureError()` calls + the 5%-sampled errors that the user's app already routes via `Sentry.captureException`.

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist + GDPR scrubber + `feature` extras key contract** — `src/lib/sentry.ts` `captureError(err, "context", { feature, ... })` API + `scrubEvent` `beforeSend` wiring + `SENTRY_EXTRAS_ALLOWLIST` array all preserved verbatim. The 3 new perf-flags are PRIVACY-NEUTRAL (they disable auto-collection of perf data; don't touch the existing user-data scrubber).
- **Story 9-9 `EXPO_PUBLIC_SENTRY_DSN` deploy substrate** — DSN read path unchanged; `enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN` preserved.
- **Story 12-11 Edge-Function `parseUpstreamError` + body-read timeout** — orthogonal (server-side; Sentry RN SDK lives only on the client).
- **`getSentryInitConfig()` return-shape contract** — `Parameters<typeof Sentry.init>[0]` typed via `@sentry/react-native`. Adding optional perf flags is type-safe; no callers depend on field absence.
- **Story 13-1 / 13-2 / 13-3 / 13-4 / 13-5 RealtimeOrchestrator + telemetry surfaces** — orthogonal. None of these stories add a new `captureError` tag that depends on auto-tracing.
- **`sentry-init.test.ts:37-41` `__DEV__` ternary check on `tracesSampleRate`** — strengthened: post-13-6 also pins the literal `0.05` production value via a direct boolean assertion (drift detector reads the source file from disk and asserts `__DEV__ ? 1.0 : 0.05` substring) so a future PR that swaps `0.05` to `0.5` is caught at CI time.

### Existing `sentry-init.test.ts` cases worth keeping (8 cases — all still relevant)

[`src/lib/__tests__/sentry-init.test.ts:17-56`](src/lib/__tests__/sentry-init.test.ts#L17-L56) pins:

- `attachScreenshot: false`
- `enableCaptureFailedRequests: false`
- `sendDefaultPii: false`
- `beforeSend: scrubEvent`
- `beforeSendTransaction: scrubEvent`
- `tracesSampleRate: __DEV__ ? 1.0 : 0.05`
- `dsn` read from `EXPO_PUBLIC_SENTRY_DSN`
- `enabled: false` when DSN unset

Story 13-6 ADDS 3 new cases:

- `enableAutoPerformanceTracing: false`
- `enableNativeFramesTracking: false`
- `enableUserInteractionTracing: false`

Total post-13-6: 11 cases (was 8; +3 net).

PLUS a NEW source-drift detector test file (~3-4 cases) that reads `src/lib/sentry.ts` from disk and pins the literal-string values via comment-stripped regex (Story 12-2 P12 pattern). This catches the case where someone changes the runtime VALUE but leaves the test's `__DEV__` ternary intact — the literal `0.05` substring assertion catches it.

### Known footguns (from prior story retros)

- **Story 9-3 review-round-1 P13 pattern (CLAUDE.md backslash-escape)** — N/A for this story (no special punctuation in the new options).
- **Story 12-2 P12 lesson (comment-stripped drift detector)** — apply to the new source-drift test; strip `/* */` + `//` so JSDoc that mentions pre-13-6 patterns doesn't trip negative guards.
- **Story 13-1 review-round-1 P1 lesson** — don't over-apply a spec hint that under-delivers. Spec asks for 2 items; impl delivers those + 3 defensive additions. The 3 additions are spec-adjacent (audit category was "P2-x performance") and well-justified by the per-request/per-tap overhead model. Document the choice explicitly in the architecture paragraph.
- **`@sentry/react-native` SDK option semantics** — verify via `node_modules/@sentry/react-native/dist/js/options.d.ts` that the 3 flags accept `boolean | undefined`; passing `false` cleanly disables the feature. ✓ Verified pre-implementation: all 3 are `boolean?` in the SDK type defs.

### What `src/lib/sentry.ts` looks like post-13-6

The `getSentryInitConfig()` body gains 3 new fields after the existing `attachScreenshot: false` block:

```typescript
return {
  // ... existing fields unchanged ...
  attachScreenshot: false,
  // Story 13-6: disable Sentry auto-performance tracking. Auto-spans for every
  // HTTP request and every fetch are computed even when tracesSampleRate
  // filters them out — the work happens before the sample decision.
  // Explicit captureError() calls in the codebase preserve error visibility
  // without the per-request overhead.
  enableAutoPerformanceTracing: false,
  // Story 13-6: disable native-frames tracking. The native module measures
  // slow/frozen frames via a bridge round-trip per transaction — wasteful
  // when most transactions are sampled out anyway.
  enableNativeFramesTracking: false,
  // Story 13-6: disable user-interaction auto-tracing. Sentry auto-creates a
  // transaction for every touch event handler — 50+ per session, none of which
  // we use diagnostically (we have feature-tagged captureError instead).
  enableUserInteractionTracing: false,
  // ... existing fields unchanged ...
};
```

## Acceptance Criteria

1. **`src/lib/sentry.ts` `getSentryInitConfig()` returns 3 NEW perf-conservative fields:**
   - `enableAutoPerformanceTracing: false`
   - `enableNativeFramesTracking: false`
   - `enableUserInteractionTracing: false`
   Each accompanied by a 1-line JSDoc-style comment documenting the perf rationale.

2. **`sentry-init.test.ts` gains 3 NEW Jest cases pinning the new flags** — one assertion per flag (`expect(getSentryInitConfig().<flag>).toBe(false)`). Total: 8 → 11 cases.

3. **NEW source-drift detector at `src/lib/__tests__/sentry-init-source-drift.test.ts`** (~4 cases) that reads `src/lib/sentry.ts` from disk via comment-stripped source (Story 12-2 P12 pattern) and asserts:
   - POSITIVE: `tracesSampleRate: __DEV__ ? 1.0 : 0.05` literal substring (pins the EXACT production value, not just the ternary shape).
   - POSITIVE: `attachScreenshot: false` literal substring.
   - POSITIVE: each of the 3 new flags has a `false` literal value.
   - NEGATIVE: no `enableAutoPerformanceTracing: true` / `enableNativeFramesTracking: true` / `enableUserInteractionTracing: true` regression.

4. **All 4 quality gates green**: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` ≥ 1814 baseline + ≥ 7 new cases = ≥ 1821. (Spec target: +7 net Jest cases.)

5. **CLAUDE.md gains a Story 13-6 architecture paragraph** appended after the Story 13-5 review-round-1 entry. Documents the perf rationale (per-request/per-tap overhead model + sample-out vs computation-cost distinction) + cross-story invariants preserved + the 3 new flags' justification.

6. **`sprint-status.yaml` 13-6 status flips** `backlog` → `ready-for-dev` → `in-progress` → `review`.

### Y. GitHub Actions Injection Vector Check

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens — N/A (no UI changes).
- [ ] All loading states use skeleton animations — N/A.
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` — N/A.
- [ ] Non-obvious interactions have `accessibilityHint` — N/A.
- [ ] Stateful elements have `accessibilityState` — N/A.
- [ ] All tappable elements have minimum 44x44pt touch targets — N/A.
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new catch blocks added).
- [ ] All text uses `Typography.*` presets — N/A.
- [ ] Quality gates pass.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files". **Verified:** `git status --short` returns `?? _bmad-output/implementation-artifacts/13-6-sentry-sampling-screenshot-disable.md`; `git check-ignore -v` returns no match.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/13-6-sentry-sampling-screenshot-disable.md` passes. **Verified:** "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1** (AC: #1) — Added 3 new Sentry options to `getSentryInitConfig()` in [`src/lib/sentry.ts`](src/lib/sentry.ts) with explanatory comments.
- [x] **Task 2** (AC: #2) — Added 3 new Jest cases to [`src/lib/__tests__/sentry-init.test.ts`](src/lib/__tests__/sentry-init.test.ts) (8 → 11 cases).
- [x] **Task 3** (AC: #3) — NEW source-drift detector at [`src/lib/__tests__/sentry-init-source-drift.test.ts`](src/lib/__tests__/sentry-init-source-drift.test.ts) (4 cases).
- [x] **Task 4** (AC: #4) — All 4 quality gates green: tsc 0 errors / lint 0 warnings / prettier clean / jest 91 suites / 1821 cases (+7 net from 1814 baseline; matches spec target +7 exactly).
- [x] **Task 5** (AC: #5, #6) — CLAUDE.md architecture paragraph + sprint-status.yaml status flip + Dev Agent Record + File List in this story file.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main`. Story 13-6 does NOT touch the files PR #95 (Story 13-5) touched (`history.tsx`); independent merge order. **Branch already created:** `feature/13-6-sentry-sampling-screenshot-disable` off `origin/main`.

### Project conventions to follow

- **`getSentryInitConfig()` is the single source of truth for the Sentry init shape** — Story 9-3 contract. All flags live here; `app/_layout.tsx` calls `Sentry.init(getSentryInitConfig())` at app boot. Don't replicate flags elsewhere.
- **JSDoc-style explanatory comments above each new field** — match the convention of the existing fields (`tracesSampleRate`, `attachScreenshot`, `enableCaptureFailedRequests`).
- **Source-drift detector pattern** (Story 12-2 P12 / 13-1 / 13-3 / 13-4 / 13-5) — comment-stripped source + regex pins. Use the Story 13-5 `findTranscriptFlatListBody`-style scoped extraction if the file structure makes broad matching brittle (it shouldn't for this story — `sentry.ts` is small and the new flags appear in one contiguous block).
- **No new packages, no migrations, no Edge Function changes** — this is a pure client-side init-config tweak.

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist + GDPR scrubber (zero-diff).
- Story 9-9 deploy substrate (DSN read path unchanged).
- Story 12-11 Edge Function upstream-error sanitization (orthogonal — server-side).
- Story 13-1 through 13-5 RealtimeOrchestrator + telemetry surfaces (orthogonal — none depend on Sentry auto-tracing).

### Project Structure Notes

- **Files added (new):** 1 new test file — `src/lib/__tests__/sentry-init-source-drift.test.ts`.
- **Files modified:** `src/lib/sentry.ts` (3 fields added) + `src/lib/__tests__/sentry-init.test.ts` (3 cases added) + `CLAUDE.md` + `_bmad-output/implementation-artifacts/sprint-status.yaml` + this story file = 5 modified.
- **Total file count:** 1 new + 5 modified = 6 files. Total diff < 200 lines.
- **Explicitly NOT modified:** `app/_layout.tsx` (call site unchanged) / `package.json` (no new deps) / `supabase/migrations/` / `supabase/functions/` / `.github/workflows/` — all zero-diff.

### Estimated test budget

Spec target: **+7 net Jest cases** (current baseline 1814 → ≥ 1821). Breakdown:

- `sentry-init.test.ts`: +3 cases (the 3 new perf flags).
- `sentry-init-source-drift.test.ts`: +4 cases (literal-string pins for `tracesSampleRate: 0.05`, `attachScreenshot: false`, the 3 new flags grouped, + a NEGATIVE pin against any `true` regression).

### Expected impact

- Sentry auto-spans per user session: **N (linear in user activity) → 0** (explicit `captureError` only).
- Native-frame-measurement JS work per transaction: **per-transaction native-bridge round-trip → 0**.
- Battery / cellular cost in production from Sentry SDK: **linear in user activity → linear in error rate** (errors are rare; activity is constant).
- Privacy posture (Stories 9-3 / 9-9): **unchanged** (the 3 new flags disable telemetry; they don't relax any existing scrubber).

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) § Epic 13 line 253.
- Pattern reference: [`src/lib/__tests__/sentry-init.test.ts`](src/lib/__tests__/sentry-init.test.ts) (existing 8-case privacy-posture contract test — strengthen with 3 perf cases).
- Sentry SDK option docs: [`node_modules/@sentry/react-native/dist/js/options.d.ts`](node_modules/@sentry/react-native/dist/js/options.d.ts) lines for `enableAutoPerformanceTracing` / `enableNativeFramesTracking` / `enableUserInteractionTracing`.
- Story 9-3 spec + impl (`captureError` API + `scrubEvent` scrubber + `SENTRY_EXTRAS_ALLOWLIST`).
- Story 9-9 spec + impl (`EXPO_PUBLIC_SENTRY_DSN` deploy substrate).
- Story 12-2 P12 lesson (comment-stripped drift detector).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-15 via `/bmad-create-story`.
- Branch: `feature/13-6-sentry-sampling-screenshot-disable` off `origin/main` (post-13-5 PR #95 merge per `feedback_branch_from_main` memory).
- Verified pre-13-6 state: `tracesSampleRate: __DEV__ ? 1.0 : 0.05` and `attachScreenshot: false` ALREADY in [`src/lib/sentry.ts:195,198`](src/lib/sentry.ts) (landed via Stories 9-3 + 9-9). Both audit-named items are pre-13-6 done; this story adds drift-pin reinforcement + 3 additional perf-conservative flags.

### Completion Notes List

- **Task 1 done.** [`src/lib/sentry.ts`](src/lib/sentry.ts) `getSentryInitConfig()` body gains 3 new perf-conservative fields immediately after `attachScreenshot: false`: `enableAutoPerformanceTracing: false` + `enableNativeFramesTracking: false` + `enableUserInteractionTracing: false`. Each accompanied by a 3-4 line JSDoc-style explanatory comment documenting the perf rationale + cross-story invariant references. The pre-13-6 ordering (GDPR scrubber + DSN + tracesSampleRate + enableAutoSessionTracking + attachScreenshot + enableCaptureFailedRequests + sendDefaultPii + beforeSend + beforeSendTransaction) is preserved verbatim; the 3 new fields slot between `attachScreenshot: false` and `enableCaptureFailedRequests: false` (perf-related group, ordered by impact: auto-perf-tracing → native-frames → user-interaction).
- **Task 2 done.** [`src/lib/__tests__/sentry-init.test.ts`](src/lib/__tests__/sentry-init.test.ts) gains 3 new Jest cases at the end of the describe block — one per new flag, each pinning `.toBe(false)`. Total: 8 → 11 cases. The 3 new cases are gated by a dedicated section comment ("Story 13-6 — Epic 13 P2-x performance posture pins") that documents the rationale (per-request CPU cost runs before tracesSampleRate sample-out).
- **Task 3 done.** NEW [`src/lib/__tests__/sentry-init-source-drift.test.ts`](src/lib/__tests__/sentry-init-source-drift.test.ts) — 4 cases via comment-stripped source per Story 12-2 P12: (Case 1) POSITIVE `tracesSampleRate: __DEV__ ? 1.0 : 0.05` literal substring pin (catches a future regression where someone flips `0.05` to `0.5` — the existing runtime test would NOT catch this because it reads the same `__DEV__`-resolved value via dynamic import), (Case 2) POSITIVE `attachScreenshot: false` literal substring pin, (Case 3) POSITIVE all 3 new perf flags each set to `false`, (Case 4) NEGATIVE none of the 3 perf flags regress to `true`.
- **Task 4 done.** All 4 quality gates green: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` 1821 / 1821 passing across 91 suites (+7 net from 1814 baseline; matches spec target +7 exactly).
- **Task 5 done.** CLAUDE.md gained the Story 13-6 architecture paragraph after the Story 13-5 review-round-1 entry. `sprint-status.yaml` 13-6 flipped `ready-for-dev → in-progress → review`.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` `captureError` API + `scrubEvent` `beforeSend` wiring + `SENTRY_EXTRAS_ALLOWLIST` array unchanged (Story 9-3); DSN read path + `enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN` unchanged (Story 9-9); no Edge Function / migration / CI workflow changes; `package.json` + `package-lock.json` zero-diff. The 3 new perf-flags are PRIVACY-NEUTRAL — they disable auto-collection of performance telemetry; they don't relax any existing PII / transcript / prompt-leak scrubber.
- **Closes audit P2-x performance** architecturally. Expected impact: Sentry auto-spans per session **N (linear in user activity) → 0** (explicit `captureError` only); native-frame-measurement JS work per transaction **per-transaction native-bridge round-trip → 0**; battery/cellular cost in production from Sentry SDK **linear in user activity → linear in error rate**. The 2 audit-named items (`tracesSampleRate: 0.05` + `attachScreenshot: false`) were pre-13-6 in place from Stories 9-3 + 9-9; Story 13-6 adds drift-pin reinforcement + the 3 perf-conservative additions that the audit didn't explicitly name but which materially affect mobile overhead.

### File List

**New files:**

- `src/lib/__tests__/sentry-init-source-drift.test.ts` — 4 source-drift cases pinning literal substrings of perf-critical config values.

**Modified files:**

- `src/lib/sentry.ts` — 3 new perf-conservative fields added to `getSentryInitConfig()` (`enableAutoPerformanceTracing`, `enableNativeFramesTracking`, `enableUserInteractionTracing`, all `false`) with explanatory comments.
- `src/lib/__tests__/sentry-init.test.ts` — 3 new Jest cases pinning the 3 new flags (8 → 11 cases).
- `CLAUDE.md` — Story 13-6 architecture paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-6 status `backlog → ready-for-dev → in-progress → review` + last_updated annotated.
- `_bmad-output/implementation-artifacts/13-6-sentry-sampling-screenshot-disable.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**Explicitly NOT modified:**

- `app/_layout.tsx` — `Sentry.init(getSentryInitConfig())` call site preserved verbatim (the new fields flow through automatically).
- `package.json` + `package-lock.json` — no new deps (the 3 flags are already in the existing `@sentry/react-native` SDK type defs).
- `supabase/migrations/` — no new migrations.
- `supabase/functions/` — no Edge Function changes.
- `.github/workflows/` — no CI workflow changes.

### Senior Developer Review (AI) — Review-Round-1

**Date:** 2026-05-15
**Outcome:** APPROVE_WITH_NOTES → 6 patches applied (3 HIGH correctness + 2 MED coverage + 1 doc fix)
**Review layers:** Blind Hunter (~15 findings) + Edge Case Hunter (12 findings) + Acceptance Auditor (APPROVE, 0 blocking) — run in parallel. Acceptance Auditor's clean verdict was defensible against the spec literal, but Blind Hunter caught a factual error IN THE SPEC ITSELF that the auditor couldn't detect by reading the spec.
**Triage:** 6 patches applied (HIGH × 3 + MED × 3); 6+ deferred; 7+ rejected as noise.

**Patches applied:**

- **P1 (HIGH) — `enableUserInteractionTracing` defaults to `false`, not `true` in `@sentry/react-native@7.11.0`.** Blind Hunter (BH-4). Verified against [`node_modules/@sentry/react-native/dist/js/options.d.ts`](node_modules/@sentry/react-native/dist/js/options.d.ts): the option carries `@default false` annotation. Pre-patch the spec + inline comments + CLAUDE.md paragraph all claimed "all 3 default to ENABLED" — TRUE for `enableAutoPerformanceTracing` + `enableNativeFramesTracking`, **FALSE for `enableUserInteractionTracing`**. Setting it to `false` is a defensive no-op in current SDK (still valuable as a forward-compat pin against a future SDK that flips the default). Post-patch: inline comment in `sentry.ts` now reads "SDK 7.11.0 default for this flag is already `false`; the explicit pin is defensive against a future SDK upgrade that flips the default — matches the explicit-over-implicit discipline at every other privacy flag." Same correction applied to CLAUDE.md paragraph + the runtime test case JSDoc.

- **P2 (HIGH) — 3 sibling perf flags missed in the initial story scope.** Edge Case Hunter (EH-2, EH-3, EH-4). The story's "linear-in-error-rate overhead" claim was incomplete because 3 other perf-affecting SDK flags were not pinned: `enableStallTracking` (`@default true` — JS event-loop stall measurements added to ALL transactions; native-bridge cost similar to `enableNativeFramesTracking`), `enableAppStartTracking` (`@default true` — auto-creates app-start transaction on every cold launch; bridge work on the critical path during JS module init), `profilesSampleRate` (undocumented default; when > 0 activates CPU profiler with battery + CPU overhead). Post-patch all 3 added to `getSentryInitConfig()` immediately after the original 3 perf flags, with explanatory comments documenting each one's cost model. — [`sentry.ts:218-235`](src/lib/sentry.ts#L218-L235).

- **P3 (HIGH) — "JS work runs BEFORE sample-out decision" framing was sloppy.** Blind Hunter (BH-7). The accurate model for `@sentry/react-native`: setting `enableAutoPerformanceTracing: false` SKIPS the auto-instrumentation INSTALLATION at SDK init time (the SDK doesn't wrap `fetch`/HTTP/touch-handlers/native-frames-tracking at all); `tracesSampleRate` filters out 95% of MANUALLY-created transactions at emit time. Pre-patch framing implied the per-request work runs and is then filtered out — actually the wrapper is installed once at init, and disabling the flag skips the install entirely. Post-patch comment reads: "setting these flags to `false` skips the auto-instrumentation INSTALLATION at SDK init time (the SDK doesn't wrap fetch/HTTP/touch-handlers/native-frames-tracking at all)." Accurate without verbose. — [`sentry.ts:199-217`](src/lib/sentry.ts#L199-L217).

- **P4 (MED) — `tracesSampleRate` literal-substring regex rejected benign refactoring.** Blind Hunter (BH-2). The drift-detector regex `/tracesSampleRate\s*:\s*__DEV__\s*\?\s*1\.0\s*:\s*0\.05/` rejected a defensible refactor like `const PROD_RATE = 0.05; ... tracesSampleRate: __DEV__ ? 1.0 : PROD_RATE`. Post-patch the regex is loosened to accept EITHER the literal `0.05` OR a `*_RATE`-style identifier reference; belt-and-suspenders second pin asserts that the literal `0.05` appears SOMEWHERE in the file (either inline or as a constant value) — catches a refactor that introduces a constant but accidentally changes the numeric. — [`sentry-init-source-drift.test.ts:36-54`](src/lib/__tests__/sentry-init-source-drift.test.ts#L36-L54).

- **P5 (MED) — Tests for the 3 new sibling flags (P2 follow-up).** 3 new cases in [`sentry-init.test.ts`](src/lib/__tests__/sentry-init.test.ts) (`enableStallTracking: false`, `enableAppStartTracking: false`, `profilesSampleRate: 0`) + 2 new cases in [`sentry-init-source-drift.test.ts`](src/lib/__tests__/sentry-init-source-drift.test.ts) (POSITIVE Case 5 pinning all 3 siblings + NEGATIVE Case 6 against `true` / > 0 regression). Total source-drift cases: 4 → 6; total runtime cases: 11 → 14. **+5 net round-1 cases** (15 → 20).

- **P6 (MED) — Inline comment in `sentry.ts` for `enableUserInteractionTracing` acknowledges defensive no-op nature.** (P1 follow-up.) Comment now explicitly states the flag already defaults to `false` in SDK 7.11.0 + the rationale for the explicit pin (forward-compat against a future SDK default flip).

**Deferred (6+):** BH-1, BH-9, BH-10 — drift-detector regex edge cases (URL-in-string, whitespace, template-literals); real but low-impact / BH-15 — `enableUserInteractionTracing` couples with React Navigation breadcrumbs (real but minor; breadcrumbs unaffected — only auto-transactions affected) / BH-16 — operator runbook for diagnostic-impact awareness (doc concern; defer) / EH-5, EH-7, EH-11, EH-12 — speculative or micro-optimization.

**Rejected (7+ as noise):** BH-3 (scope-creep on tracesSampleRate pin — the audit category is broader than the 2 named items) / BH-5 (3 runtime tests are tautologies — same pattern as the pre-existing 8 cases; not a 13-6 regression) / BH-11 (no Sentry.init integration test — pre-existing baseline; not a 13-6 issue) / BH-12 (Story 12-2 P12 reference jargon — project convention) / BH-13 (test descriptions editorial — stylistic) / BH-14 (no type-narrowness verification — `Parameters<typeof Sentry.init>[0]` already provides strict typing) / EH-1, EH-8, EH-9, EH-10 — speculative future-SDK scenarios.

**Tests after round-1:** 1826 / 1826 passing (+5 round-1 net 1821 → 1826; +12 net since story start vs 1814 baseline). All 4 quality gates green.

**Files modified in round-1:**

- `src/lib/sentry.ts` — P1+P3+P6 comment refinements on the 3 original perf flags + P2 NEW 3 sibling perf flags (`enableStallTracking: false`, `enableAppStartTracking: false`, `profilesSampleRate: 0`) with explanatory comments.
- `src/lib/__tests__/sentry-init.test.ts` — P5 NEW 3 cases pinning the 3 sibling flags + P6 JSDoc on the `enableUserInteractionTracing` case acknowledging defensive no-op.
- `src/lib/__tests__/sentry-init-source-drift.test.ts` — P4 loosen `tracesSampleRate` regex (accept literal OR `*_RATE` constant + belt-and-suspenders literal-0.05 pin) + P1 Case 3 comment correction + P5 NEW Case 5 (POSITIVE 3 sibling flags) + Case 6 (NEGATIVE regression against `true` / > 0).
- `CLAUDE.md` — Story 13-6 review-round-1 paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-6 round-1 annotation.
- `_bmad-output/implementation-artifacts/13-6-sentry-sampling-screenshot-disable.md` — this Senior Developer Review section.
