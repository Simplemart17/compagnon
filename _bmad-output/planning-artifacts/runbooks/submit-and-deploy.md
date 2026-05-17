# Submit & Deploy Runbook

End-to-end runbook for shipping a Companion build to **TestFlight** (iOS) and the **Google Play Internal Track** (Android), plus auto-deploying Edge Function changes. Owns the one-time provisioning, the per-release submission flow, and the source-map upload verification.

For OTA hotfixes that don't require a fresh native build, see [ota-hotfix.md](./ota-hotfix.md).

---

## 1. Prerequisites

These are external-account / one-time-only items the operator must have in hand before running anything in §2.

| #   | Resource                                               | Where to get it                                                                                                                                                                                 | First-time cost                                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Apple Developer Program membership (active)            | https://developer.apple.com/account                                                                                                                                                             | $99/yr; 24–48h enrollment delay possible                 |
| 2   | App Store Connect app record (`com.companion.app`)     | https://appstoreconnect.apple.com                                                                                                                                                               | Free once §1.1 active                                    |
| 3   | App Store Connect API key (`.p8`, `keyId`, `issuerId`) | App Store Connect → Users and Access → Keys → "Generate API Key" with **Admin** role                                                                                                            | 5 min, **non-recoverable** — store the `.p8` immediately |
| 4   | Google Play Developer Console account                  | https://play.google.com/console                                                                                                                                                                 | $25 one-time                                             |
| 5   | Google Play app record (`com.companion.app`)           | Play Console → Create App                                                                                                                                                                       | Free once §1.4 active                                    |
| 6   | Google service account JSON                            | Google Cloud Console → IAM → Service Accounts → Keys → Create JSON key, then in Play Console → Setup → API access → invite the service account email and grant "Release apps to testing tracks" | 10 min                                                   |
| 7   | Sentry auth token (project scope)                      | https://sentry.io/settings/account/api/auth-tokens — scopes: `project:write`, `project:releases`, `project:read`                                                                                | 2 min                                                    |
| 8   | Supabase access token                                  | https://supabase.com/dashboard/account/tokens                                                                                                                                                   | 1 min                                                    |
| 9   | Supabase project ref                                   | The slug in your Supabase dashboard URL (https://supabase.com/dashboard/project/**`<ref>`\*\*)                                                                                                  | 0 min — read-only lookup                                 |
| 10  | Expo (EAS) account + `EXPO_TOKEN` GitHub secret        | https://expo.dev/accounts/&lt;owner&gt;/settings/access-tokens                                                                                                                                  | 1 min                                                    |

---

## 2. One-Time Provisioning

Run all commands from the project root. Each command is idempotent — re-running it overwrites the prior value.

### 2.1 EAS — Apple submit credentials

```bash
# 1. Save the .p8 you downloaded in §1.3 to ./asc-api-key.p8 (gitignored by *.p8 rule).
# 2. Upload as a file secret. EAS materializes it to ./asc-api-key.p8 at submit time.
eas secret:create --scope project --name EXPO_ASC_API_KEY_P8 \
  --type file --value ./asc-api-key.p8

# 3. Upload the API key ID, issuer ID, ASC App ID, Apple Team ID as plaintext
#    env vars (these are not strictly secret — they appear in App Store Connect URLs —
#    but the convention is "credentials never live in git" anyway).
eas env:create --name EXPO_ASC_API_KEY_ID \
  --value <key-id-from-asc-keys-page> \
  --visibility plaintext \
  --environment production

eas env:create --name EXPO_ASC_API_KEY_ISSUER_ID \
  --value <issuer-id-from-asc-keys-page> \
  --visibility plaintext \
  --environment production

eas env:create --name EXPO_ASC_APP_ID \
  --value <numeric-app-id-from-asc-app-information> \
  --visibility plaintext \
  --environment production

eas env:create --name EXPO_APPLE_TEAM_ID \
  --value <10-char-team-id> \
  --visibility plaintext \
  --environment production

# 4. Verify
eas env:list --environment production
```

### 2.2 EAS — Google Play service account

```bash
# 1. Save the JSON you downloaded in §1.6 to ./google-service-account.json (gitignored).
# 2. Upload as a file secret.
eas secret:create --scope project --name EXPO_GOOGLE_SERVICE_ACCOUNT_KEY \
  --type file --value ./google-service-account.json

# 3. Verify
eas secret:list --scope project
```

### 2.3 EAS — Sentry auth token

```bash
# Available to both `eas build` and `eas update` runs. The
# @sentry/react-native/expo plugin auto-detects this and uploads source maps.
eas env:create --name SENTRY_AUTH_TOKEN \
  --value <token-from-sentry-account-tokens> \
  --visibility secret \
  --environment production \
  --environment preview
```

### 2.4 GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret. Add:

| Name                            | Value source                                | Used by                               |
| ------------------------------- | ------------------------------------------- | ------------------------------------- |
| `EXPO_TOKEN`                    | expo.dev → Account Settings → Access Tokens | build.yml, submit.yml, ota-update.yml |
| `EXPO_PUBLIC_SUPABASE_URL`      | local `.env.local`                          | build.yml, ota-update.yml             |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | local `.env.local`                          | build.yml, ota-update.yml             |
| `EXPO_PUBLIC_SENTRY_DSN`        | local `.env.local`                          | build.yml, ota-update.yml             |
| `SENTRY_AUTH_TOKEN`             | sentry.io → Account Tokens (project-scope)  | ota-update.yml                        |
| `SUPABASE_ACCESS_TOKEN`         | supabase.com/dashboard/account/tokens       | deploy.yml                            |
| `SUPABASE_PROJECT_REF`          | Supabase dashboard URL slug                 | deploy.yml                            |

> **Why both `EXPO_PUBLIC_*` GitHub secrets AND EAS env vars exist:**
> GitHub secrets are read by GHA-hosted steps (`eas build`, `eas update`); EAS env vars are interpolated into `eas.json` at submit time on EAS's infrastructure. They serve different stages of the pipeline.

### 2.5 GitHub environment "production" (optional but recommended)

Settings → Environments → New environment: `production`. Enable "Required reviewers" with at least 1 reviewer. This adds a manual gate to `submit.yml` and `deploy.yml` jobs that run with `environment: production`.

### 2.6 GHA secret vs EAS env-var — when does each apply?

The `EXPO_PUBLIC_*` GitHub secrets in §2.4 (Supabase URL, anon key, Sentry DSN) propagate to EAS Cloud builds via the build job spec — **EAS reads `EXPO_PUBLIC_*`-prefixed env vars from the local shell at `eas build` invocation time and uploads them as part of the job spec**, per [EAS docs](https://docs.expo.dev/build-reference/variables/). Setting them in `build.yml`'s `env:` block is the correct mechanism; you do NOT also need to mirror them as EAS Project env vars.

The credentials in §2.1–§2.3 are different — they live as EAS env vars / file secrets because they are interpolated into `eas.json` (`$EXPO_*` syntax) at submit/build time on EAS's infrastructure, where the GHA shell does not exist. So:

| Variable type | Set as | Read by |
|---|---|---|
| `EXPO_PUBLIC_*` (Supabase URL, anon key, Sentry DSN) | GitHub repo secret + `build.yml` `env:` block | EAS Cloud build (uploaded with job spec) |
| `EXPO_ASC_*` / `EXPO_APPLE_TEAM_ID` | EAS env var (`eas env:create`) | `eas.json` interpolation at submit time |
| `EXPO_ASC_API_KEY_P8` / `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` | EAS file secret (`eas secret:create --type file`) | EAS submit infrastructure |
| `SENTRY_AUTH_TOKEN` | Both: GitHub repo secret (for OTA via `ota-update.yml`) AND EAS env var (for native builds via `eas build`) | The `@sentry/react-native/expo` plugin |

---

## 3. First-Build Verification

### 3.1 Trigger a production build

GitHub → Actions → "EAS Build" → Run workflow → `profile: production`, `platform: all`. Wait for the EAS dashboard to show the build complete (~20–40 min for both platforms).

#### First-run notes (Story 16-1, operator fills in on 2026-05-XX)

<!--
  OPERATOR ACTION: After completing the first real production build per
  Story 16-1, replace this placeholder block with the actual observations.
  Suggested items to capture (drop any that didn't apply):
    - Did EAS prompt for provisioning-profile / distribution-cert
      auto-generation? If yes, did it succeed in CI or require a local
      `eas build` invocation first to seed credentials?
    - Did 2FA prompts fire on any step (ASC API key, Google service
      account, Apple Developer Portal)?
    - Did Google Cloud IAM role propagation take longer than ~5 minutes?
    - Any error messages not covered by §4.3 below?
    - Actual wall-clock build duration per platform (compare against the
      pre-execution estimate "~20–40 min").
  If no novel observations: replace this block with the single line
  "First production build completed without novel observations on YYYY-MM-DD."
-->

_(placeholder — see HTML comment for operator-action instructions)_

### 3.2 Confirm Sentry source maps uploaded

While the build runs, watch the EAS build log for a line like:

```
Sentry release artifacts uploaded successfully.
```

After the build completes:

1. Open https://sentry.io/organizations/simplemart-inc/releases/
2. The new release (e.g., `companion@1.0.0+<build-number>`) should appear with `.bundle.map` files attached.

If the line does not appear, `SENTRY_AUTH_TOKEN` is not set in the EAS environment — re-run §2.3.

### 3.3 Confirm `EXPO_PUBLIC_*` baked correctly

After the build completes, install on a device or simulator and confirm:

- The app boots past the splash screen (a missing `EXPO_PUBLIC_SUPABASE_URL` would crash here).
- A login attempt successfully reaches the Supabase backend.

If boot fails, the GitHub secrets in §2.4 rows 2–4 are missing or stale.

---

## 4. First-Submit Verification

> **Local `eas submit -p ios` precondition:** `eas.json` references `./asc-api-key.p8` for iOS submission. CI gets this file via the EAS file secret `EXPO_ASC_API_KEY_P8`, but if you run `eas submit` from your laptop directly (bypassing the workflow), you must have the `.p8` file present at the project root — `eas` will exit with `File not found: ./asc-api-key.p8` otherwise. Same for `./google-service-account.json` on Android. The CI path is the supported flow; local submit is for emergency rollback only (P11 review).

### 4.1 iOS → TestFlight

GitHub → Actions → "EAS Submit" → Run workflow → `platform: ios`, `build_id: <empty>` (uses `--latest`). If the `production` environment gate is configured (§2.5), approve the deployment.

Expected (pre-Story-16-1 estimates):

- Workflow completes in ~3 minutes.
- App Store Connect → TestFlight → iOS Builds shows the new build within 5–15 minutes (Apple processing).
- The build is in "Processing" → "Ready to Test" once Apple completes its scan.

#### Story 16-1 first-run observed values (operator fills in on 2026-05-XX)

<!--
  OPERATOR ACTION: After the first real iOS submission, replace this
  placeholder with actual observed values:
    - Workflow duration (compare against ~3 min estimate)
    - Time to TestFlight visibility (compare against 5–15 min Apple processing)
    - "Processing" → "Ready to Test" transition time
    - Apple email notifications received (if any rejection scans fired)
  If observed range matches expected: "First iOS submission completed within
  expected timings on YYYY-MM-DD."
-->

_(placeholder — see HTML comment for operator-action instructions)_

### 4.2 Android → Play Internal Track

Same workflow, `platform: android`.

Expected (pre-Story-16-1 estimates):

- Workflow completes in ~2 minutes.
- Play Console → Testing → Internal testing → Releases shows the AAB as a **draft** (per `releaseStatus: "draft"` in `eas.json`).
- Operator promotes to internal testers manually via Play Console → Edit release → Review release → Roll out to Internal testing.

#### Story 16-1 first-run observed values (operator fills in on 2026-05-XX)

<!--
  OPERATOR ACTION: After the first real Android submission, replace this
  placeholder with actual observed values:
    - Workflow duration (compare against ~2 min estimate)
    - Time from submit → draft-visible in Play Console
    - Did the "Android draft promotion reminder" GHA annotation surface
      correctly at end of workflow?
    - Promotion-to-internal-testers wall-clock (operator manual action)
  If observed range matches expected: "First Android submission completed
  within expected timings on YYYY-MM-DD."
-->

_(placeholder — see HTML comment for operator-action instructions)_

### 4.3 Failure modes & fixes

| Symptom                                                        | Likely cause                                                            | Fix                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `eas submit` exits with `Apple authentication failed`          | Stale or wrong ASC API key fields                                       | Re-run §2.1; verify `EXPO_ASC_API_KEY_*` in `eas env:list`                     |
| `eas submit` exits with `serviceAccountKeyPath does not exist` | EAS file secret not created                                             | Re-run §2.2; confirm `eas secret:list` shows `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` |
| Submit succeeds but build never appears in TestFlight          | Apple processing failure (rare); check email from `developer@apple.com` | Resubmit a fresh build; if persistent, file an Apple TSI                       |
| Play submit succeeds but track empty                           | Service account lacks "Release apps to testing tracks" role             | Re-do §1.6 last step; resubmit                                                 |
| EAS Submit workflow fails at "Preflight — EXPO_TOKEN present" step with `::error::EXPO_TOKEN GitHub secret missing` | `EXPO_TOKEN` GitHub secret unset or empty                               | Run `gh secret set EXPO_TOKEN --body <token>` OR add via GitHub → Settings → Secrets and variables → Actions. See §2.4 row 1. (Story 16-1 fail-fast check.) |

#### Story 16-1 first-run novel failure modes (operator fills in on 2026-05-XX)

<!--
  OPERATOR ACTION: After the first real submission, append any novel
  symptom → cause → fix rows to the table above. If no novel failure
  modes occurred, replace this block with the single line
  "First-run submission completed with no novel failure modes on YYYY-MM-DD."
-->

_(placeholder — see HTML comment for operator-action instructions)_

---

## 5. Source-Map Verification (Synthetic Crash)

Confirms production stack traces deobfuscate to source paths.

```bash
# 1. Send a synthetic event tagged with the current release.
RELEASE="companion@$(jq -r .expo.version app.json)"
npx sentry-cli send-event \
  --message "9-9 deploy verification" \
  --release "$RELEASE"

# 2. Open Sentry → Issues, filter by the release tag.
open "https://sentry.io/organizations/simplemart-inc/issues/?project=companion&query=release:$RELEASE"
```

Pass criterion: the event's stack frame shows a real source path like `app/_layout.tsx:43`, **not** a minified path like `index.android.bundle:1:42851`.

If minified: `SENTRY_AUTH_TOKEN` was missing during the build — re-run §2.3 and trigger a new build.

---

## 6. Edge Function Auto-Deploy

### 6.1 How it triggers

`.github/workflows/deploy.yml` runs on push to `main` when `supabase/functions/**` changes (and on manual dispatch). It runs `supabase functions deploy <name>` for each of the 6 functions in serial order.

### 6.2 Confirm a deploy succeeded

After a function-touching push:

1. GitHub → Actions → "Deploy" → click the latest run.
2. The "Deploy functions" step should show 6 successful `supabase functions deploy` lines.
3. Confirm in Supabase dashboard → Edge Functions → each function's "Last deployed" timestamp matches the run.

### 6.3 Manual force-redeploy

GitHub → Actions → "Deploy" → Run workflow → `force: true`. Use this when:

- A secret was rotated and you need functions to pick it up (`supabase secrets set`-then-redeploy).
- A previous run partially failed.
- An Edge Function shared util file (`_shared/*.ts`) changed but the auto-trigger didn't fire.

### 6.4 Migration handling (deliberately manual)

When a push touches `supabase/migrations/`, the `notify-migration-pending` job emits a `::warning::` annotation visible at the top of the run summary. The operator must manually run:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Auto-`db push` is **gated on Epic 16.6** (rollback playbook). Until that lands, manual application is the safe default — a forward-only migration that breaks production has no automated recovery path today.

---

## 7. Rollback

| Surface           | Rollback path                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OTA update**    | See [ota-hotfix.md §Rollback](./ota-hotfix.md#rollback). `eas update --channel production --republish --group <prior-group-id>` ships in minutes.                                                                                    |
| **Native binary** | Re-submit a prior known-good build: `eas submit -p ios --id <prior-build-id>` (or via the Submit workflow's `build_id` input). For Android, manually demote the bad release in Play Console; submission rollbacks are not automated. |
| **Edge Function** | Re-run the Deploy workflow against a prior commit: GitHub → Actions → "Deploy" → Run workflow on the desired tag/SHA. Or locally: `git checkout <good-sha> && supabase functions deploy <name>`.                                     |
| **Migration**     | **No automated path.** Manual SQL reversal — see Epic 16.6 (planned).                                                                                                                                                                |

---

## 8. Cost Watch

| Service         | Free tier                                                | Cost beyond                | Trigger to upgrade                                                         |
| --------------- | -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| EAS Update      | 1,000 MAU                                                | $99/mo (1k → 50k MAU plan) | Beta exit / public launch                                                  |
| Sentry          | 10k events/month                                         | $26/mo (50k events)        | First production crash spike                                               |
| Supabase        | 500 MB DB / 5 GB egress / 500k Edge Function invocations | $25/mo Pro                 | When daily-greeting embedding cache stops absorbing the function call rate |
| Apple Developer | $99/yr fixed                                             | —                          | annual renewal                                                             |
| Google Play     | $25 one-time                                             | —                          | n/a                                                                        |

Surface in monthly review with a single "platform fees" line item.

---

## 9. Quick reference

```bash
# Trigger a production build
gh workflow run "EAS Build" -f profile=production -f platform=all

# Submit the latest build to both stores
gh workflow run "EAS Submit" -f platform=all

# Force-deploy all Edge Functions
gh workflow run "Deploy" -f force=true

# Publish an OTA hotfix to preview, then promote to production
gh workflow run "EAS Update (OTA)" -f channel=preview -f message="fix: <summary>" -f platform=all
gh workflow run "EAS Update (OTA)" -f channel=production -f message="fix: <summary>" -f platform=all
```

---

## 10. Related docs

- [ota-hotfix.md](./ota-hotfix.md) — when to OTA vs fresh build, App Store Guideline 3.3.1, channel matrix.
- [docs/deployment-guide.md](../../../docs/deployment-guide.md) — high-level overview.
- [SUBMISSION_CHECKLIST.md](../../../SUBMISSION_CHECKLIST.md) — initial setup checklist (now mostly obsolete; this runbook supersedes most of it).
- [store/ios-metadata.md](../../../store/ios-metadata.md), [store/android-metadata.md](../../../store/android-metadata.md) — App Store Connect / Play Console listing copy.
- [CLAUDE.md](../../../CLAUDE.md) — "Deploy substrate" architecture line.
