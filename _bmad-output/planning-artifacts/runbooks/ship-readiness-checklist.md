# Ship-Readiness Checklist

Consolidated view of what blocks a working, shippable deployment as of the
`app-running-bugfix` branch ship-blocker pass. Split into **(A) code fixes
landed on this branch** and **(B) operator-only steps** that cannot be done
from the repo (they need Supabase dashboard / CLI credentials + store accounts).

---

## A. Code fixes landed (ship-blockers closed)

All verified green: `type-check` (0 errors), `lint` (0 warnings), `format:check`,
`jest` (124 suites / 2237 tests), `check:tokens`. (`check:colors` has a
pre-existing test-fixture-hex failure tracked as `14-4-followup-test-fixture-hex-exemption`
— unrelated to this pass; zero new hex introduced.)

| # | Area | Fix | Where |
|---|------|-----|-------|
| 1 | **Backend — cost-cap bypass (Critical)** | `record_daily_cost` / `check_daily_cost_budget` / `check_and_increment_rate_limit` gained a service-role-permitting `auth.uid()` guard (blocks cross-user forging) + non-negative cost clamp (blocks the negative-ledger spend-cap bypass) | `supabase/migrations/20260518000000_rate_limit_cost_rpc_hardening.sql` |
| 2 | **Voice — echo cooldown was inert (Critical)** | Mic gate now reads a timestamp (`micCooldownUntilMs`) independent of `isAiSpeaking`, so the mic stays gated through the ~800ms speaker tail while the UI orb stops immediately | `src/lib/realtime-orchestrator.ts` |
| 3 | **Voice — dead-mic on skipped `audio.done` (Critical)** | `handleResponseDone` (guaranteed-terminal) defensively resets AI-speaking + applies the cooldown, so a cancelled/filtered response can't latch the mic closed forever | `src/lib/realtime-orchestrator.ts` |
| 4 | **Voice — reconnecting UI dead-end** | Added a `reconnecting` state branch (status label, back-guard, orb, End button) so the ~15s reconnect window is no longer a controls-less "Ready" screen | `app/(tabs)/conversation/[sessionId].tsx` |
| 5 | **Voice — invisible mic-permission denial** | Mic-denied / audio-engine failure now flips to the error state (with a clear message + Retry/Back) instead of a silently-dead "connected" screen | `src/lib/realtime-orchestrator.ts` |
| 6 | **Mock-test — scores never moved skill bars** | Finish path now calls `updateSkillProgress` per section (before `checkCefrPromotion`, which reads `skill_progress`), so a completed mock test advances skills + CEFR level | `app/(tabs)/mock-test/[testId].tsx` |
| 7 | **Mock-test — empty section rendered a blank exam** | `mockTestSectionSchema.questions` gained `.min(1)`; an empty section now fails validation → marked failed (per-section isolation) instead of shipping a blank exam | `src/lib/schemas/ai-responses.ts` |
| 8 | **Placement — fragile exactly-15 (onboarding-critical)** | Relaxed `.length(15)` → `.min(12).max(18)` tolerance band so an off-by-one from the model no longer rejects the whole response + burns ~9 retries | `src/lib/schemas/ai-responses.ts` |
| 9 | **CI — branch was red + Edge tests not gated** | Restored the Deno test step in `ci.yml` (fixes the 5 failing drift tests AND re-runs the Edge Function Deno suites — 14 tests — in CI, pointing Deno at `supabase/functions/deno.json`) | `.github/workflows/ci.yml` |

New/updated tests: `rate-limit-cost-rpc-hardening-source-drift.test.ts` (7),
`realtime-orchestrator-echo-gate.test.ts` (4 behavioral), plus updated
`ai-responses.test.ts`, `realtime-orchestrator-session-race.test.ts`, and
`ci-deno-step-source-drift.test.ts`.

---

## B. Operator-only steps to a working deployment (BLOCKERS)

These require Supabase dashboard/CLI access + store accounts and **cannot be
done from the repo**. Until they're done, the corresponding features 500 / are
absent at runtime even though the code is correct.

### B1. Push migrations (REQUIRED — includes the new cost-cap fix)

`deploy.yml` intentionally does NOT auto-run `supabase db push` (gated on the
Epic 16.6 rollback playbook). Apply manually:

```bash
supabase link --project-ref <ref>
supabase db push   # applies all 16 migrations incl. 20260518000000 cost-cap hardening
```

If migrations are not applied, every RPC (`get_home_aggregate`, the atomic
activity RPCs, `match_memories`, `match_error_pattern`, and the hardened
rate/cost RPCs) 500s at runtime → home, progress, conversation persist, and the
cost cap all break.

### B2. Set server secrets (REQUIRED — all AI features 500 without these)

```bash
supabase secrets set OPENAI_API_KEY=... AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... CRON_SECRET=...
```

`.env.local` only holds the 3 client vars (`EXPO_PUBLIC_*`); none of the above
can live in the repo. `SUPABASE_SERVICE_ROLE_KEY` is auto-provided to Edge Functions.

### B3. Enable extensions + seed Vault (REQUIRED for push notifications)

- Enable `pg_cron` + `pg_net` in the Supabase dashboard.
- Insert the Vault secrets `project_url` + `cron_secret` **before** migration
  `20260402000000_notification_cron.sql` runs (the cron body reads them). If
  absent, the hourly notification cron silently posts to a NULL URL and no push
  ever fires.

### B4. Deploy Edge Functions

```bash
supabase functions deploy ai-proxy realtime-session pronunciation-assess account-delete notification-register send-notifications
```
(Or let `.github/workflows/deploy.yml` do it on push to `supabase/functions/**`.)

### B5. Dashboard auth policy (Story 12-8 / 12-9 — REQUIRED for the two-layer defenses)

- Authentication → Policies → Password Policy: min length 10 + lowercase +
  uppercase + digits (see `auth-password-policy.md`).
- Authentication → Providers → Email → "Confirm email" ON (see
  `auth-email-verification.md`).

### B6. App-store submission (Epic 16.9 — launch gate)

Metadata + EAS submit profiles exist (`store/*.md`, `eas.json`); the actual App
Store Connect / Play Console listing, screenshots, and review submission are
still outstanding. See `submit-and-deploy.md`.

---

## C. Known non-blockers / follow-ups (safe to ship beta without)

- `check:colors` test-fixture-hex failure → `14-4-followup-test-fixture-hex-exemption`.
- `match_error_pattern` (migration `20260513000000`) has no `REVOKE ... FROM PUBLIC` /
  `GRANT ... TO authenticated` block, so it defaults to PUBLIC EXECUTE —
  inconsistent with every other hardened RPC. **Not exploitable** (its `WHERE`
  clause scopes to `ep.user_id = auth.uid()`). Deliberately NOT patched in this
  pass: the correct `vector`/`float` GRANT signature can't be verified without a
  live Postgres, and a wrong signature would fail `db push` — a worse outcome
  than a non-exploitable consistency nit. Add the REVOKE/GRANT when next editing
  that migration area with DB access to confirm it applies.
- Mid-sentence barge-in remains intentionally disabled (traded for echo defense;
  the `computeBargeInDirective` helper + tests remain but the path is gated).
  Re-enabling full-duplex barge-in without re-introducing echo is a future story.
- Maestro E2E flows exist but are not CI-wired and their selectors are still
  `# TODO` → `maestro-e2e-setup.md`.
- Epic 17 backend long-tail (RLS docs, pagination, reverse migrations) — backlog.
