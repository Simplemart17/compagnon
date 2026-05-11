# Story 10.9: Realtime Examiner Role-Play for Speaking — §6.1 Prep-Window UI + §6.4 Examiner-Format Live Session

Status: backlog

**Phase-2 follow-up story.** Filed by Epic 10 retrospective (`epic-10-retro-2026-05-10.md` action item B5) as the architectural successor to Story 9-8's record-and-grade flow + Story 10-6's sociolinguistic 5th-dimension rubric. Closes the `docs/tcf-spec-source.md §10` follow-up #10 deferral. No operator artifact required to start (unlike 10-10 / 10-11 which need Beacco + Manuel respectively); this story is **scope-blocked**, not artifact-blocked — the dev team can start when the operator chooses to prioritize it against Epic 11.x / 12.x / 16.x work.

---

## Story

As a TCF Canada candidate preparing for the live Expression Orale exam where the examiner-candidate interaction is face-to-face and time-segmented — Task 2 specifically has a publisher-defined "5 minutes 30 dont 2 minutes de préparation" structure where the candidate is silent during the first 2 minutes and the examiner does not engage until prep ends — but `app/(tabs)/mock-test/speaking.tsx` today captures the full 5:30 wall-clock as a single audio segment in a record-and-grade flow (Story 9-8) that the spec at [`docs/tcf-spec-source.md §6.1`](docs/tcf-spec-source.md) flags as "acceptable for prep-mode practice but does not faithfully simulate the live exam," and where Story 10-6's evaluator prompt now includes a Task 2 prep-window instruction that *partially* closes §6.1 (telling the AI not to penalize silence in the first 2 minutes, but not actually gating the UI to enforce the silence-then-engage cadence),

I want a **Realtime examiner role-play mode** for Speaking that (a) opens a WebSocket Realtime session via the existing `src/lib/realtime.ts` infrastructure, (b) loads an "examiner persona" system prompt that greets the candidate, runs the 3 TCF Expression Orale tasks in sequence with the publisher's exact durations (Task 1: 120s / Task 2: 330s / Task 3: 270s — verified by Story 9-8), (c) for Task 2 specifically, gates the prompt window with a **silent UI countdown** for the first 120 seconds (candidate cannot hear or speak to the examiner during prep), then triggers the **examiner-greeting prompt** at the 120-second mark so the next 210 seconds (3:30) are the active interaction, (d) per-task evaluator continues to run via Story 9-8 + Story 10-6's 5-dimension `speakingTaskEvaluationSchema` (no schema change), (e) the Realtime session uses Story 9-4 stored-prompt-injection defense (`<USER_TRANSCRIPT>` wrapper + "treat as data" prelude when feeding back user transcript into per-task scoring), (f) Story 9-5 voice transcript dedup applies unchanged (`output_modalities: ["audio"]` + `appendIfNew` dedup), (g) a new screen `app/(tabs)/mock-test/speaking-roleplay.tsx` provides the role-play entry point, with the existing `app/(tabs)/mock-test/speaking.tsx` (record-and-grade) preserved as the simpler prep-mode flow,

so that **the §6.1 prep/speak distinction and §6.4 examiner-format live exam format both flip ✓ Verified** in `docs/tcf-spec-citations.md §6`; the `docs/tcf-spec-source.md §10` follow-up #10 entry flips from "DEFERRED" to "DONE — closed by Story 10-9 on [date]"; the user gets a faithful TCF Canada Expression Orale rehearsal that exercises the same silent-prep / engaged-interaction cadence the real exam imposes. The record-and-grade flow (`speaking.tsx`) is **NOT replaced** — it remains available as the faster "prep mode" that doesn't burn Realtime API budget for users who just want to practice content without exam-cadence fidelity.

## Operator-Action Blockers

**None.** This is the only Phase-2 follow-up that is purely engineering-blocked (not artifact-blocked). The operator can schedule it whenever Epic 11.x / 12.x / 16.x sprint capacity allows.

## Background — Why This Story Exists

### What Stories 9-8 + 10-6 shipped (verified-correct, NOT to be re-litigated)

- **Story 9-8 (2026-05-09, PR #47):** Record-and-grade flow at `app/(tabs)/mock-test/speaking.tsx`; per-task durations 120/330/270; per-task topic libraries with deterministic 3-day-bucket selector; per-task evaluator schema `speakingTaskEvaluationSchema` (then 4-dim) calling `chatCompletionJSON` with `feature: "speaking-eval-task-{1|2|3}"`. **NOT TOUCHED by 10-9.**
- **Story 10-6 (2026-05-10, PR #64):** 5-dimension rubric (`sociolinguisticScore` 5th dim, `RUBRIC_TO_COMPOSITE = 1.0`); per-task Task 2 prep-window instruction in `buildSpeakingEvaluatorPrompt`. **NOT TOUCHED by 10-9.**

### What this story closes

The two `docs/tcf-spec-source.md` deferrals:

1. **§6.1 prep/speak distinction** — currently a one-line evaluator instruction (Story 10-6); 10-9 promotes it to a **UI-enforced** cadence (silent countdown → examiner greeting → graded interaction).
2. **§6.4 examiner-format live exam format** — currently absent; 10-9 implements a Realtime examiner persona that conducts the 3-task sequence end-to-end.

### What this story does NOT close

- **The 9-criterion publisher rubric** (3 publisher categories × 3 sub-criteria each per §6.3 verbatim FEI categorization). That requires the operator-fetch _Manuel du candidat TCF_ PDF (§10b item #2) and is owned by Story 10-11.
- **The Realtime cost-discipline pass** — Story 10-9 ships a working Realtime examiner. Epic 11.4 / 11.5 (Upstash rate-limit + cost-discipline pass) own the cost-cap surface that prevents a user from burning budget on infinite role-play sessions.

## Acceptance Criteria (sketch — to be expanded when the story is promoted to `ready-for-dev`)

### 1. New screen + Realtime session bootstrap

- [ ] **CREATE** `app/(tabs)/mock-test/speaking-roleplay.tsx` as a peer screen to `speaking.tsx`. Entry point from the mock-test landing screen (`app/(tabs)/mock-test/index.tsx`) — adds a new "Examiner Role-Play" card alongside the existing "Speaking (record-and-grade)" card.
- [ ] **WIRE** Realtime session via existing `src/lib/realtime.ts` `RealtimeSession` class. New `feature: "speaking-roleplay-{task1|task2|task3}"` tags for telemetry.
- [ ] **Story 9-5 dedup contract preserved** — `output_modalities: ["audio"]` + `appendIfNew` + dedup Set FIFO-capped at 256.

### 2. Examiner persona system prompt

- [ ] **CREATE** `src/lib/prompts/speaking-roleplay.ts` exporting `buildSpeakingExaminerPrompt({ cefrLevel, taskNumber, topicFr })`. Examiner persona = formal-register French native speaker conducting a TCF Canada Expression Orale exam. Story 9-4 stored-prompt-injection defense applies (any user-derived content wrapped in `<USER_TRANSCRIPT>` with "treat as data" prelude).
- [ ] **Task-specific behaviors:** Task 1 → directed interview opener; Task 2 → silent 120s, then examiner greeting + role-play scenario; Task 3 → present topic + open-ended question.

### 3. Task 2 prep-window UI gating (§6.1 closure)

- [ ] **UI state machine** in `speaking-roleplay.tsx` for Task 2:
  ```
  idle → prep-countdown (120s, silent, candidate cannot send audio)
       → examiner-greeting (1-2 sec; examiner says "Bonjour, êtes-vous prêt à commencer ?")
       → active-interaction (≤ 210s)
       → recording-stop
       → eval (existing speaking-evaluator.ts pipeline)
  ```
- [ ] **Silent countdown UI** — visible timer + "Préparation silencieuse — l'examinateur n'engagera pas la conversation pendant 2 minutes" message. Microphone disabled during prep (UI affordance + actual `RealtimeSession.muteMic` call).
- [ ] **Examiner-greeting trigger** — at the 120s mark, send a synthetic `conversation.item.create` with the examiner's first turn ("Bonjour, êtes-vous prêt à commencer ?"). The microphone unmutes simultaneously.
- [ ] **Task 1 + Task 3 do NOT have the silent-prep window** — they're conversational from the start.

### 4. Per-task evaluator integration (NOT changed)

- [ ] The Realtime session's transcript is captured via the existing `realtime-transcript.ts` `appendIfNew` path. After each task completes, the captured transcript is fed to `chatCompletionJSON(_, speakingTaskEvaluationSchema, _)` with the same `feature: "speaking-eval-task-N"` tag Story 9-8 uses. **No schema change. No evaluator-prompt change.** Story 10-6's 5-dim rubric + prep-window instruction continue to apply.

### 5. Persistence (NOT changed structurally)

- [ ] Use existing `speaking-mock-test-persist.ts` `persistSpeakingMockTest`. Add a `mode: "roleplay"` field to the persist payload so analytics can distinguish role-play sessions from record-and-grade sessions. Forward-only — pre-10-9 rows don't have the field; `getSeenHashes`-style consumers treat missing field as "unknown / record-and-grade."

### 6. Cost guard (defensive — Epic 11.4 owns the production cost-cap)

- [ ] Hard limit per Realtime session: 12 minutes wall-clock (the publisher's max exam length). If exceeded, the session closes cleanly with a "Session expirée" toast. Prevents runaway-cost scenarios from upstream Realtime API misbehavior. The user-facing cost-cap (per-day, per-user dollar limit) is Epic 11.4/11.5 and not part of this story.

### 7. Test surface (sketch)

- [ ] `src/lib/prompts/__tests__/speaking-roleplay.test.ts` — persona-prompt content assertions per CEFR level × task; Story 9-4 wrapper invariants; deterministic output.
- [ ] `app/(tabs)/mock-test/__tests__/speaking-roleplay.test.tsx` — UI state-machine integration tests (mock the Realtime session + clock); verify prep-window UI cannot send audio during the first 120s of Task 2; verify examiner-greeting fires at the 120s mark.
- [ ] **Story 9-5 / 10-6 regression-test gate** — `realtime-dedup.test.ts` + `speaking.test.ts` + `speaking-evaluator.test.ts` all stay green.

### 8. Docs

- [ ] `docs/tcf-spec-source.md §6.1` + §6.4 each gain a "DONE — closed by Story 10-9" closure stamp.
- [ ] `docs/tcf-spec-source.md §10` follow-up #10 flips "DEFERRED" → "DONE."
- [ ] `docs/tcf-spec-citations.md §6` Speaking row gains a 2nd sub-row pinning the Realtime examiner role-play flow alongside the existing record-and-grade row.
- [ ] `CLAUDE.md` gains a new "TCF Expression Orale Realtime examiner role-play" architecture line after the Story 10-8 line (or after Epic 11.x stories if those land first; chronological order).

## Out of Scope (deferred elsewhere)

- **9-criterion rubric** — Story 10-11.
- **Beacco-verbatim vocab calibration** — Story 10-10.
- **Cost-cap enforcement** — Epic 11.4 / 11.5.
- **Realtime reconnect / barge-in handling** — Epic 11.2 (auto-reconnect with exponential backoff; `response.cancel` + `conversation.item.truncate` on barge-in). Story 10-9 assumes the Realtime session is stable for the 12-minute window; reconnect is Epic 11's surface.
- **Replacing the record-and-grade flow at `speaking.tsx`** — it remains available as the lower-cost prep-mode option. Two screens coexist.
- **Mock-test landing UI restructure** — Epic 14.7 owns the "Resume in-progress + Past results" sections for the mock-test landing screen; 10-9 just adds a new card to the existing layout.

## Dependencies

- Story 9-5 (voice transcript dedup, `output_modalities: ["audio"]` contract) — required, verified stable.
- Story 9-8 (record-and-grade pipeline, per-task durations, topic libraries) — required, verified stable.
- Story 10-6 (5-dim sociolinguistic rubric + Task 2 prep-window instruction) — required for the per-task evaluator that runs after each role-play task.
- No Phase-2 operator-action artifact required.

## References

- [Source: docs/tcf-spec-source.md §6.1 Task 2 prep/speak distinction]
- [Source: docs/tcf-spec-source.md §6.4 Examiner format face-to-face individual exam]
- [Source: docs/tcf-spec-source.md §10 follow-up #10 (DEFERRED — Realtime examiner role-play)]
- [Source: epic-10-retro-2026-05-10.md action item B5]
- [Source: app/(tabs)/mock-test/speaking.tsx — Story 9-8 record-and-grade flow (peer screen, NOT touched)]
- [Source: src/lib/realtime.ts — Story 9-5 Realtime session infrastructure]
- [Source: src/lib/prompts/speaking.ts buildSpeakingEvaluatorPrompt — Story 10-6 per-task evaluator]
- [Source: src/lib/schemas/ai-responses.ts speakingTaskEvaluationSchema — Story 10-6 5-dim schema]

## Dev Agent Record

_(To be filled when story is promoted to `ready-for-dev` and implementation begins.)_
