# Companion v2 Vision Roadmap — Conversation Buddy, Curriculum & Market Readiness

**Date:** 2026-07-18
**Status:** Draft for operator review — feeds `bmad-create-epics-and-stories` / `bmad-sprint-planning`
**Relationship to `shippable-roadmap.md`:** that document (Epics 9–17) took the app from prototype to code-complete. This document plans everything AFTER: (1) the consolidated gap register from the 2026-07-18 shippability + market-standard + efficacy analyses, and (2) the operator's v2 product vision — a human-like conversation buddy, bilingual corrections, proactive nudging, and an in-app A1→C2 curriculum.

**Operator strategy (binding):** dogfood-first. The operator is user #1 and must be personally satisfied before selling on personal evidence. Sequencing below optimizes for "makes daily personal use satisfying" first, "makes it sellable" second.

---

## 0. The prerequisite nobody can skip: Phase 0 — Deploy to your own phone

Nothing in this roadmap can be personally validated until the app runs in production. These are the already-identified blockers (see `runbooks/ship-readiness-checklist.md` §B), restated as the Phase 0 checklist:

1. `supabase link` + `supabase db push` (all 16 migrations — every RPC 500s without them)
2. `supabase secrets set OPENAI_API_KEY / AZURE_SPEECH_KEY / AZURE_SPEECH_REGION / CRON_SECRET`
3. Enable `pg_cron` + `pg_net`; seed Vault (`project_url`, `cron_secret`) — required for nudge notifications (Epic 18.3 depends on this)
4. `supabase functions deploy` all 6 Edge Functions
5. Supabase dashboard auth policy (password Layer 2 + email-confirm ON) — fill decision logs in `auth-password-policy.md` / `auth-email-verification.md`
6. Complete Story 16-1 operator tasks O1–O5 → **first TestFlight build on the operator's device**
7. Story 16-2 rollback rehearsal (one OTA publish + one rollback)

**Exit criterion:** the operator has a working conversation on their own phone, installed via TestFlight, against production Supabase. Estimated effort: 1–2 operator days (mostly account/credential work).

---

## 1. Consolidated gap register (from the 2026-07-18 analyses)

Every identified gap, mapped to where it gets worked. Nothing is left unassigned.

| # | Gap | Source analysis | Planned home |
| --- | --- | --- | --- |
| G1 | Migrations/secrets/functions/dashboard never applied | Shippability §B | **Phase 0** |
| G2 | No TestFlight build ever; store submission not started | Shippability | Phase 0 + Epic 16.9 |
| G3 | Epic 16 backlog: deploy automation, source maps, staging, rollback playbook, fn-error→Sentry, uptime | Shippability | **Epic 16 (existing, finish as planned)** |
| G4 | No beta with real users | Shippability #7 | Phase 3 (Epic 16.10) |
| G5 | Device perf claims unverified (all "estimate-only" rows in CLAUDE.md index) | Shippability | Phase 0 exit + `device-perf-profiling.md` runbook pass |
| G6 | No monetization (payments/tier/paywall) | Market-standard | **Epic 21.1** |
| G7 | No product analytics (retention/funnels invisible) | Market-standard | **Epic 21.2** (pulled EARLY — Phase 1, to measure dogfooding) |
| G8 | No feature flags / remote kill switch on OpenAI dependency | Market-standard | **Epic 21.3** |
| G9 | No website / hosted privacy policy / support channel (store metadata points at placeholder `companion.app` URLs) | Market-standard | **Epic 21.4** |
| G10 | No staging, uptime, alerting, load posture | Market-standard | Epic 16.5/16.8 (existing) |
| G11 | Uncalibrated TCF score presented with no disclaimer (immigration stakes) | Efficacy | **Epic 20.1** (quick win — do in Phase 1) |
| G12 | No outcome feedback loop (real TCF results never collected) | Efficacy | **Epic 20.2** |
| G13 | Item difficulty never calibrated; infinite fresh generation | Efficacy | **Epic 20.3 + 19.4** |
| G14 | Speaking "score" is an engagement heuristic; mock-test pronunciation graded from a Whisper transcript | Efficacy | **Epic 20.4** |
| G15 | Whisper auto-corrects learner errors (evaluator never sees mistakes) | Efficacy | **Epic 20.5** (investigation + mitigation) |
| G16 | gpt-realtime-mini correction quality never measured vs full model | Efficacy | **Epic 20.6** (dogfood A/B — operator uses full model, judges delta) |
| G17 | Existing filed backlog: P2-19 SRS lapse, P2-20 SRS coverage, P2-23 deps-disables, P2-24 screen decomposition, P2-25 dictation apostrophe, 12-9 read-side gap, 12-11 patch sweep, 12-X pgTAP CI, 16-11 SDK 57 | Prior audits | **Epic 22** (long-tail sweep) — EXCEPT P2-25 (dictation apostrophe) which is a French-correctness bug → pull into Phase 1 |
| G18 | Maestro E2E selectors are TODO, not CI-wired | Shippability | Epic 22 (with 15-3 follow-up) |
| G19 | Quarterly refreshes due 2026-08-12 (cost table + vuln review); moderates grew 4→12 | Shippability | Standing operator calendar item |

---

## 2. New vision epics

### Epic 18 — Conversation Buddy 2.0 (the core of the v2 vision)

**Goal:** the conversation screen feels like talking to a close friend who happens to be a brilliant French tutor — a visible companion who drives the conversation, corrects you kindly, explains in French AND English, and nudges you to talk every day.

**What already exists (do not rebuild):** Realtime voice loop, `report_correction` tool-call protocol (11-1), reconnect + barge-in (11-2), pgvector memory + error patterns injected into the prompt (9-4/11-7), post-conversation analysis (11-5), transcript UX (13-1/13-5).

**Deliverables:**

- **18.1 Persona & conversation-driver upgrade** (prompt + light schema work, ~3–4 days)
  - Named, consistent persona with warmth and a "close pal" register (operator to choose name/voice).
  - Conversation-driving policy in the system prompt: always end turns with a question or invitation; steer topics from stored memories ("Tu m'avais parlé de ton entretien — comment ça s'est passé ?"); re-engage on short answers; graceful topic changes.
  - Silence handling: after N seconds of user silence mid-session, the AI re-prompts naturally (a "relance") instead of sitting idle. Uses existing VAD events; needs a client-side silence timer + one `response.create` nudge path in the orchestrator.
  - AC: in a 10-minute session the AI initiates ≥ 2 topics and the conversation never dead-ends; turns-per-session measurably increases (PostHog, see 21.2).

- **18.2 Bilingual correction explanations** (~3–4 days)
  - Extend `reportCorrectionArgsSchema` + the `report_correction` tool definition with `explanation_fr` + `explanation_en` (both required, short).
  - CEFR-adaptive delivery policy in the prompt: A1–A2 → English-primary explanation spoken/shown; B1 → bilingual; B2+ → French-primary with English available on tap.
  - `CorrectionBubble` gains an FR/EN toggle; correction history stores both.
  - Preserves Story 9-4 injection wrappers and 11-1 protocol invariants; forward-compatible with stored single-language corrections.
  - AC: every correction renders both languages; spoken explanation language matches the CEFR policy.

- **18.3 Proactive nudges ("your pal texts you first")** (~3–4 days; depends on Phase 0 item 3)
  - Daily conversation-starter push generated from memory + error patterns + curriculum position ("Ready for 10 minutes? Yesterday's passé composé needs a rematch 😉" — EN chrome, FR content per Story 14-1 rule).
  - Cadence policy: max 1/day default, quiet hours, user-tunable in settings; hard opt-out.
  - Streak-save nudge (evening, only if streak ≥ 3 and no activity today).
  - AC: nudges reference real user context (not generic); tapping deep-links into a conversation pre-seeded with that topic.

- **18.4 Avatar v1 — on-device animated companion** ✅ (2026-07-19 — see D-V1 amendment below; device FPS verification = operator action on next dev build)
  - An expressive animated character (Rive recommended; Lottie/Reanimated fallback) center-stage on the conversation screen with state-driven animation: idle / listening (user speaking) / thinking / speaking (mouth movement driven by output-audio amplitude from the existing PCM stream) / celebrating (on milestones).
  - **Deliberately NOT streaming video in v1** — see decision D-V1. Zero marginal cost per minute, works offline-degraded, keeps the Realtime audio pipeline untouched, and preserves the 5¢/session economics.
  - AC: avatar states track orchestrator states with < 200ms lag; conversation screen holds the Epic 13 ≥ 55 FPS budget with the avatar animating (device-verified this time, not estimated).

- **18.5 Avatar v2 spike — streaming video head (paid-tier candidate)** (~3–5 day spike, later phase)
  - Evaluate real-time conversational-video providers (Tavus CVI, HeyGen Interactive Avatar, Simli, D-ID) for: RN/WebRTC integration with the existing OpenAI Realtime audio, latency, and **measured cost/minute** (verify current pricing at spike time — likely $0.05–$1.00/min, i.e., 10–200× the current total AI cost/session).
  - Decision gate: ship only behind the paid tier (Epic 21.1) if the spike shows acceptable latency + unit economics. The free tier keeps Avatar v1.

- **18.6 Conversation screen redesign** ✅ (2026-07-19 — largely delivered incrementally: avatar center-stage by 18.4, condensed caption strip by 3-2, FR/EN side-note corrections by 18.2; Story 18-6 closed the remainder with the SessionGoalChip — target icon + goal text + CEFR badge under the header, with a `goalOverride` prop as the Epic 19 lesson-scenario hook)
  - Avatar center-stage; live caption strip (existing transcript, condensed); corrections as unobtrusive side-notes with the FR/EN toggle; session goal chip (curriculum tie-in, Epic 19); end-of-session summary flows unchanged.

**Epic AC:** the operator, hand on heart, would open this screen to chat even on a day they don't feel like studying. Estimated total: 3–4 weeks.

### Epic 19 — Built-in Curriculum (A1 → C2 journey)

**Goal:** a learner can rely on Companion alone to progress level-by-level, with the conversation buddy practicing exactly what the curriculum just taught.

**Honesty constraint (bakes into marketing + scope):** A1→C2 is ~1,000–1,200 guided hours — a multi-year journey. C2 is near-native. Building the full spine at once is neither feasible nor needed: the paying market (TCF Canada / CLB 7–9) lives at A2→C1. **Scope decision D-C1: build A1→B2 deep first; C1–C2 ship later as "advanced tracks."** The app can still *say* "your path to C2" — the path exists; the upper floors ship later.

**Deliverables:**

- **19.1 Curriculum spine (A1→B2)** 🚧 (slices 1-3 2026-07-19: **A1 COMPLETE** — 6 units / 30 lessons / 309 vocab items (Se présenter · La famille · Au quotidien · La nourriture · En ville · Le temps libre); slice 4 2026-07-20: **A2 Units 1-3** — 15 lessons / 121 vocab items (Hier et avant · Les courses et les achats · La santé) — passé composé (avoir + être + agreement + negation), vouloir/pouvoir/devoir paradigms, object pronouns, numbers 100-1000, avoir mal à, full reflexive paradigm, il faut advice; the 19-3 placement fall-down is now REAL (B1+ placements enter at the A2 start); remaining: A2 Units 4-6 → B2) — CEFR can-do-statement-based syllabus: ~6 units/level × ~5 lessons/unit, each lesson = can-do outcome + grammar target + vocab set (tier-aligned with Story 10-4) + conversation scenario. Authored as versioned content files (JSON/MD in-repo), drafted with `french-pedagogy-expert`, **human-reviewed by the operator** (who is conveniently also a learner). ~2 weeks authoring for A1–A2, iterate upward.
- **19.2 Lesson engine** 🚧 (slice 1 2026-07-19: lesson list + player (teach step + vocab) + APPLY-in-conversation wiring — promptSeed→topicDescription, goalEn→SessionGoalChip.goalOverride, completion persisted on user-ended sessions via lesson_progress; slice 2 2026-07-20: guided-drill middle step shipped — 3 lesson-scoped MCQs between teach and apply; remaining: unlock gating) — lesson player flow: teach (short explanation, FR+EN) → guided drill (existing exercise engine, scoped to the lesson's target) → **apply in conversation** (a buddy session pre-seeded with the lesson scenario — this loop is the differentiator no competitor closes well). Lesson state persisted; unlock gating via the existing promotion engine. ~2 weeks.
- **19.3 Placement + daily-plan integration** ✅ (2026-07-20) — placement maps to a curriculum position: `entryLessonIdForLevel(profile.current_cefr_level)` feeds a placement-aware `nextLessonForUser` (the pointer scans FROM the entry lesson and never regresses below placement; with only A1 shipped every level honestly enters at the spine start), the placement results screen shows a "Your starting point" card, Today's Plan leads with the next lesson (new Priority 1 item routing to the lesson player), and the conversation topic picker gains a "Continue my lesson" list-header default that routes to the PLAYER so teach → drill → apply stays intact.
- **19.4 Curated item bank** — generated-then-reviewed exercise items stored + versioned per lesson (replaces infinite fresh generation on the curriculum path). Cuts cost, kills repetition risk, and creates the substrate Epic 20 calibrates. ~1 week engine + ongoing review.

**Epic AC:** a new A1 user has a guided "what do I do today" answer every single day without ever choosing from a menu. Estimated total: 5–7 weeks (spine authoring dominates; parallelizable with Epic 18).

### Epic 20 — Efficacy & Trust (make the numbers honest)

- **20.1 Score disclaimer** (30 minutes — do immediately in Phase 1): results screen gains "Estimated from practice items — not an official TCF prediction" + a link explaining the estimate.
- **20.2 Outcome collection**: post-exam self-report flow ("Took the real TCF? Tell us your score") + storage + comparison against app predictions. The single highest-value learning loop in the product.
- **20.3 Calibration anchoring**: use the official FEI sample items (already snapshotted in `docs/tcf-canada-snapshots/`) as anchor items; compare user performance on anchors vs generated items to estimate difficulty bias; adjust score mapping.
- **20.4 Speaking honesty** ✅ (2026-07-19): conversation metrics relabeled as practice metrics (feedback-sheet caption + `speaking-score.ts` semantics contract); evaluator rubric dimension 1 rescoped to transcript-observable **Fluency & Coherence** with an explicit cannot-hear contract (the model was hallucinating articulation scores from normalized Whisper text); speaking results screen discloses the gap + links to Pronunciation Practice. **Amendment:** the original "route exam audio through Azure phoneme assessment" clause is infeasible at this tier — Azure pronunciation assessment caps at ~30s (short-audio REST, PCM WAV only; unsupported on fast transcription) vs 5.5-min AAC task recordings with no Deno-side transcode. Full-audio assessment needs the Azure streaming SDK (native module) — filed as `20-4-followup-azure-streaming-assessment` (Epic 22 / paid-tier candidate).
- **20.5 Whisper L2-speech investigation**: measure how often Whisper silently corrects planted learner errors; document; mitigate (prompt bias, temperature, or accept + disclose).
- **20.6 Model-quality dogfood A/B**: operator flag to run `gpt-realtime` (full) personally; judge correction quality delta vs mini over 2 weeks of daily use → informs the paid-tier model decision.

Estimated total: ~2 weeks engineering + beta-time data collection.

### Epic 21 — Commercial Wrapper (make it a product, not a demo)

- **21.1 Payments + tier**: RevenueCat, `profiles.tier`, paywall (candidate paid tier: video avatar + unlimited sessions + full realtime model + C1/C2 tracks). ~1 week.
- **21.2 Product analytics**: PostHog (self-serve, RN SDK) — session/retention/funnel events, D1/D7/D30. **Pull into Phase 1** so dogfooding produces data. ~2–3 days.
- **21.3 Remote config + kill switch**: PostHog feature flags (comes free with 21.2) or Statsig — model selection, avatar on/off, AI-feature kill switch, maintenance banner. ~2–3 days.
- **21.4 Public presence**: buy a real domain, host privacy/terms/support pages (static site), support email, update store metadata URLs. ~1–2 days.

### Epic 22 — Long-tail sweep (existing filed backlog)

P2-19 SRS lapse softening · P2-20 cross-skill SRS · P2-23 exhaustive-deps sweep · P2-24 screen decomposition (4 screens > 1,000 lines) · 12-9 read-side gate · 12-11 patch sweep · 12-X pgTAP CI wiring · 15-3/16-1 follow-ups · Maestro selectors + CI wiring · 16-11 SDK 57 evaluation. Grab-bag epic; schedule opportunistically. **Exception: P2-25 (dictation accepts `leau` for `l'eau`) is a French-correctness bug — pull into Phase 1.**

---

## 3. Sequencing

| Phase | Contents | Duration | Exit criterion |
| --- | --- | --- | --- |
| **0 — Deploy to self** | §0 checklist; device-perf profiling pass | ~1–2 days operator work | Working prod conversation on operator's phone via TestFlight |
| **1 — Dogfood loop** | 18.1 persona/driver · 18.2 bilingual corrections · 18.3 nudges · 20.1 disclaimer · 20.4 relabel · 20.6 model A/B · 21.2 analytics · 21.3 flags · P2-25 fix | ~3 weeks | Operator uses the app daily and *wants* to; analytics proves it |
| **2 — Buddy + Curriculum** | 18.4 avatar v1 · 18.6 screen redesign · 19.1–19.3 curriculum A1→B2 · Epic 16 remainder (staging, uptime, fn-error→Sentry) | ~5–6 weeks | "Close pal + guided path" experience complete on device |
| **3 — Sellable** | 19.4 item bank · 20.2/20.3 calibration · 21.1 paywall · 21.4 web presence · 18.5 avatar-video spike · 16.9/16.10 submission + beta (≥10 users, 14 days) | ~4 weeks + beta | Public store listing; personal-evidence story backed by beta data |

Total to public launch: roughly **3–4 months** at solo pace with agent parallelism — consistent with the effort profile of Epics 9–15.

## 4. Operator decision matrix (resolve at story-creation time; recommendations bold)

| ID | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D-V1 | Avatar technology v1 | streaming video API / **on-device animated character (Rive) with audio-driven states** / static illustration | **On-device.** Streaming video costs 10–200× current per-session AI spend and adds a latency + WebRTC dependency; economics only work behind a paid tier. Rive character preserves 5¢ sessions and ships weeks sooner. **AMENDED 2026-07-19 (Story 18-4):** shipped as a CODE-DRAWN Reanimated character rather than Rive — a .riv character requires operator-authored art in the Rive editor (not producible in-repo), and `rive-react-native` is a native module (breaks OTA). The `AvatarState` union + amplitude SharedValue form the renderer contract; a Rive character can swap in behind the same props later (`18-4-followup-rive-renderer`, needs operator-authored .riv + EAS build). All other D-V1 rationale (on-device, zero marginal cost, no WebRTC) fully honored. |
| D-V2 | Avatar video (v2) | never / free tier / **paid tier only, pending 18.5 spike** | **Paid-tier gate.** Sell the "video buddy" as the upgrade. |
| D-C1 | Curriculum scope | full A1→C2 now / **A1→B2 deep first, C1–C2 as later advanced tracks** | **A1→B2 first.** Matches the TCF/CLB market; honest about the ~1,000-hour C2 reality. |
| D-B1 | Correction explanation language | FR-only / EN-only / **CEFR-adaptive FR+EN** | **CEFR-adaptive** (A1–A2 EN-primary → B2+ FR-primary, always both available). |
| D-N1 | Nudge policy | none / **1/day max, quiet hours, opt-out, context-aware** / aggressive | **1/day contextual.** Pal, not spam. |
| D-M1 | Dogfood model | mini / **operator flag → full gpt-realtime for self, mini default** | **Flag it** (via 21.3) — you should personally test the quality ceiling you might sell. |
| D-P1 | Persona | name, voice, gender-neutral vs choice | Operator taste — decide during 18.1; recommend offering the user a small persona picker eventually. |

## 5. The personal-evidence bar (define "I am satisfied" measurably)

Since the sales story is personal evidence, pre-commit to what would convince a skeptic:

1. **30 consecutive days** of real personal use, ≥ 20 min/day average (analytics-verified, not vibes).
2. Buddy initiates topics and the conversation never dead-ends (18.1 AC observed across the month).
3. Spot-check **50 corrections**: ≥ 90% judged accurate (log any wrong correction as a bug).
4. Measurable personal skill delta over 8 weeks on **official FEI sample items** (the calibration anchors) — before/after.
5. Zero sessions abandoned due to bugs in the final 2 weeks.
6. The honest one: on a day you don't feel like studying, you open it anyway. If that happens, you have a product.

---

*Next step: run `bmad-create-epics-and-stories` against this document to generate story files for Phase 1, or start directly with Story 18-1 (persona & conversation driver) once Phase 0 is complete.*
