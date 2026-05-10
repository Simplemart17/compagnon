---
stepsCompleted:
  [
    "step-01-init",
    "step-02-discovery",
    "step-02b-vision",
    "step-02c-executive-summary",
    "step-03-success",
    "step-04-journeys",
    "step-05-domain",
    "step-06-innovation",
    "step-07-project-type",
    "step-08-scoping",
    "step-09-functional",
    "step-10-nonfunctional",
    "step-11-polish",
    "step-12-complete",
  ]
classification:
  projectType: mobile_app
  domain: edtech
  complexity: medium
  projectContext: brownfield
inputDocuments:
  - CLAUDE.md
  - _bmad-output/project-context.md
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
  - docs/component-inventory.md
  - docs/source-tree-analysis.md
  - docs/development-guide.md
  - docs/deployment-guide.md
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 11
workflowType: "prd"
---

# Product Requirements Document — Companion

**Author:** Simplemart
**Date:** 2026-03-24
**Status:** Complete
**Project Type:** Mobile App (React Native / Expo SDK 55, iOS and Android)
**Domain:** EdTech — French Language Learning / TCF Exam Preparation
**Complexity:** Medium
**Project Context:** Brownfield — 36 screens, 11 database tables, 4 Edge Functions, full CI/CD

## Executive Summary

Companion is an AI-powered French language learning mobile app purpose-built for TCF (Test de Connaissance du Français) exam preparation. It provides a persistent, adaptive AI learning partner that delivers the immersive experience of practicing French in a francophone environment — accessible to anyone, anywhere, without geographic barriers.

The app targets self-learners preparing for the TCF exam: individuals pursuing Canadian or French immigration, university students, professionals seeking certification, and anyone studying French independently. Companion covers every TCF skill dimension — listening, reading, writing, grammar, speaking, vocabulary, and pronunciation — through AI-generated exercises calibrated to CEFR levels A1 through C2.

This is a brownfield product with a fully implemented MVP. The PRD formalizes the existing product and defines the next wave of features.

### What Makes This Special

Companion is not a gamified drill tool or a content library. It is a personalized learning partner that remembers the user — their strengths, recurring mistakes, conversation history, and personal context. The AI companion tracks error patterns across sessions and generates targeted micro-drills. It retrieves relevant memories during conversations to create continuity. It adapts exercise difficulty based on demonstrated skill.

The core insight: the biggest barrier to TCF success for self-learners isn't access to content — it's the absence of an adaptive practice partner who knows their history and can provide real-time correction across all exam dimensions. Companion fills that gap with AI that acts as a patient, knowledgeable tutor available on demand.

## Success Criteria

### User Success

- **TCF Score Improvement:** Measurable score improvement across TCF skill dimensions within 30 days of consistent practice (5+ sessions per week)
- **CEFR Level Progression:** Advance at least one CEFR level within 3 months of regular use, validated by in-app placement test and skill progress tracking
- **Confidence Moment:** Complete a 5+ minute voice conversation in French without switching to English
- **Exam Readiness:** Users who complete 3+ mock tests score within one CEFR level of their target before the real TCF
- **Habit Formation:** Maintain a 7+ day practice streak

### Business Success

- **Retention:** 40%+ Day-30 retention for users who complete onboarding
- **Engagement Depth:** 15+ minutes per session, 4+ sessions per week for active users
- **Feature Breadth:** Active users engage with 3+ skill types, validating the all-in-one value proposition
- **Organic Growth:** 20%+ of new users via word-of-mouth within 6 months of launch
- **App Store Rating:** 4.5+ star average on both iOS and Android

### Technical Success

- **AI Response Quality:** <5% error rate requiring exercise regeneration
- **Voice Latency:** Round-trip under 2 seconds (user stops speaking → AI starts responding)
- **Uptime:** Edge Functions at 99.5%+; graceful offline degradation via caching
- **Data Integrity:** Zero data loss across streak tracking, skill progress, and SRS scheduling

### Measurable Outcomes

| Metric                    | Target               | Timeframe   | Measurement                              |
| ------------------------- | -------------------- | ----------- | ---------------------------------------- |
| Onboarding completion     | 70%+                 | Ongoing     | Placement test completed after signup    |
| Weekly active users (WAU) | 60% of registered    | Month 3+    | 1+ session per week                      |
| CEFR promotion rate       | 30%+ of active users | Per quarter | In-app auto-promotion triggers           |
| Mock test completion      | 50%+ attempt rate    | Month 2+    | Started mock tests that are finished     |
| Conversation duration     | 5+ min average       | Ongoing     | Median voice session length              |
| Daily goal achievement    | 50%+ of active days  | Ongoing     | Users meeting self-set daily minute goal |

## Product Scope

### MVP (Current State — Implemented)

- Authentication, onboarding, and CEFR placement test
- Real-time voice conversations with AI companion (3 modes: companion, debate, TCF simulation)
- Structured exercises: listening, reading, writing, grammar (AI-generated, CEFR-calibrated)
- Pronunciation assessment (Azure Speech, phoneme-level)
- Dictation exercises with word-by-word comparison
- TCF mock tests (76 questions, 3 sections, progressive A1-C2 difficulty)
- SM-2 spaced repetition vocabulary with offline support
- Companion memory (pgvector RAG) and error pattern tracking
- Skill progress, streaks, daily activity tracking, CEFR auto-promotion
- Offline caching with write queue
- GDPR compliance (data export, account deletion)
- App store readiness (privacy policy, terms, metadata, CI/CD)

### Growth Features (Post-MVP)

See **Project Scoping & Phased Development** for detailed phased breakdown with priorities, dependencies, and team requirements.

### Vision (Future)

- **Multi-Exam Support:** DELF/DALF, TEF Canada, and other French proficiency exams
- **Multi-Language Platform:** Architecture supports additional languages (Spanish DELE, German Goethe, etc.)
- **Institutional/B2B:** Teacher dashboards, classroom management, bulk licensing
- **Advanced AI Tutor:** Long-term learning plan generation, adaptive weekly curriculum

## User Journeys

### Journey 1: Sofia — The Immigration Applicant (Core Success Path)

**Persona:** Sofia, 28, Brazilian software developer. Needs TCF B2 within 4 months for a Montreal job offer contingent on French proficiency. Speaks Portuguese and English; French is rusty from school years ago.

**Opening Scene:** Downloads Companion after failing to progress with Duolingo — can match pictures to words but can't hold a conversation or understand spoken French at natural speed. Anxious about the visa deadline; can't afford in-person tutoring in São Paulo.

**Rising Action:**

- Placement test assigns A2. Sets B2 target, 20 minutes daily.
- Day 1: First voice conversation on "Introducing yourself" — manages 3 minutes. Post-conversation feedback: grammar 2/5, fluency 3/5.
- Week 2: Rotates between grammar exercises (targeting "de/du/des" errors flagged by error tracker), listening, and daily conversations. Streak hits 14 days. Companion remembers her Montreal move and weaves it into conversations.
- Week 6: First mock test — reading B1, grammar B1, listening A2. Shifts focus to listening and dictation.
- Week 10: Auto-promoted to B1. Pronunciation accuracy: 78% (up from 52%).

**Climax:** Week 14: Scores B2 on mock test. Books real TCF. Chats for 8 minutes in French about her nervousness on the train to the test center — entirely in French.

**Resolution:** Passes TCF with B2. The persistent companion that remembered her story, tracked weaknesses, and adapted to her level made it feel like having a patient friend in Paris.

### Journey 2: Marc — The Returning User (Re-engagement Path)

**Persona:** Marc, 35, French-Canadian in Toronto. Grew up speaking French but hasn't used it in a decade. Employer requires TCF C1 for a promotion. Used Companion for one week 3 months ago, then dropped off.

**Opening Scene:** Reopens the app after 3 months. Worried he'll have to start over.

**Rising Action:**

- Profile, skill progress (B1), and vocabulary intact. 47 SRS cards due for review.
- Companion greets him: "Ça fait longtemps, Marc! Comment ça va à Toronto?" Remembered his city and register preference.
- Mock test benchmark: reading/grammar B2, listening/speaking B1. Receptive skills outpace productive.
- Focuses on debate mode conversations and formal writing. Error tracker catches anglicisms ("faire du sens" → "avoir du sens").

**Climax:** Scores C1 in reading/grammar, B2 in listening/speaking. Decade of passive exposure + structured reactivation = rapid progress.

**Resolution:** Achieves C1. Zero-friction return — preserved progress, companion memory continuity — was why he came back instead of trying a different app.

### Journey 3: Amina — The Complete Beginner (A1 Onboarding Path)

**Persona:** Amina, 22, Moroccan student in Casablanca. Speaks Arabic and English. Needs TCF B1 for a French university master's program in 8 months. Zero French.

**Opening Scene:** Overwhelmed by learning French from scratch. YouTube videos assume basic knowledge she doesn't have.

**Rising Action:**

- Placement test: A1. Sets B1 target, 15 minutes daily.
- Day 1: Grammar exercises with simple structures — scores 40% but learns from explanations. Voice conversation on "Greetings" — AI speaks slowly, celebrates attempts.
- Week 3: Pronunciation practice reveals struggling with French "r" and nasal vowels. Accuracy climbs from 35% to 60%.
- Week 8: Promoted to A2. Dictation becomes her favorite — connecting sounds to spelling is especially challenging from Arabic script.
- Month 4: Fails first mock test (A2 overall). Reading at B1 — her strongest skill. Doubles down on listening and speaking.

**Climax:** Month 7: Scores B1 across all sections. Error patterns dropped from 12 to 3.

**Resolution:** Submits TCF B1 with university application. Companion took her from zero to B1 by meeting her where she was and never overwhelming her.

### Journey 4: Thomas — The Advanced Plateaued Learner (B2-C1 Refinement Path)

**Persona:** Thomas, 41, British accountant in Lyon for 5 years. Speaks functional French daily but keeps making the same mistakes. Colleagues have stopped correcting him. Needs TCF C1 for citizenship.

**Opening Scene:** Frustrated — can survive in French but knows it's full of fossilized errors. Needs honest correction.

**Rising Action:**

- Placement test: B2. Sets C1 target, 20 minutes daily.
- Day 1: Debate mode — AI immediately flags preposition errors ("penser à" not "penser de"), register mixing, false friends. Grammar 3/5, fluency 4/5.
- Week 2: Error tracker identifies 8 recurring patterns. Grammar screen generates B2-C1 precision micro-drills — not generic A1 exercises.
- Week 4: Writing scores reveal weak lexical richness (14/25) and register (15/25). AI suggests specific connectors and formal expressions.
- Week 8: Companion discusses his life in Lyon — tax season, son's school, local politics — while catching weaknesses.

**Climax:** Week 12: C1 in reading, grammar, writing. Error patterns dropped from 8 to 2. First grammar 4/5 in conversation feedback.

**Resolution:** Earns C1, applies for citizenship. App succeeded where 5 years of immersion didn't — systematic tracking and drilling of fossilized errors broke through his plateau.

### Journey Requirements Summary

| Capability                         | Sofia      | Marc                | Amina            | Thomas             |
| ---------------------------------- | ---------- | ------------------- | ---------------- | ------------------ |
| Placement test & onboarding        | Critical   | —                   | Critical         | Critical           |
| Voice conversation (multi-mode)    | Core daily | Core daily          | Gradual adoption | Core daily         |
| CEFR-calibrated exercises          | Core       | Targeted            | Core             | Precision-targeted |
| Error tracking & micro-drills      | High       | High                | Moderate         | Highest            |
| Companion memory                   | Engagement | Re-engagement       | Motivation       | Relevance          |
| Mock tests & score breakdown       | Benchmark  | Benchmark           | Benchmark        | Benchmark          |
| Pronunciation assessment           | Supporting | —                   | Critical         | Supporting         |
| Dictation                          | Supporting | —                   | High             | —                  |
| SRS vocabulary                     | Supporting | Re-engagement entry | Core             | —                  |
| Offline caching                    | —          | Critical            | —                | —                  |
| Writing evaluation                 | Moderate   | High                | Moderate         | Critical           |
| Speech-to-speech translation (new) | High       | —                   | Critical         | Moderate           |

## Domain-Specific Requirements

### Compliance & Regulatory

- **Age Restriction:** 13+ target. App Store and Play Store age ratings must reflect this. Terms of Service states minimum age. No COPPA compliance required.
- **GDPR (Implemented):** Data export and account deletion via `account-delete` Edge Function. All user data cascades on deletion. Privacy policy and terms in-app.
- **Data Retention:** Inactive accounts (no login for 6 months) auto-deleted with all data. 30-day warning email before deletion with reactivation option.
- **FERPA:** Not applicable unless institutional/B2B tier is introduced (Vision scope).

### Content Quality & Linguistic Accuracy

- **AI Content Validation:** All AI-generated French content passes structural validation (MCQ: exactly 4 options, 1 correct). Exercise generation uses temperature 0.4.
- **Linguistic Review:** AI-generated prompts reviewed for grammatical accuracy, CEFR calibration, and natural French usage. Known issues tracked and corrected in prompt builders.
- **CEFR Alignment:** Exercise difficulty, vocabulary frequency, and grammatical structures align with published CEFR descriptors. TCF question counts (29/29/18) and scoring bands match official exam specifications.
- **Content Moderation:** AI conversation responses remain educational, appropriate, and on-topic. System prompts enforce pedagogical boundaries.

### Technical Constraints

- **User Data Isolation:** All database tables enforce RLS with `auth.uid() = user_id`.
- **API Key Security (Implemented):** All AI API keys stored server-side in Supabase Edge Function secrets. Client bundle contains only public Supabase URL and anon key.
- **Rate Limiting (Implemented):** All Edge Functions enforce per-user rate limits (10-30 req/min).
- **Offline Data Security:** Cached data scoped to authenticated user. Auth tokens in native secure storage (expo-secure-store).

## Innovation & Novel Patterns

### Meta-Innovation: The Learner as One Person

Companion treats the learner as **one person with one learning profile**, not separate users of separate drill tools. Memory, error tracking, cross-skill progression, and personalized conversations express a single principle: the AI knows you, remembers you, and adapts to you across every dimension.

### Detected Innovation Areas

| Rank | Innovation                           | Type             | Defensibility       | Status                                                                  |
| ---- | ------------------------------------ | ---------------- | ------------------- | ----------------------------------------------------------------------- |
| 1    | **Persistent learning relationship** | First-principles | High (12-18 months) | Implemented — social memory needs management UI                         |
| 2    | **Closed-loop error correction**     | Process          | High (12+ months)   | Partially implemented — loop open (detect → drill); verification needed |
| 3    | **Voice-first translation practice** | Format           | Medium (3-6 months) | Planned — scoped to A1-B1; paraphrasing at B2+                          |
| 4    | **Unified cross-skill intelligence** | Aspirational     | Low today           | Architecture supports it; cross-skill wiring incomplete                 |

**Persistent learning relationship:** The first consumer language app where the AI genuinely knows you over time — your goals, story, and weaknesses across months of practice. Social memory (personal facts) must be distinguished from learning memory (error patterns, skill data). Users need ability to view/delete memories. Privacy implications for 13-17 users require careful handling.

**Closed-loop error correction:** Mistakes in conversation become targeted exercises; errors in writing inform speaking corrections. Current state: loop is open (detect → drill). Growth milestone: "resolved" = error absent from 5 consecutive conversations after drill completion.

**Voice-first translation practice:** Users hear native language, produce spoken French, receive AI evaluation of accuracy/fluency/naturalness. No competitor offers this in structured CEFR-calibrated format. Scoped to A1-B1; shifts to L2 paraphrasing at B2+ (translation reinforces L1→L2 pathways, counterproductive for advanced learners).

**Unified cross-skill intelligence:** Aspiration that performance in one skill informs another. CEFR auto-promotion requires multi-skill breadth, but skills don't deeply inform each other at the practice level yet. Strongest future expression: "Practice Now" button where AI decides optimal next activity.

### SCAMPER-Discovered Opportunities

| Discovery                   | Description                                              | Impact    | Feasibility |
| --------------------------- | -------------------------------------------------------- | --------- | ----------- |
| **Echo Practice**           | Listen + speak + type = 3 skills scored simultaneously   | High      | High        |
| **Tutor-directed practice** | "Practice Now" — AI picks optimal next activity          | Very High | Medium      |
| **Exam Day Prep**           | Personalized pre-exam review from learning history       | High      | High        |
| **Reverse correction**      | AI makes mistakes; user corrects them                    | Medium    | High        |
| **Scenario-on-demand**      | Practice conversations for real upcoming situations      | High      | Medium      |
| **Narrative continuity**    | Companion remembers conversation threads, not just facts | High      | Medium      |

### Competitive Landscape

| Innovation                       | Companion | Nearest Competitor | Gap |
| -------------------------------- | --------- | ------------------ | --- |
| Persistent learning relationship | 30/30     | ChatGPT (10/30)    | +20 |
| Closed-loop error correction     | 33/39     | Duolingo (11/39)   | +22 |
| Unified cross-skill intelligence | 29/39     | Duolingo (11/39)   | +18 |
| Voice-first translation          | 30/30     | None (0/30)        | +30 |

**Strategy:** Lead with voice translation to attract users (easy to demo, shallowest moat), retain them with memory and error tracking (deepest moats, hardest to replicate).

### Innovation Validation

| Innovation               | Validation Method                           | Success Signal                                  |
| ------------------------ | ------------------------------------------- | ----------------------------------------------- |
| Persistent memory        | A/B test: memory-enabled vs. stateless      | Higher conversation duration and return rate    |
| Error correction         | Cohort: drill completers vs. non-completers | Lower error recurrence rate                     |
| Voice translation        | Usage metrics post-launch                   | 30%+ A1-B1 engagement in first 2 weeks          |
| Cross-skill intelligence | Before/after "Practice Now" ships           | Faster CEFR promotion with AI-directed practice |

## Mobile App Specific Requirements

### Platform Requirements

| Requirement      | Specification                                           |
| ---------------- | ------------------------------------------------------- |
| **Framework**    | React Native 0.83 + Expo SDK 55 (managed workflow)      |
| **Platforms**    | iOS + Android from single codebase                      |
| **Form factor**  | Phone only — no tablet optimization                     |
| **Minimum OS**   | Expo SDK 55 defaults for maximum backward compatibility |
| **Language**     | App UI in English; learning content in French           |
| **Orientation**  | Portrait only                                           |
| **Build system** | EAS — development, preview, production profiles         |

### Device Permissions

| Permission         | Purpose                                                    | Required           |
| ------------------ | ---------------------------------------------------------- | ------------------ |
| **Microphone**     | Voice conversations, pronunciation, dictation, translation | Yes — core         |
| **Internet**       | AI API calls, Supabase, auth                               | Yes — primary mode |
| **Secure storage** | Auth tokens via expo-secure-store                          | Yes — automatic    |
| **AsyncStorage**   | Offline cache, SRS write queue                             | Yes — automatic    |

No camera, location, contacts, Bluetooth, or other hardware permissions required.

### Offline Mode

| Capability               | Offline Behavior                                                   |
| ------------------------ | ------------------------------------------------------------------ |
| Profile & skill data     | Cached with TTL (profile: 4h, skills: 30m, activity: 15m)          |
| Vocabulary SRS review    | Fully functional — ratings queued, flushed on reconnect            |
| Exercise generation      | Unavailable — requires AI API                                      |
| Voice conversations      | Unavailable — requires WebSocket                                   |
| Pronunciation assessment | Unavailable — requires Azure Speech                                |
| Mock tests               | In-progress viewable from cache; new tests require API             |
| Network detection        | NetworkBanner displays offline indicator; auto-flushes write queue |

### Push Notifications (Post-MVP)

- **Planned:** Streak-at-risk alerts, SRS review nudges, daily goal reminders, inactive account deletion warning (30-day notice)
- **Infrastructure:** Not implemented — requires expo-notifications, push token registration, server-side delivery
- **MVP state:** No push notifications. Engagement via in-app streaks and daily goals.

### Store Compliance

| Requirement            | Status                                                         |
| ---------------------- | -------------------------------------------------------------- |
| iOS App Store metadata | Ready (`store/ios-metadata.md`)                                |
| Google Play metadata   | Ready (`store/android-metadata.md`)                            |
| Age rating             | 13+                                                            |
| Privacy policy         | In-app at auth and profile screens                             |
| Terms of service       | In-app at auth and profile screens                             |
| Data export            | Available in profile settings (GDPR)                           |
| Account deletion       | Via `account-delete` Edge Function (GDPR)                      |
| Content policy         | AI educational content only; system prompts enforce boundaries |
| Review notes           | Demo account and AI feature explanations prepared              |

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Experience MVP — the existing codebase delivers a complete learning experience across all TCF dimensions. Not a stripped-down prototype; a full product validating whether an AI companion can replace francophone immersion.

**Resources:** Solo developer for MVP launch. Collaborators planned for Phase 2+.

**Immediate Milestone:** App Store and Google Play submission.

**Launch Blockers:**

1. `eas init` → update `app.json` with projectId
2. Create Sentry project → add DSN to `.env.local` and `app.json`
3. Add `EXPO_TOKEN` secret to GitHub for CI/CD
4. Set Supabase secrets: `OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
5. Deploy Edge Functions and apply database migrations
6. Submit to App Store and Google Play

### Phase 1: MVP Launch (Current → App Store)

All 4 user journeys fully supported. All capabilities implemented (see MVP scope above).

### Phase 2: Growth (Months 1-3 post-launch)

**Goal:** Strengthen core innovation claims; add first net-new feature no competitor offers.

| Feature                          | Priority | Rationale                                                | Risk                                 |
| -------------------------------- | -------- | -------------------------------------------------------- | ------------------------------------ |
| **Speech-to-Speech Translation** | P0       | Highest marketing differentiation; complete white space  | Medium — new exercise type           |
| **Echo Practice**                | P0       | Proves cross-skill intelligence with existing components | Low — combines existing features     |
| **Notification Engine**          | P1       | Critical for retention via streak/SRS nudges             | Low — well-documented infrastructure |

**Team:** Solo can ship Echo Practice + Notifications. Speech-to-speech benefits from a collaborator.

### Phase 3: Intelligence & Monetization (Months 4-12)

**Goal:** Deepen the moat, close error correction loop, introduce revenue.

| Feature                           | Priority | Rationale                                                                     |
| --------------------------------- | -------- | ----------------------------------------------------------------------------- |
| **Tutor-Directed "Practice Now"** | P0       | Strongest expression of unified cross-skill intelligence                      |
| **Exam Day Prep**                 | P1       | High-emotion feature leveraging existing data; viral potential                |
| **Monetization (Subscriptions)**  | P1       | Free tier with limits; premium unlimited. Required for sustainability.        |
| **Memory Management UI**          | P1       | View/delete memories. Required for privacy (especially 13-17 users).          |
| **Error Correction Verification** | P2       | Closes open error loop. "Resolved" = absent from 5 consecutive conversations. |

**Team:** 2-3 collaborators: mobile engineer, backend/AI engineer, UX review.

### Phase 4: Expansion (Backlog)

Sequencing depends on user feedback and metrics from Phases 2-3.

- Social/Community (leaderboards, study groups)
- Content Library (curated French media, CEFR-graded)
- Onboarding Improvements (guided first conversation, tutorials)
- Reverse Correction exercises
- Scenario-on-Demand practice
- Narrative Continuity across conversations

### Risk Mitigation

**Technical Risks:**

| Risk                                   | Impact                          | Mitigation                                                                         |
| -------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Speech-to-speech evaluation quality    | Inaccurate translation feedback | Technical spike in first 2 weeks; start with sentence-level before complex grammar |
| AI generates incorrect French          | User learns wrong patterns      | Temperature 0.4, structural validation, explicit linguistic rules in prompts       |
| Notification deliverability            | Push notifications unreliable   | expo-notifications + delivery monitoring; fallback to in-app badges                |
| "Practice Now" recommendation accuracy | Wrong activity erodes trust     | Start with simple heuristics, iterate toward ML-based                              |
| OpenAI/Azure API outage                | Core features unavailable       | Graceful offline degradation; retry with backoff; clear user messaging             |
| Mock test timer drift                  | Unfair test conditions          | Absolute time (Date.now()), not interval decrement                                 |

**Market Risks:**

| Risk                             | Impact                        | Mitigation                                                                                      |
| -------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Low initial downloads            | No user base to validate      | Pre-launch: TCF forums, French learner communities, immigration forums. Free tier.              |
| Users only use conversation mode | All-in-one value not realized | Track feature breadth metric; surface skills via home quick actions and future "Practice Now"   |
| Competitor launches similar AI   | Moat eroded                   | Ship Phase 2 within 3 months. Deepest moats (memory + error loop) take 12+ months to replicate. |

**Resource & Compliance Risks:**

| Risk                                      | Impact                  | Mitigation                                                                        |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| No collaborators for Phase 2              | Bottleneck              | Echo Practice + Notifications solo-shippable. Translation deferrable.             |
| AI API costs pre-monetization             | Unsustainable burn      | Rate limits in place. Monitor per-user cost. Reduce free tier limits if needed.   |
| App store rejection                       | Delayed launch          | Review notes prepared. Privacy/terms in-app. AI content moderation.               |
| Memory surfaces unwanted personal context | User trust loss         | Memory management UI; separate social vs. learning memory; age policies for 13-17 |
| Inactive account data accumulation        | Storage/compliance risk | Auto-deletion after 6 months with 30-day warning email                            |
| User data breach                          | Privacy violation       | RLS, server-side keys, JWT validation, no PII in logs                             |

## Functional Requirements

**Scope:** Phase 1 (MVP — implemented) and Phase 2 (planned). Phase 3+ features formalized when development is imminent.

### Authentication & Onboarding

- **FR1:** Users can create an account with email and password
- **FR2:** Users can sign in and sign out
- **FR3:** Users can reset their password via email
- **FR4:** Users can complete a 3-step onboarding wizard (CEFR level, learning goal, daily time target)
- **FR5:** Users can take a 15-question AI-generated placement test assessing 4 linguistic competencies
- **FR6:** Users can view privacy policy and terms of service in-app

### Voice Conversations

- **FR7:** Users can start a voice conversation on a selected topic
- **FR8:** Users can choose conversation mode: companion, debate, or TCF simulation
- **FR9:** Users can speak and receive real-time AI voice responses via full-duplex audio
- **FR10:** Users can view a live text transcript during conversation
- **FR11:** Users receive inline corrections with category labels and explanations
- **FR12:** Users can view post-conversation AI feedback (fluency rating, grammar rating, strengths, improvements)
- **FR13:** The system retrieves companion memories before each conversation for personalization
- **FR14:** The system extracts and stores new facts from conversations as memories
- **FR15:** The system detects and logs error patterns from corrections

### Structured Exercises

- **FR16:** Users can generate exercises for listening, reading, writing, and grammar at their CEFR level
- **FR17:** Users can answer MCQ with 4 options and receive feedback with explanations
- **FR18:** Users can complete writing tasks with 4-dimension AI evaluation and rewrite suggestion
- **FR19:** Users can view original text alongside AI corrections in writing exercises
- **FR20:** Users can receive targeted micro-drills generated from tracked error patterns
- **FR21:** The system validates AI-generated MCQ content (4 options, 1 correct)

### Pronunciation Assessment

- **FR22:** Users can record speech and receive phoneme-level pronunciation assessment
- **FR23:** Users can view word-by-word accuracy with error type indicators
- **FR24:** Users can track weak sounds across assessment history

### Dictation

- **FR25:** Users can listen to AI-generated sentences at normal and slow speeds
- **FR26:** Users can type what they hear and receive word-by-word color-coded comparison
- **FR27:** The system feeds dictation errors into error pattern tracking

### TCF Mock Tests

- **FR28:** Users can take full mock tests (76 questions, 3 sections, A1-C2 progressive difficulty)
- **FR29:** Users can take individual section tests
- **FR30:** Users can view results with per-section CEFR breakdown and TCF 0-699 score
- **FR31:** Users can resume interrupted mock tests
- **FR32:** Users see unanswered question count before submitting

### Vocabulary & Spaced Repetition

- **FR33:** Users can review vocabulary using SM-2 spaced repetition flashcards
- **FR34:** Users can rate recall quality (0-5) to adjust scheduling
- **FR35:** Users can review vocabulary offline with ratings queued for sync
- **FR36:** Users can view full word list with translations, context, and CEFR level

### Progress & Analytics

- **FR37:** Users can view per-skill progress scores and CEFR levels
- **FR38:** Users can view daily activity tracking
- **FR39:** Users can maintain and view practice streaks with daily goal achievement
- **FR40:** The system auto-promotes CEFR level at 10+ exercises across 3+ skills with 85%+ average
- **FR41:** Users can view CEFR progression chart with target level indicator
- **FR42:** Users can view error patterns and navigate to targeted micro-drills

### Profile & Settings

- **FR43:** Users can view profile with stats, skills, CEFR chart, and errors
- **FR44:** Users can edit target level, daily goal, and preferences with confirmation
- **FR45:** Users can export personal data (GDPR)
- **FR46:** Users can delete account and all data (GDPR)
- **FR47:** Users can view app version number

### Conversation History

- **FR48:** Users can browse past conversations with date, topic, and duration
- **FR49:** Users can view full transcript of past conversations including corrections

### Offline & Data Resilience

- **FR50:** The system caches profile, skills, and activity with TTL-based expiration
- **FR51:** The system displays offline indicator when disconnected
- **FR52:** The system queues offline writes and syncs on reconnection

### Phase 2: Speech-to-Speech Translation (Planned)

- **FR53:** Users can hear a sentence in their native language and speak the French translation
- **FR54:** The system evaluates spoken translation for accuracy, fluency, and naturalness
- **FR55:** Exercise difficulty is CEFR-calibrated (A1-B1; L2 paraphrasing at B2+)

### Phase 2: Echo Practice (Planned)

- **FR56:** Users can listen to a sentence, repeat it aloud, and type it in one exercise
- **FR57:** The system scores listening comprehension, pronunciation, and spelling

### Phase 2: Notifications (Planned)

- **FR58:** Users receive streak-at-risk push notifications
- **FR59:** Users receive SRS vocabulary review push notifications
- **FR60:** Users can manage notification preferences

## Non-Functional Requirements

### Performance

- **NFR1:** Voice round-trip latency under 2 seconds
- **NFR2:** Exercise generation within 5 seconds
- **NFR3:** TTS playback begins within 3 seconds
- **NFR4:** Cold start to home screen within 3 seconds on 4-year-old devices
- **NFR5:** Animations at 60fps with no jank
- **NFR6:** Cached data loads within 500ms from AsyncStorage
- **NFR7:** Mock test timer drift under 1 second per 30 minutes

### Security

- **NFR8:** AI API keys stored server-side only — never in client bundle
- **NFR9:** All tables enforce RLS with `auth.uid()` scoping
- **NFR10:** Auth tokens in native secure storage, not AsyncStorage
- **NFR11:** All Edge Functions validate JWT before processing
- **NFR12:** All Edge Functions enforce per-user rate limits
- **NFR13:** Model parameter allowlists on Edge Functions
- **NFR14:** SECURITY DEFINER functions use `SET search_path = public`
- **NFR15:** No PII in console, Sentry, or client-side logs

### Accessibility

- **NFR16:** All interactive elements have `accessibilityLabel` and `accessibilityRole`
- **NFR17:** Touch targets at least 44x44 points
- **NFR18:** WCAG 2.1 AA contrast ratios (4.5:1 body, 3:1 large text)
- **NFR19:** Dynamic Type / system font scaling without layout breakage
- **NFR20:** Skeleton animations for loading states

### Integration

- **NFR21:** OpenAI retries with exponential backoff for retryable errors
- **NFR22:** Azure Speech graceful degradation with informative error
- **NFR23:** Session expiry redirects to login without data loss
- **NFR24:** Network changes surfaced within 2 seconds
- **NFR25:** Offline write queue auto-flushes on reconnection without duplicates

### Reliability

- **NFR26:** Edge Functions at 99.5%+ availability with graceful cache fallback
- **NFR27:** Zero data loss for streaks, progress, SRS, and exercise results
- **NFR28:** Interrupted mock tests resumable from exact question
- **NFR29:** Back-press confirmation on active conversations and mock tests
- **NFR30:** All unhandled errors captured to Sentry with context tags

### Content Quality

- **NFR31:** Exercise generation temperature ≤ 0.4
- **NFR32:** MCQ validation: exactly 4 options, exactly 1 correct
- **NFR33:** AI responses educational, 13+-appropriate, on-topic
- **NFR34:** TCF question distribution: listening 29, reading 29, grammar 18
