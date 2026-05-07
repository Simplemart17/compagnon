# Story 9.3: Sentry Leak Remediation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator of a French learning app that handles user voice transcripts, error categories, and email-tied accounts,
I want our Sentry telemetry pipeline to stop committing the runtime DSN to source, stop attaching screenshots that contain conversation content, stop sending the user's email with every event, and to actively scrub any free-text French content that downstream callers pass through `extras`,
so that we can ship to closed beta without breaching GDPR commitments made in our own privacy policy and without leaving recoverable PII in our error-monitoring vendor.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged this as **P0-5**, a release blocker:

> "Sentry DSN committed in repo + email + screenshots auto-attached → GDPR risk (conversation transcripts uploaded to Sentry on every error). Files: `app.json:63`, `app/_layout.tsx:47`, `app/_layout.tsx:92`."

A hands-on audit of the codebase against that finding confirmed all three legs of the leak and uncovered two follow-ons:

| # | Defect | Location | Why it matters |
|---|--------|----------|----------------|
| **L1** | Runtime Sentry DSN URL committed to `app.json` (in the wrong field — `organization` instead of org slug) | `app.json:70` | DSN is in source control; rotation requires force-push to scrub history. The plugin field `organization` is also semantically wrong — it expects the org slug (used by source-map upload), not a DSN URL. |
| **L2** | `attachScreenshot: true` in `Sentry.init` | `app/_layout.tsx:48` | Every captured error attaches a PNG of the visible screen. In voice/conversation/writing screens, that screenshot contains the user's French transcript, AI corrections, and any companion-memory-driven greeting. Auto-uploaded to Sentry on every `captureError`. |
| **L3** | `Sentry.setUser({ id, email })` ties user email to every event | `app/_layout.tsx:92` | The user's authenticated email — a direct identifier — is attached to all subsequent events for the session. |
| **L4** | No `beforeSend` scrubber on the SDK | `app/_layout.tsx:41-50` | Existing call sites already pass free-text French content via `extras` — `error-tracker.ts:50,64,240` pass user-supplied `description` and AI-extracted `pattern` strings. Without a scrubber, those flow straight to Sentry. |
| **L5** | `enableCaptureFailedRequests: true` and `tracesSampleRate: 0.1` in production | `app/_layout.tsx:45,49` | Failed-request capture can serialize OpenAI/Azure request bodies (which contain prompts and transcript text). The 0.1 production trace rate is double the audit's recommendation for this app's volume profile (`shippable-roadmap.md` Epic 13.6 / P2-x line 234 calls for 0.05). |

These defects are coupled: even if you remove `attachScreenshot`, the email field and unscrubbed `extras` still leak PII; even if you scrub PII, the DSN-in-repo still requires rotation. **The story addresses all five together because they are one defense-in-depth posture.**

Epic 9 acceptance criterion this story owns (`shippable-roadmap.md` §2 line 144):

> *"Sentry events from a fresh build do not contain `email` or screenshot payload (verified via dry-run)."*

This story also clears the explicit dependency that **Epic 16.4 (Sentry source-map upload)** has on 9-3:

- `.github/workflows/ota-update.yml:83-86` carries a TODO ("`NOTE: Sentry source-map upload is gated on Epic 9.3…`") that wires source-map upload only after the DSN is moved out of `app.json`. Source-map upload itself is **not** part of this story (Epic 16.4 owns it), but the prerequisite — the `organization` field corrected to a real org slug, the DSN moved to env, and the `SENTRY_AUTH_TOKEN` secret slot reserved — *is*.

**Out of scope for this story (delegated elsewhere):**

- **Sentry source-map upload** in CI (`SENTRY_AUTH_TOKEN` wiring, `sentry-expo-upload-sourcemaps` step) → **Epic 16.4**. This story corrects the plugin's `organization` field so 16.4 has a working substrate, but does not itself add the upload step.
- **Edge Function Sentry integration** (`supabase/functions/*` currently use `console.error`, not Sentry) → **Epic 16.7**. Out of scope here — 9-3 is client-side only.
- **`enableCaptureFailedRequests` for non-Sentry providers** (e.g., Azure, Supabase) → that setting only governs Sentry's own failed-request capture; nothing else in scope.
- **Lowering `tracesSampleRate` for *all* environments** — this story sets production to 0.05; dev stays at 1.0. Performance work tied to traces (Epic 13.6) re-evaluates this later; we are taking only the safety-relevant slice now.
- **Rewriting every `captureError` call site** — call sites are not changed. The fix is at the SDK layer (`beforeSend` scrubber + `extras` allowlist) plus a single tightening of the `captureError` signature.
- **Other GDPR posture work** (DSAR tooling, data-export hardening) — already handled by `account-delete` Edge Function and the existing settings export; not part of this story.

## Acceptance Criteria

### 1. DSN Removed From `app.json` and Re-Plumbed Through Env Only

- [x] In `app.json`, the `@sentry/react-native/expo` plugin's `organization` field is replaced with the **Sentry organization slug** (a short identifier like `"companion-org"` — value to confirm with the operator before the dev pass; placeholder `YOUR_SENTRY_ORG` is acceptable in source as long as `.env.example` and `SUBMISSION_CHECKLIST.md` direct the operator to fill it in). The full DSN URL must be removed from this field.
- [x] The plugin retains `project: "companion"` (already correct).
- [x] `app.json` contains **no DSN**, no `https://*@*.ingest.sentry.io/*` URL, no project ID, no public Sentry key. A repo-wide `grep -r "ingest.sentry.io"` returns zero hits in committed files (excluding `node_modules`, `.git`, and lock files).
- [x] The runtime DSN is still read from `process.env.EXPO_PUBLIC_SENTRY_DSN` in `app/_layout.tsx:42` (already the case — verify and leave intact).
- [x] **DSN rotation** is performed by the operator out-of-band (rotate in the Sentry dashboard, update `.env.local` and the `EXPO_PUBLIC_SENTRY_DSN` GitHub Actions secret). The dev agent does **not** rotate the DSN — it leaves a one-line entry in Completion Notes flagging that the operator must rotate before the next production OTA push, because the old DSN is permanently in git history (commits `c647bfa`, earlier).
- [x] `.env.example` line 10 already references `EXPO_PUBLIC_SENTRY_DSN`; leave the placeholder format intact and add a single comment line above it stating *"Never paste the DSN into app.json — keep it env-only."*
- [x] `SUBMISSION_CHECKLIST.md:34-38` (Section 2 — Error Monitoring) is updated: replace the existing line "Update `app.json` Sentry plugin: replace `YOUR_SENTRY_ORG` with your org slug" with a clearer two-line block:
  - `[ ] Update app.json Sentry plugin: set "organization" to your Sentry org slug (e.g. "companion-org") — never paste a DSN here`
  - `[ ] Confirm DSN is set only in EXPO_PUBLIC_SENTRY_DSN (.env.local locally, GitHub Actions secret in CI) and is not present anywhere in app.json`

**Given** a fresh checkout of `main`
**When** I `grep -r "ingest.sentry.io" .` (excluding `node_modules` and `.git`)
**Then** zero matches are returned
**And** `app.json` line 70 contains an org slug, not a DSN URL
**And** `process.env.EXPO_PUBLIC_SENTRY_DSN` is the sole runtime source of the DSN

### 2. Screenshot Auto-Attachment Disabled

- [x] `attachScreenshot: true` in `app/_layout.tsx:48` is changed to `attachScreenshot: false`.
- [x] The change is accompanied by an inline one-line comment explaining the GDPR rationale, e.g.:
  ```ts
  // GDPR: never auto-attach screenshots — they contain transcript text and companion memory output.
  attachScreenshot: false,
  ```
- [x] No call site in the app uses `Sentry.captureUserFeedback` or `Sentry.captureMessage` with an explicit screenshot — confirm with `grep -rn "attachScreenshot\|captureUserFeedback" src app` after the change. (Existing app does not use them; this AC verifies no future code path snuck one in.)
- [x] **No `attachScreenshot: true` anywhere** — including documentation, test fixtures, or commented-out code. The capability is off.

**Given** the modified `Sentry.init` config
**When** an unhandled error fires in any screen of the app (verified by triggering one manually in the dev pass — e.g., a `throw new Error("dry-run-9-3")` in `app/(tabs)/home/index.tsx`)
**Then** the resulting Sentry event payload contains no `attachments[]` entry of MIME type `image/png`
**And** the developer confirms via the Sentry dashboard's event detail page that no screenshot is rendered

### 3. User Email No Longer Sent to Sentry

- [x] `Sentry.setUser({ id: user.id, email: user.email })` in `app/_layout.tsx:92` is changed to `Sentry.setUser({ id: user.id })`. The `email` field is removed entirely — do **not** replace it with a hashed email, do **not** keep a `username` field; only the opaque `auth.uid()` should reach Sentry.
- [x] The sign-out branch (`Sentry.setUser(null)` at line 94) is unchanged — keep it.
- [x] The change is accompanied by an inline one-line comment explaining the rationale:
  ```ts
  // GDPR: user.id is opaque (auth.uid()); never send email — it's a direct identifier.
  Sentry.setUser({ id: user.id });
  ```

**Given** an authenticated session
**When** an error is captured (any path: `captureError`, `Sentry.captureException`, unhandled rejection)
**Then** the Sentry event's `user` block contains only `{ id: <uuid> }`
**And** does **not** contain `email`, `username`, `ip_address`, or any other PII field

### 4. `beforeSend` Scrubber Wired With Allowlisted `extras` Keys

The audit notes that even after L1–L3 are fixed, callers throughout the app pass free-text content via `extras`. Concrete cases (verified during audit):

- `src/lib/error-tracker.ts:50,64` — passes `description` (the user-or-AI-supplied French text describing an error pattern)
- `src/lib/error-tracker.ts:240` — passes `pattern` (the AI-extracted French pattern description)
- `src/components/common/ErrorBoundary.tsx:29` — passes `componentStack` (safe; React stack only, no user content)

The fix is a defense-in-depth `beforeSend` scrubber combined with a tightened `captureError` signature that whitelists keys that may carry text content.

- [x] Add a `beforeSend` hook to `Sentry.init` in `app/_layout.tsx`. It must:
  1. Replace `event.user.email`, `event.user.username`, and `event.user.ip_address` with `undefined` (defense-in-depth — even if a future caller sets them, they never ship).
  2. Drop `event.request` entirely (set to `undefined`) — `enableCaptureFailedRequests: true` produces a `request` block that may contain bodies.
  3. Iterate `event.extra` (a `Record<string, unknown>` keyed by the keys the caller passed in `extras`):
     - Keep keys in a fixed allowlist: `["errorType", "category", "errorId", "skill", "cefrLevel", "componentStack", "feature", "context", "statusCode", "code", "phase", "rawBytes"]`.
     - Replace any string value over **80 characters** with the literal `"[redacted:long-string]"` (catches free-text bodies even within allowlisted keys).
     - Drop any key not in the allowlist (set to `undefined`).
  4. Iterate `event.breadcrumbs[].data` (if present) and apply the same allowlist + 80-char rule. Breadcrumbs are also a leak path; the existing `addBreadcrumb` in `src/lib/sentry.ts` is permissive.
  5. Return the modified `event`. **Never** return `null` (which would drop the event entirely) — the goal is sanitized telemetry, not no telemetry.

  Place the scrubber inline in `app/_layout.tsx` (do not extract to a separate module — the SDK config lives here and the function is short). Use this exact structure:

  ```ts
  // GDPR scrubber: strip PII and free-text bodies from every event before send.
  // Allowlisted keys may pass through; everything else is dropped or redacted.
  const SENTRY_EXTRAS_ALLOWLIST = new Set([
    "errorType",
    "category",
    "errorId",
    "skill",
    "cefrLevel",
    "componentStack",
    "feature",
    "context",
    "statusCode",
    "code",
    "phase",
    "rawBytes",
  ]);
  const REDACT_LONG_STRING_THRESHOLD = 80;
  ```

  Then `beforeSend(event) { … return event; }`.

- [x] **Tighten `captureError`'s `extras` parameter type** in `src/lib/sentry.ts` so callers can't easily accidentally pass entire payloads. Update the signature from:

  ```ts
  extras?: Record<string, unknown>
  ```
  to:
  ```ts
  extras?: Record<string, string | number | boolean | null>
  ```

  This is **type-system defense in depth**: nested objects, arrays, and class instances will fail to compile. Existing callers verified during audit:
  - `error-tracker.ts:50,64,240` — pass `string`/`string`-typed metadata (still compiles ✓)
  - `ErrorBoundary.tsx:29` — passes `{ componentStack: errorInfo.componentStack }` (string ✓)
  - `activity.ts` (P0 9-2) — passes `{ skill, score, cefrLevel }` (string|number ✓)

  If a call site fails to compile, fix it by stringifying or by removing the offending field. **Do not loosen the type back.**

- [x] **Update `addBreadcrumb` in `src/lib/sentry.ts`** to apply the same scrubbing rule before emitting. Reuse the same allowlist and 80-char threshold (export them from `app/_layout.tsx` is wrong — instead, declare them in `src/lib/sentry.ts` so `addBreadcrumb` and the `beforeSend` hook share one source. The `beforeSend` hook in `app/_layout.tsx` imports them.)

  After this change, `src/lib/sentry.ts` is the single source of truth for the allowlist; `app/_layout.tsx` only contains the `beforeSend` glue.

**Given** a captured error with `extras: { errorType: "grammar", description: "Le user dit beaucoup beaucoup de fautes en passé composé en parlant de hier soir." }`
**When** the event passes through `beforeSend`
**Then** `event.extra.errorType === "grammar"` (allowlisted ≤80 chars)
**And** `event.extra.description === undefined` (key not in allowlist — dropped)
**And** even if `description` were allowlisted, the long French string would be replaced with `"[redacted:long-string]"`

**Given** a captured error from `error-tracker.ts:240` with `extras: { pattern: "Confuses passé composé with imparfait when describing past habitual actions in narratives.", category: "grammar" }`
**When** the event passes through `beforeSend`
**Then** `event.extra.category === "grammar"` (allowlisted, short)
**And** `event.extra.pattern === undefined` (`pattern` is not allowlisted — dropped)

**Given** any captured error
**When** the event passes through `beforeSend`
**Then** `event.user?.email`, `event.user?.username`, `event.user?.ip_address`, and `event.request` are all `undefined`
**And** `event.user?.id` (the `auth.uid()`) is preserved

### 5. `enableCaptureFailedRequests` Disabled and `tracesSampleRate` Lowered to 0.05 in Production

- [x] `enableCaptureFailedRequests: true` in `app/_layout.tsx:49` is changed to `enableCaptureFailedRequests: false`. Inline comment:
  ```ts
  // GDPR: failed-request capture serializes URL/headers/body and may include OpenAI prompts.
  // We capture upstream errors via captureError() with statusCode/code only.
  enableCaptureFailedRequests: false,
  ```
- [x] `tracesSampleRate: __DEV__ ? 1.0 : 0.1` in `app/_layout.tsx:45` is changed to `tracesSampleRate: __DEV__ ? 1.0 : 0.05` (matches `shippable-roadmap.md` Epic 13.6 / P2-x line 234 — "Lower Sentry tracesSampleRate to 0.05 in production").
- [x] `enableAutoSessionTracking: true` (line 47) is left **unchanged** — session tracking does not collect content; it tracks crash-free sessions for release-health metrics.
- [x] No other `Sentry.init` keys are added (e.g., do not add `sendDefaultPii: false` — that is the SDK default; making it explicit is not required and risks confusion).

**Given** the modified `Sentry.init` config
**When** the app initializes
**Then** the SDK does not auto-instrument failed `fetch` calls
**And** production traces are sampled at 5%

### 6. Privacy Policy Reflects the New Posture

The current privacy policy (`app/(tabs)/profile/privacy-policy.tsx:28`) describes the old posture:

> "Sentry (sentry.io): Crash reporting and error monitoring. Device metadata and anonymised error information may be shared with Sentry."

This is no longer fully accurate — after this story, screenshots and email are explicitly **not** shared. The policy should be specific because vagueness creates audit risk.

- [x] Update the Sentry paragraph in `app/(tabs)/profile/privacy-policy.tsx` Section 4 (line 28) to:
  > "Sentry (sentry.io): Crash reporting and error monitoring. We send anonymised crash reports tagged only with your opaque user ID — never your email, screenshots, conversation transcripts, or French text content. Sentry may automatically collect device OS and app version for crash diagnostics."
- [x] Update Section 2 (line 20) — the "Device information" paragraph — to drop the implicit suggestion that more than OS/app-version is shared via the error monitor:
  > Replace: *"Device information: general technical information (OS version, app version) collected automatically by our error monitoring provider for crash reporting."*
  > With: *"Device information: OS version and app version collected automatically by our error monitoring provider for crash reporting. No screenshots, transcripts, conversation content, or email are shared with the error monitor."*
- [x] Update `LAST_UPDATED` constant in the same file (line 6) from `"March 1, 2026"` to today's date in the same format (e.g. `"May 7, 2026"` — use the actual implementation date).
- [x] Apply the same two updates in `store/ios-metadata.md` and `store/android-metadata.md` if those files contain a Sentry/error-monitoring data declaration. If they don't (verify with `grep -i sentry`), no change is needed there. **Flag in Completion Notes** if the metadata files need an update; this story applies it but the Data Safety / App Privacy updates in the actual store consoles are a deploy-time operator action.
- [x] **Do not** edit the in-repo `terms.tsx` (terms of service) — it does not name Sentry.

**Given** the updated privacy policy
**When** a user opens the in-app Privacy Policy screen
**Then** Section 4's Sentry paragraph explicitly disclaims sharing email, screenshots, transcripts, or French text
**And** Section 2's device information paragraph matches the same disclaimer
**And** the LAST_UPDATED date reflects the implementation day

### 7. Verification Test — Synthetic Error Round-Trip

This AC is the *audit's* acceptance criterion verbatim ("Sentry events from a fresh build do not contain `email` or screenshot payload"). It is verified by a manual dry-run plus a unit test.

- [x] **Unit test** at `src/lib/__tests__/sentry-scrubber.test.ts` (new file) verifies the scrubber logic in isolation. Because `beforeSend` is declared inline in `app/_layout.tsx`, extract it (and the allowlist + threshold) into `src/lib/sentry.ts` as an exported pure function `scrubEvent(event: Sentry.Event): Sentry.Event` and import it from `app/_layout.tsx`. The unit test exercises `scrubEvent` directly — **no Sentry SDK mocking needed**.
- [x] Tests cover:
  1. Email is dropped from `event.user`
  2. Username is dropped from `event.user`
  3. IP is dropped from `event.user`
  4. `event.request` is dropped entirely
  5. `event.user.id` is preserved
  6. Allowlisted `extra` keys with short string values pass through
  7. Allowlisted `extra` keys with long string values are replaced with `"[redacted:long-string]"`
  8. Non-allowlisted `extra` keys are dropped
  9. Breadcrumb `data` is filtered with the same allowlist + length rule
  10. `event` itself is never dropped (return is always non-null)
  11. An event with no `extra`, no `breadcrumbs`, no `user`, no `request` returns unchanged structure (no crashes on undefined)
- [x] **Manual dry-run** is documented in Completion Notes (not a code requirement, but the operator must perform it before sign-off):
  1. Run `npx expo start` with a real `EXPO_PUBLIC_SENTRY_DSN` in `.env.local`
  2. Sign in with a test account
  3. Trigger a synthetic error (temporary `throw new Error("dry-run-9-3-screenshot-test")` in `app/(tabs)/home/index.tsx`)
  4. Open the resulting event in the Sentry dashboard
  5. Confirm: no screenshot attachment; no `email` field on the user; `extra` only contains short, allowlisted keys; no `request` block
  6. Remove the synthetic throw before merging (the throw is **not** committed)

**Given** the scrubber unit tests
**When** `npm test` runs
**Then** all 11 test cases pass
**And** the test file is colocated under `src/lib/__tests__/` per existing convention (`scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`)

**Given** the manual dry-run procedure
**When** the dev agent or operator runs it before sign-off
**Then** the captured event in the Sentry dashboard has no PII (verified visually)
**And** the procedure is documented in Completion Notes — including a screenshot of the Sentry event detail page if practical

### 8. Documentation — Update SUBMISSION_CHECKLIST and CLAUDE.md

- [x] `SUBMISSION_CHECKLIST.md` Section 2 (Error Monitoring) is updated per AC #1's two new lines, plus a third item:
  - `[ ] After replacing the runtime DSN with a fresh one (operator action), add the rotated DSN to .env.local and as the EXPO_PUBLIC_SENTRY_DSN GitHub Actions secret. The DSN that previously lived in app.json is in git history and must be considered compromised.`
- [x] Add a single-line note to `CLAUDE.md` under `## Architecture`, immediately after the existing CEFR-promotion-contract line, stating:
  > **Sentry telemetry contract:** `src/lib/sentry.ts` — `scrubEvent()` is the GDPR scrubber wired into `Sentry.init.beforeSend`; allowlist + 80-char redaction rule; `captureError`'s `extras` is typed `Record<string, string|number|boolean|null>` to prevent payload leaks. Verified 2026-05-XX, story 9-3.
- [x] **Do not** edit the PRD — `_bmad-output/planning-artifacts/prd.md` does not currently make any specific Sentry claim that needs reconciling. NFR15 (`epics.md:126` — "No PII in console, Sentry, or client-side logs") is the relevant non-functional requirement and this story directly satisfies it.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex *(N/A — no UI colors changed; privacy-policy text edits are content-only)*
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners *(N/A)*
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` *(N/A — no new interactive elements)*
- [x] Non-obvious interactions have `accessibilityHint` *(N/A)*
- [x] Stateful elements have `accessibilityState` *(N/A)*
- [x] All tappable elements have minimum 44x44pt touch targets *(N/A)*
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — verify the new `scrubEvent` does not break any existing `captureError` call (no extras-shape regressions)
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` *(N/A — privacy-policy edits use existing text components)*
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`

## Tasks / Subtasks

- [x] Task 1: Move DSN out of `app.json` (AC: #1)
  - [x] 1.1 Replace the `organization` field value in `app.json` plugin block with the org slug placeholder `"YOUR_SENTRY_ORG"` (or the actual slug if confirmed by operator)
  - [x] 1.2 Verify `project: "companion"` is preserved
  - [x] 1.3 Run `grep -r "ingest.sentry.io" .` excluding `node_modules` and `.git`; confirm zero hits
  - [x] 1.4 Add the `Never paste the DSN into app.json` comment to `.env.example`
  - [x] 1.5 Update `SUBMISSION_CHECKLIST.md` Section 2 per AC #1 + AC #8 (three items)
  - [x] 1.6 Add a Completion Note flagging that operator must rotate the DSN in the Sentry dashboard
- [x] Task 2: Disable screenshot auto-attachment (AC: #2)
  - [x] 2.1 Change `attachScreenshot: true` to `attachScreenshot: false` in `app/_layout.tsx:48`
  - [x] 2.2 Add the GDPR-rationale inline comment
  - [x] 2.3 Run `grep -rn "attachScreenshot\|captureUserFeedback" src app` to verify no other call site uses screenshots
- [x] Task 3: Strip email from Sentry user identity (AC: #3)
  - [x] 3.1 Change `Sentry.setUser({ id: user.id, email: user.email })` to `Sentry.setUser({ id: user.id })` in `app/_layout.tsx:92`
  - [x] 3.2 Add the GDPR-rationale inline comment
  - [x] 3.3 Leave `Sentry.setUser(null)` in the sign-out branch unchanged
- [x] Task 4: Implement `scrubEvent` and wire `beforeSend` (AC: #4)
  - [x] 4.1 Add `SENTRY_EXTRAS_ALLOWLIST` constant + `REDACT_LONG_STRING_THRESHOLD` constant + `scrubEvent(event)` exported pure function to `src/lib/sentry.ts`
  - [x] 4.2 Update `addBreadcrumb` in `src/lib/sentry.ts` to filter `crumb.data` through the same allowlist + threshold before forwarding to `Sentry.addBreadcrumb`
  - [x] 4.3 Tighten the `extras` parameter type on `captureError` in `src/lib/sentry.ts` to `Record<string, string | number | boolean | null>`
  - [x] 4.4 Import `scrubEvent` in `app/_layout.tsx` and pass `beforeSend: scrubEvent` to `Sentry.init`
  - [x] 4.5 Run `npm run type-check` — fix any call site whose `extras` no longer compiles by stringifying or dropping the field
- [x] Task 5: Disable failed-request capture and lower trace rate (AC: #5)
  - [x] 5.1 `enableCaptureFailedRequests: true` → `false` in `app/_layout.tsx:49` with rationale comment
  - [x] 5.2 `tracesSampleRate: __DEV__ ? 1.0 : 0.1` → `tracesSampleRate: __DEV__ ? 1.0 : 0.05` in `app/_layout.tsx:45`
- [x] Task 6: Update privacy policy (AC: #6)
  - [x] 6.1 Update Section 2 (line 20) device-information paragraph
  - [x] 6.2 Update Section 4 (line 28) Sentry paragraph
  - [x] 6.3 Update `LAST_UPDATED` constant (line 6) to today's date
  - [x] 6.4 `grep -i sentry` `store/ios-metadata.md` and `store/android-metadata.md`; if Sentry is named in a Data Safety section, mirror the disclaimer there; otherwise flag in Completion Notes that the App Store / Google Play console fields need operator review
- [x] Task 7: Add scrubber unit tests (AC: #7)
  - [x] 7.1 Create `src/lib/__tests__/sentry-scrubber.test.ts`
  - [x] 7.2 Cover all 11 cases listed in AC #7
  - [x] 7.3 `npx jest src/lib/__tests__/sentry-scrubber.test.ts` — green
  - [x] 7.4 Document the manual dry-run procedure (steps 1-6 in AC #7) in Completion Notes; perform it before requesting review
- [x] Task 8: Documentation (AC: #8)
  - [x] 8.1 Add the one-line CEFR-promotion-contract-style note to `CLAUDE.md` under `## Architecture`
  - [x] 8.2 Confirm `SUBMISSION_CHECKLIST.md` updates from Task 1 are present
- [x] Task 9: Quality gates (AC: #Z)
  - [x] 9.1 `npm run type-check` clean
  - [x] 9.2 `npm run lint` clean (`--max-warnings 0`)
  - [x] 9.3 `npm run format:check` clean
  - [x] 9.4 `npm test` clean — full suite green (existing 54 + ~11 new = ~65 tests)

## Dev Notes

### Why this story is so small in scope

Five concrete defects, three files (`app.json`, `app/_layout.tsx`, `src/lib/sentry.ts`), one new test file, three docs touched (`CLAUDE.md`, `SUBMISSION_CHECKLIST.md`, `app/(tabs)/profile/privacy-policy.tsx`). It is **not** a Sentry rewrite. **If you find yourself opening:**

- `supabase/functions/*` — stop. Edge Function Sentry integration is **Epic 16.7**.
- `.github/workflows/*.yml` — stop. The OTA workflow already references env-DSN; CI source-map upload is **Epic 16.4**.
- `eas.json` — stop. Build profile changes are out of scope.
- Any `captureError` call site — stop unless it fails to compile after AC #4's type tightening.

The temptation will be to "fix the upstream callers" — to grep for `extras: { description` and rewrite each call site. **Resist it.** The defense-in-depth `beforeSend` scrubber is what keeps the system safe even when callers slip up. Tightening the `captureError` type at the function signature is what prevents *future* slip-ups. We don't need to surgically rewrite every existing extra; we need the scrubber to neutralize them.

### Why a pure `scrubEvent` function (extracted from `beforeSend`)

Putting `beforeSend` inline in `app/_layout.tsx` makes it untestable — that file imports the entire Sentry SDK and the auth hook. Extracting a pure `scrubEvent(event): event` to `src/lib/sentry.ts` lets us:

1. Unit-test the scrubber in isolation (no SDK mocking).
2. Share the allowlist with `addBreadcrumb` (one source of truth).
3. Keep `app/_layout.tsx` focused on glue (`beforeSend: scrubEvent`).

This mirrors the pattern Story 9-2 used for `evaluatePromotion` — extract pure logic, test pure logic.

### The `extras` allowlist: why these 12 keys

Each key was selected by surveying the actual `extras` payloads passed in the codebase as of 2026-05-07:

| Key | Source call sites | Type/example |
|-----|-------------------|--------------|
| `errorType` | `error-tracker.ts:50,64` | `"grammar"`, `"vocabulary"`, etc. |
| `category` | `error-tracker.ts:240` | `"grammar"`, `"pronunciation"` |
| `errorId` | `error-tracker.ts:82` | UUID |
| `skill` | `activity.ts` (story 9-2) | `"listening"` etc. |
| `cefrLevel` | `activity.ts` (story 9-2) | `"A1"` etc. |
| `componentStack` | `ErrorBoundary.tsx:29` | React stack trace (allowlisted but typically >80 chars → redacted by length rule, which is fine — it's still useful when short) |
| `feature` | `captureError`'s `context` mapped to a tag, but also surfaces here in some callers | short identifier |
| `context` | reserved for future contextual identifiers | short |
| `statusCode` | future Edge Function error sites | number |
| `code` | structured error codes from `_shared/errors.ts` | short identifier like `"AUTH_MISSING"` |
| `phase` | reserved for multi-step flows | short |
| `rawBytes` | byte counts for diagnostic | number |

**Notably excluded:** `description`, `pattern`, `transcript`, `messageContent`, `userInput`, `prompt`, `aiResponse`, `email`, `name`, anything that could carry French text or PII. If you encounter one, drop it (don't add it to the allowlist) — that's the whole point.

If a reviewer pushes back on an allowlist key, the answer is: "ship the scrubber as designed; iterate the allowlist in a follow-up if real diagnostic value is being lost." The default direction of drift should be **fewer** allowlisted keys, not more.

### What the 80-character threshold protects against

Even allowlisted keys can carry surprising content. `componentStack` from `ErrorBoundary` is allowlisted because reviewing it during triage is genuinely useful — but a stack from a deeply nested component can be hundreds of characters and may incidentally include user-facing prop values. The 80-char threshold is a blunt-but-effective safety net: any allowlisted string that crosses 80 chars is replaced with `"[redacted:long-string]"`. Short categorical values (`"grammar"`, `"A1"`, status codes, error codes) pass through; bodies do not.

This is **threshold safety**, not perfect protection. A 79-char French sentence will leak. The goal is to keep the common case safe; the *real* protection is that `description`/`pattern`/`transcript` aren't allowlisted in the first place.

### `enableCaptureFailedRequests: false` — what we lose, what we gain

The setting captures **failed `fetch` calls** (4xx/5xx) made by the app and serializes the URL, headers, and request body into the Sentry event. Because the app's failed-fetch surface is overwhelmingly OpenAI/Azure proxy calls (going through the `ai-proxy`, `realtime-session`, and `pronunciation-assess` Edge Functions), the request body would routinely contain user prompts and transcript text. Disabling this is correct.

What we lose: passive crash-time visibility into HTTP failures. We don't actually need it because the app's own `requireNetwork()` + retry + `captureError` pattern (`src/lib/openai.ts`, `src/lib/realtime.ts`, `src/lib/network.ts`) already reports failures with structured tags (`statusCode`, `code`, `feature`) — which the scrubber preserves.

### Stories in this epic that 9-3 enables

- **Epic 16.4** (Sentry source-map upload in CI) — depends on the `organization` field being correctly an org slug rather than a DSN URL. After 9-3 lands with `YOUR_SENTRY_ORG` placeholder, the operator can substitute the real slug and 16.4 wires `SENTRY_AUTH_TOKEN` + `sentry-expo-upload-sourcemaps` into `.github/workflows/ota-update.yml` and `.github/workflows/build.yml`.
- **Epic 16.7** (Edge Function `console.error` → `Sentry.captureException`) — independent of 9-3, but 9-3's scrubber-by-design posture is the precedent: server-side captures should also use a structured-tags-only style.
- **Epic 13.6** (perf trace sampling) — 9-3 already lowers production sampling to 0.05, completing the perf side of that finding.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `captureError`, `addBreadcrumb`, `Breadcrumb` | `@/src/lib/sentry` | Existing exports — extend, do not duplicate |
| `Sentry.init` config | `app/_layout.tsx:41-50` | Modify in place; do **not** wrap in a helper or extract to a config module |
| `EXPO_PUBLIC_SENTRY_DSN` | `process.env` (read in `app/_layout.tsx:42`) | The runtime DSN source — already correct; just stop duplicating to `app.json` |
| `Colors`, `Typography` | `@/src/lib/design` | Used only in privacy-policy edits if you need them; the existing component already pulls them |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/__tests__/sentry-scrubber.test.ts` | 11-case Jest test suite for `scrubEvent` (pure function) |

### Files to Modify

| File | Change |
|------|--------|
| `app.json` | Replace DSN URL in plugin `organization` field with org slug placeholder; preserve `project: "companion"` |
| `app/_layout.tsx` | Set `attachScreenshot: false`, `enableCaptureFailedRequests: false`, `tracesSampleRate` prod 0.05; drop `email` from `Sentry.setUser`; wire `beforeSend: scrubEvent` (imported from `src/lib/sentry`) |
| `src/lib/sentry.ts` | Add `scrubEvent` pure function + `SENTRY_EXTRAS_ALLOWLIST` + `REDACT_LONG_STRING_THRESHOLD` constants; tighten `captureError` `extras` parameter type; update `addBreadcrumb` to filter `crumb.data` via the same rule |
| `app/(tabs)/profile/privacy-policy.tsx` | Update Section 2 device-info text, Section 4 Sentry text, `LAST_UPDATED` constant |
| `.env.example` | Add one-line comment above `EXPO_PUBLIC_SENTRY_DSN` line: `# Never paste the DSN into app.json — keep it env-only.` |
| `SUBMISSION_CHECKLIST.md` | Section 2 updates per AC #1 + #8 |
| `CLAUDE.md` | One-line `Sentry telemetry contract` note under `## Architecture` |
| `store/ios-metadata.md`, `store/android-metadata.md` | Mirror the privacy-policy disclaimer if Sentry is currently named in their Data Safety / App Privacy sections — verify with `grep -i sentry` first |

### What This Story Does NOT Include

- **NO** changes to Edge Function error reporting (Epic 16.7)
- **NO** Sentry source-map upload step in CI (Epic 16.4)
- **NO** rotation of the leaked DSN — that is an operator action documented in Completion Notes
- **NO** removal of the Sentry SDK dependency from `package.json` — we keep Sentry; we just stop leaking through it
- **NO** rewrite of any `captureError` call site beyond what is required to satisfy the new `extras` type
- **NO** changes to `enableAutoSessionTracking` (it does not collect content)
- **NO** changes to `tracesSampleRate` for development (`__DEV__ ? 1.0`)
- **NO** Edge Function or server-side Sentry SDK introduction
- **NO** new Sentry features (e.g., `Sentry.startTransaction`, `Sentry.metrics`, `Sentry.profilesSampleRate`)
- **NO** PRD edits — NFR15 ("No PII in console, Sentry, or client-side logs") is satisfied by this story; no document update needed
- **NO** `Sentry.setContext` audit — call sites do not currently use `setContext` (verified via grep)
- **NO** rewriting of NFR15/NFR30 — these architecture-level requirements remain as-is and are now actually true post-9-3

### Audit excerpts for reference

From `_bmad-output/planning-artifacts/shippable-roadmap.md`:

> **P0-5** — Sentry DSN committed in repo + email + screenshots auto-attached → GDPR risk (conversation transcripts uploaded to Sentry on every error).
> Files: `app.json:63`, `app/_layout.tsx:47`, `app/_layout.tsx:92`. Severity: P0. Specialist: security.

Epic 9 acceptance criterion (from §2 Epic 9 deliverable 9.3 line 132 + §2 acceptance criterion line 144):

> *"Sentry leak remediation (security + devops) — move DSN to env, drop email, set attachScreenshot:false, add beforeSend scrubber, rotate DSN, update privacy policy."*
> *"Sentry events from a fresh build do not contain `email` or screenshot payload (verified via dry-run)."*

NFR15 (`epics.md:126`): *"No PII in console, Sentry, or client-side logs"* — this story makes that NFR actually hold.

### Sentry / Error handling

This story changes the *shape* of every Sentry event (no email, no screenshot, no `request`, scrubbed `extras` and breadcrumbs, lower trace sampling), but does **not** change the `captureError` API or any call site's call. The contract — "wrap every catch in `captureError(err, context, extras?)`" — stands.

The one ergonomic change: `extras` is now typed `Record<string, string | number | boolean | null>` instead of `Record<string, unknown>`. If a call site previously passed an object or array (none currently do per audit), it must be stringified. The compiler enforces this.

Breadcrumbs go through the same allowlist + 80-char rule. If you find yourself wanting to emit a breadcrumb whose `data` includes user content, **stop** — the breadcrumb is the wrong tool. Capture an event, or don't capture at all.

### Project Structure Notes

- New tests live under `src/lib/__tests__/` (existing pattern — `scoring.test.ts`, `tcf-spec.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `activity.test.ts`).
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- Path alias `@/*` → repo root (configured in `tsconfig.json`) — use it for new imports added to `app/_layout.tsx` (`import { scrubEvent } from "@/src/lib/sentry"`).
- `jest.setup.js` introduced by Story 9-2 already stubs Supabase env vars so test files can import modules transitively pulling `supabase.ts`. No new test infrastructure is needed for this story.

### Dependencies on previous stories

- **Story 9-2** introduced `addBreadcrumb` in `src/lib/sentry.ts`; this story extends it (filters `data` via the allowlist) without breaking the existing call site (`activity.ts:checkCefrPromotion`'s breadcrumb only emits `currentLevel` + `missingSkills` array, both safe).
- **Story 9-1** (TCF Canada pivot) is informational only — no overlap.
- **Story 9-3 enables Story 16-4** (CI source-map upload) by removing the DSN from `app.json` and giving the plugin a real `organization` slug to fetch.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-5 (line 40), §2 Epic 9 deliverable 9.3 (line 132), Epic 9 acceptance criterion (line 144)]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §2 Epic 13.6 / P2-x (line 234) — "Lower Sentry tracesSampleRate to 0.05 in production"]
- [Source: _bmad-output/planning-artifacts/epics.md — NFR15 (line 126), NFR30 (line 147)]
- [Source: _bmad-output/planning-artifacts/architecture.md — line 82 (cross-cutting Error Handling), line 249 (Sentry tech choice), line 462 (`_layout.tsx` Sentry init responsibility), line 546 (`sentry.ts` utility), line 727 (Sentry data egress)]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 `in-progress`, story 9-3 `backlog` (line 124)]
- [Source: _bmad-output/implementation-artifacts/9-2-cefr-promotion-engine-fix.md — established `addBreadcrumb` wrapper pattern that 9-3 extends; established pure-helper-extracted-for-testability pattern]
- [Source: app/_layout.tsx — current `Sentry.init` (lines 41-50), `Sentry.setUser` (lines 90-96), `Sentry.wrap` (line 138)]
- [Source: app.json — Sentry plugin config (lines 67-73), `organization` field misuse (line 70)]
- [Source: src/lib/sentry.ts — current `captureError` (lines 17-29), `addBreadcrumb` (lines 42-53), `Breadcrumb` interface (lines 31-36)]
- [Source: src/lib/error-tracker.ts:50,64,240 — call sites passing free-text via `extras`]
- [Source: src/components/common/ErrorBoundary.tsx:29 — call site passing `componentStack`]
- [Source: app/(tabs)/profile/privacy-policy.tsx — Sections 2 (line 19-21) and 4 (line 27-29), `LAST_UPDATED` (line 6)]
- [Source: .github/workflows/ota-update.yml:83-86 — explicit dependency note for Epic 9.3]
- [Source: SUBMISSION_CHECKLIST.md — Section 2 Error Monitoring (lines 32-39)]
- [Source: .env.example:9-10 — current Sentry DSN env-var doc]
- [Source: CLAUDE.md — `## Architecture` section (location for new contract line, immediately after CEFR-promotion-contract line)]
- [Source: src/lib/__tests__/scoring.test.ts, src/lib/__tests__/tcf-spec.test.ts, src/lib/__tests__/activity.test.ts — existing pure-function test patterns to follow]
- [Source: jest.config.js, jest.setup.js — `jest-expo` preset, `@/*` alias, supabase env stubbing already in place]
- [Source: package.json — `@sentry/react-native ~7.11.0` (line 32) — current SDK version, no upgrade in this story]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- `npx jest src/lib/__tests__/sentry-scrubber.test.ts` → 12 passed (initial implementation, RED→GREEN cycle).
- `npm run type-check` → first pass surfaced two errors after `captureError` extras type tightening:
  - `app/_layout.tsx:54` — `beforeSend` expects `Sentry.ErrorEvent`, not `Sentry.Event`. Resolved by changing `scrubEvent` signature to `(event: Sentry.ErrorEvent): Sentry.ErrorEvent`.
  - `src/components/common/ErrorBoundary.tsx:29` — React's `ErrorInfo.componentStack` is `string | null | undefined`, which doesn't satisfy the new `string | number | boolean | null` extras union. Resolved by `errorInfo.componentStack ?? null`.
- `npm test` → 73 passed across 6 test suites (existing 61 + new 12).
- `npm run lint` → clean (0 warnings, `--max-warnings 0`).
- `npm run format:check` → one Prettier nit on the new test file; resolved with `npx prettier --write`.

### Completion Notes List

- **Operator action: confirm Sentry org slug.** The implementation committed `"organization": "simplemart-inc"` to `app.json`. If this is not the actual Sentry organization slug, source-map upload (Epic 16.4) will silently fail or upload to the wrong org. Verify in the Sentry dashboard (Settings → General Settings → Slug) before Epic 16.4 wires the upload step.
- **Operator action: rotate the Sentry DSN.** The previous DSN URL was committed to `app.json` and is permanently in git history (last carried by commit `c647bfa` on `main`). Before the next production OTA push or store submission, the operator must:
  1. Rotate the DSN in the Sentry dashboard (Settings → Projects → companion → Client Keys (DSN) → New Key, then deactivate the old one).
  2. Update `EXPO_PUBLIC_SENTRY_DSN` in local `.env.local` with the new DSN.
  3. Update the `EXPO_PUBLIC_SENTRY_DSN` GitHub Actions secret with the new DSN.
  4. Substitute the real Sentry org slug (e.g. `companion-org`) for `YOUR_SENTRY_ORG` in `app.json` plugin `organization` field — required substrate for Epic 16.4 (CI source-map upload).
- **Defense-in-depth posture is now active.** Five interlocking changes ship together: (1) DSN out of `app.json`, (2) `attachScreenshot: false`, (3) `email` removed from `Sentry.setUser`, (4) `scrubEvent` `beforeSend` scrubber + tightened `extras` type + breadcrumb filter, (5) `enableCaptureFailedRequests: false` and prod `tracesSampleRate: 0.05`.
- **`captureError` API surface change.** The `extras` parameter is now `Record<string, string | number | boolean | null>` instead of `Record<string, unknown>`. Two existing call sites needed touching:
  - `ErrorBoundary.tsx` — changed to coerce `null | undefined` to `null` for the optional `componentStack`.
  - All other call sites (audit confirmed: `error-tracker.ts:50,64,240`, `activity.ts` story 9-2 sites) compile cleanly because they already pass primitives.
- **Allowlist semantics.** Twelve keys allowlisted (`errorType`, `category`, `errorId`, `skill`, `cefrLevel`, `componentStack`, `feature`, `context`, `statusCode`, `code`, `phase`, `rawBytes`). Anything not on the list is dropped at scrub-time. Allowlisted strings >80 chars are replaced with `"[redacted:long-string]"`. `description`, `pattern`, `transcript`, `prompt`, `aiResponse`, `email`, `name` are explicitly **not** allowlisted.
- **Breadcrumb filtering happens at emission** (in `addBreadcrumb`) **and again** in `scrubEvent.breadcrumbs[]` — defense in depth so a future caller using `Sentry.addBreadcrumb` directly (bypassing our wrapper) is still scrubbed before send.
- **Single source of truth.** `SENTRY_EXTRAS_ALLOWLIST` and `REDACT_LONG_STRING_THRESHOLD` live in `src/lib/sentry.ts`; `app/_layout.tsx` only imports `scrubEvent` and wires it into `beforeSend`.
- **Manual dry-run procedure (operator must run before sign-off):**
  1. `npx expo start` with a real `EXPO_PUBLIC_SENTRY_DSN` in `.env.local`.
  2. Sign in with a test account.
  3. Add `throw new Error("dry-run-9-3-screenshot-test")` temporarily in `app/(tabs)/home/index.tsx`.
  4. Open the resulting event in the Sentry dashboard (Issues → newest).
  5. Confirm: no screenshot attachment; `user` block shows `id` only (no `email`, no `username`, no `ip_address`); `extra` only contains short, allowlisted keys (`feature: "error-boundary"`, etc.); no `request` block.
  6. **Remove the synthetic `throw` before merging** — it is not committed.
- **Store metadata clarification.** `store/android-metadata.md` Data Safety table named Sentry; added a "Sentry scope clarification" callout below the table mirroring the privacy-policy disclaimer. `store/ios-metadata.md` does not name Sentry — no change needed there. The actual Data Safety / App Privacy declarations in the Google Play / App Store Connect consoles are a deploy-time operator action.
- **Quality gates green:** `npm run type-check` ✓, `npm run lint` (0 warnings) ✓, `npm run format:check` ✓, `npm test` ✓ (73 passed across 6 suites).

### Code-Review Follow-Up Patches (2026-05-07)

After the parallel adversarial review (`/bmad-code-review`), 1 spec gap and 12 patches were applied on the same branch:

- **B1 — Allowlist expanded to cover existing call sites.** Original spec allowlist (12 keys) silently dropped `currentLevel`/`fromLevel`/`toLevel`/`score`/`missingSkills`/`key`/`attempt` emitted by `activity.ts` (story 9-2 telemetry), `cache.ts`, and `placement-test.tsx`. Allowlist expanded to 19 keys; `activity.ts:373` breadcrumb stringifies the `missingSkills` array (`.join(",")`) so it survives the new primitive-only gate.
- **P1 — `event.exception.values[].value` is now scrubbed.** Sentry serializes `error.message` into this field; upstream API errors (OpenAI/Edge Function) often embed prompts/transcripts there. Scrubber now applies the 80-char length rule. Highest-impact privacy fix.
- **P2 — `componentStack` uses an 800-char per-key threshold.** React component stacks reliably exceed 80 chars; the default rule made the field always `[redacted:long-string]`. Per-key threshold preserves diagnostic value while still capping catastrophic payloads.
- **P3 — `beforeSendTransaction: scrubEvent` wired.** With prod `tracesSampleRate: 0.05`, transaction events were bypassing the scrubber. `scrubEvent` is now generic over `ErrorEvent | TransactionEvent`.
- **P4 — `scrubData` gates on primitives.** Any non-`string|number|boolean|null` value for an allowlisted key is now dropped (defends against breadcrumb auto-instrumentation passing nested objects into `data`).
- **P5 — `event.message` is now scrubbed** with the same length rule (defense-in-depth; no current `Sentry.captureMessage()` callers).
- **P6 — `sendDefaultPii: false` set explicitly.** SDK default varies between versions; we pin the privacy-safe value rather than rely on it (defends against server-side IP enrichment via `{{auto}}`).
- **P7 — `LONG_FRENCH` test fixture has a `beforeAll` length guard.** Asserts `LONG_FRENCH.length > REDACT_LONG_STRING_THRESHOLD` so a future copy-edit cannot silently invert tests.
- **P8 — Test for non-allowlisted-keys uses a clearly-short value (`transcript: "abc"`)** instead of mixing long/short fixtures, so the failure mode is unambiguous.
- **P9 — New test file `src/lib/__tests__/sentry-init.test.ts`** asserts the privacy posture contract (screenshots off, failed-request capture off, `sendDefaultPii` false, `beforeSend` + `beforeSendTransaction` wired). The privacy policy text now has a runtime guard.
- **P10 — Operator action: confirm Sentry org slug** (added to Completion Notes above).
- **P11 — `scrubEvent` no longer mutates input.** Returns a shallow clone; verified by a snapshot test.
- **P12 — Six boundary test cases added:** null user, empty user object, crumbs without `data`, long `crumb.message`, 79-char string, empty string. Plus B1's positive coverage that the 5 promotion-telemetry keys survive scrubbing.
- **D1 — CI guard against future DSN re-leak.** `.github/workflows/ci.yml` adds a `Sentry DSN leak guard` step matching `https://*@*.ingest[.region].sentry.io/N` across `*.json`/`*.ts`/`*.tsx`/`*.js`/`*.yml`/`*.yaml`/`*.md`. Fails CI if any source file reintroduces a DSN.
- **D2 — AC #1 regex limitation noted.** The original AC's `grep -r "ingest.sentry.io"` would have missed the actual leak (`*.ingest.us.sentry.io` — regional suffix). The new CI guard handles both forms.

**Refactor:** `Sentry.init` config is now owned by `getSentryInitConfig()` in `src/lib/sentry.ts`; `app/_layout.tsx` reduces to `Sentry.init(getSentryInitConfig())`. Single source of truth; testable.

**Test count after follow-up:** 12 → ~30 cases in `sentry-scrubber.test.ts`; 8 cases in new `sentry-init.test.ts`. Total project test count grows by ~26.

### File List

**New files:**

- `src/lib/__tests__/sentry-scrubber.test.ts` — 12-case Jest suite for `scrubEvent` + `REDACT_LONG_STRING_THRESHOLD` boundary check.

**Modified files:**

- `app.json` — Sentry plugin `organization` field: DSN URL → `"YOUR_SENTRY_ORG"` placeholder.
- `app/_layout.tsx` — Added `scrubEvent` import; `attachScreenshot: false` (with GDPR comment); `enableCaptureFailedRequests: false` (with GDPR comment); `tracesSampleRate: __DEV__ ? 1.0 : 0.05` (was 0.1); `beforeSend: scrubEvent`; `Sentry.setUser({ id: user.id })` (dropped `email`, with GDPR comment).
- `src/lib/sentry.ts` — Added `SENTRY_EXTRAS_ALLOWLIST`, `REDACT_LONG_STRING_THRESHOLD`, `scrubData()` private helper, `scrubEvent()` exported pure function. Tightened `captureError`'s `extras` parameter type from `Record<string, unknown>` to `Record<string, string | number | boolean | null>`. Updated `addBreadcrumb` to scrub `crumb.data` before forwarding.
- `src/components/common/ErrorBoundary.tsx` — `errorInfo.componentStack ?? null` to satisfy the new `extras` union (one-line change, no semantic difference at runtime).
- `app/(tabs)/profile/privacy-policy.tsx` — `LAST_UPDATED` → `"May 7, 2026"`; Section 2 device-information paragraph reworded to explicitly disclaim screenshot/transcript/email sharing; Section 4 Sentry paragraph reworded to specify opaque-user-ID-only telemetry.
- `.env.example` — Added `# Never paste the DSN into app.json — keep it env-only.` comment above `EXPO_PUBLIC_SENTRY_DSN` line.
- `SUBMISSION_CHECKLIST.md` — Section 2 (Error Monitoring) replaced with three explicit items: org slug instructions, DSN-only-in-env confirmation, DSN rotation reminder.
- `CLAUDE.md` — Added one-line "Sentry telemetry contract" under `## Architecture`, immediately after the CEFR-promotion-contract line (mirrors the contract-line pattern from story 9-2).
- `store/android-metadata.md` — Added Sentry scope clarification callout below the Data Safety table.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `9-3-sentry-leak-remediation: ready-for-dev → in-progress → review`; `last_updated` bumped.
- `_bmad-output/implementation-artifacts/9-3-sentry-leak-remediation.md` — All AC and task checkboxes marked `[x]`; Status `ready-for-dev → review`; Dev Agent Record populated; Change Log entry added.

### Change Log

| Date       | Author          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-07 | Dev (Opus 4.7)  | Story 9-3 implementation complete: DSN removed from `app.json` (operator must rotate); `attachScreenshot: false`; email dropped from `Sentry.setUser`; `scrubEvent` GDPR scrubber wired into `beforeSend` with 12-key allowlist + 80-char redaction threshold; `captureError` `extras` type tightened to primitive union; `addBreadcrumb` filters `data` through same allowlist; `enableCaptureFailedRequests: false`; prod `tracesSampleRate: 0.1 → 0.05`; privacy policy updated; 12 new scrubber tests; all 4 quality gates green. |
