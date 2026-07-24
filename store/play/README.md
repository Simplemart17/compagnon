# Google Play Store — Submission Package

Everything needed to create the Play Store listing for **Companion** lives here.
Generated graphics are produced by `npm run generate-store-assets`
(source: [`scripts/generate-store-assets.mjs`](../../scripts/generate-store-assets.mjs)).
Copy-ready text metadata lives in [`../android-metadata.md`](../android-metadata.md).

> **Regenerate any graphic:** `npm run generate-store-assets` — deterministic,
> re-renders every file below from brand tokens. Edit the script to tweak copy,
> colors, or layout.

---

## 1. Asset inventory (what to upload where)

| File                               | Dimensions  | Play Console field                             | Status                |
| ---------------------------------- | ----------- | ---------------------------------------------- | --------------------- |
| `icon-512.png`                     | 512 × 512   | Store listing → **App icon**                   | ✅ Ready (32-bit PNG) |
| `feature-graphic.png`              | 1024 × 500  | Store listing → **Feature graphic**            | ✅ Ready              |
| `screenshots/01-home.png`          | 1080 × 1920 | Store listing → **Phone screenshots** (slot 1) | ✅ Ready              |
| `screenshots/02-conversation.png`  | 1080 × 1920 | Phone screenshots (slot 2)                     | ✅ Ready              |
| `screenshots/03-lessons.png`       | 1080 × 1920 | Phone screenshots (slot 3)                     | ✅ Ready              |
| `screenshots/04-pronunciation.png` | 1080 × 1920 | Phone screenshots (slot 4)                     | ✅ Ready              |
| `screenshots/05-results.png`       | 1080 × 1920 | Phone screenshots (slot 5)                     | ✅ Ready              |

**Play requirements met:** icon is a full-bleed 512×512 32-bit PNG (Play applies
its own rounded mask — do **not** pre-round it); feature graphic is exactly
1024×500; screenshots are 9:16, 1080×1920 (Play requires min 2, max 8, shortest
side ≥ 320px, ≤ 3840px). Tablet screenshots are **optional** and not required to
publish — the app runs phone-portrait.

> **A note on the screenshots:** these are faithful marketing compositions built
> from the app's real design tokens, copy, and layout — not live device captures.
> They are Play-Store-ready as-is. If you want pixel-exact captures from a running
> build, take them on a real device/emulator at 1080×1920 and drop them into
> `screenshots/`, keeping the same file names.

---

## 2. Store listing text (copy from `../android-metadata.md`)

| Field                 | Value                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| **App name**          | `Companion – Learn French`                                                     |
| **Short description** | `AI French tutor for TCF exam prep. Voice practice, pronunciation, exercises.` |
| **Full description**  | See [`../android-metadata.md`](../android-metadata.md) (§ Full Description)    |
| **App category**      | Education                                                                      |
| **Tags**              | language learning, French, TCF, CEFR, exam prep                                |
| **Contact email**     | `support@companion.app` _(create this — see §6)_                               |
| **Package name**      | `com.compagnon.android`                                                        |

---

## 3. App content (required declarations)

Complete **App content** in the Play Console left nav. Answers are pre-drafted in
[`../android-metadata.md`](../android-metadata.md):

- **Privacy policy** — set the URL (see §6; **blocker** until hosted).
- **Content rating** (IARC questionnaire) → expected **Everyone**. No violence /
  sexual content / profanity / drugs. Declare **user-generated content** (voice
  conversations + written exercises) and **data sharing** (voice → Azure, text →
  OpenAI).
- **Data safety** → the full collected/shared table is in `../android-metadata.md`.
  Key points: email + name (not shared), voice recordings + transcripts (shared
  with Azure/OpenAI to provide the feature), analytics (PostHog, anonymised),
  crash logs (Sentry, opaque user id only). Encrypted in transit + at rest;
  deletion supported in-app and via `privacy@companion.app`.
- **Target audience** → 18+ (or 13+); not "designed for children".
- **Ads** → No ads.
- **Government apps / financial / health** → No.

---

## 4. Build & upload the app bundle

The listing accepts graphics + text at any time, but the app can only go live
with a signed **AAB**. Production config is already in
[`eas.json`](../../eas.json) (`buildType: app-bundle`) and
[`app.json`](../../app.json) (`versionCode: 5`, `version: 1.0.0`).

```bash
# 1. Build the production Android App Bundle on EAS
eas build --profile production --platform android

# 2a. First upload MUST be manual: download the .aab from expo.dev and upload it
#     in Play Console → Testing → Internal testing → Create new release.
#     (Google requires the first bundle by hand so it can register the signing key.)

# 2b. Every subsequent release can be automated:
eas submit --platform android --latest      # or: npm run submit:android
```

`eas.json` submit config targets the **Internal testing** track as a **draft**
release — promote to Closed/Open/Production in Play Console when ready.
`npm run release:android` does build + auto-submit in one step.

---

## 5. Recommended screenshot order & captions

The generated screenshots already bake in marketing captions. Upload in this
order for the strongest first impression:

1. **01-home** — "Your French tutor, in your pocket" (daily adaptive plan)
2. **02-conversation** — "Real voice conversations" (speak freely, corrections after)
3. **03-lessons** — "Guided lessons, A1 to B2"
4. **04-pronunciation** — "Fix your accent, sound by sound"
5. **05-results** — "Full TCF mock tests"

---

## 6. Manual blockers (must be done by you before you can publish)

These require external accounts/hosting and cannot be produced from the repo:

- [ ] **Google Play Console account** ($25 one-time) → create app for `com.compagnon.android`.
- [ ] **Host the privacy policy** at a public URL and paste it into the listing +
      App content. The policy text already exists in-app
      ([`app/(auth)/privacy-policy.tsx`](<../../app/(auth)/privacy-policy.tsx>)) and
      terms ([`app/(auth)/terms.tsx`](<../../app/(auth)/terms.tsx>)) — publish the
      same content to a web page. `../android-metadata.md` currently uses the
      placeholder `https://companion.app/privacy`; replace it everywhere with the
      real URL.
- [ ] **Support email** reachable (e.g. `support@companion.app`).
- [ ] **Reviewer test account** — create a Supabase Auth user and add the
      credentials in Play Console review notes (the app is login-gated).
- [ ] **Signed production AAB** uploaded (see §4).
- [ ] **Play App Signing** — accept when prompted (recommended; Google manages the key).

Full context for backend/EAS provisioning:
[`../../SUBMISSION_CHECKLIST.md`](../../SUBMISSION_CHECKLIST.md) §7 and
[`_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`](../../_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md).

---

## 7. Pre-submit sanity check

- [ ] `icon-512.png` opens as a clean 512×512 navy square (Play rounds it).
- [ ] Feature graphic reads well as a thumbnail (no clipped text).
- [ ] All 5 screenshots are 1080×1920.
- [ ] Short description ≤ 80 chars; full description ≤ 4000 chars.
- [ ] Privacy policy URL is live and reachable.
- [ ] `versionCode` in `app.json` is higher than any previously uploaded build.
- [ ] Data safety answers match what the app actually does (voice → Azure/OpenAI).
