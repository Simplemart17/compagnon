# App Store Connect — iOS Metadata

Paste these values into App Store Connect when creating your app listing.

---

## Identity

| Field                | Value                    |
| -------------------- | ------------------------ |
| **Name**             | Companion – Learn French |
| **Subtitle**         | AI Tutor & TCF Exam Prep |
| **Bundle ID**        | com.compagnon.ios        |
| **SKU**              | companion-ios-001        |
| **Primary Language** | English                  |

---

## Description (4,000 char max)

```
Master French with an AI tutor that actually listens.

Companion uses advanced AI to help you practice real French — the kind you need for the TCF exam and everyday life. Whether you're a complete beginner or polishing your C1 for a visa application, Companion adapts to your exact level and keeps you on track.

──────────────────────────────────────
VOICE CONVERSATIONS
──────────────────────────────────────
Talk with your AI companion in French, any time. Choose a topic — ordering at a café, debating French cinema, or simulating a job interview — and have a genuine back-and-forth conversation. The AI speaks at your level, introduces vocabulary naturally, and gives you a correction summary after each session — never mid-sentence.

──────────────────────────────────────
PRONUNCIATION ASSESSMENT
──────────────────────────────────────
Get phoneme-level feedback on your French pronunciation. Companion identifies your specific weak sounds — the French "r", nasals, liaison — and tracks your improvement over time.

──────────────────────────────────────
TCF EXAM PRACTICE
──────────────────────────────────────
Structured practice for all five TCF skills:
• Listening comprehension
• Reading comprehension
• Grammar & vocabulary
• Writing expression
• Speaking expression

Exercises are generated fresh every session and calibrated to your CEFR level (A1 → C2). Full mock TCF tests with real timing and score simulation are available when you're ready to test yourself.

──────────────────────────────────────
PERSONALISED TO YOU
──────────────────────────────────────
Companion remembers what you talk about, your vocabulary gaps, and your recurring mistakes — and uses that knowledge to make every session more relevant. Your error patterns automatically become targeted micro-drill exercises so you fix real problems, not imaginary ones.

──────────────────────────────────────
SPACED REPETITION VOCABULARY
──────────────────────────────────────
Every word you learn during conversations is saved and reviewed at the scientifically proven optimal interval (SM-2 algorithm). Build lasting vocabulary without flashcard fatigue.

──────────────────────────────────────
PROGRESS TRACKING
──────────────────────────────────────
Track your daily streak, weekly activity, and skill-by-skill progress. See exactly where you are on the A1–C2 scale and how far you are from your target.

──────────────────────────────────────
PRIVACY FIRST
──────────────────────────────────────
Your API keys and sensitive data never leave our servers. Audio is processed in real-time and not stored after sessions. All data is protected by end-to-end encryption and strict access controls.

Companion is built for serious French learners. Download it and start speaking today.
```

---

## Promotional Text (170 char max — can be updated without a new release)

```
Your AI French tutor, available 24/7. Practice real conversations, ace your TCF exam, and finally sound like you belong in Paris.
```

---

## Keywords (100 char max — comma-separated, no spaces after commas)

```
french,TCF,DELF,DALF,learn french,french tutor,AI french,french practice,CEFR,pronunciation
```

> **Tip:** Apple counts each keyword slot separately. Prioritise high-intent, low-competition terms. Do not repeat words already in the app name or subtitle.

---

## Support URL

```
https://companion.app/support
```

## Marketing URL (optional)

```
https://companion.app
```

## App Privacy questionnaire (App Store Connect answers)

Post-Story-21-2 the app collects usage analytics via PostHog. Answer the
App Privacy questionnaire as follows:

- **Data Used to Track You:** None (no cross-app/cross-site tracking; no ad
  networks; no data broker sharing).
- **Data Linked to You:**
  - _Identifiers → User ID:_ Yes (opaque account UUID, linked for app
    functionality + analytics).
  - _Usage Data → Product Interaction:_ Yes (feature-usage events — e.g.
    conversation completed, exercise finished, coarse score bands — linked
    via the opaque user ID; purpose: Analytics + App Functionality).
- **Data Not Linked to You:** Diagnostics (crash data via Sentry, tagged
  with the opaque user ID only per the in-app privacy policy).
- No data is used for Third-Party Advertising or Developer's Advertising.

Keep these answers in sync with the in-app privacy policy (§3 purposes +
§4 processor list) whenever a new data sink ships.

## Privacy Policy URL (required)

```
https://companion.app/privacy
```

---

## App Information

| Field                  | Value                  |
| ---------------------- | ---------------------- |
| **Category**           | Education              |
| **Secondary Category** | Utilities              |
| **Age Rating**         | 4+                     |
| **Content Rights**     | No third-party content |

### Age Rating questionnaire answers

All questions → **None / No**
(No violence, gambling, mature content, unrestricted web access)

---

## Version Information

| Field          | Value            |
| -------------- | ---------------- |
| **Version**    | 1.0.0            |
| **Copyright**  | © 2026 Companion |
| **What's New** | Initial release  |

---

## Screenshots Required

Apple requires screenshots at these sizes. Use the Simulator or a real device.

| Device             | Size               | Required                      |
| ------------------ | ------------------ | ----------------------------- |
| iPhone 16 Pro Max  | 6.9" (1320 × 2868) | Yes                           |
| iPhone 8 Plus / SE | 5.5" (1242 × 2208) | Yes                           |
| iPad Pro 13" (M4)  | 13" (2064 × 2752)  | Yes (if supportsTablet: true) |

**Recommended screenshot sequence:**

1. Home dashboard (progress + streak)
2. Voice conversation in progress (waveform view)
3. Practice exercise (MCQ with explanation)
4. Pronunciation assessment results
5. Mock TCF test interface

---

## Review Notes (for App Review team)

```
This app uses microphone access for two features:
1. Voice conversation practice with the AI companion (real-time speech)
2. Pronunciation assessment (evaluates phoneme-level French pronunciation)

Test account:
Email: reviewer@companion.app
Password: CompanionReview2026!

The app requires an internet connection. All AI processing is performed server-side via secure Supabase Edge Functions. No OpenAI or Azure API keys are present in the client binary.

If you encounter any issues during review, please contact: review@companion.app
```
