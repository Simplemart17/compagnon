# OTA Hotfix Runbook

## When to use OTA vs. a fresh build

OTA (`eas update`) ships a new JS bundle to installed apps within minutes, with no App Store / Play Store review. It is the fastest hotfix path, but only for changes that do **not** require new native code.

### ✅ Safe via OTA
- Business logic, state machine, hook changes
- UI / styling / NativeWind classes
- Copy and microcopy
- API endpoint URLs and request shapes (within the same auth contract)
- Schema validation (Zod) and error handling
- AI prompt strings (`src/lib/prompts/*.ts`)
- Feature flag flips
- Bug fixes in TypeScript / JavaScript
- Adjusting analytics events

### ❌ Requires a fresh native build (cannot OTA)
- Adding / removing / upgrading any native module
- `expo-updates` itself
- Changes to `app.json` outside `expo.updates`
- New permissions (camera, microphone, location)
- New URL schemes / deep link handlers
- iOS `infoPlist` changes
- Android `AndroidManifest.xml` changes
- Splash screen, icon, name changes
- Bumping the Expo SDK
- Any native module API surface change (e.g. `@mykin-ai/expo-audio-stream` upgrade)

### ⚠️ App Review Guideline 3.3.1
Apple permits OTA for bug fixes and content updates **but not** for changes that "significantly change features described in the metadata." Practical interpretation:
- Fixing a broken correction display: OK.
- Adding a brand-new exercise type the App Store description didn't mention: not OK.
- Switching pricing tiers, changing in-app purchase behavior: not OK without store review.

If unsure, ship a fresh build.

---

## Standard hotfix flow

1. **Reproduce the bug** on a build running the production channel.
2. **Land the fix** in a feature branch with a unit / integration test that would have caught it.
3. **Open a PR.** CI runs lint, type-check, format, tests, migration sanity.
4. **Merge to `main`.**
5. **Deploy to `preview` first.**
   - Go to GitHub Actions → "EAS Update (OTA)" → Run workflow.
   - `channel: preview`, `message: "fix: <one-line summary>"`, `platform: all`.
   - Verify the fix on a TestFlight or internal Play build pinned to the `preview` channel.
6. **Promote to production.**
   - Wait at least 1 hour after preview if the fix touches state/cache (lets you observe Sentry for new crashes).
   - Re-run the workflow with `channel: production`. The workflow guards production updates to the `main` branch only.
   - Watch Sentry for the next 30 minutes for new crash signatures.
7. **If something breaks: roll back.** See "Rollback" below.
8. **Post-mortem.** If the bug bypassed CI, add the missing test and update CLAUDE.md or the relevant runbook.

---

## Rollback

OTA updates are versioned by "update group." To roll back, republish a previous group:

```bash
# List recent update groups
eas update:list --channel production --limit 10

# Republish a known-good prior group as the latest production update
eas update --channel production --republish --group <group-id> \
  --message "rollback: revert <bad-group-id>"
```

Rollback ships in minutes. Then fix forward in the codebase.

If the bad update has crashed users into a non-recoverable state (e.g., the JS bundle won't load), the runtime falls back to the prior cached bundle on next launch — `fallbackToCacheTimeout: 0` in `app.json` makes this immediate.

---

## Project-specific gotchas

- **`@mykin-ai/expo-audio-stream` is a native module.** Audio bugs are not OTA-fixable. Ship a fresh build.
- **`expo-secure-store` migrations.** If a fix changes how the profile cache is read/written (Epic 12.7 territory), the OTA must be backward-compatible with prior cache schemas, or read AsyncStorage as a fallback. Otherwise users on the old binary + new OTA see blank profiles.
- **Realtime API event names.** OpenAI's GA event names are hardcoded in `src/lib/realtime.ts`. If a future rename forces a fix, the fix is OTA-shippable (TypeScript-only), but verify on preview first because audio playback failure is silent.
- **Edge Function changes are not OTA.** `supabase functions deploy` is a separate path — the OTA workflow does not touch Edge Functions.
- **Migrations are not OTA.** Database migrations apply via `supabase db push` (manual until Epic 16.3 lands the auto-deploy step). Never ship a JS OTA that depends on a column that hasn't been migrated to production yet.

---

## Release vs. update versioning

- **`version` in `app.json` (semver, e.g. 1.0.0):** changes only when shipping a new native build to the stores. Bump per release.
- **`runtimeVersion`:** derived from `version` via the `appVersion` policy. Each native binary has a runtime version; OTA updates target a specific runtime version.
- **EAS Update group:** generated per `eas update` invocation, identifies a specific JS bundle.

A 1.0.1 OTA update will NOT reach 1.0.0 binaries — and that is correct, because the 1.0.0 binary may not have native code the JS expects. To reach all users, a fresh build to each version channel is required.

---

## Channels

| Channel | Build profile | Audience | Auto-publish |
|---|---|---|---|
| `development` | development | Local dev clients | No (use `expo start`) |
| `preview` | preview | Internal TestFlight + Play Internal Track | Manual via workflow |
| `production` | production | Live App Store + Play Store users | Manual via workflow, main branch only |

---

## Known follow-ups (not yet wired)

- **Sentry source-map upload on OTA publish** — gated on Epic 9.3 (remove committed DSN from `app.json`, add `SENTRY_AUTH_TOKEN` secret, add `beforeSend` PII scrubber). Without this, production OTAs ship code that produces minified Sentry stack traces. Add `npx sentry-expo-upload-sourcemaps dist` to `.github/workflows/ota-update.yml` once Epic 9.3 lands.
- **EXPO_TOKEN in CI secrets** — required for the workflow to authenticate with EAS. If not yet present, generate at expo.dev → Account Settings → Access Tokens, then add as a repository secret.
- **`EAS Update` quota** — free tier = 1,000 MAU. Past that, $99/mo. Plan accordingly before public launch.

---

## Acceptance criteria for "OTA capability shipped" (Epic 16.2)

- [ ] `expo-updates` installed (✅ `~55.0.21` as of 2026-05-06)
- [ ] `app.json` has `updates.url` pointing at the project's EAS Update endpoint (✅)
- [ ] `app.json` has `runtimeVersion: { policy: "appVersion" }` (✅)
- [ ] Each `eas.json` build profile declares its `channel` (✅)
- [ ] `.github/workflows/ota-update.yml` exists and is invocable from Actions UI (✅)
- [ ] First fresh build uploaded to TestFlight with `expo-updates` baked in (pending — next `eas build`)
- [ ] First test OTA published to `preview` and verified on a TestFlight build (pending)
- [ ] Rollback exercise rehearsed (pending)
- [ ] Sentry source-map upload wired on publish (blocked on Epic 9.3)
