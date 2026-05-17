# Story 16.1: Real submit credentials provisioned + first verified TestFlight + Play Internal submission

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator of Companion preparing for the first external TestFlight + Google Play Internal-Track beta — currently blocked because the deploy substrate from Story 9-9 ([eas.json:42-54](eas.json#L42), [`.github/workflows/submit.yml`](.github/workflows/submit.yml), [`_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`](_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md)) is wired but the **real credential values have never been provisioned and the pipeline has never been exercised end-to-end against the live Apple + Google submission APIs**,

I want the 5 EAS environment variables (`EXPO_ASC_API_KEY_ID`, `EXPO_ASC_API_KEY_ISSUER_ID`, `EXPO_ASC_APP_ID`, `EXPO_APPLE_TEAM_ID`, `EXPO_ASC_API_KEY_P8`) + the 1 EAS file secret (`EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`) + the 1 GitHub repo secret (`EXPO_TOKEN`) provisioned with real values, the first production-profile `eas build` to succeed for iOS + Android, the first run of the EAS Submit workflow to push that build to TestFlight + Play Internal-Track without manual intervention, and a CI-enforceable preflight + drift-detector pair to guard against a future regression that re-introduces placeholder credentials or drops a required env-var reference,

so that the Epic 16 acceptance criterion at [shippable-roadmap.md:325](_bmad-output/planning-artifacts/shippable-roadmap.md#L325) (_"A pushed commit to main results in: tests pass → staging Edge Functions deployed → preview build to TestFlight → source maps uploaded — fully automated"_) is verifiably met for the build → submit portion, Story 9-9's "needs first TestFlight build with expo-updates + rollback rehearsal" follow-up at [sprint-status.yaml:220](_bmad-output/implementation-artifacts/sprint-status.yaml#L220) (story 16-2's review-status annotation) is closed, and Epic 16.10 beta-tester recruitment can begin against a real TestFlight + Play Internal build.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1, P0-9) flagged production deployment as blocked. Story 9-9 (Verified 2026-05-09; merged in Epic 9) closed the **wiring** half of that finding — `eas.json` placeholders excised, env-var references plumbed, `submit.yml` workflow created with `production` environment gate + concurrency lock + GHA-injection defense, leak guard added to `ci.yml`, runbook authored at `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`. **Story 16-1 closes the operator-action half:** acquiring the real credentials, provisioning them via `eas secret:create` + GitHub secrets, and running the pipeline end-to-end for the first time.

### Verification of substrate against Story 9-9 (2026-05-17):

| Substrate piece                                                                  | Today                                                                                              | Gap (Story 16-1 scope)                                                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [eas.json:42-48](eas.json#L42) iOS submit `ascApiKeyIssuerId` + `ascApiKeyId` + `ascAppId` + `appleTeamId` | ✓ env-var references `$EXPO_ASC_*` + `$EXPO_APPLE_TEAM_ID`                                         | EAS env vars themselves are not set                                                                                                                               |
| [eas.json:43](eas.json#L43) `ascApiKeyPath: "./asc-api-key.p8"`                   | ✓ path declared                                                                                    | EAS file secret `EXPO_ASC_API_KEY_P8` not created — CI cannot materialize the `.p8` file at submit time                                                           |
| [eas.json:50](eas.json#L50) `serviceAccountKeyPath: "./google-service-account.json"` | ✓ path declared                                                                                    | EAS file secret `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` not created — CI cannot materialize the JSON file at submit time                                                |
| [`.github/workflows/submit.yml`](.github/workflows/submit.yml)                   | ✓ workflow_dispatch trigger, `production` env gate, concurrency lock, env-var indirection for inputs | `EXPO_TOKEN` GitHub secret not set — workflow fails at `expo/expo-github-action@v8` step                                                                          |
| [ci.yml:110-150](.github/workflows/ci.yml#L110) Submit credentials leak guard    | ✓ blocks placeholder strings + 10-char Apple Team ID literal + 10-digit ASC App ID literal in git  | No drift detector pins that `eas.json` still uses `$EXPO_*` references (negative-guard against regression to literals)                                            |
| [`.github/workflows/build.yml`](.github/workflows/build.yml)                     | ✓ on push to main + manual                                                                         | EAS-side build credentials (provisioning profile, distribution cert, Android keystore) auto-generated on first `eas build` — operator never run                   |
| [submit-and-deploy.md §2.1-2.4](_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md) operator runbook | ✓ all steps documented                                                                             | Never executed end-to-end; first-real-run gotchas not yet captured                                                                                                |
| Apple Developer Program enrollment                                               | Unknown — operator action                                                                          | Precondition; 24-48h delay possible on first sign-up                                                                                                              |
| Google Play Console + Cloud project + service account                            | Unknown — operator action                                                                          | Precondition; service account JSON must be downloaded from Google Cloud Console                                                                                   |

### Why this story is "skeleton-only" per Epic 15 retro

Per the Epic 15 retro team agreement: _"Skeleton-only is a first-class scope option when external infrastructure setup blocks full delivery. Filing operator-action follow-ups + drift detectors + runbooks is the canonical pattern."_ Story 16-1 splits cleanly along this seam:

- **Operator-action work (~70% of value):** acquire real credentials from Apple Developer Portal + Google Cloud Console, provision via `eas secret:create` + GitHub repo settings, run first `eas build` + `eas submit` end-to-end. **No dev-agent can do this** — it requires interactive login at `appstoreconnect.apple.com/access/api` (.p8 download is a one-time, browser-only operation) and at `console.cloud.google.com` (service account JSON ditto).
- **Dev-agent work (~30% of value, what we ship in this PR):** the CI-enforceable preflight that fails-fast on missing `EXPO_TOKEN`, a drift detector pinning `eas.json` still uses env-var references, runbook updates with first-real-run observations, and the CLAUDE.md / MEMORY.md / sprint-status annotation flipping 9-9's "wired but unexercised" framing to "wired + exercised against real TestFlight + Play Internal".

Both halves are needed for the story to be `done`. A merged dev-agent PR with no operator execution is incomplete; an operator execution without the merged drift detectors is regression-prone. The Tasks/Subtasks section below splits the two cleanly so the operator can do their half asynchronously (during the 24-48h Apple Developer enrollment window, for instance) while the dev-agent ships the code half independently.

**Threat / failure model — what cannot happen post-story:**

After this story:

1. A `git grep "YOUR_APPLE_ID\|YOUR_APP_STORE_CONNECT_APP_ID\|YOUR_APPLE_TEAM_ID"` returns zero matches (already true post-9-9; the new drift detector pins this so a future revert is caught at test-time, not just CI-leak-guard-time).
2. `eas secret:list` shows all 6 EAS-side credentials populated (4 string env vars + 2 file secrets).
3. `gh secret list --repo <repo>` shows `EXPO_TOKEN` set.
4. A manual run of GitHub → Actions → "EAS Submit" → `platform: all` completes within ~3 minutes for iOS and ~2 minutes for Android, with no manual intervention.
5. App Store Connect → TestFlight shows the new build in "Processing" → "Ready to Test" state within 15 minutes of submission.
6. Google Play Console → Testing → Internal testing → Releases shows the new AAB as a draft (per [`eas.json:52`](eas.json#L52) `releaseStatus: "draft"`); operator promotion to internal testers is the next-step Action listed in the workflow's "Android draft promotion reminder" output at [submit.yml:94-100](.github/workflows/submit.yml#L94).
7. The runbook at `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` carries first-real-run observations in §3 + §4 — specifically any gotchas operator encountered (e.g., 2FA prompts on ASC API key generation, Google Cloud project IAM role propagation delays, EAS first-build provisioning-profile auto-creation).
8. CLAUDE.md "Deploy substrate" paragraph gains a Verified-2026-05-17 (or actual completion date) annotation confirming the first real TestFlight + Play Internal submissions succeeded — flipping Story 9-9's framing from "wired but not exercised" to "wired + exercised".
9. `memory/MEMORY.md` "User's Remaining Manual Steps" list collapses — the Apple/Google credentials provisioning steps are dropped.

**Out of scope for this story (delegated elsewhere):**

- **Real submit to live App Store / Play Store production tracks** — the AC is _internal_ tracks (TestFlight + Play Internal). Public release is **Epic 16.9** ("App Store / Google Play submission") and gates on beta sign-off in **Epic 16.10**.
- **Staging Supabase project / preview channel testing** → **Epic 16.5**.
- **Edge Function deploy auto-trigger verification** — wired by 9-9 in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); 16-1 verifies submission specifically, not Edge Function CI/CD. Operator can confirm Edge Function deploys are working via §6 of the runbook independently.
- **Sentry source-map upload verification** — wired by 9-9; the synthetic-crash recipe in §5 of the runbook is operator-runnable but not required for 16-1's submission AC.
- **Migration rollback playbook** → **Epic 16.6**.
- **Edge Function `console.error` → Sentry conversion** → **Epic 16.7**.
- **Uptime / health checks** → **Epic 16.8**.
- **Beta tester recruitment** → **Epic 16.10**.
- **Apple Developer Program enrollment** — precondition; operator does at [developer.apple.com/programs](https://developer.apple.com/programs). Story documents the dependency.
- **Google Cloud project setup + IAM role assignment** — precondition; operator does at [console.cloud.google.com](https://console.cloud.google.com).
- **Per-PR EAS preview build** ("build-on-PR") — §1 P3-4 in the audit; not yet allocated to an epic.
- **Apple ID + app-specific-password fallback flow** — Story 9-9 chose the ASC API key path; 16-1 does not re-litigate.
- **Removing the legacy `appleId` field from `eas.json` after first successful submit** — defensive consolidation; operator can do post-launch.

## Acceptance Criteria

### 1. Operator preflight — Apple side (operator-action; no dev-agent commit required)

The operator completes the following before invoking the EAS Submit workflow for the first time. The runbook at `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` §2.1 is the canonical reference; 16-1 acceptance is when each box is checked.

- [ ] Apple Developer Program enrollment is active (verify at [developer.apple.com/account](https://developer.apple.com/account); 24-48h delay possible on first sign-up). Apple Team ID is recorded.
- [ ] ASC API Key created at [App Store Connect → Users and Access → Keys](https://appstoreconnect.apple.com/access/api) with role "App Manager" or higher. The Key ID (~10 alphanumeric chars), Issuer ID (UUID), and the `.p8` private key file are recorded. **Note:** the `.p8` file is downloadable exactly ONCE — store it in a secure password manager immediately; Apple does not let you re-download it.
- [ ] App Store Connect App record exists for `com.companion.app` (or the operator's chosen bundle ID — must match `app.json` `ios.bundleIdentifier`). The ASC App ID (10-digit numeric) is recorded.
- [ ] EAS env vars created (project-scope, `production` environment):
  ```bash
  eas env:create --scope project --environment production --name EXPO_APPLE_TEAM_ID --value <10-char-team-id>
  eas env:create --scope project --environment production --name EXPO_ASC_API_KEY_ISSUER_ID --value <uuid>
  eas env:create --scope project --environment production --name EXPO_ASC_API_KEY_ID --value <10-char-key-id>
  eas env:create --scope project --environment production --name EXPO_ASC_APP_ID --value <10-digit-app-id>
  eas secret:create --scope project --type file --name EXPO_ASC_API_KEY_P8 --value ./AuthKey_<KeyId>.p8
  ```
- [ ] Verify with `eas env:list --scope project --environment production` — all 4 string vars listed.
- [ ] Verify with `eas secret:list` — `EXPO_ASC_API_KEY_P8` listed (type: file).

### 2. Operator preflight — Google side (operator-action)

- [ ] Google Play Console publisher account active. Companion app record exists with package name matching `app.json` `android.package`.
- [ ] Google Cloud project linked to the Play Console (Play Console → Setup → API access). Service account created via "Create new service account" flow with role "Service Account User" granted on the Google Cloud side AND "Release apps to testing tracks" granted on the Play Console side (Play Console → Setup → API access → Manage Play Console permissions → service-account row → Account permissions tab → "Release to production, exclude devices, and use Reach and devices" — minimum for internal-track submit).
- [ ] Service account JSON downloaded; named `google-service-account.json` locally (matches [`eas.json:50`](eas.json#L50) `serviceAccountKeyPath`).
- [ ] EAS file secret created:
  ```bash
  eas secret:create --scope project --type file --name EXPO_GOOGLE_SERVICE_ACCOUNT_KEY --value ./google-service-account.json
  ```
- [ ] Verify with `eas secret:list` — `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` listed (type: file).

### 3. Operator preflight — GitHub side (operator-action)

- [ ] `EXPO_TOKEN` is created at [expo.dev → Account Settings → Access Tokens](https://expo.dev/accounts/settings/access-tokens) with the personal-access-token type (NOT a build-bot service token — the latter cannot run `eas submit`).
- [ ] GitHub repo secret `EXPO_TOKEN` set via `gh secret set EXPO_TOKEN --body <token>` OR via GitHub → Settings → Secrets and variables → Actions → New repository secret.
- [ ] Verify with `gh secret list --repo Simplemart17/companion` — `EXPO_TOKEN` present.
- [ ] GitHub Environment `production` exists with the operator listed as a required reviewer (per [submit.yml:39](.github/workflows/submit.yml#L39) `environment: production`; the gate adds a human-checkpoint before any submission fires). Configure at GitHub → Settings → Environments → New environment → `production` → "Required reviewers" → add operator.

### 4. First-build verification (operator-action)

- [ ] Trigger a production build: GitHub → Actions → "EAS Build" → Run workflow → keep defaults (build production iOS + Android). OR locally: `eas build --profile production --platform all --non-interactive`.
- [ ] On first run, EAS will prompt to auto-generate the iOS provisioning profile + distribution certificate (interactive). If running via GitHub Actions, this fails; the operator must first run `eas build --profile production --platform ios --non-interactive` locally once to seed the credentials, then re-trigger CI. **Document this gotcha in the runbook** if encountered (Story 9-9 anticipated but didn't verify).
- [ ] Both iOS + Android builds complete successfully (typical: ~12-18 min each). Build IDs are noted.
- [ ] Build artifacts visible at [expo.dev/accounts/&lt;owner&gt;/projects/companion/builds](https://expo.dev) — status "Finished" for both platforms.

### 5. First-submit verification (operator-action)

- [ ] GitHub → Actions → "EAS Submit" → Run workflow → `platform: all`, `build_id: <empty>` (uses `--latest`). Approve the `production` environment gate when prompted.
- [ ] Workflow completes within ~5 minutes total (iOS ~3 min, Android ~2 min). Run status is green.
- [ ] **iOS verification:** App Store Connect → TestFlight → iOS Builds shows the new build within 15 minutes. State transitions from "Processing" → "Ready to Test" (Apple's malware + private-API scan; failure here surfaces via the email Apple sends to `developer@apple.com`).
- [ ] **Android verification:** Play Console → Testing → Internal testing → Releases shows the new AAB as a draft (per [`eas.json:52`](eas.json#L52) `releaseStatus: "draft"`). The "Android draft promotion reminder" step at [submit.yml:94-100](.github/workflows/submit.yml#L94) emits a GitHub annotation reminding the operator that internal testers cannot see the build until the draft is rolled out.
- [ ] Operator promotes the Android draft to internal testers manually via Play Console → Edit release → Review release → Roll out to Internal testing.

### 6. NEW CI preflight — `EXPO_TOKEN` GitHub-secret presence check (dev-agent work)

Add a new step to [`.github/workflows/submit.yml`](.github/workflows/submit.yml), positioned BEFORE the existing `Setup EAS` step (line 51), that fails the workflow IMMEDIATELY if `EXPO_TOKEN` is unset — rather than waiting for the `expo-github-action@v8` step to fail with a cryptic 401. The preflight emits an actionable `::error::` annotation pointing to the runbook §2.4 (GitHub repository secrets).

- [ ] NEW step `Preflight — EXPO_TOKEN present` in `submit.yml`, positioned after `Checkout` (line 42) and before `Setup EAS` (line 51), with content:
  ```yaml
  - name: Preflight — EXPO_TOKEN present
    env:
      EXPO_TOKEN_PRESENT: ${{ secrets.EXPO_TOKEN != '' }}
    run: |
      if [ "$EXPO_TOKEN_PRESENT" != "true" ]; then
        echo "::error title=EXPO_TOKEN GitHub secret missing::Submit cannot proceed without EXPO_TOKEN. See _bmad-output/planning-artifacts/runbooks/submit-and-deploy.md §2.4 (GitHub repository secrets) for provisioning."
        exit 1
      fi
  ```
- [ ] The same preflight pattern is **NOT** added for `EXPO_ASC_*` / `EXPO_APPLE_TEAM_ID` / `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` because those live in EAS env / EAS file secrets (not GitHub secrets) and GHA cannot introspect them. The `EAS Submit` step itself fails with a clear `Apple authentication failed` or `serviceAccountKeyPath does not exist` error if any are missing — runbook §4.3 covers those failure modes.
- [ ] The preflight uses env-var indirection (`${{ secrets.EXPO_TOKEN != '' }}` evaluated at template-render time, then bound to `EXPO_TOKEN_PRESENT` env var that the `run:` script consumes) to avoid the GHA injection sink pattern flagged in Story 9-9 P3 review. The secret value itself is NEVER interpolated into the `run:` block.

### 7. NEW drift detector — `eas.json` env-var reference pinning (dev-agent work)

NEW Jest drift detector at `src/lib/__tests__/eas-json-env-var-references-source-drift.test.ts` (≥5 cases) reading [`eas.json`](eas.json) from disk and pinning:

- [ ] POSITIVE: `eas.json` `submit.production.ios.ascApiKeyIssuerId === "$EXPO_ASC_API_KEY_ISSUER_ID"` (literal string, not interpolated).
- [ ] POSITIVE: `submit.production.ios.ascApiKeyId === "$EXPO_ASC_API_KEY_ID"`.
- [ ] POSITIVE: `submit.production.ios.ascAppId === "$EXPO_ASC_APP_ID"`.
- [ ] POSITIVE: `submit.production.ios.appleTeamId === "$EXPO_APPLE_TEAM_ID"`.
- [ ] NEGATIVE: no field under `submit.production.ios` matches the literal regex `/[A-Z0-9]{10}/` outside the `$EXPO_*` env-var reference shape (defends against regression where a 10-char Apple Team ID is hardcoded directly — paired with the [ci.yml:110-150](.github/workflows/ci.yml#L110) leak guard which catches it at CI time; the drift detector catches it at test time).
- [ ] NEGATIVE: no field under `submit.production.ios` contains the literal substring `"YOUR_"` (regression to Story 9-9 placeholder strings).
- [ ] POSITIVE: `submit.production.ios.ascApiKeyPath === "./asc-api-key.p8"` (the local-file reference materialized by EAS file secret `EXPO_ASC_API_KEY_P8`).
- [ ] POSITIVE: `submit.production.android.serviceAccountKeyPath === "./google-service-account.json"` (the local-file reference materialized by EAS file secret `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`).

Follows the Story 12-2 P12 comment-stripped read pattern + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline + Story 12-10 R1 step-block-scoped negative-guard pattern from `ci-audit-gate-source-drift.test.ts`. `eas.json` parses cleanly as JSON (no comments to strip post-9-9), so `JSON.parse(readFileSync(...))` is the load mechanism.

### 8. Runbook updates with first-real-run observations (operator-action; light dev-agent assist)

After the operator completes AC #1-5, the runbook gets an annotation pass capturing any gotchas:

- [ ] In `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` §3.1 (Trigger a production build), append any first-run observations under a new "First-run notes (2026-05-XX)" subheading — specifically any provisioning-profile auto-generation prompts, 2FA prompts, Google Cloud IAM role propagation delays, or anything else the runbook's pre-execution prose didn't anticipate.
- [ ] In §4.1 + §4.2, annotate the "Expected" output blocks with the operator's actual observed timings (Apple TestFlight processing window varied 5-15 min per Story 9-9's runbook; operator confirms the real range).
- [ ] In §4.3 (Failure modes & fixes), append any new symptom→cause→fix rows encountered. **If no new failure modes occurred, append a single row "First-run completed with no novel failure modes" with the date.**

### 9. CLAUDE.md + MEMORY.md + sprint-status annotation

After AC #1-8 are complete:

- [ ] CLAUDE.md "Deploy substrate" paragraph (the one starting `**Deploy substrate:** \`eas.json\` submit profiles read all credentials...`) gains a `Verified 2026-05-XX, story 16-1 (first real submission)` annotation appended at the end, alongside the existing Story 9-9 `Verified 2026-05-09` annotation. **The 9-9 annotation stays unchanged** — it documents when the substrate was wired; the 16-1 annotation documents when it was first exercised against real submission infrastructure.
- [ ] `_bmad-output/planning-artifacts/shippable-roadmap.md` line 313 (Epic 16.1 deliverable) gets a "✓ Closed by Story 16-1 (Verified 2026-05-XX)" annotation appended in the bullet body (matches the pattern at line 40 for Story 12-10's audit-finding closure annotation).
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` line 219 status flips `backlog → review` (or `done` after first-submission verification). Update `last_updated` to reflect Story 16-1 completion.
- [ ] In `.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/MEMORY.md` "User's Remaining Manual Steps" section, the Apple/Google credentials provisioning steps are dropped from the list (steps 1-4 of the current 6-item list are the deploy substrate; 16-1 closes the Apple + Google portions specifically). The remaining steps (Sentry DSN, Supabase secrets, function deploys, db push) stay; those are tracked under other Epic 16 stories.

### 10. Quality gates + cross-story preservation

- [ ] All 5 design-system gates green (type-check + lint + format-check + check:tokens + jest).
- [ ] **Net test growth:** **+5 to +8 net Jest cases** (drift detector only — the operator-action work doesn't add tests). Spec target: 2165 → 2170-2173.
- [ ] **0 source-module modifications** beyond `submit.yml` (1 new preflight step) + the new drift detector test file + runbook annotation + CLAUDE.md / MEMORY.md / sprint-status / roadmap closure annotations. No `eas.json` change in 16-1 (substrate landed in 9-9; 16-1 verifies it works).
- [ ] **Cross-story invariants:** Story 9-9 leak-guard at [ci.yml:110-150](.github/workflows/ci.yml#L110) preserved byte-for-byte; submit.yml `concurrency` block + `production` environment gate + GHA-injection defense + draft-promotion reminder all preserved.

<!--
  CONDITIONAL — Story 16-1 modifies a GitHub Actions workflow file (`submit.yml`) so this section applies.
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the Blind Hunter caught a `${{ github.event.inputs.* }}` interpolation injection in submit.yml; CI did not. 16-1 adds a preflight step; injection vector must be re-audited.
-->

### Y. GitHub Actions Injection Vector Check (submit.yml modification)

- [ ] No `${{ github.event.* }}`, `${{ github.head_ref }}`, `${{ github.actor }}`, or any other attacker-controlled context expression appears inside the new preflight step's `run:` block as an interpolation. The single context expression used (`secrets.EXPO_TOKEN != ''`) is bound to an env var via `env:` and consumed via `$EXPO_TOKEN_PRESENT`, never spliced into shell.
- [ ] No `${{ secrets.* }}` is interpolated into the `run:` block in a way that could be echoed. The `secrets.EXPO_TOKEN != ''` template expression evaluates to the boolean string `'true'` or `'false'` at template-render time; the secret value itself never reaches the runner shell.
- [ ] The workflow's existing `permissions:` block (if any) is preserved — 16-1 does not relax it. Currently submit.yml has no explicit `permissions:` block; this is acceptable for `workflow_dispatch`-only workflows that consume secrets + push to external services (Apple/Google); the default `contents: read` from the repo settings applies.
- [ ] The workflow's existing `on:` trigger (`workflow_dispatch` with `type: choice` + `type: string` inputs) is preserved. 16-1 does not add new triggers.
- [ ] The workflow's `concurrency` block at [submit.yml:31-33](.github/workflows/submit.yml#L31) is preserved — prevents double-submit waste.
- [ ] The workflow's `production` environment gate at [submit.yml:39](.github/workflows/submit.yml#L39) is preserved — adds the human-checkpoint before submission.
- [ ] The new preflight step's failure path (`exit 1`) is reached BEFORE any secret-consuming step runs — defense-in-depth so a missing-secret state cannot leak partial information through the EAS error path.

### Z. Polish Requirements

<!--
  Story 16-1 is primarily a CI/runbook/operator-action story. The Polish Requirements
  are mostly N/A here (no UI, no styling, no React Native code). Listed for completeness;
  most boxes are inapplicable.
-->

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex. **N/A** — no UI code in 16-1.
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners. **N/A** — no UI code in 16-1.
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel`. **N/A** — no UI code in 16-1.
- [x] Non-obvious interactions have `accessibilityHint`. **N/A** — no UI code in 16-1.
- [x] Stateful elements have `accessibilityState`. **N/A** — no UI code in 16-1.
- [x] All tappable elements have minimum 44x44pt touch targets. **N/A** — no UI code in 16-1.
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`. **N/A** — no TypeScript runtime code (the new preflight is bash inside YAML; failure mode is `exit 1` not Sentry).
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize`. **N/A** — no UI code in 16-1.
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files" — visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/16-1-real-submit-credentials.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule.

## Operator Decisions

| Q   | Question                                                                                                                                                                                                  | Recommended                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Real submit vs `eas submit --dry-run`?                                                                                                                                                                    | **Real submit**. Story 9-9's AC #4 was "the command... succeeds in pushing the latest production build to TestFlight without prompting" — that's the bar; dry-run defeats the purpose. A real submit costs nothing material (TestFlight processing is free; Play Internal draft is free; one `eas submit` invocation per platform).                                                                                                                                                          |
| Q2  | Block CI on missing `EXPO_TOKEN`, or document-only?                                                                                                                                                       | **Block CI** via the new preflight step. Cheapest place to catch the failure is the workflow's first step; the alternative (waiting for `expo-github-action@v8` to fail with a 401) wastes ~30s of runner time AND produces a confusing error message. Preflight emits an actionable `::error::` annotation pointing to the runbook.                                                                                                                                                         |
| Q3  | Verify `EXPO_ASC_API_KEY_P8` / `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` via GHA preflight?                                                                                                                       | **No — defer to EAS Submit step's own error handling**. EAS file secrets live in EAS infra, NOT GitHub secrets; GHA cannot introspect them via `${{ secrets.* }}`. The EAS Submit step fails with a clear `File not found: ./asc-api-key.p8` or `Apple authentication failed` error if either is missing; runbook §4.3 covers these symptoms. Adding a GHA preflight for them would require shelling out to `eas secret:list` which itself needs `EXPO_TOKEN` — circular and not worth it. |
| Q4  | Should the drift detector pin `submit.production.ios.ascApiKeyPath === "./asc-api-key.p8"` literally, or also tolerate `./AuthKey_*.p8` filenames?                                                        | **Pin the literal "./asc-api-key.p8"**. The rationale in Story 9-9 was to rename the operator's downloaded `AuthKey_<KeyId>.p8` to `asc-api-key.p8` as the convention (decouples the runbook from Apple's per-key filename convention; matches the `eas secret:create --value ./AuthKey_<KeyId>.p8` invocation which uploads under the secret name `EXPO_ASC_API_KEY_P8`). A future filename change is a deliberate decision, not drift — the strict pin forces the decision through review. |
| Q5  | Should the `submit.yml` modification also add a "Verify EAS env vars" step (e.g., parse `eas env:list` output)? Story 12-10 (audit gate) precedent says CI gates should be strict; Q3 says we can't strictly check EAS env vars from GHA. | **No — defer to EAS Submit step's failure**. Same rationale as Q3. The strictness argument from 12-10 applies to assertable state (GitHub secrets, file presence); EAS env-var introspection from GHA requires `EXPO_TOKEN` to be valid first, which creates a chicken-and-egg dependency. The EAS Submit step's failure with a clear error message is acceptable.                                                                                                                            |

## Out of Scope

- Real submit to public App Store / Play Store production tracks (Epic 16.9).
- Staging environment provisioning (Epic 16.5).
- Edge Function deploy-trigger verification (already wired in `deploy.yml` from Story 9-9; out of 16-1 scope).
- Sentry source-map synthetic-crash verification (runbook §5; operator-runnable but not blocking 16-1).
- Migration rollback playbook (Epic 16.6).
- Edge Function `console.error` → Sentry conversion (Epic 16.7).
- Uptime / health checks (Epic 16.8).
- Beta tester recruitment (Epic 16.10).
- Apple Developer Program enrollment (precondition; operator action).
- Google Cloud project + service account setup (precondition; operator action).
- App Store Connect App record creation (precondition; operator action).
- Removing the legacy `appleId` field from `eas.json` (operator can do post-launch; not load-bearing).
- Per-PR EAS preview build (§1 P3-4 in audit; not yet allocated to an epic).
- EAS build cost optimization (current `m-medium` at [eas.json:33](eas.json#L33) stays).
- `@sentry/react-native` v8 migration (current `~7.11.0`; out of scope).
- Apple App-Specific-Password fallback (Story 9-9 chose ASC API key path; 16-1 does not re-litigate).
- TestFlight external tester invitation (Epic 16.10).
- Play Console "Roll out to Internal testing" automation (Play Console policy: the final promotion is intentionally a manual operator gate; the draft-promotion-reminder step in submit.yml is the canonical surface).

## Tasks / Subtasks

**Operator-action tasks (no PR commit):**

- [ ] Task O1 — Apple side credentials (AC #1)
  - [ ] O1.1 Confirm Apple Developer Program enrollment active
  - [ ] O1.2 Create ASC API Key + download `.p8` (one-time download)
  - [ ] O1.3 Record App ID + Team ID + Issuer ID + Key ID
  - [ ] O1.4 Run 4× `eas env:create` for the string vars
  - [ ] O1.5 Run `eas secret:create --type file` for `EXPO_ASC_API_KEY_P8`
  - [ ] O1.6 Verify with `eas env:list` + `eas secret:list`
- [ ] Task O2 — Google side credentials (AC #2)
  - [ ] O2.1 Confirm Play Console publisher account active + app record exists
  - [ ] O2.2 Create Google Cloud service account + assign IAM roles
  - [ ] O2.3 Download service account JSON
  - [ ] O2.4 Run `eas secret:create --type file` for `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY`
  - [ ] O2.5 Verify with `eas secret:list`
- [ ] Task O3 — GitHub side credentials (AC #3)
  - [ ] O3.1 Create `EXPO_TOKEN` at expo.dev → Account Settings → Access Tokens
  - [ ] O3.2 Set `EXPO_TOKEN` GitHub repo secret
  - [ ] O3.3 Configure GitHub Environment `production` with operator as required reviewer
  - [ ] O3.4 Verify with `gh secret list`
- [ ] Task O4 — First production build (AC #4)
  - [ ] O4.1 Trigger via GitHub Actions OR `eas build --profile production --platform all --non-interactive`
  - [ ] O4.2 First-run iOS credentials auto-generation (may require one-time local invocation)
  - [ ] O4.3 Confirm both platform builds finish — Build IDs noted
- [ ] Task O5 — First submission (AC #5)
  - [ ] O5.1 Trigger EAS Submit workflow with `platform: all`
  - [ ] O5.2 Approve `production` environment gate
  - [ ] O5.3 Confirm workflow green; confirm TestFlight + Play Internal draft visible
  - [ ] O5.4 Promote Android draft to internal testers via Play Console

**Dev-agent tasks (PR commit):**

- [x] Task D1 — Add `EXPO_TOKEN` preflight to submit.yml (AC #6 + AC-Y)
  - [x] D1.1 Insert new `Preflight — EXPO_TOKEN present` step after Checkout, before Setup EAS (submit.yml:45-58)
  - [x] D1.2 Use env-var indirection (`secrets.EXPO_TOKEN != ''` → `EXPO_TOKEN_PRESENT` env var → `$EXPO_TOKEN_PRESENT` shell check)
  - [x] D1.3 Emit `::error title=...::` annotation with runbook §2.4 pointer on failure
  - [x] D1.4 Re-audit GHA injection-vector checklist (AC-Y) — all 7 boxes verified clean (only `secrets.EXPO_TOKEN != ''` template expression used; resolves to boolean string at template-render time; secret VALUE never reaches shell)
- [x] Task D2 — NEW drift detector test (AC #7)
  - [x] D2.1 Created `src/lib/__tests__/eas-json-env-var-references-source-drift.test.ts`
  - [x] D2.2 Loads `eas.json` via `JSON.parse(readFileSync(...))`
  - [x] D2.3 8 cases pinning 4 POSITIVE env-var references + 2 NEGATIVE (Apple Team ID / ASC App ID literal shapes + "YOUR_" placeholder substring) + 2 POSITIVE file paths
  - [x] D2.4 `npx jest src/lib/__tests__/eas-json-env-var-references-source-drift` → 8/8 green
- [x] Task D3 — Runbook updates (AC #8; pre-positioned placeholders for operator fill-in)
  - [x] D3.1 Added `#### First-run notes (Story 16-1, operator fills in on 2026-05-XX)` subheading to §3.1 with HTML-comment operator-action instructions
  - [x] D3.2 Added `#### Story 16-1 first-run observed values (operator fills in on 2026-05-XX)` subheadings to §4.1 + §4.2
  - [x] D3.3 Added `EXPO_TOKEN` missing-secret failure-mode row to §4.3 table + placeholder for novel-failure rows
- [~] Task D4 — CLAUDE.md / MEMORY.md / sprint-status / roadmap closure annotations (AC #9; D4.3 done in PR; D4.1/D4.2/D4.4 deferred to `16-1-followup-operator-execution-annotations`)
  - [ ] D4.1 Append Story 16-1 Verified annotation to CLAUDE.md "Deploy substrate" paragraph — **DEFERRED** (operator-execution-gated; filed as `16-1-followup-operator-execution-annotations`)
  - [ ] D4.2 Append "✓ Closed by Story 16-1" annotation to shippable-roadmap.md line 313 — **DEFERRED** (same follow-up)
  - [x] D4.3 Update sprint-status.yaml line 219 status (`backlog → ready-for-dev → in-progress → review` via dev-story Steps 4 + 9) + `last_updated` field
  - [ ] D4.4 Drop Apple/Google credential steps from MEMORY.md "User's Remaining Manual Steps" — **DEFERRED** (same follow-up)
- [x] Task D5 — Quality gates (AC #10)
  - [x] D5.1 `npm run type-check` → 0 errors
  - [x] D5.2 `npm run lint` → 0 warnings
  - [x] D5.3 `npm run format:check` → clean
  - [x] D5.4 `npm run check:tokens` → clean
  - [x] D5.5 `npm test` → all suites green EXCEPT pre-existing `ci-deno-step-source-drift.test.ts` (5 failing cases) which fails on clean origin/main checkout — confirmed pre-existing; NOT introduced by Story 16-1; filed as `15-3-followup-deno-drift-test-fix`
  - [x] D5.6 +8 net Jest cases (squarely within +5 to +8 spec target)

## Dev Notes

### Architecture patterns to follow

- **Skeleton-only scope** (Epic 15 retro team agreement): the dev-agent ships the CI-enforceable preflight + drift detectors + runbook updates; the operator ships the actual credential provisioning + verification. Both halves are needed for `done`. Precedent: Stories 15-4 (Maestro skeleton + selectors-need-validation) and 15-5 (AI schema regression with synthetic fixtures + real-fixture follow-up).
- **GHA injection defense via env-var indirection** (Story 9-9 P3 review): every workflow that consumes a `secrets.*` or `github.event.*` expression must bind it to `env:` and reference via `$VAR_NAME` in shell, never `${{ ... }}` interpolated directly into `run:`. The new preflight follows this pattern.
- **Drift-detector pattern with paired POSITIVE+NEGATIVE pins** (Story 13-2 P11 / 12-2 P12 / 12-10 R1-H2): every load-bearing config invariant gets BOTH a "this value is X" positive pin AND a "no regression to Y" negative pin. The 16-1 drift detector pins `eas.json` env-var references (positive) + no literal Apple Team ID / placeholder shapes (negative).
- **Cross-story invariant preservation:** Story 9-9 leak guard at [ci.yml:110-150](.github/workflows/ci.yml#L110), submit.yml `concurrency` + `production` env gate + Android draft-promotion reminder all preserved byte-for-byte. Story 12-10 `--audit-level=high` gate at ci.yml:49 unchanged. Story 15-6 coverage gate at 40% threshold unchanged.

### Source tree components to touch

- [`.github/workflows/submit.yml`](.github/workflows/submit.yml) — add 1 new step (Task D1)
- NEW `src/lib/__tests__/eas-json-env-var-references-source-drift.test.ts` (Task D2)
- [`_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`](_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md) — §3.1 / §4.1 / §4.2 / §4.3 annotations (Task D3)
- `CLAUDE.md` — append Verified-2026-05-XX annotation to Deploy substrate paragraph (Task D4.1)
- [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md#L313) line 313 — closure annotation (Task D4.2)
- [`_bmad-output/implementation-artifacts/sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml#L219) line 219 — status flip + `last_updated` (Task D4.3)
- `.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/MEMORY.md` — drop Apple/Google steps (Task D4.4)

**Files explicitly NOT touched** (defends against scope creep):

- `eas.json` (substrate landed in 9-9)
- `.github/workflows/build.yml`, `deploy.yml`, `ota-update.yml`, `ci.yml` (orthogonal to 16-1)
- Any `app/`, `src/components/`, `src/hooks/`, `src/lib/` runtime code
- `supabase/migrations/`, `supabase/functions/` (Edge Functions are Epic 16.3 / 16.7 scope)
- `package.json` (no new dependencies; the EAS CLI is consumed via `expo/expo-github-action@v8`)
- `tsconfig.json`, `jest.config.js` (no test-config changes)

### Testing standards

- Drift detector follows Story 12-2 P12 comment-stripped read pattern (`eas.json` is JSON so no comments to strip; use `JSON.parse(readFileSync(...))` directly with `{ encoding: "utf8" }`).
- Test cases use `it.each` for the parametric matrix where 4 env-var references share identical assertion shape (POSITIVE), keeping the file under ~120 lines.
- No new runtime smoke tests required — the operator-execution path IS the runtime smoke test (the EAS Submit workflow either succeeds or fails against real Apple + Google APIs).
- Per Epic 13 retro AI #4 accountability gate, the 5 design-system gates (type-check + lint + prettier + check:tokens + jest) must remain green after Task D1-D4.

### Project Structure Notes

- Story 16-1 is the FIRST Epic 16 story creation post-Epic 15 close. Epic 15 retro AIs were acknowledged + deferred at this story's creation per the workflow's advisory accountability gate (logged in sprint-status `last_updated` 2026-05-17 annotation). The 10 Epic 15 retro AIs are flagged for re-surfacing in Epic 16 retrospective.
- The "skeleton-only scope" framing IS itself a deliberate choice per Epic 15 retro team agreement #2. Future stories that hit operator-action gates should follow this same dev-agent / operator-action split.
- The `submit.yml` modification is small (1 new step) but qualifies as a workflow-touching story per the template — the AC-Y GitHub Actions Injection Vector Check applies.

### References

- [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md#L313) §"Epic 16 — Deploy & Launch Readiness (P1)" line 313 — 16.1 deliverable verbatim.
- [`_bmad-output/implementation-artifacts/9-9-submit-credentials-deploy-substrate.md`](_bmad-output/implementation-artifacts/9-9-submit-credentials-deploy-substrate.md) — full Story 9-9 substrate spec; 16-1 closes the operator-action half.
- [`_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`](_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md) — canonical operator runbook §1-§10; 16-1 §1.1-1.6 execute against §2 (Provisioning) + §3 (First-Build) + §4 (First-Submit).
- [`_bmad-output/implementation-artifacts/epic-15-retro-2026-05-17.md`](_bmad-output/implementation-artifacts/epic-15-retro-2026-05-17.md) §"Team Agreements" #2 — Skeleton-only as a first-class scope option.
- [`.github/workflows/submit.yml`](.github/workflows/submit.yml) — Story 9-9 workflow being extended in Task D1.
- [`eas.json`](eas.json) — Story 9-9 env-var references being pinned in Task D2.
- [`.github/workflows/ci.yml#L110-L150`](.github/workflows/ci.yml#L110) — Story 9-9 Submit credentials leak guard; preserved unchanged by 16-1.
- [Story 12-2 P12 source-string drift pattern](_bmad-output/implementation-artifacts/12-2-auth-listener-bootstrap-pure-consumer-hook.md) — referenced for drift-detector implementation pattern.
- [Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline](_bmad-output/implementation-artifacts/13-2-home-query-fan-out-reduction.md) — referenced for the drift-detector cases shape.
- [Story 12-10 R1-H2 CI gate step-block-scoped negative-guard pattern](_bmad-output/implementation-artifacts/12-10-npm-audit-ci-gate.md) — referenced for the preflight injection-defense pattern.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- `npm test` initially surfaced 5 failing tests in `src/lib/__tests__/ci-deno-step-source-drift.test.ts` (Story 15-3 R1-patch test). Investigation: ran the test against a clean `git checkout origin/main -- .github/workflows/ci.yml src/lib/__tests__/ci-deno-step-source-drift.test.ts` checkout — same 5 failures. **Confirmed pre-existing on origin/main; NOT introduced by Story 16-1.** The test expects `- name: Setup Deno` and `- name: Run Deno tests` steps in `ci.yml` but `grep -n "Deno\|deno" ci.yml` returns zero matches. Filed as `15-3-followup-deno-drift-test-fix` for the Story 15-3 owner to triage (root cause likely either: 15-3 R1 patches added the drift test ahead of the CI step that was deferred, OR the CI step was removed in a later merge without updating the drift test).
- Branch was created from `origin/main` after `PR #118` (chore/epic-15-retro) merged; uncommitted kickoff bookkeeping (sprint-status status flips + new 16-1 story file) was stashed across the branch switch + popped cleanly onto `feature/16-1-real-submit-credentials`. Verified the chore/epic-15-retro branch's work was already on main via `git diff origin/main` after the stash pop.

### Completion Notes List

**Dev-agent half complete; operator half pending (skeleton-only scope per Epic 15 retro team agreement #2).**

What the dev-agent shipped in this PR:

1. **`submit.yml` preflight step** (lines 45-58) — `Preflight — EXPO_TOKEN present` fails-fast on missing `EXPO_TOKEN` GitHub secret before the workflow consumes any other secret. Env-var indirection via `secrets.EXPO_TOKEN != ''` → `EXPO_TOKEN_PRESENT` env var pattern keeps the secret value out of the shell (Story 9-9 P3 GHA-injection defense). Failure emits `::error title=EXPO_TOKEN GitHub secret missing::...` with a runbook §2.4 pointer.
2. **NEW `eas-json-env-var-references-source-drift.test.ts`** (8 cases; 8/8 green) — pins `submit.production.ios.{ascApiKeyIssuerId, ascApiKeyId, ascAppId, appleTeamId}` to their `$EXPO_*` literal string references + NEGATIVE guards against literal Apple Team ID / ASC App ID shapes + `"YOUR_"` placeholder substring + POSITIVE pins on `./asc-api-key.p8` + `./google-service-account.json` file-path references. Test-time companion to the Story 9-9 CI-time leak guard at `ci.yml:110-150`; catches regressions one CI step earlier.
3. **Runbook annotation placeholders** at `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` §3.1 + §4.1 + §4.2 + §4.3 — each section gains a `#### Story 16-1 first-run ... (operator fills in on 2026-05-XX)` subheading with HTML-comment operator-action instructions enumerating what to capture (build duration, TestFlight processing wall-clock, Play Console draft visibility, novel failure modes). §4.3 also gains a new `EXPO_TOKEN missing-secret` row to the failure-modes table (the canonical failure mode the new preflight surfaces).
4. **Sprint-status update** — Story 16-1 status `backlog → ready-for-dev → in-progress → review` (final transition at Step 9). New follow-up entries filed: (a) `15-3-followup-deno-drift-test-fix` (pre-existing failure caught during D5 quality-gate run), (b) `16-1-followup-operator-execution-annotations` (the operator-execution-gated D4.1/D4.2/D4.4 closure annotations).

What the operator must still execute (Tasks O1-O5; NOT blocking PR merge):

5. Acquire credentials from Apple Developer Portal + Google Cloud Console (Tasks O1.1-O1.3 + O2.1-O2.3).
6. Provision 4 EAS string env vars + 2 EAS file secrets + 1 GitHub secret (Tasks O1.4-O1.6 + O2.4-O2.5 + O3.1-O3.4).
7. Run first production build via `eas build --profile production --platform all` (Task O4).
8. Run first EAS Submit workflow with `platform: all` (Task O5).
9. Fill in the runbook placeholders post-execution (D3 follow-up).
10. Append CLAUDE.md `Verified 2026-05-XX, story 16-1 (first real submission)` annotation + roadmap closure annotation + drop Apple/Google steps from MEMORY.md (D4 follow-up).

**Cross-story invariants verified clean:**

- Story 9-9 Submit credentials leak guard at `ci.yml:110-150` — zero-diff.
- Story 9-9 `submit.yml` concurrency block + `production` env gate + GHA-injection defense in `BUILD_ID` / `PLATFORM` env vars + Android draft-promotion reminder — all zero-diff (only ADDITION is the new preflight step BEFORE Setup EAS).
- Story 12-10 `--audit-level=high` audit gate at `ci.yml:49` — zero-diff.
- Story 15-6 coverage gate at 40% threshold — zero-diff.
- `eas.json` — zero-diff (the substrate landed in 9-9; 16-1 verifies it via drift detector).

**Quality gate results:**

- `npm run type-check` → 0 errors
- `npm run lint` → 0 warnings
- `npm run format:check` → clean
- `npm run check:tokens` → clean
- `npm test` → 2211 passing + 5 pre-existing failures in `ci-deno-step-source-drift.test.ts` (filed as `15-3-followup-deno-drift-test-fix`; verified pre-existing on clean origin/main)
- Net new tests: **+8** (within +5 to +8 spec target)

### File List

**Modified files:**

- `.github/workflows/submit.yml` (added Preflight — EXPO_TOKEN present step at lines 45-58)
- `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md` (added §3.1 / §4.1 / §4.2 / §4.3 operator-fill-in placeholder subheadings + new EXPO_TOKEN row to §4.3 failure-modes table)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Story 16-1 status flips + new `15-3-followup-deno-drift-test-fix` + `16-1-followup-operator-execution-annotations` follow-up entries; last_updated field refreshed)
- `_bmad-output/implementation-artifacts/16-1-real-submit-credentials.md` (Tasks checklist updated; Dev Agent Record + File List populated; Status flipped to `review` at Step 9)

**New files:**

- `src/lib/__tests__/eas-json-env-var-references-source-drift.test.ts` (8 Jest cases pinning eas.json env-var reference invariants)

**Files explicitly NOT touched (scope discipline preserved):**

- `eas.json` (substrate landed in Story 9-9)
- `.github/workflows/ci.yml`, `build.yml`, `deploy.yml`, `ota-update.yml`
- `CLAUDE.md`, `MEMORY.md`, `_bmad-output/planning-artifacts/shippable-roadmap.md` (D4.1/D4.2/D4.4 annotations deferred to operator-execution gate)
- Any `app/`, `src/components/`, `src/hooks/`, `src/lib/` runtime code
- `supabase/migrations/`, `supabase/functions/`
- `package.json`, `package-lock.json`, `tsconfig.json`, `jest.config.js`

### Change Log

- 2026-05-17: Story 16-1 implementation complete (dev-agent half). Skeleton-only scope per Epic 15 retro team agreement #2. Operator-action half (Tasks O1-O5) is asynchronous; post-execution closure annotations filed as `16-1-followup-operator-execution-annotations`. Pre-existing Story 15-3 drift-test failure filed as `15-3-followup-deno-drift-test-fix`.
