# Maestro E2E Setup Runbook

**Owner:** qa-engineer / operator
**Story:** 15-4 (Skeleton flows shipped 2026-05-17; CI wiring deferred to `15-4-followup-maestro-ci-wiring`)

---

## What is this?

Story 15-4 shipped 5 Maestro YAML flow skeletons covering the 5 golden user flows:
1. `01-signup-flow.yaml` — sign-up → EmailVerificationGate (Story 12-9)
2. `02-onboarding-flow.yaml` — sign-in → onboarding wizard → placement test → home
3. `03-first-exercise.yaml` — Practice tab → Grammar → AI exercise → grade
4. `04-first-conversation.yaml` — Conversation tab → topic → start session → end
5. `05-mock-test-partial-review.yaml` — Mock test → TCF full sim → submit partial → results

**All flows carry `# TODO: verify selector` markers** because the testID / accessibilityLabel / text strings need to be confirmed against the actual running app via `maestro studio`. Until this verification pass is done, the flows are documentation, not executable.

---

## Step 1 — Install Maestro CLI

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Verify:

```bash
maestro --version
```

Expected: latest version (Maestro is updated frequently; pin via `maestro install latest` if needed).

---

## Step 2 — Set up iOS Simulator

Maestro requires Xcode + the iOS Simulator app. On a development machine:

```bash
# Check available simulators
xcrun simctl list devices

# Boot a simulator (e.g., iPhone 16 Pro running iOS 18)
xcrun simctl boot "iPhone 16 Pro"

# Open Simulator.app
open -a Simulator
```

---

## Step 3 — Build a development client

Maestro tests the BUILT app, not the Expo Go shell. Build a dev client:

```bash
cd /Users/simplemart/Development/projects/personal/companion
npx expo run:ios --device "iPhone 16 Pro"
```

This installs `com.companion.app` on the booted simulator + starts Metro.

For Android:

```bash
npx expo run:android
```

---

## Step 4 — Verify selectors with `maestro studio`

`maestro studio` launches an interactive UI where you can tap on the running app and Maestro extracts the testID / accessibilityLabel / text for each element:

```bash
maestro studio
```

Walk through each of the 5 flows in `studio`. For each `# TODO: verify selector` marker in the YAML, replace with the actual selector studio shows. Common patterns:
- `tapOn: "Sign in"` works if the button has accessibilityLabel "Sign in"
- `tapOn: { id: "input-email" }` works if the TextInput has testID "input-email"
- If neither matches, add the testID to the React Native component source first

---

## Step 5 — Seed test accounts

### Prerequisites — verify Story 12-9 email-verification gate is ON

**R1 EH-3 precheck:** Flow 1 asserts the EmailVerificationGate appears after signup. This requires the Supabase project to have **Authentication → Providers → Email → "Confirm email" toggled ON** (per the Story 12-9 runbook). If your test environment was created with the toggle OFF (or you followed the 12-9 rollback procedure), Flow 1 will dead-end because the new user is routed straight to onboarding — the gate never renders.

Verify with:

```bash
# Quick precheck — signup against the project; response body should
# carry `email_confirmed_at: null` (gate active) AND no session token
# (gate is gating session establishment).
curl -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"precheck-12-9@invalid.localdomain","password":"Abcdefghi1"}' | jq '.user.email_confirmed_at, .session'
```

If `email_confirmed_at` is not null OR a `session` object is present, the gate is OFF — toggle it ON in the Supabase Dashboard before running Flow 1.

### Test accounts

Each flow uses an env-var-injected test email:

- `e2e-test+signup-001@invalid.localdomain` (Flow 1 only — created at runtime)
- `e2e-test+onboarding-001@invalid.localdomain`
- `e2e-test+exercise-001@invalid.localdomain`
- `e2e-test+conversation-001@invalid.localdomain`
- `e2e-test+mocktest-001@invalid.localdomain`

**Flows 2–5 assume these accounts already exist + are email-verified + have completed onboarding.** The Flow 1 account is created fresh on each run (which means re-running Flow 1 against the same Supabase project requires per-run cleanup — see "Flow 1 re-run cleanup" below).

**Password single source of truth (R1 EH-5):** All flows reference `${TEST_PASSWORD}` via Maestro env-var. The seed script + flow files all consume the same `MAESTRO_TEST_PASSWORD` env var when set; the default value `Abcdefghi1` is hardcoded for convenience. If Story 12-8's `MIN_PASSWORD_LENGTH` tightens above 10 in the future, update the env var default in this runbook + the seed script — the flow files inherit via `${TEST_PASSWORD}`.

```bash
export MAESTRO_TEST_PASSWORD="Abcdefghi1"  # must satisfy Story 12-8 policy
maestro test --env TEST_PASSWORD=$MAESTRO_TEST_PASSWORD .maestro/
```

### Flow 1 re-run cleanup (R1 EH-1)

Flow 1 creates the `e2e-test+signup-001@invalid.localdomain` account fresh. **A second invocation against the same Supabase project fails on "user already exists"** because the email is unique-indexed. Pick one of:

1. **Delete the account between runs** (manual): Supabase Studio → Auth → Users → search `signup-001` → Delete.
2. **Delete the account between runs** (scripted): `supabase auth users delete <user_id>` via the CLI.
3. **Randomize the email suffix** (cleanest): edit Flow 1 to use `e2e-test+signup-${MAESTRO_RUN_ID}@invalid.localdomain` and pass `--env MAESTRO_RUN_ID=$(date +%s)` to `maestro test`. The signup gate accepts any unique email; the test asserts the gate state, not a specific email.
4. **Skip Flow 1 on subsequent runs**: `maestro test --include-tags=smoke --exclude-tags=signup .maestro/`.

### Seed Flows 2–5 (one-time setup)

**Option A (recommended):** Supabase Studio → Auth → Users → Add user (with verified flag).

**Option B:** Run a one-off seed script:

```ts
// scripts/seed-maestro-test-accounts.ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const password = process.env.MAESTRO_TEST_PASSWORD ?? "Abcdefghi1";
const flows = ["onboarding", "exercise", "conversation", "mocktest"];
for (const flow of flows) {
  await supabase.auth.admin.createUser({
    email: `e2e-test+${flow}-001@invalid.localdomain`,
    password,
    email_confirm: true,
  });
}
```

---

## Step 6 — Run flows locally

```bash
# All flows
maestro test .maestro/

# Single flow
maestro test .maestro/03-first-exercise.yaml

# By tag
maestro test --include-tags=smoke .maestro/
```

Maestro outputs pass/fail per flow + writes a video of each run (helpful for debugging selector failures).

---

## Step 7 — Wire into CI (deferred)

When the operator is ready to wire CI, see `15-4-followup-maestro-ci-wiring`. CI setup requires:

1. **Runner with simulator support** — macOS runner for iOS (paid GitHub Actions tier) OR an external service like BrowserStack / Maestro Cloud.
2. **Pre-built `.app` binary** — produced by `eas build --profile development --platform ios` and stored as a workflow artifact.
3. **Maestro CLI install step** — `curl -Ls https://get.maestro.mobile.dev | bash` in CI script.
4. **Test account env vars** — `MAESTRO_TEST_EMAIL_SIGNUP` / `_ONBOARDING` / `_EXERCISE` / `_CONVERSATION` / `_MOCKTEST` (+ `MAESTRO_TEST_PASSWORD`) as GitHub Actions secrets.
5. **Workflow step:** `maestro test .maestro/`

Do NOT mark the CI step `continue-on-error: true` (Story 12-10 R1-H2 silent-disable defense). If E2E coverage isn't ready for CI gating, leave the step out of `ci.yml` entirely — partial gating is a footgun.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `maestro test` exits 1 with "element not found" | testID drift OR text drift after a UI refactor | Re-run `maestro studio`, update the YAML's selector |
| Permission dialog blocks Flow 4 | mic-permission dialog timing | Add a delay before the `tapOn: "OK"` for the system dialog |
| Flow 2 times out at placement test | AI generation > 120s | Increase `extendedWaitUntil.timeout` in the YAML; investigate prompt complexity |
| Flow 4 fails on Realtime connection | OpenAI Realtime API outage OR Edge Function rate-limit | Check Supabase logs for `realtime-session` errors |

---

## Cross-story references

- Story 12-8 password policy: test accounts must use ≥10-char passwords (`Abcdefghi1` complies)
- Story 12-9 EmailVerificationGate: Flow 1 verifies the gate fires; Flows 2-5 assume verified accounts
- Story 14-1 chrome rule: EN UI strings throughout — flows use English button/tab labels
- Story 13-4 parallel mock-test generation: Flow 5 leverages the listening-section-first availability
- Story 15-4-followup-maestro-ci-wiring: CI integration when operator infrastructure is ready
