# App Store Submission Checklist

Work through this list top-to-bottom before submitting to either store.
Check off each item as you complete it.

---

## 1. Backend Setup

- [ ] Create a Supabase project at supabase.com
- [ ] Enable the `vector` extension (Database → Extensions)
- [ ] Run `supabase link --project-ref YOUR_PROJECT_REF`
- [ ] Run `supabase db push` to apply both migrations
- [ ] Set Edge Function secrets:
  ```bash
  supabase secrets set \
    OPENAI_API_KEY=sk-... \
    AZURE_SPEECH_KEY=... \
    AZURE_SPEECH_REGION=westeurope
  ```
- [ ] Deploy all three Edge Functions:
  ```bash
  supabase functions deploy ai-proxy
  supabase functions deploy realtime-session
  supabase functions deploy pronunciation-assess
  ```
- [ ] Verify Edge Functions respond (see `supabase/README.md`)
- [ ] Create a reviewer test account in Supabase Auth dashboard

---

## 2. Error Monitoring

- [ ] Create a Sentry project at sentry.io (React Native type)
- [ ] Copy the DSN
- [ ] Add to `.env.local`: `EXPO_PUBLIC_SENTRY_DSN=https://...`
- [ ] Update `app.json` Sentry plugin: replace `YOUR_SENTRY_ORG` with your org slug
- [ ] Verify Sentry receives a test event (`npx expo start`, trigger an error)

---

## 3. EAS & Expo Account

- [ ] Create/log in to an Expo account at expo.dev
- [ ] Run `eas init` in the project root
- [ ] Copy the `projectId` into `app.json` → `extra.eas.projectId`
- [ ] Run `eas credentials` to configure iOS and Android signing

---

## 4. Environment Variables

- [ ] `.env.local` has all required values:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_SENTRY_DSN`
- [ ] Confirm `EXPO_PUBLIC_OPENAI_API_KEY` is **not** present (server-side only)

---

## 5. Legal

- [ ] Register a domain (e.g. companion.app)
- [ ] Host the privacy policy at `https://companion.app/privacy`
- [ ] Host the terms of service at `https://companion.app/terms`
- [ ] Create a support email address (`support@companion.app`)
- [ ] Create a privacy email address (`privacy@companion.app`)
- [ ] Update `.env.example` support URLs if different

---

## 6. Apple Developer (iOS)

- [ ] Enrol in the Apple Developer Program ($99/year) at developer.apple.com
- [ ] Create an App ID for `com.companion.app`
- [ ] Create an app record in App Store Connect
- [ ] Configure push notifications if needed (not currently used)
- [ ] Prepare screenshots (see `store/ios-metadata.md`)
  - [ ] 6.9" iPhone screenshots (required)
  - [ ] 5.5" iPhone screenshots (required)
  - [ ] 13" iPad screenshots (required — supportsTablet is true)
- [ ] Write app description and keywords (copy from `store/ios-metadata.md`)
- [ ] Set Privacy Policy URL to `https://companion.app/privacy`
- [ ] Complete the age rating questionnaire (expected: 4+)
- [ ] Add a review test account in App Store Connect → Users and Access
- [ ] Add review notes (copy from `store/ios-metadata.md`)

---

## 7. Google Developer (Android)

- [ ] Create a Google Play Console account ($25 one-time) at play.google.com/console
- [ ] Create a new app for `com.companion.app`
- [ ] Upload a signed AAB (from EAS production build)
- [ ] Prepare screenshots and feature graphic (see `store/android-metadata.md`)
- [ ] Complete the content rating questionnaire (expected: Everyone)
- [ ] Complete the Data Safety section (see `store/android-metadata.md`)
- [ ] Set Privacy Policy URL to `https://companion.app/privacy`
- [ ] Add short and full descriptions (copy from `store/android-metadata.md`)

---

## 8. CI/CD

- [ ] Push repository to GitHub
- [ ] Add `EXPO_TOKEN` to GitHub repository secrets (Settings → Secrets → Actions)
- [ ] Confirm CI passes: `npm run type-check` + `npm run lint`
- [ ] Trigger a manual EAS preview build via GitHub Actions to verify the pipeline

---

## 9. Device Testing (do before final submission)

- [ ] Test on a real iOS device (not just simulator) — especially:
  - [ ] Microphone permission prompt appears correctly
  - [ ] Voice conversation works end-to-end
  - [ ] Audio plays back correctly during exercises
  - [ ] Pronunciation assessment returns results
- [ ] Test on a real Android device — especially:
  - [ ] `RECORD_AUDIO` permission prompt appears
  - [ ] Voice conversation works end-to-end
  - [ ] App behaves correctly on Android audio focus interruptions (calls, notifications)
- [ ] Test auth flow: sign up → email confirmation → onboarding → main app
- [ ] Test error recovery: turn off internet mid-exercise — does the app handle it gracefully?
- [ ] Test sign out and sign back in

---

## 10. Final Build & Submit

- [ ] Bump version in `app.json` if needed (`"version": "1.0.0"`)
- [ ] Run production EAS build:
  ```bash
  eas build --profile production --platform all
  ```
- [ ] Download the `.ipa` (iOS) and `.aab` (Android) from expo.dev
- [ ] Submit iOS via EAS or Transporter:
  ```bash
  eas submit --platform ios
  ```
- [ ] Submit Android via EAS or Google Play Console:
  ```bash
  eas submit --platform android
  ```
- [ ] Monitor App Store Connect for review status (typically 1–3 days)
- [ ] Monitor Google Play Console for review status (typically 1–7 days)

---

## Post-Launch

- [ ] Verify Sentry is receiving real crash reports
- [ ] Set up billing alerts in OpenAI dashboard (cost control)
- [ ] Set up billing alerts in Azure portal
- [ ] Set up billing alerts in Supabase dashboard
- [ ] Monitor Edge Function logs in Supabase dashboard for errors
- [ ] Reply to any App Store reviews within 48 hours
