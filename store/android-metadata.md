# Google Play Console — Android Metadata

Paste these values into Google Play Console when creating your store listing.

---

## Identity

| Field                | Value                    |
| -------------------- | ------------------------ |
| **App Name**         | Companion – Learn French |
| **Package Name**     | com.compagnon.android    |
| **Default Language** | English (United States)  |

---

## Short Description (80 char max)

```
AI French tutor for TCF exam prep. Voice practice, pronunciation, exercises.
```

---

## Full Description (4,000 char max)

```
Master French with an AI tutor that actually listens.

Companion uses advanced AI to help you practice real French — the kind you need for the TCF exam and everyday life. Whether you're a complete beginner or polishing your C1 for a visa application, Companion adapts to your exact level and keeps you on track.

🎙️ VOICE CONVERSATIONS
Talk with your AI companion in French, any time. Choose a topic — ordering at a café, debating French cinema, or simulating a job interview — and have a genuine back-and-forth conversation. The AI speaks at your level, introduces vocabulary naturally, and gives you a correction summary after each session — never mid-sentence.

🔊 PRONUNCIATION ASSESSMENT
Get phoneme-level feedback on your French pronunciation. Companion identifies your specific weak sounds — the French "r", nasals, liaison — and tracks your improvement over time.

📝 TCF EXAM PRACTICE
Structured practice for all five TCF skills:
• Listening comprehension
• Reading comprehension
• Grammar & vocabulary
• Writing expression
• Speaking expression

Exercises are generated fresh every session and calibrated to your CEFR level (A1 → C2). Full mock TCF tests with real timing and score simulation are available when you're ready to test yourself.

🧠 PERSONALISED TO YOU
Companion remembers what you talk about, your vocabulary gaps, and your recurring mistakes — and uses that knowledge to make every session more relevant. Your error patterns automatically become targeted micro-drill exercises so you fix real problems, not imaginary ones.

📚 SPACED REPETITION VOCABULARY
Every word you learn during conversations is saved and reviewed at the scientifically proven optimal interval (SM-2 algorithm). Build lasting vocabulary without flashcard fatigue.

📊 PROGRESS TRACKING
Track your daily streak, weekly activity, and skill-by-skill progress. See exactly where you are on the A1–C2 scale and how far you are from your target.

🔒 PRIVACY FIRST
Your API keys and sensitive data never leave our servers. Audio is processed in real-time and not stored after sessions. All data is protected by end-to-end encryption and strict access controls.

Companion is built for serious French learners. Download it and start speaking today.
```

---

## Store Listing Assets

### Icon

- **Size:** 512 × 512 px
- **Format:** PNG (no transparency)
- Source: `assets/images/icon.png` — ensure it is 512×512 and high resolution

### Feature Graphic (required)

- **Size:** 1024 × 500 px
- **Format:** PNG or JPEG
- Design guidance: Navy (#1E3A5F) background, Companion wordmark in white, brief tagline in amber (#F5A623). No screenshots or text smaller than 16px.

### Screenshots

- **Min:** 2 screenshots per form factor
- **Recommended device:** Pixel 9 Pro (or any modern Android)
- **Sizes accepted:** 16:9 or 9:16 ratio, min 320px on shortest side

**Recommended screenshot sequence:**

1. Home dashboard (progress + streak)
2. Voice conversation in progress
3. Practice exercise (MCQ)
4. Pronunciation feedback
5. Mock TCF test

---

## Categorisation

| Field                | Value                                           |
| -------------------- | ----------------------------------------------- |
| **Application type** | Apps                                            |
| **Category**         | Education                                       |
| **Tags**             | language learning, French, TCF, CEFR, exam prep |

---

## Content Rating

Complete the IARC rating questionnaire:

- Violence → None
- Sexual content → None
- Profanity → None
- Controlled substances → None
- User-generated content → **Yes** (voice conversations, written exercises)
- Data sharing → **Yes** (voice sent to Azure; text sent to OpenAI — disclose in questionnaire)

Expected rating: **Everyone (E)**

---

## Privacy Policy URL (required)

```
https://companion.app/privacy
```

---

## Data Safety Section

Go to **App content → Data safety** and declare:

### Data collected

| Data type                   | Collected | Shared                                                       | Purpose                      |
| --------------------------- | --------- | ------------------------------------------------------------ | ---------------------------- |
| Email address               | Yes       | No                                                           | Account registration         |
| Name                        | Yes       | No                                                           | Profile personalisation      |
| Voice or sound recordings   | Yes       | Yes (Microsoft Azure, OpenAI)                                | Pronunciation & conversation |
| In-app messages/transcripts | Yes       | Yes (OpenAI)                                                 | AI conversation              |
| App interactions            | Yes       | Yes (PostHog — anonymised usage events, opaque user ID only) | Analytics                    |
| Crash logs                  | Yes       | Yes (Sentry)                                                 | App stability                |

> **Sentry scope clarification:** Crash logs sent to Sentry are tagged only with the user's opaque `auth.uid()`. We do not share email, screenshots, conversation transcripts, French text content, or request bodies with Sentry. Only OS version, app version, stack traces, and short structured tags (e.g. error category, status code) are transmitted.

### Data security

- Data encrypted in transit: **Yes**
- Data encrypted at rest: **Yes**
- Users can request deletion: **Yes** (via privacy@companion.app)

---

## Permissions Declaration

| Permission     | Declared purpose                                         |
| -------------- | -------------------------------------------------------- |
| `RECORD_AUDIO` | Voice conversation practice and pronunciation assessment |
| `INTERNET`     | All AI features require a server connection              |

---

## Release Notes (What's new)

```
Initial release of Companion — your AI French tutor.

• Voice conversation practice with real-time AI
• Pronunciation assessment with phoneme-level feedback
• TCF-calibrated exercises for all 5 skills
• Full mock TCF tests
• Spaced repetition vocabulary (SM-2)
• Progress tracking and daily streaks
```
