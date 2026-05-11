# Story 11.1: Correction Protocol via Realtime Tool-Calls — Replace `parseCorrections` Regex with `report_correction` Function-Call

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose AI conversation partner is the OpenAI Realtime session at [`src/hooks/use-realtime-voice.ts:670`](src/hooks/use-realtime-voice.ts) — driven by the prompt builder at [`src/lib/prompts/conversation.ts:38`](src/lib/prompts/conversation.ts) and decoded via a brittle regex at [`src/hooks/use-realtime-voice.ts:152-171`](src/hooks/use-realtime-voice.ts) (`parseCorrections`) which extracts corrections via `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` from a plain-text "Correction Report" block the model is asked to emit at the END of each turn (Story 10-7's minimum-viable §8.4 P2-1 bridge) — but per audit finding **P1-6** ([`shippable-roadmap.md` line 58](_bmad-output/planning-artifacts/shippable-roadmap.md)) "correction parsing uses brittle regex `/"X"\s*→\s*"Y"\s*\(...\)/g` — curly quotes, em-dashes, paraphrased corrections silently produce zero corrections; speaking-score pipeline depends on this" the regex bridge is the wrong architecture: even after Story 10-7's prompt-side ASCII-quote + no-nested-parens defensive instructions (P8 review patch), the regex still produces silent zero-correction outputs when (a) the model emits French typographic guillemets (`« »`) or curly quotes despite the instruction, (b) the model paraphrases the correction inline ("J'aurais dit plutôt 'je suis allée' au féminin") instead of using the exact arrow shape, (c) French explanations naturally nest parentheses (`(auxiliaire être (être/avoir distinction))`) and the regex's `\(([^)]+)\)` terminates at the first `)`, (d) the model omits the Correction Report entirely when the conversational flow doesn't warrant a formal correction summary — all of which result in `correctionsRef.current` staying empty, `entry.corrections` rendering nothing, the speaking-score `Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))` at [`use-realtime-voice.ts:611-614`](src/hooks/use-realtime-voice.ts) silently overstating performance (corrections invisible to the algorithm = perfect performance assumed), and `extractErrorsFromCorrections` at [`use-realtime-voice.ts:601-605`](src/hooks/use-realtime-voice.ts) (Story 1-2 / error-tracker pipeline) producing zero error patterns to feed the home-screen "Fix This Mistake" card and the SRS-driven `getErrorsForDrills` micro-drill generator — and per audit finding **P2-1** the same prompt-side "Correction Report" block was the §8.4 voice-mode emoji + markdown failure mode (Story 10-7 stripped emoji + `**bold**` + `---` but the architectural successor was queued for Epic 11.1) — and per [`shippable-roadmap.md` Epic 11.1](_bmad-output/planning-artifacts/shippable-roadmap.md) the architectural successor is to "replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. **Covers P1-6, P2-1**" — and the infrastructure to receive Realtime tool-calls already exists ([`src/lib/realtime.ts:88-93`](src/lib/realtime.ts) `response.function_call_arguments.done` event type + [`src/lib/realtime.ts:347-357`](src/lib/realtime.ts) `sendFunctionResult` for `function_call_output` + [`src/hooks/use-realtime-voice.ts:224-266`](src/hooks/use-realtime-voice.ts) `handleFunctionCall` already routing two tools `save_vocabulary` / `note_error_pattern` and emitting `function_call_output` back) so the change is **additive to the existing tool-call pipeline, not a new pipeline**,

I want (a) a new third Realtime tool **`report_correction`** registered in the `tools: [...]` array of `RealtimeConfig` at [`use-realtime-voice.ts:726-757`](src/hooks/use-realtime-voice.ts) with strict parameters `{ original: string, corrected: string, explanation: string, category: "grammar" | "pronunciation" | "vocabulary" | "register" }` mirroring the `Correction` type at [`src/types/conversation.ts:33-38`](src/types/conversation.ts) — the model classifies `category` directly instead of the keyword-matching `inferCategory` heuristic at [`use-realtime-voice.ts:142-149`](src/hooks/use-realtime-voice.ts) which is **deleted** (Story 10-2 "delete don't alias" pattern), (b) a Zod schema **`reportCorrectionArgsSchema`** in [`src/lib/schemas/ai-responses.ts`](src/lib/schemas/ai-responses.ts) that validates the parsed JSON arguments — invalid shapes fire `addBreadcrumb({ category: "ai", level: "warning", message: "report_correction args parse failed", data: { feature: "realtime-report-correction", code } })` and the tool-call result returns `"Invalid correction shape; correction not recorded."` so the model can self-correct on a subsequent turn (mirroring Story 9-7's safeParse-then-breadcrumb pattern but without the retry loop because the Realtime session doesn't have a `chatCompletionJSON`-style outer retry surface), (c) an extension to **`handleFunctionCall`** at [`use-realtime-voice.ts:224`](src/hooks/use-realtime-voice.ts) that on `name === "report_correction"` (i) `safeParse`s args against the Zod schema, (ii) on success appends the validated `Correction` to a new ref **`pendingToolCorrectionsRef`** (scoped to the current AI turn — drained when the terminal `response.output_audio_transcript.done` fires for that response, mirroring Story 9-5's per-turn dedup-key lifetime), (iii) sends `function_call_output` back via `sendFunctionResult` with `"Correction recorded."` so the model knows the call succeeded and can continue its audio turn, (d) the **`parseCorrections` regex callback** at [`use-realtime-voice.ts:152-171`](src/hooks/use-realtime-voice.ts) **rewritten** to return the drain of `pendingToolCorrectionsRef.current` instead of regex-parsing the assistant text — preserving the `AppendOptions.parseCorrections: (text: string) => Correction[]` signature at [`src/lib/realtime-transcript.ts:75`](src/lib/realtime-transcript.ts) so the pure-helper module is **NOT touched** (Story 9-5 invariant holds), (e) the **entire `## Correction Report (Plain Text — Read Aloud)` block** at [`conversation.ts:62-76`](src/lib/prompts/conversation.ts) **removed** from `buildConversationPrompt` (Story 10-2 delete pattern) and replaced with a short **`## Correction Reporting (Tool-Call)` block** that instructs the model to invoke `report_correction({ original, corrected, explanation, category })` whenever it detects an error in the user's French, and to NEVER emit the legacy text-form Correction Report (no `"User said" → "Correct form" (explanation)` line shape, no `Tip:` line, no `No corrections.` sentinel) — the model still speaks pedagogical encouragement naturally during its audio response as part of the conversational flow, just no structured text-extracted report, (f) `TranscriptView.getDisplayText` at [`src/components/conversation/TranscriptView.tsx:42-90`](src/components/conversation/TranscriptView.tsx) sentinel-based stripper **retained as a legacy fallback** for in-flight pre-11-1 conversation messages and for historical conversations rendered via [`app/(tabs)/conversation/history.tsx`](app/(tabs)/conversation/history.tsx) — new post-11-1 assistant turns won't trigger any sentinel (no correction-line / no `Tip:` / no `No corrections.` / no `---` divider) so `getDisplayText` returns the text verbatim, (g) the `realtime-dedup.test.ts` Case 14 `parseCorrectionsForTest` mirror regex **deleted** (Story 10-2 delete pattern; the production regex is gone, so the mirror has no contract to verify), and (h) Story 10-7's `conversation.test.ts` `parseCorrections`-regex-compatibility test cases (`"je suis allé" → "je suis allée" (feminine agreement)` positive match) **deleted** with the regex they verified, replaced with new positive assertions that the rendered prompt contains the `report_correction` tool-call instruction and does NOT contain the legacy `"User said" → "Correct form"` example line shape,

so that **audit finding P1-6 closes architecturally** (the regex is gone — silent zero-correction failures are impossible because the model invokes a function with a strict typed schema rather than emitting parseable text), **audit finding P2-1 closes architecturally** (the prompt-side Correction Report block that was Story 10-7's emoji + markdown failure mode is removed entirely — TTS no longer reads correction-summary text aloud at all; corrections are out-of-band tool-calls invisible to the audio modality), [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) row 4 (the "✓ Verified-with-caveat" row Story 10-7 flagged for Epic 11.1 closure) flips to **✓ Verified** with a Story 11-1 closure trailer, the post-conversation flow at [`use-realtime-voice.ts:592-627`](src/hooks/use-realtime-voice.ts) (`extractErrorsFromCorrections` → `updateSkillProgress("speaking")` → `incrementDailyActivity` → `updateStreak` → `checkCefrPromotion`) continues to consume `correctionsRef.current` with NO downstream code change because the array shape is identical post-11-1, and the **Realtime correction-protocol architecture line** in `CLAUDE.md` documents the closure of Story 10-7's deferred architectural successor. The verified-correct surfaces NOT touched are Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude at [`conversation.ts:158-194`](src/lib/prompts/conversation.ts) — preserved byte-for-byte), Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` pure helpers + FIFO-capped 256-entry dedup Set + the entire [`src/lib/realtime-transcript.ts`](src/lib/realtime-transcript.ts) pure module — not touched), Story 9-7 Zod schema retry contract for `chatCompletionJSON` (Realtime is a different surface; the `report_correction` tool-call uses a one-shot `safeParse` + breadcrumb without the retry loop), Story 9-8 / 10-6 speaking pipeline (the `transcribe → chatCompletionJSON(speakingTaskEvaluationSchema) → 5-dim rubric` flow at [`app/(tabs)/mock-test/speaking.tsx`](app/(tabs)/mock-test/speaking.tsx) is a separate record-and-grade flow that does NOT use Realtime — not touched), Story 10-2 per-skill scoring + `IRCC_CLB_BANDS` ([`src/lib/scoring.ts`](src/lib/scoring.ts) / [`src/lib/ircc-bands.ts`](src/lib/ircc-bands.ts) — not touched), Story 10-3 per-CEFR passage ranges + `writingTaskWordRange` helper (not touched), Story 10-4 vocabulary-tier integration (`buildVocabularyConstraintBlock(cefrLevel)` continues to render between the `## Language Adaptation` block and the new `## Correction Reporting (Tool-Call)` block — unchanged), Story 10-5 placement-test extraction (`buildPlacementTestPrompt` — not touched; placement runs through `chatCompletionJSON`, not Realtime), Story 10-7 debate-mode 3-category split + `CEFR_LEVELS` `nameFr` Alliance Française convention + Québécois drop + `force est de constater` connector-misclassification echo fixes in `writing.ts` / `placement.ts` (all preserved verbatim — the `mode === "debate"` block at [`conversation.ts:106-124`](src/lib/prompts/conversation.ts) is NOT touched), Story 10-8 exercise dedup + `text-hash.ts` module + `question_stem_hashes` column (a separate skill-exercise surface; not touched), the existing `save_vocabulary` + `note_error_pattern` tool-call handlers (additive only — the new tool joins the array; the existing handlers are unchanged), and the post-conversation `ConversationFeedback` generation via `chatCompletionJSON(conversationFeedbackSchema)` at [`use-realtime-voice.ts:632-660`](src/hooks/use-realtime-voice.ts) (a separate `chatCompletionJSON` summary call run after the Realtime session ends — not touched).

## Background — Why This Story Exists

### What audit findings P1-6 and P2-1 own to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) tracks two findings owned by Epic 11.1:

| Audit row | Finding                                                                                                                                                                                              | Roadmap line                                          | Severity |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| **P1-6**  | Correction parsing uses brittle regex `/"X"\s*→\s*"Y"\s*\(...\)/g` — curly quotes, em-dashes, paraphrased corrections silently produce zero corrections; speaking-score pipeline depends on this. | `src/hooks/use-realtime-voice.ts:142-161` (pre-10-7)  | P1       |
| **P2-1**  | Conversation prompt instructs Realtime voice model to emit emoji-formatted markdown corrections — TTS will literally say the asterisks or skip them.                                                | `src/lib/prompts/conversation.ts:38-52` (pre-10-7)    | P2       |

Story 10-7 closed P2-1 with a **minimum-viable bridge** (strip emoji + markdown decoration from the prompt; preserve the regex contract); it explicitly deferred P1-6 (the regex itself) and the architectural P2-1 fix (remove the entire Correction Report text block) to Epic 11.1. Story 10-7's [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) row 4 trailer reads:

> ✓ Verified-with-caveat 2026-05-10 — Story 10-7 minimum-viable P2-1 remediation; architectural successor (`report_correction` tool-call) owned by Epic 11.1 ("Correction protocol via tool-calls"). Story 10-7 ships the forward-compatible bridge so beta can ship before Epic 11.

Story 11-1 is the architectural successor: it deletes the bridge, replaces the entire correction-extraction pipeline with structured Realtime tool-calls, and flips the citation row from ✓ Verified-with-caveat to ✓ Verified.

### What the OpenAI Realtime GA API gives us for tool-calls

Per Context7 + [`docs/openai-realtime-websocket`](https://platform.openai.com/docs/guides/realtime-websocket) (verified against the GA API 2026-05-11):

1. **Tools are declared at session config time** via `session.update` `session.tools[]`. The existing path at [`src/lib/realtime.ts:283-311`](src/lib/realtime.ts) `configureSession` already does this — the `tools: this.config.tools ?? []` line picks them up from `RealtimeConfig`.

2. **When the model invokes a tool**, the GA API emits `response.function_call_arguments.done` with `{ call_id, name, arguments }` where `arguments` is a JSON-encoded string of the function arguments. The event type is already defined at [`src/lib/realtime.ts:88-93`](src/lib/realtime.ts) and routed at [`use-realtime-voice.ts:439-441`](src/hooks/use-realtime-voice.ts) into `handleFunctionCall(event.name, event.arguments, event.call_id)`.

3. **The handler responds** by sending `conversation.item.create` with `item: { type: "function_call_output", call_id, output }` followed by `response.create`. The `sendFunctionResult` method at [`src/lib/realtime.ts:347-357`](src/lib/realtime.ts) already implements this exact pattern — current callers are the `save_vocabulary` / `note_error_pattern` handlers.

4. **Multiple tool-calls can fire within one AI turn** (the model can invoke `report_correction` several times for multi-error utterances before the audio response completes). Each call gets its own `call_id` + `response.function_call_arguments.done` event; the existing handler is already invoke-per-event so parallel calls "just work" without orchestration changes.

5. **Audio modality holds.** Tool-calls run on a side-channel: the audio stream (`response.output_audio.delta` / `.done` / `.output_audio_transcript.delta` / `.done`) is unaffected by tool-call events. Story 9-5's `output_modalities: ["audio"]` configuration is **NOT touched**.

The infrastructure is already wired. Story 11-1 is **additive surface + targeted deletes** — register a third tool, route it in the existing handler, delete the regex parser, delete the prompt block. The Realtime session orchestration, the WebSocket plumbing, the ephemeral-token Edge Function, and the `sendFunctionResult` plumbing all stay untouched.

### Threat / failure model — what cannot happen post-story

After this story:

1. **The `parseCorrections` regex is deleted.** No surface in `src/` mentions the pattern `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` (verified by `grep -rn '"([^"]+)"\\s*→\\s*"([^"]+)"\\s*\\(' src/` returning zero results outside the legacy stripper in `TranscriptView.getDisplayText` which keeps it for backward-compat with pre-11-1 stored transcripts).

2. **The `inferCategory` keyword-matching heuristic is deleted.** No surface in `src/` defines or calls `inferCategory`. Categories arrive from the AI directly as a strict literal-union member (`"grammar" | "pronunciation" | "vocabulary" | "register"`) validated by the Zod schema. The `pronunciation|accent|phonetic` / `vocabulary|word choice|lexical` / `register|formal|informal|tone` regex chains are unused.

3. **`buildConversationPrompt` no longer instructs the model to emit a Correction Report text block.** The prompt body contains no substring `"## Correction Report (Plain Text — Read Aloud)"`, no `"\"User said\" → \"Correct form\" (explanation)"` example shape, no `"Tip:"` directive, no `"No corrections."` sentinel string. The new `"## Correction Reporting (Tool-Call)"` block tells the model to invoke `report_correction` and explicitly forbids emitting the legacy text format.

4. **`report_correction` is a registered tool.** `RealtimeConfig.tools` at session config time includes three function declarations: `save_vocabulary` (existing), `note_error_pattern` (existing), `report_correction` (new). The new tool's `parameters` JSON schema includes `original` / `corrected` / `explanation` / `category` as required fields with `category` constrained to the 4-literal `enum` matching `Correction["category"]`.

5. **`reportCorrectionArgsSchema` is the runtime validation layer.** Defined in [`src/lib/schemas/ai-responses.ts`](src/lib/schemas/ai-responses.ts) using the existing `z` import; consumed by `handleFunctionCall` via `safeParse(JSON.parse(args))`. On parse success: the validated correction is buffered. On parse failure: a Sentry breadcrumb fires with `category` (from the partial args, allowlisted) + the new tool-call returns `"Invalid correction shape; correction not recorded."` so the model can self-correct.

6. **`pendingToolCorrectionsRef` is the per-turn buffer.** Reset on every `start()` (along with the other refs at [`use-realtime-voice.ts:674-684`](src/hooks/use-realtime-voice.ts)) and on every `response.done` (so a cancelled / orphaned tool-call without a terminating transcript doesn't leak into the next turn). Drained by the new `parseCorrections` callback when `appendIfNew` consumes a terminal `response.output_audio_transcript.done`.

7. **`AppendOptions.parseCorrections` signature is preserved.** The pure-helper module at [`src/lib/realtime-transcript.ts`](src/lib/realtime-transcript.ts) is **NOT touched**. The hook-side implementation of the callback changes from "regex over the assistant text" to "drain the pending buffer" — same signature, different body. Story 9-5's dedup + delta-bookkeeping invariants hold byte-for-byte.

8. **No backward-compat shim for the regex.** Per Story 10-2 "delete don't alias" pattern, the regex is removed, not aliased. The `realtime-dedup.test.ts` `parseCorrectionsForTest` mirror function in Case 14 is deleted; the test case is removed; the test count drops by 1 on that surface. The `conversation.test.ts` Story 10-7 regex-compatibility cases are deleted with the regex they verified.

9. **`TranscriptView.getDisplayText` keeps its legacy sentinels.** The Story 10-7 sentinel-based stripper (correction-line shape + `No corrections.` + `Tip:` + legacy `---\n`) remains in [`TranscriptView.tsx:42-90`](src/components/conversation/TranscriptView.tsx) — but its JSDoc gains a Story 11-1 note clarifying that the sentinels are now ONLY for pre-11-1 historical messages stored in `conversation_messages`; new turns will never trigger them.

10. **Sentry telemetry posture holds.** No new keys are added to `SENTRY_EXTRAS_ALLOWLIST` ([`src/lib/sentry.ts:25-52`](src/lib/sentry.ts)) — the new breadcrumbs use existing allowlisted keys (`category`, `feature`, `code`). Story 9-3 telemetry contract preserved.

11. **The speaking-score formula at [`use-realtime-voice.ts:611-614`](src/hooks/use-realtime-voice.ts)** continues to compute `Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))` over `correctionsRef.current.length`. Post-11-1 this number will be **non-zero in more sessions** (the regex's silent-zero failure mode is gone), which may produce slightly lower scores than the pre-11-1 false-perfect-score regime. This is a correctness improvement, not a regression — documented in the Out-of-scope section.

12. **`extractErrorsFromCorrections` is unchanged.** The Story 1-2 / error-tracker batch-AI-call pipeline at [`src/lib/error-tracker.ts:212-273`](src/lib/error-tracker.ts) consumes `correctionsRef.current` as a flat `Correction[]` — the array shape is identical post-11-1. The home-screen "Fix This Mistake" card and `getErrorsForDrills` micro-drill generator continue to work.

13. **The post-conversation `ConversationFeedback` generation at [`use-realtime-voice.ts:632-660`](src/hooks/use-realtime-voice.ts)** uses a separate `chatCompletionJSON(_, conversationFeedbackSchema)` call over the full transcript text (`transcriptRef.current.map(e => \`${e.role}: ${e.text}\`).join("\n")`). It does NOT consume `correctionsRef.current` and is NOT touched. The 5-field schema (summary / strengths / improvements / vocabularyUsed / fluencyRating / grammarRating) is the canonical contract for that surface; Story 9-7 owns it.

14. **`docs/tcf-spec-citations.md §8` row 4 flips ✓ Verified-with-caveat → ✓ Verified.** Story 10-7 trailer is replaced with a Story 11-1 trailer documenting the architectural closure.

15. **`CLAUDE.md` gains a new "Realtime correction tool-call protocol" architecture line** after the Story 10-8 line documenting the full closure of the §8.4 architecture, the `report_correction` tool registration, the `pendingToolCorrectionsRef` buffer lifetime, the regex / `inferCategory` deletes, and the Story 9-4 / 9-5 / 9-7 / 9-8 / 10-6 / 10-7 invariants preserved.

### Why the regex bridge was always temporary

[`shippable-roadmap.md` line 181](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.1 deliverable: "Correction protocol via tool-calls — replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. **Covers P1-6, P2-1.**"

Story 10-7's choice to ship the regex-preserving bridge was deliberate: §8.4 was a P0/P1-coupled finding (TTS reading "asterisk asterisk corrections" was visibly broken in every voice session), Epic 11 was backlog, beta could not wait for the tool-call rewrite. The bridge was **structurally forward-compatible** — Story 10-7's prompt explicitly used ASCII straight quotes + no-nested-parens defensive instructions to keep the regex hit-rate as high as possible while the bridge was in place — and the architectural successor was tracked as an explicit Epic 11.1 deliverable, not lost in a TODO.

Story 11-1 is the architectural successor. It is **scoped narrowly**:

- One new tool definition.
- One new Zod schema in an existing file.
- One new ref in the existing hook.
- One handler branch added to the existing `handleFunctionCall` switch.
- One prompt block replaced (entirely deleted on the way out + entirely added on the way in).
- Two deletes (the regex, the `inferCategory` heuristic).
- Three test files touched (extend `conversation.test.ts` to assert the new prompt shape; delete the parseCorrectionsForTest case from `realtime-dedup.test.ts`; add a new tool-call handler test file).

No DB migrations. No Edge Function changes. No new dependencies. No app router changes. No UI styling changes.

### What about parallel tool-calls and turn boundaries?

The OpenAI Realtime GA API allows the model to invoke multiple tools within a single response (e.g., `report_correction` twice for a turn with two errors, plus `save_vocabulary` once if the user used a notable new word). Each invocation gets its own `call_id` + its own `response.function_call_arguments.done` event. The existing handler is invoke-per-event — no orchestration change needed.

**Turn boundary:** `pendingToolCorrectionsRef.current` is reset on `response.done` (the catch-all turn-terminator at [`use-realtime-voice.ts:443-452`](src/hooks/use-realtime-voice.ts) which already drops the in-flight delta accumulator). This means a tool-call that lands AFTER `response.done` (theoretically possible per the GA API but not observed in practice) would be discarded with a Sentry breadcrumb. Conservative — if the API ever introduces such a flow, the breadcrumb gives us a signal to revisit; if it doesn't, the buffer is correctly bounded.

The terminal-event ordering question (`response.function_call_arguments.done` vs `response.output_audio_transcript.done`): per the GA API, both events fire as part of the same `response` (which terminates with `response.done`). The `appendIfNew`-via-`parseCorrections` drain pattern works regardless of order because the buffer is per-turn and lives until `response.done`. If the transcript-done arrives first (rare — audio finishes before tool-call arguments in most observed flows), the drain returns an empty array and `appendIfNew` simply appends the assistant entry without corrections; the subsequent tool-call lands in the buffer but `response.done` clears it before the next turn. **Mitigation:** the `case "response.done"` cleanup at AC #3 emits the `"Pending tool corrections dropped at response.done"` Sentry breadcrumb whenever it clears a non-empty buffer, which is the actual leak signal worth tracking. Empty drains are silent — see the AC #4 callout on why a drain-empty breadcrumb is intentionally NOT added.

### Out of scope for this story (delegated elsewhere)

- **A `provide_tip` tool for structured pedagogical hints** — the legacy `Tip:` line that Story 10-7 preserved as plain-text is dropped entirely from the prompt. The model continues to weave teaching encouragement into its natural audio response (which is read aloud); we no longer extract a structured Tip surface. Adding a `provide_tip` tool would be net-new structured surface with no consumer (`ConversationFeedback.improvements` is generated by a separate `chatCompletionJSON` call, not from the inline Tip). Filed as a deferred Epic 14.X follow-up if the operator wants a "Today's tip" home-screen surface in the future.
- **Auto-reconnect + barge-in handling** ([`shippable-roadmap.md` line 182](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.2) — separate story. Story 11-1 does not change reconnect / cancel / interrupt behavior.
- **Edge Function upstream timeouts** ([`shippable-roadmap.md` line 183](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.3) — separate story.
- **Realtime examiner role-play for TCF Speaking** (Story 10-9 — Phase-2 / scope-blocked) — Story 11-1 does not change the TCF simulation `tcf_simulation` mode block at [`conversation.ts:127-150`](src/lib/prompts/conversation.ts) (`Task 1` / `Task 2` / `Task 3` task-instruction prose). The full §6.4 examiner format remains deferred. Story 11-1 only modifies the Correction Report / Correction Reporting block, which is mode-agnostic.
- **Per-user daily AI spend cap** ([`shippable-roadmap.md` line 185](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.5) — separate story; tool-call usage may slightly increase OpenAI bill (each `report_correction` invocation is a tool-call billed at function-output token rates), but the cost discipline pass owns the cap.
- **Embedding-based dedupe in error-tracker** ([`shippable-roadmap.md` line 186](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.6) — separate story; `extractErrorsFromCorrections` continues to use string-equality dedup. Story 11-1 only changes the upstream source of `corrections` (tool-call instead of regex); downstream consumption is unchanged.
- **Prompt truncation for memories + error patterns** ([`shippable-roadmap.md` line 187](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.7) — separate story.
- **Migrating historical pre-11-1 stored transcripts** — forward-only. `conversation_messages` rows written before this story may contain the Story 10-7 plain-text Correction Report block in `content` (`"X" → "Y" (Z)` lines + `Tip:` line + `No corrections.` sentinel); they will continue to be rendered through `TranscriptView.getDisplayText` legacy sentinels in conversation history. The `corrections` JSONB column on those rows still holds the regex-parsed Corrections from Story 10-7. No backfill.
- **Updating the existing `save_vocabulary` / `note_error_pattern` tool handlers** — out of scope; these are Story 1-2 surfaces verified-correct. Story 11-1 only adds the third tool.
- **Adding a `Correction["category"]` type-system enum derivation from the Zod schema** — the new schema's `z.enum(...)` literal tuple is the runtime guard; the existing `Correction` interface at [`src/types/conversation.ts:33-38`](src/types/conversation.ts) carries the same 4-literal union manually. Could be unified later as `Correction = z.infer<typeof reportCorrectionArgsSchema>` (Story 9-7 pattern for `WritingEvaluation` / `ConversationFeedback`) — but the `Correction` type is consumed across many UI files and a sweeping type-derivation refactor is scope creep. Filed as a deferred consolidation.
- **Speaking-score formula re-tuning** — the existing `Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))` formula may produce slightly more pessimistic scores post-11-1 because the regex's silent-zero failure mode no longer suppresses real corrections. The formula is unchanged; documented as a correctness improvement, not a regression. If operator wants a different cap or weight, that's a separate `use-realtime-voice.ts:611` tuning story.
- **Updating `app/(tabs)/conversation/history.tsx`** — historical conversations may render the old text Correction Report inline because pre-11-1 stored transcripts contain it. The Story 10-7 sentinel stripper in `TranscriptView.getDisplayText` continues to handle this. **Not touched.**
- **Adding TranscriptView component-level test for `getDisplayText`** — the function is exported-by-name from inside the component file; existing test coverage is absent. Adding a co-located test is out-of-scope churn. The Story 11-1 contract is exercised via the new tool-call handler test, not the display stripper.

## Acceptance Criteria

### 1. Register the `report_correction` tool in the Realtime session config (P1-6 / P2-1; §8.4 architectural)

- [x] **UPDATE** [`src/hooks/use-realtime-voice.ts:726-757`](src/hooks/use-realtime-voice.ts) `tools: [...]` array in `RealtimeConfig`. Add a third tool entry after `save_vocabulary` and `note_error_pattern`:

  ```typescript
  {
    type: "function",
    name: "report_correction",
    description:
      "Report a French-language correction the user needs. Invoke this whenever the user's French contains a grammar / pronunciation / vocabulary / register error worth correcting. Do NOT emit corrections as text in your audio response — invoke this function instead. The function is silent (your audio response is unaffected). Multiple invocations per turn are allowed (one per distinct error).",
    parameters: {
      type: "object",
      properties: {
        original: {
          type: "string",
          description: "The exact French the user said, verbatim (no quotes around it).",
        },
        corrected: {
          type: "string",
          description: "The correct French form.",
        },
        explanation: {
          type: "string",
          description:
            "Brief plain-French explanation of why the correction applies. Avoid nested parentheses. 1-2 sentences.",
        },
        category: {
          type: "string",
          enum: ["grammar", "pronunciation", "vocabulary", "register"],
          description: "The error category. Pick the single best fit.",
        },
      },
      required: ["original", "corrected", "explanation", "category"],
    },
  },
  ```

- [x] **No change to the existing `save_vocabulary` / `note_error_pattern` tool entries** — additive only.

- [x] **`RealtimeConfig.tools` type at [`src/lib/realtime.ts:114-120`](src/lib/realtime.ts)** is permissive enough (`{ type: "function"; name: string; description: string; parameters: Record<string, unknown> }[]`) — no type-system change needed.

**Given** a `useRealtimeVoice` invocation that calls `start()`
**When** the Realtime session config is sent via `session.update`
**Then** the `tools` array contains three entries with names `["save_vocabulary", "note_error_pattern", "report_correction"]` (order unimportant for the API, but the source-code order matches for review-diff readability).

### 2. Add `reportCorrectionArgsSchema` to `src/lib/schemas/ai-responses.ts` (P1-6 typed-validation)

- [x] **UPDATE** [`src/lib/schemas/ai-responses.ts`](src/lib/schemas/ai-responses.ts). Add a new exported schema + inferred type after the existing `speakingTaskEvaluationSchema` block (before the Placement test section header) — co-located with the other realtime / conversation-adjacent schemas:

  ```typescript
  /**
   * `report_correction` Realtime tool-call arguments. Used by `useRealtimeVoice`
   * `handleFunctionCall` to validate the model's tool invocation payload
   * before pushing the correction into the pending-corrections buffer.
   *
   * Story 11-1 — replaces the Story 9-5 / 10-7 `parseCorrections` regex bridge
   * with structured tool-call ingestion. The schema mirrors `Correction` at
   * `src/types/conversation.ts:33-38` — `category` is the same 4-literal
   * union (`"grammar" | "pronunciation" | "vocabulary" | "register"`); the
   * three string fields are non-empty.
   *
   * Validation runs via `schema.safeParse(JSON.parse(args))` inside the
   * tool-call handler. The Realtime path does NOT route through
   * `chatCompletionJSON`, so there is no Story 9-7 retry loop — on parse
   * failure the handler returns "Invalid correction shape; correction not
   * recorded." so the model can self-correct on a subsequent invocation,
   * and a Sentry breadcrumb fires with `feature: "realtime-report-correction"`
   * + the Zod issue code.
   */
  export const correctionCategorySchema = z.enum([
    "grammar",
    "pronunciation",
    "vocabulary",
    "register",
  ]);

  export const reportCorrectionArgsSchema = z.object({
    original: z.string().min(1),
    corrected: z.string().min(1),
    explanation: z.string().min(1),
    category: correctionCategorySchema,
  });

  export type ReportCorrectionArgs = z.infer<typeof reportCorrectionArgsSchema>;
  ```

- [x] **The `correctionCategorySchema` enum** is exported separately so future surfaces (the `note_error_pattern` handler's existing inline `enum: ["grammar", "pronunciation", "vocabulary", "register"]` literal at [`use-realtime-voice.ts:750`](src/hooks/use-realtime-voice.ts)) could consume it as a single source of truth in a future hardening story. **Story 11-1 does NOT refactor the existing `note_error_pattern` handler** to use the new enum — additive only, no `note_error_pattern` surface change.

- [x] **No change** to `mcqOptionSchema` / `mcqQuestionSchema` / `conversationFeedbackSchema` / `placementQuestionSchema` / any other existing schema — additive only.

- [x] **No change** to the `Correction` interface at [`src/types/conversation.ts:33-38`](src/types/conversation.ts). The interface retains its manual 4-field declaration; `ReportCorrectionArgs` is structurally compatible (same field names + types) but kept as a separate name to avoid forcing a sweeping `Correction = z.infer<...>` migration across UI consumers. The schema's field set is a superset of the interface's — `Correction` has no fields the schema doesn't, and vice versa.

**Given** a synthetic `args` JSON string `'{"original":"je suis allé","corrected":"je suis allée","explanation":"feminine agreement","category":"grammar"}'`
**When** `reportCorrectionArgsSchema.safeParse(JSON.parse(args))` runs
**Then** `result.success === true` AND `result.data` is a `Correction`-compatible object.

**Given** a synthetic invalid `args` JSON string `'{"original":"","corrected":"","explanation":"","category":"nonsense"}'`
**When** `reportCorrectionArgsSchema.safeParse(JSON.parse(args))` runs
**Then** `result.success === false` AND `result.error.issues` contains at least one issue with `code: "invalid_type"` or `code: "invalid_enum_value"` or `code: "too_small"`.

### 3. Implement `handleFunctionCall` `report_correction` branch + per-turn buffer (P1-6 / §8.4)

- [x] **UPDATE** [`src/hooks/use-realtime-voice.ts`](src/hooks/use-realtime-voice.ts). Add a new ref alongside the existing refs (e.g., near [`use-realtime-voice.ts:130-136`](src/hooks/use-realtime-voice.ts) where `processedResponseItemsRef` and `inflightItemIdRef` are declared):

  ```typescript
  /**
   * Corrections accumulated during the current AI turn via `report_correction`
   * tool-calls. Drained by the `parseCorrections` callback when `appendIfNew`
   * consumes the terminal `response.output_audio_transcript.done`. Also
   * cleared on `response.done` so an orphaned tool-call without a terminating
   * transcript cannot leak into the next turn. Story 11-1.
   */
  const pendingToolCorrectionsRef = useRef<Correction[]>([]);
  ```

- [x] **UPDATE** [`use-realtime-voice.ts:224-266`](src/hooks/use-realtime-voice.ts) `handleFunctionCall`. Add a new branch handling `name === "report_correction"`:

  ```typescript
  } else if (name === "report_correction") {
    const result = reportCorrectionArgsSchema.safeParse(parsed);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      addBreadcrumb({
        category: "ai",
        level: "warning",
        message: "report_correction args parse failed",
        data: {
          feature: "realtime-report-correction",
          code: firstIssue?.code ?? "unknown",
        },
      });
      sessionRef.current?.sendFunctionResult(
        callId,
        "Invalid correction shape; correction not recorded."
      );
      return;
    }
    pendingToolCorrectionsRef.current.push(result.data);
    sessionRef.current?.sendFunctionResult(callId, "Correction recorded.");
  } else {
  ```

  The `else { sendFunctionResult(callId, "Unknown function.") }` branch is unchanged.

- [x] **Import the schema** at the top of the file. The existing import line at [`use-realtime-voice.ts:26`](src/hooks/use-realtime-voice.ts) — `import { conversationFeedbackSchema } from "@/src/lib/schemas/ai-responses";` — gains `reportCorrectionArgsSchema`:

  ```typescript
  import {
    conversationFeedbackSchema,
    reportCorrectionArgsSchema,
  } from "@/src/lib/schemas/ai-responses";
  ```

- [x] **Reset `pendingToolCorrectionsRef`** in three places, with precise placement (review patch P-pre-1):

  1. **In `start()`** at [`use-realtime-voice.ts:674-684`](src/hooks/use-realtime-voice.ts) — append the line at the END of the existing reset block (after the `userTurnCounterRef.current = 0;` at line 684), so it lives alongside the other `*Ref.current = ...` resets without disturbing the existing block structure:
     ```typescript
     pendingToolCorrectionsRef.current = [];
     ```
  2. **In the `case "response.done"` handler** at [`use-realtime-voice.ts:443-452`](src/hooks/use-realtime-voice.ts) — insert the new block **immediately before** the existing `inflightItemIdRef.current = null;` line (so it executes before the existing in-flight delta accumulator is dropped). The existing `currentAiTextRef.current = "";` and the existing `setState((s) => ({ ...s, isProcessing: false, pendingAiText: "" }));` calls **stay intact unchanged** after the new block:
     ```typescript
     // Drop any pending tool-correction buffer. If a tool-call lands after
     // `response.done` (theoretically possible per the GA API, not observed
     // in practice), the buffer would leak into the next turn — guard against
     // it. Story 11-1.
     if (pendingToolCorrectionsRef.current.length > 0) {
       addBreadcrumb({
         category: "realtime",
         level: "warning",
         message: "Pending tool corrections dropped at response.done",
         data: { category: "report_correction" },
       });
       pendingToolCorrectionsRef.current = [];
     }
     ```
  3. **In the `case "error"` handler** at [`use-realtime-voice.ts:454-484`](src/hooks/use-realtime-voice.ts) — insert **immediately after** the existing `currentAiTextRef.current = "";` line at [line 461](src/hooks/use-realtime-voice.ts) and **before** the `if (event.error.code === "connection_lost") { ... } else { ... }` branch at line 462. This ensures both error sub-branches (`connection_lost` → cleanup + persist; other → leave session) inherit the same buffer-clear. **Silent** clear (no breadcrumb — the parent `case "error"` block already emits `captureError(event.error, "realtime-voice-error")` at line 455, so adding a buffer-clear breadcrumb here would be log-doubling on the error path):
     ```typescript
     pendingToolCorrectionsRef.current = [];
     ```

**Given** the Realtime session emits `response.function_call_arguments.done` with `name: "report_correction"` and valid JSON args
**When** `handleFunctionCall` processes the event
**Then** `pendingToolCorrectionsRef.current` contains the new `Correction` object AND `sessionRef.current.sendFunctionResult(callId, "Correction recorded.")` is invoked.

**Given** the Realtime session emits `response.function_call_arguments.done` with `name: "report_correction"` and INVALID args (e.g., missing `category` field)
**When** `handleFunctionCall` processes the event
**Then** `pendingToolCorrectionsRef.current` is unchanged AND `sessionRef.current.sendFunctionResult(callId, "Invalid correction shape; correction not recorded.")` is invoked AND a Sentry breadcrumb fires with `feature: "realtime-report-correction"` + `code: <ZodIssueCode>`.

### 4. Rewrite `parseCorrections` to drain the pending-buffer; delete `inferCategory` (P1-6 — regex deleted)

- [x] **REPLACE** [`use-realtime-voice.ts:142-171`](src/hooks/use-realtime-voice.ts) (the `inferCategory` + `parseCorrections` callbacks) with a new single callback that drains the per-turn buffer:

  ```typescript
  /**
   * Drain the per-turn `report_correction` tool-call buffer.
   *
   * Story 11-1 — replaces the pre-11-1 regex parser
   * (`/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g`) and the keyword-matching
   * `inferCategory` heuristic. Both are deleted (Story 10-2 "delete don't
   * alias" pattern). Corrections now arrive structurally via the
   * `report_correction` tool-call; the model classifies `category` directly.
   *
   * Called by `appendIfNew` (`src/lib/realtime-transcript.ts`) when the
   * terminal `response.output_audio_transcript.done` fires for an AI turn.
   * Signature is preserved as `(text: string) => Correction[]` so the pure
   * helper module's `AppendOptions.parseCorrections` contract is NOT touched
   * (Story 9-5 invariant). The `text` parameter is ignored.
   */
  const parseCorrections = useCallback((_text: string): Correction[] => {
    const drained = pendingToolCorrectionsRef.current;
    pendingToolCorrectionsRef.current = [];
    return drained;
  }, []);
  ```

  **No drain-empty breadcrumb.** An earlier draft of this story considered emitting a `level: "info"` breadcrumb on every empty drain (i.e., every AI turn that produced no corrections). Rejected during review because a typical 5–10 minute conversation has 15–30 user turns and most produce no corrections — that would flood Sentry with low-signal noise. The presence-of-corrections signal is reachable via the existing breadcrumbs that fire on tool-call invocations (one breadcrumb per `report_correction` invoke); the absence-of-corrections signal is uninteresting in isolation.

- [x] **DELETE the `inferCategory` callback entirely.** Verified post-delete by `grep -n "inferCategory" src/` returning zero matches.

- [x] **DELETE the regex pattern `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g`** from `src/hooks/`. Verified by `grep -rn '\(\\[^\\)\\]\\+\\)' src/hooks/` not matching this specific pattern. The same regex pattern in `src/components/conversation/TranscriptView.tsx:66` `getDisplayText` for legacy sentinel detection is **retained** (it strips display-only text from pre-11-1 stored transcripts; not a parser).

- [x] **NO change to `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP`** at [`src/lib/realtime-transcript.ts`](src/lib/realtime-transcript.ts) — Story 9-5 invariants preserved.

- [x] **NO change to `appendAiTranscriptEntry`** at [`use-realtime-voice.ts:275-330`](src/hooks/use-realtime-voice.ts) — it calls `appendIfNew(..., { parseCorrections, onDedup })` and continues to pass the new (drain-based) `parseCorrections` callback by reference. The dedup, inflight-item handling, and state-update chain all stay identical.

**Given** the AI turn invokes `report_correction` twice (e.g., one grammar correction + one register correction) before its terminal audio-transcript event fires
**When** `appendIfNew` runs and calls `parseCorrections(text)` to attach corrections to the new assistant entry
**Then** the returned array has length 2 AND the buffer is empty AND `entry.corrections` on the appended assistant entry has length 2.

**Given** the AI turn invokes no tools
**When** `appendIfNew` runs and calls `parseCorrections(text)` on the terminal transcript event
**Then** the returned array has length 0 AND `entry.corrections` is `undefined` (per `appendIfNew`'s existing `newCorrections.length > 0 ? newCorrections : undefined` branch at [`realtime-transcript.ts:144`](src/lib/realtime-transcript.ts)).

### 5. Replace the `## Correction Report (Plain Text — Read Aloud)` prompt block (P2-1; §8.4 architectural)

- [x] **UPDATE** [`src/lib/prompts/conversation.ts:62-76`](src/lib/prompts/conversation.ts). **Delete** the entire `## Correction Report (Plain Text — Read Aloud)` block (15 lines) and **replace** with a new `## Correction Reporting (Tool-Call)` block:

  ```
  ## Correction Reporting (Tool-Call)
  When the user's French contains an error worth correcting (grammar, pronunciation, vocabulary, or register), invoke the `report_correction` function. Do NOT speak the correction as part of your audio response and do NOT emit any correction text or summary — invoke the function silently while continuing the natural conversation. The function takes four required arguments:
  - `original`: the user's exact French verbatim (no surrounding quotes)
  - `corrected`: the correct French form
  - `explanation`: brief plain-French explanation, 1-2 sentences, no nested parentheses
  - `category`: one of `"grammar"`, `"pronunciation"`, `"vocabulary"`, `"register"`

  You may invoke `report_correction` multiple times within a single response if the user made multiple distinct errors. Skip invocation when an error does NOT change the meaning and would interrupt the conversational flow — Story 10-7 "Do NOT interrupt the user's conversational flow to correct errors" guidance still applies. Your spoken French response continues to weave in pedagogical encouragement naturally; the structured correction data is for the post-conversation analytics surface and is invisible to the audio modality.
  ```

- [x] **The pre-11-1 lines deleted** (Story 10-7's Correction Report block):

  ```
  ## Correction Report (Plain Text — Read Aloud)
  Your full response will be spoken aloud verbatim by text-to-speech. Do NOT use markdown formatting (no asterisks, no bullet symbols, no horizontal rules) and do NOT use emoji. At the END of each response, after responding to the user naturally, briefly note any corrections in plain spoken French.

  Use this exact line shape for each correction so the post-conversation parser can extract them:
  "What the user said" → "Correct form" (brief explanation in plain French)

  Formatting rules for the correction line (CRITICAL — the post-conversation parser depends on this exact shape):
  - Use ASCII straight double quotes (") for the quoted text — NOT French guillemets («, ») and NOT curly typographic quotes (", "). The arrow is the literal character →.
  - Do NOT nest parentheses inside the explanation — use commas, em-dashes, or simple phrasing instead. The parser terminates the explanation at the first closing parenthesis.
  - One correction per line. If you have multiple corrections, put each on its own line in the same shape.

  Then on the next line:
  Tip: [one specific, actionable tip to improve, in plain French]

  If the user made no errors, write the literal text No corrections. on one line (no quotes around it), and Tip: <suggestion in plain French> on the next.
  ```

  Verified deleted by `grep -n "Correction Report (Plain Text — Read Aloud)\|For each correction\|No corrections\.\|Tip: " src/lib/prompts/conversation.ts` returning zero matches.

- [x] **The position of the new block** is the same position as the deleted block (between `buildVocabularyConstraintBlock(cefrLevel)` and `## Idiom Injection`) — verified by re-reading the file post-edit. The `<USER_FACTS>` / `<USER_WEAK_AREAS>` Story 9-4 wrappers at the bottom of the prompt are NOT touched.

- [x] **The `mode === "debate"` block at [`conversation.ts:106-124`](src/lib/prompts/conversation.ts)** (Story 10-7's 3-category split: Connecteurs / Locutions verbales figées / Déclencheurs du subjonctif) is **NOT touched** — verified by re-reading the file post-edit + by the existing `conversation.test.ts` Story 10-7 debate-mode test cases staying green.

- [x] **The `mode === "tcf_simulation"` block at [`conversation.ts:127-150`](src/lib/prompts/conversation.ts)** is **NOT touched** — Story 10-7 review patch P4 already dropped the `**bold**` markdown; Story 11-1 makes no further changes there.

**Given** `buildConversationPrompt({ cefrLevel: "B1", mode: "companion", topic: "voyages" })`
**When** the rendered prompt is inspected
**Then** the prompt contains the substring `"## Correction Reporting (Tool-Call)"` AND contains the substring `"invoke the \`report_correction\` function"` AND does NOT contain `"## Correction Report (Plain Text — Read Aloud)"` AND does NOT contain `"User said\" → \"Correct form\""` (the legacy regex example) AND does NOT contain the literal `"No corrections."` sentinel AND does NOT contain a standalone `"Tip:"` line at the prompt level.

**Given** `buildConversationPrompt({ cefrLevel: "B2", mode: "debate", topic: "politique étrangère" })`
**When** the rendered prompt is inspected
**Then** the prompt still contains `"Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part"` (Story 10-7 surface verified-correct) AND still contains `"Locutions verbales figées (fixed expressions): Force est de constater que"` (Story 10-7 surface verified-correct) AND contains the new `"## Correction Reporting (Tool-Call)"` block (mode-agnostic).

**Given** `buildConversationPrompt({ cefrLevel: "C1", mode: "tcf_simulation", topic: "..." })`
**When** the rendered prompt is inspected
**Then** the prompt still contains `"Task 1 (2 minutes):"` / `"Task 2 (5.5 minutes):"` / `"Task 3 (4.5 minutes):"` plain-text task headers (Story 10-7 P4 surface verified-correct) AND contains the new `"## Correction Reporting (Tool-Call)"` block.

### 6. Update `TranscriptView.getDisplayText` JSDoc + retain legacy sentinels (P1-6 / §8.4 forward-compat with stored history)

- [x] **UPDATE** [`src/components/conversation/TranscriptView.tsx:42-60`](src/components/conversation/TranscriptView.tsx) JSDoc only (not the function body). Add a Story 11-1 clarification:

  ```
   * Post-Story-11-1: corrections arrive via the `report_correction`
   * tool-call (Story 11-1) instead of being embedded as text. New post-11-1
   * assistant turns will never trigger any of the sentinels below — the
   * model has no instruction to emit a Correction Report text block in its
   * audio response. The sentinel-based stripper is retained ONLY for:
   *   - In-flight pre-11-1 conversations rendered before the prompt update
   *     fully propagates (rare during the deploy window).
   *   - Historical conversation messages stored in `conversation_messages`
   *     before Story 11-1 shipped (rendered via the conversation history
   *     screen at `app/(tabs)/conversation/history.tsx`).
   * The strip logic is therefore a forward-compat / backward-compat shim,
   * not a load-bearing parser.
  ```

- [x] **No change to the function body** at [`TranscriptView.tsx:62-90`](src/components/conversation/TranscriptView.tsx) — the sentinel detection (correction-line shape + `No corrections.` + `Tip:` + legacy `---\n`) is retained byte-for-byte.

- [x] **No change to `CorrectionBubble`** at [`src/components/conversation/CorrectionBubble.tsx`](src/components/conversation/CorrectionBubble.tsx) — it consumes `Correction[]` arrays; the array shape is unchanged.

**Given** a stored pre-11-1 `ConversationMessage.content` containing `"Bonjour ! "je suis allé" → "je suis allée" (feminine agreement)\nTip: review past participle agreement."`
**When** `getDisplayText` is invoked
**Then** the returned string is `"Bonjour !"` (the legacy correction-line sentinel still fires).

**Given** a post-11-1 `ConversationMessage.content` containing plain-text French audio transcription (no correction-line text shape)
**When** `getDisplayText` is invoked
**Then** the returned string is the input verbatim (no sentinel fires).

### 7. Test surface

- [x] **EXTEND** [`src/lib/schemas/__tests__/ai-responses.test.ts`](src/lib/schemas/__tests__/ai-responses.test.ts). Add a new `describe("reportCorrectionArgsSchema", ...)` block:

  ```typescript
  describe("reportCorrectionArgsSchema (Story 11-1)", () => {
    it("accepts a well-formed grammar correction", () => {
      const result = reportCorrectionArgsSchema.safeParse({
        original: "je suis allé",
        corrected: "je suis allée",
        explanation: "Accord du participe passé avec être au féminin.",
        category: "grammar",
      });
      expect(result.success).toBe(true);
    });

    it.each(["grammar", "pronunciation", "vocabulary", "register"] as const)(
      "accepts category=%s",
      (category) => {
        const result = reportCorrectionArgsSchema.safeParse({
          original: "x",
          corrected: "y",
          explanation: "z",
          category,
        });
        expect(result.success).toBe(true);
      }
    );

    it("rejects category outside the 4-literal union", () => {
      const result = reportCorrectionArgsSchema.safeParse({
        original: "x",
        corrected: "y",
        explanation: "z",
        category: "nonsense",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].code).toBe("invalid_enum_value");
      }
    });

    it("rejects empty strings on any of the three string fields", () => {
      for (const field of ["original", "corrected", "explanation"] as const) {
        const result = reportCorrectionArgsSchema.safeParse({
          original: "a",
          corrected: "b",
          explanation: "c",
          category: "grammar",
          [field]: "",
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects missing required fields", () => {
      const result = reportCorrectionArgsSchema.safeParse({
        original: "a",
        corrected: "b",
        // explanation missing
        category: "grammar",
      });
      expect(result.success).toBe(false);
    });

    it("ReportCorrectionArgs is structurally compatible with Correction", () => {
      // Compile-time: assignability check via const assertion. If the schema
      // ever diverges from the Correction interface, this fails type-check.
      const args: ReportCorrectionArgs = {
        original: "x",
        corrected: "y",
        explanation: "z",
        category: "grammar",
      };
      const correction: import("@/src/types/conversation").Correction = args;
      void correction;
    });
  });
  ```

- [x] **EXTEND** [`src/lib/prompts/__tests__/conversation.test.ts`](src/lib/prompts/__tests__/conversation.test.ts). Add a new `describe("buildConversationPrompt — Story 11-1 tool-call Correction Reporting", ...)` block:

  ```typescript
  describe("buildConversationPrompt — Story 11-1 tool-call Correction Reporting", () => {
    it.each(ALL_LEVELS)("%s — contains the new tool-call block header", (cefrLevel) => {
      const prompt = buildConversationPrompt({ cefrLevel, mode: "companion", topic: "voyages" });
      expect(prompt).toContain("## Correction Reporting (Tool-Call)");
      expect(prompt).toContain("invoke the `report_correction` function");
      expect(prompt).toContain("`category`: one of `\"grammar\"`, `\"pronunciation\"`, `\"vocabulary\"`, `\"register\"`");
    });

    it.each(ALL_MODES)("mode %s — drops the legacy Correction Report block", (mode) => {
      const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "voyages" });
      expect(prompt).not.toContain("## Correction Report (Plain Text — Read Aloud)");
      expect(prompt).not.toContain('"User said" → "Correct form"');
      expect(prompt).not.toContain("No corrections.");
      // Negative: the prompt-level "Tip:" directive line that lived in the
      // legacy block is gone. Note: "Tip:" may legitimately appear inside
      // example utterances elsewhere; assert specifically against the
      // legacy directive line shape.
      expect(prompt).not.toMatch(/^Tip: \[/m);
    });

    it.each(ALL_MODES)(
      "mode %s — does NOT contain the legacy parser-format ASCII-quote instructions",
      (mode) => {
        const prompt = buildConversationPrompt({ cefrLevel: "B1", mode, topic: "voyages" });
        // The pre-11-1 prompt contained a "CRITICAL — the post-conversation
        // parser depends on this exact shape" sub-block; gone post-11-1.
        expect(prompt).not.toContain("the post-conversation parser depends on this exact shape");
        expect(prompt).not.toContain("Use ASCII straight double quotes");
      }
    );

    it("Story 10-7 debate-mode 3-category split is preserved", () => {
      const prompt = buildConversationPrompt({ cefrLevel: "B2", mode: "debate", topic: "politique" });
      expect(prompt).toContain(
        "Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part"
      );
      expect(prompt).toContain("Locutions verbales figées (fixed expressions): Force est de constater que");
      expect(prompt).toContain("Déclencheurs du subjonctif (subjunctive triggers): Bien que (+ subjonctif), Quand bien même");
    });
  });
  ```

- [x] **DELETE the Story 10-7 `parseCorrections`-regex-compatibility test cases** from [`src/lib/prompts/__tests__/conversation.test.ts`](src/lib/prompts/__tests__/conversation.test.ts) — search the file for `PARSE_CORRECTIONS_REGEX` consumer cases and remove them along with the constant declaration. The regex is deleted from production code; the mirror test has no contract to verify. (Note: the Story 10-7 emoji-guard + horizontal-rule + Correction Report instruction tests CAN stay — they continue to assert that the new Correction Reporting block ALSO emits no emoji and no `---`. Re-read those tests and update the block-scope regex from `"## Correction Report (Plain Text — Read Aloud)"` to `"## Correction Reporting (Tool-Call)"`.)

- [x] **DELETE** [`src/lib/__tests__/realtime-dedup.test.ts`](src/lib/__tests__/realtime-dedup.test.ts) Case 14 + the `parseCorrectionsForTest` mirror function at lines 31-45. The production regex is deleted; the mirror has no contract to verify. Re-confirm by re-reading the file post-edit. **All other cases in this file stay green** — Story 9-5's dedup contract is what's being tested; the corrections-extraction-via-callback is a passing-through detail.

- [x] **CREATE** [`src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts`](src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts) (new file — `src/hooks/__tests__/` already exists from Story 10-8 `use-exercise.test.ts`). Test the `handleFunctionCall` `report_correction` branch via a pure unit-test extraction of the handler logic — mock `RealtimeSession` to capture `sendFunctionResult` calls. **Avoid rendering the hook**; extract a testable pure helper if needed. Cases:

  1. Valid `report_correction` args → buffer gains entry + `sendFunctionResult(callId, "Correction recorded.")` invoked.
  2. Invalid `report_correction` args (missing field) → buffer unchanged + `sendFunctionResult(callId, "Invalid correction shape; correction not recorded.")` + Sentry breadcrumb with `feature: "realtime-report-correction"` + `code` from Zod issue.
  3. Multiple `report_correction` invocations in one turn → buffer accumulates all; drain returns all in insertion order.
  4. `parseCorrections` drain returns + clears buffer (post-drain length === 0).
  5. `response.done` clears non-empty buffer + emits "Pending tool corrections dropped at response.done" breadcrumb.
  6. `case "error"` clears non-empty buffer (synthetic `connection_lost` error event).

  If extracting a pure helper would require non-trivial hook refactor, scope this test to **just the `reportCorrectionArgsSchema` validation path** + the **drain semantics of the new `parseCorrections` callback** by exercising them as standalone functions exported from a thin `src/lib/realtime-corrections.ts` module that Story 11-1 also creates (containing `drainPendingCorrections(ref: { current: Correction[] }): Correction[]`). The hook then imports and uses this pure helper, making the unit test trivial. Dev agent picks the testing approach that gives the cleanest separation; both are acceptable.

- [x] **ADD a speaking-score formula baseline-pin test** (review enhancement #3). The post-conversation flow at [`use-realtime-voice.ts:609-615`](src/hooks/use-realtime-voice.ts) computes `speakingScore = Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))`. The formula is unchanged by Story 11-1, but the input (`correctedEntries`) is now more accurate post-11-1, so any future tuning of the formula (a separate story) needs a regression baseline. Add a pure-helper extraction `computeSpeakingScore(totalUserEntries: number, correctedEntries: number): number` in a small `src/lib/speaking-score.ts` module (or inline in `use-realtime-voice.ts` and exported as a named function), with a co-located test pinning at least 5 cases: `(0, 0) → 70` (default), `(10, 0) → 100`, `(10, 1) → 97`, `(10, 5) → 85`, `(10, 10) → 70`, `(2, 2) → 70` (boundary), `(1, 10) → 20` (cap floor). This is a small but load-bearing baseline — without it, the next person who tunes the formula has nothing to diff against.

- [x] **VERIFY existing tests stay green** (no regression):

  - `src/lib/__tests__/prompt-injection.test.ts` — `buildConversationPrompt` `<USER_FACTS>` / `<USER_WEAK_AREAS>` describe block stays green (Story 9-4 invariant).
  - `src/lib/__tests__/realtime-dedup.test.ts` Cases 1-13 + 15+ — `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` contract stays green (Story 9-5 invariant). Case 14 is the only one removed.
  - `src/lib/prompts/__tests__/conversation.test.ts` Story 10-7 emoji-guard + debate-mode 3-category split cases stay green (with the Correction Report block header swapped to "Correction Reporting (Tool-Call)" in the block-scope regex).
  - `src/lib/prompts/__tests__/passage-calibration.test.ts` (Story 10-3), `vocabulary-tiers.test.ts` + `vocabulary-integration.test.ts` (Story 10-4), `placement.test.ts` (Story 10-5), `speaking.test.ts` (Story 9-8 / 10-6), `writing.test.ts` (Story 10-7), `listening.test.ts` (Story 10-7), `cefr.test.ts` (Story 10-7), `tcf-spec.test.ts`, `chat-completion-json.test.ts` (Story 9-7) all stay green — Story 11-1 does NOT touch their surfaces.
  - `src/lib/schemas/__tests__/ai-responses.test.ts` all pre-existing cases stay green — additive only.

- [x] **TARGET TEST COUNT POST-STORY:** 894 → 910-925 (estimate: ~10 new `reportCorrectionArgsSchema` cases + ~8 new `buildConversationPrompt` tool-call-block cases + 6 new tool-call handler cases = ~24 new, minus 1 removed `realtime-dedup` Case 14 + ~4 removed Story 10-7 regex-compat cases = net +19 to +25).

### 8. Update `docs/tcf-spec-citations.md §8` row 4 (P2-1 / §8.4 — architectural closure)

- [x] **UPDATE** [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) row 4 (the voice-mode emoji output row owned by Story 10-7 with ✓ Verified-with-caveat status). Flip to **✓ Verified** and replace the Story 10-7 trailer with a Story 11-1 trailer:

  ```
  | `src/lib/prompts/conversation.ts` `## Correction Reporting (Tool-Call)` block (consumed by `src/hooks/use-realtime-voice.ts:670` Realtime session) + `report_correction` Realtime tool-call handler at `src/hooks/use-realtime-voice.ts:224-266` + `reportCorrectionArgsSchema` at `src/lib/schemas/ai-responses.ts` | Corrections arrive via the `report_correction` Realtime tool-call (structured `{ original, corrected, explanation, category }`); the legacy Correction Report text block is removed entirely from the prompt; TTS no longer reads correction-summary text at all. | §8.4 — TTS reads asterisks/emoji literally; brittle regex extraction silently zeros out corrections (P1-6 + P2-1) | ✓ Verified 2026-05-11 — closed by Story 11-1 (architectural successor to Story 10-7's minimum-viable bridge); P1-6 brittle-regex finding closes (regex deleted, structured tool-call replaces it); P2-1 voice-mode-emoji finding closes architecturally (the prompt block that was the emoji failure mode is removed entirely — no correction text on the audio side). |
  ```

- [x] **NO change** to §8 rows 1, 2, 3 (Story 10-7's other three closures: A2 `nameFr`, Québécois drop, Force est de constater classification) — Story 11-1 only owns row 4.

- [x] **NO change** to §1, §2, §3, §4, §5, §6, §7, §9, §10, §11 of the citations matrix — Story 11-1 is scoped to §8.4.

### 9. Update `docs/tcf-spec-source.md §8.4`

- [x] **UPDATE** [`docs/tcf-spec-source.md §8.4`](docs/tcf-spec-source.md). Append a Story 11-1 closure stamp after the existing Story 10-7 "DONE — closed by Story 10-7" closure stamp:

  ```
  **ARCHITECTURAL SUCCESSOR DONE — closed by Story 11-1 on 2026-05-11.** Story 10-7's minimum-viable bridge (strip emoji + markdown decoration from the Correction Report block; preserve the regex contract) is superseded. The Correction Report text block is removed entirely from `buildConversationPrompt`; corrections now arrive via the new `report_correction` Realtime tool-call (`src/hooks/use-realtime-voice.ts:224-266` handler + `src/lib/schemas/ai-responses.ts` `reportCorrectionArgsSchema` validator). The brittle regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` and the `inferCategory` keyword-matching heuristic are both deleted (Story 10-2 "delete don't alias" pattern). The model emits no correction text on the audio side at all; the TTS-reads-asterisks failure mode is structurally impossible because the prompt block that instructed the model to emit asterisks no longer exists. Audit findings P1-6 (silent zero-correction failures from regex brittleness) and P2-1 (voice-mode emoji formatting) both close architecturally. The `TranscriptView.getDisplayText` legacy sentinel stripper at `src/components/conversation/TranscriptView.tsx:42-90` is retained as a forward-compat / backward-compat shim for pre-11-1 stored transcripts in `conversation_messages` (rendered via the conversation history screen).
  ```

- [x] **NO change** to §8.1, §8.2, §8.3 (Story 10-7 closure stamps unchanged) — Story 11-1 only owns the §8.4 closure.

- [x] **NO change** to §1-§7 or §9-§11 of the spec — Story 11-1 is scoped to §8.4.

### 10. Update CLAUDE.md

- [x] **UPDATE** [`CLAUDE.md`](CLAUDE.md). Add a new architecture line **after** the Story 10-8 "TCF exercise anti-repetition" line (chronological order):

  ```markdown
  **Realtime correction tool-call protocol:** post-Epic-11.1, the Story 10-7 minimum-viable bridge (strip emoji + markdown decoration from the Correction Report block; preserve the regex contract at `src/hooks/use-realtime-voice.ts:152-171` `parseCorrections` reading `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` from the assistant's plain-text Correction Report) is superseded by structured Realtime tool-call ingestion. `src/lib/prompts/conversation.ts` `buildConversationPrompt` drops the entire `## Correction Report (Plain Text — Read Aloud)` block (15 lines deleted — Story 10-2 "delete don't alias") and replaces it with a `## Correction Reporting (Tool-Call)` block instructing the model to invoke `report_correction({ original, corrected, explanation, category })` whenever it detects an error in the user's French (mode-agnostic: companion + debate + tcf_simulation all share the same tool-call instruction). The `tools: [...]` array in `useRealtimeVoice`'s `RealtimeConfig` gains a third entry alongside the existing `save_vocabulary` and `note_error_pattern` tools; the new tool's `parameters` JSON schema constrains `category` to the same 4-literal union (`"grammar" | "pronunciation" | "vocabulary" | "register"`) as `Correction["category"]` at `src/types/conversation.ts`. Runtime validation lives in the new `reportCorrectionArgsSchema` at `src/lib/schemas/ai-responses.ts` (alongside `correctionCategorySchema` exported for future single-source-of-truth use). On `response.function_call_arguments.done` for `name === "report_correction"`, `handleFunctionCall` `safeParse`s args → on success pushes to the new `pendingToolCorrectionsRef` per-turn buffer + `sendFunctionResult(callId, "Correction recorded.")`; on failure breadcrumbs `feature: "realtime-report-correction"` + ZodIssueCode + `sendFunctionResult(callId, "Invalid correction shape; correction not recorded.")` so the model can self-correct. The buffer is drained by the new `parseCorrections` callback (signature preserved per Story 9-5 contract — pure helper module at `src/lib/realtime-transcript.ts` NOT touched; the `text` parameter is ignored and `pendingToolCorrectionsRef.current` is returned + cleared); buffer is also cleared on `response.done` and on `case "error"` so an orphaned tool-call without a terminating transcript cannot leak into the next turn. The `inferCategory` keyword-matching heuristic at `use-realtime-voice.ts:142-149` is **deleted** — categories arrive structurally from the AI's tool-call invocation. Closes audit findings P1-6 (brittle regex silent-zero failures) and P2-1 (voice-mode emoji format) **architecturally** — the failure modes are structurally impossible post-11-1 because the prompt block + regex + heuristic that made them possible all no longer exist. `docs/tcf-spec-citations.md §8` row 4 flips ✓ Verified-with-caveat → ✓ Verified. The `TranscriptView.getDisplayText` legacy sentinel stripper at `src/components/conversation/TranscriptView.tsx:42-90` is retained as a forward-compat / backward-compat shim for pre-11-1 stored transcripts (rendered via `app/(tabs)/conversation/history.tsx`). The post-conversation flow at `use-realtime-voice.ts:592-627` (`extractErrorsFromCorrections` → `updateSkillProgress("speaking")` → `incrementDailyActivity` → `updateStreak` → `checkCefrPromotion`) consumes `correctionsRef.current` with NO downstream change; the speaking-score formula `Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))` at `use-realtime-voice.ts:611-614` may produce slightly more pessimistic scores post-11-1 (the regex's silent-zero failure mode no longer suppresses real corrections) — documented as a correctness improvement, not a regression. Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude) and Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` + FIFO-capped 256-entry dedup Set) and Story 9-7 Zod-schema retry contract (`chatCompletionJSON` path is separate — Realtime path uses one-shot `safeParse` + breadcrumb without retry loop) and Story 9-8 / 10-6 speaking pipeline (separate record-and-grade flow via `chatCompletionJSON(speakingTaskEvaluationSchema)` — not Realtime) and Story 10-7 debate-mode 3-category split + `CEFR_LEVELS` `nameFr` Alliance Française convention + Québécois drop + `force est de constater` echo fixes in `writing.ts` / `placement.ts` all hold unchanged. Verified 2026-05-11, story 11-1.
  ```

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 11-1 does NOT introduce or modify any `.github/workflows/*.yml` file. The Story 9-9 GHA injection-vector guard pattern is unused here.

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — applicable to the new `handleFunctionCall` `report_correction` branch (the existing `} catch (err) { captureError(err, "function-call-handler"); ... }` block at [`use-realtime-voice.ts:260-263`](src/hooks/use-realtime-voice.ts) covers the new branch by inheritance — no new catch block introduced).
- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — **N/A** (no UI changes; CorrectionBubble + TranscriptView styling unchanged).
- [x] All loading states use skeleton animations — **N/A** (no UI changes).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A** (no UI changes).
- [x] Non-obvious interactions have `accessibilityHint` — **N/A** (no UI changes).
- [x] Stateful elements have `accessibilityState` — **N/A** (no UI changes).
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A** (no UI changes).
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` — **N/A** (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **Citations matrix completeness test** in [`src/lib/__tests__/tcf-spec.test.ts`](src/lib/__tests__/tcf-spec.test.ts) continues to pass — the §8 row 4 update is content-only (no row added / removed).
- [x] **Sentry DSN leak guard** + **Submit credentials leak guard** in `ci.yml` continue to pass (no DSN / credential changes; no `[A-Z0-9]{10}` or `[0-9]{10}` literals in `src/`).
- [x] **Story 9-4 stored-prompt-injection defense holds** — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude at [`conversation.ts:158-194`](src/lib/prompts/conversation.ts) NOT modified. Verified by re-reading the lines post-edit + the `prompt-injection.test.ts` `buildConversationPrompt` describe block staying green.
- [x] **Story 9-5 voice transcript dedup holds** — `output_modalities: ["audio"]` config in `realtime.ts:288` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP` in `realtime-transcript.ts` NOT modified. Verified by `realtime-dedup.test.ts` Cases 1-13 + 15+ staying green (Case 14 is deleted with the production regex).
- [x] **Story 9-7 Zod schema retry contract holds** — `chatCompletionJSON` is unchanged. The `report_correction` tool-call uses a one-shot `safeParse` + breadcrumb (different path; no `chatCompletionJSON` retry loop applies). Verified by `chat-completion-json.test.ts` staying green.
- [x] **Story 9-8 / 10-6 speaking pipeline holds** — `transcribe → chatCompletionJSON(speakingTaskEvaluationSchema)` flow at `app/(tabs)/mock-test/speaking.tsx` NOT touched. Verified by `speaking-mock-test-persist.test.ts` + `speaking-evaluator.test.ts` + `speaking-scoring.test.ts` staying green.
- [x] **Story 10-2 per-skill scoring contract holds** — `rawPercentToListeningReadingScore` / `rawPercentToWritingSpeakingScore` / `IRCC_CLB_BANDS` NOT touched.
- [x] **Story 10-3 per-CEFR passage ranges contract holds** — listening / reading / writing word ranges NOT touched.
- [x] **Story 10-4 vocabulary-tier integration holds** — `buildVocabularyConstraintBlock(cefrLevel)` continues to render between `## Language Adaptation` and `## Correction Reporting (Tool-Call)` blocks in `buildConversationPrompt`. Verified by `vocabulary-integration.test.ts` staying green.
- [x] **Story 10-5 placement-test contract holds** — `buildPlacementTestPrompt` + `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` NOT touched.
- [x] **Story 10-7 surfaces hold** — debate-mode 3-category split + `CEFR_LEVELS.nameFr` Alliance Française convention + Québécois drop in `listening.ts` + `force est de constater` echo fixes in `writing.ts` / `placement.ts` NOT touched. Verified by `conversation.test.ts` (Story 10-7 describe blocks) + `cefr.test.ts` + `listening.test.ts` + `writing.test.ts` + `placement.test.ts` staying green.
- [x] **Story 10-8 exercise dedup contract holds** — `extractExerciseHashes` / `text-hash.ts` / `question_stem_hashes` column NOT touched (separate exercise surface, not voice).
- [x] **`save_vocabulary` + `note_error_pattern` tool-call handlers** continue to work — additive only; no behavioral change to the two existing handlers.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/11-1-correction-protocol-tool-calls.md`) under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/11-1-correction-protocol-tool-calls.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] Task 1: Add `reportCorrectionArgsSchema` to `src/lib/schemas/ai-responses.ts` (AC #2)
  - [x] Add `correctionCategorySchema` (`z.enum([...])`) above the new args schema
  - [x] Add `reportCorrectionArgsSchema` (`z.object({...})`) with non-empty strings + enum category
  - [x] Export `ReportCorrectionArgs = z.infer<typeof reportCorrectionArgsSchema>` type alias
  - [x] Add JSDoc citing Story 11-1, the Realtime path, and the "no retry loop" rationale

- [x] Task 2: Register the `report_correction` tool in `RealtimeConfig.tools` (AC #1)
  - [x] Append the third tool entry to the `tools: [...]` array at `use-realtime-voice.ts:726-757`
  - [x] Verify the entry's `parameters.properties.category.enum` matches the schema's literal tuple
  - [x] Source-order: `save_vocabulary` → `note_error_pattern` → `report_correction` for review-diff readability

- [x] Task 3: Implement the `report_correction` handler branch + per-turn buffer (AC #3)
  - [x] Add `pendingToolCorrectionsRef = useRef<Correction[]>([])` alongside existing refs
  - [x] Add `import { reportCorrectionArgsSchema } from "@/src/lib/schemas/ai-responses";` to the imports
  - [x] Add the new `} else if (name === "report_correction")` branch to `handleFunctionCall`
  - [x] On valid: push to buffer + `sendFunctionResult(callId, "Correction recorded.")`
  - [x] On invalid: Sentry breadcrumb (`feature: "realtime-report-correction"`, `code: <ZodIssueCode>`) + `sendFunctionResult(callId, "Invalid correction shape; correction not recorded.")`
  - [x] Reset buffer in `start()` alongside the other ref resets
  - [x] Reset buffer in `case "response.done"` (with Sentry breadcrumb if non-empty)
  - [x] Reset buffer in `case "error"` (silent — the error itself is already breadcrumbed)

- [x] Task 4: Rewrite `parseCorrections` to drain the buffer; delete `inferCategory` + regex (AC #4)
  - [x] Replace the `parseCorrections` body with the buffer-drain pattern (signature preserved)
  - [x] Delete the entire `inferCategory` useCallback at `use-realtime-voice.ts:142-149`
  - [x] Delete the regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` from the source — verified by grep
  - [x] Confirm `appendAiTranscriptEntry` still references `parseCorrections` correctly (no signature change)

- [x] Task 5: Replace the Correction Report prompt block (AC #5)
  - [x] Delete the 15-line `## Correction Report (Plain Text — Read Aloud)` block in `conversation.ts:62-76`
  - [x] Insert the new `## Correction Reporting (Tool-Call)` block at the same position
  - [x] Verify the new block mentions all 4 required arguments (`original`, `corrected`, `explanation`, `category`) + the 4-literal enum
  - [x] Verify the new block contains the "Skip invocation when an error does NOT change the meaning" clause to preserve Story 10-7's "don't interrupt conversational flow" guidance
  - [x] Verify `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers at the bottom of the prompt are unchanged
  - [x] Verify the `mode === "debate"` block at `conversation.ts:106-124` is unchanged
  - [x] Verify the `mode === "tcf_simulation"` block at `conversation.ts:127-150` is unchanged

- [x] Task 6: Update `TranscriptView.getDisplayText` JSDoc (AC #6)
  - [x] Add Story 11-1 clarification to the JSDoc at `TranscriptView.tsx:42-60`
  - [x] Verify the function body at lines 62-90 is unchanged

- [x] Task 7: Test surface (AC #7)
  - [x] EXTEND `src/lib/schemas/__tests__/ai-responses.test.ts` with the `reportCorrectionArgsSchema` describe block (6 cases: well-formed, parameterized category, invalid category, empty-string-field-rejection, missing-field-rejection, ReportCorrectionArgs ↔ Correction compat)
  - [x] EXTEND `src/lib/prompts/__tests__/conversation.test.ts` with the Story 11-1 tool-call Correction Reporting describe block (4 describe blocks × parameterizations: ~10-15 cases)
  - [x] DELETE the Story 10-7 `PARSE_CORRECTIONS_REGEX` constant + cases that consume it in `conversation.test.ts` (regex is deleted from production code)
  - [x] UPDATE the Story 10-7 Correction Report block-scope regex in `conversation.test.ts` from `"## Correction Report (Plain Text — Read Aloud)"` to `"## Correction Reporting (Tool-Call)"`
  - [x] DELETE Case 14 + `parseCorrectionsForTest` mirror function from `src/lib/__tests__/realtime-dedup.test.ts` (regex is deleted from production code)
  - [x] CREATE `src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts` (or `src/lib/__tests__/realtime-corrections.test.ts` if pure-helper extraction path is taken) — 6 cases covering the new tool-call branch + buffer semantics + drain + clear-on-response-done + clear-on-error
  - [x] VERIFY all pre-existing tests stay green per the AC #7 enumeration

- [x] Task 8: Update `docs/tcf-spec-citations.md §8` row 4 (AC #8) — flip ✓ Verified-with-caveat → ✓ Verified with Story 11-1 trailer

- [x] Task 9: Update `docs/tcf-spec-source.md §8.4` (AC #9) — append the "ARCHITECTURAL SUCCESSOR DONE — closed by Story 11-1" closure stamp after the existing Story 10-7 closure stamp

- [x] Task 10: Update CLAUDE.md (AC #10) — add the new "Realtime correction tool-call protocol" architecture line after the Story 10-8 line

- [x] Task 11: Quality gates (AC #Z)
  - [x] `npm run type-check` passes (0 errors)
  - [x] `npm run lint` passes (0 errors, 0 warnings)
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 910-925 tests (was 894 post-10-8)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN + Submit credentials leak guards pass
  - [x] `git status` shows the story file as untracked-but-not-ignored
  - [x] `npx prettier --check` on the story file passes

## Dev Notes

### Architecture pattern alignment

- **Architectural successor pattern (Story 11-1 § AC #5, AC #4).** Story 10-7 deliberately shipped a forward-compatible bridge; Story 11-1 is the architectural successor that closes the deferral. The Correction Report text-block + regex pipeline is wholesale replaced with structured Realtime tool-call ingestion. Two deletes (the regex + the heuristic), one new tool registration, one prompt-block swap, one new ref, one handler branch — narrowly scoped to the §8.4 surface.
- **Delete don't alias (Story 11-1 § AC #4, AC #5).** Story 10-2 pattern. The regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` is removed from `use-realtime-voice.ts`, not aliased as `LEGACY_CORRECTION_REGEX` for "historical compatibility." The `inferCategory` heuristic is removed, not aliased. The 15-line `## Correction Report (Plain Text — Read Aloud)` prompt block is removed, not commented out or guarded by a feature flag. Single source of truth: the structured tool-call.
- **Signature preservation across the pure-helper boundary (Story 11-1 § AC #4).** The `parseCorrections: (text: string) => Correction[]` callback type in `AppendOptions` at `src/lib/realtime-transcript.ts:75` is preserved exactly. The hook-side implementation changes from "regex over text" to "drain a buffer" — same signature, different body. The pure helper module is NOT touched; Story 9-5's dedup contract is byte-for-byte preserved. The `text` parameter is now unused by the implementation but kept in the signature for future flexibility (e.g., a hybrid mode that combines tool-call corrections with text-mined ones). Dev agent should mark the parameter with `_text` to signal intentional disuse to ESLint.
- **One-shot safeParse on the Realtime side (Story 11-1 § AC #3).** Story 9-7's `chatCompletionJSON` path retries-once-on-parse-failure because it's the only surface that can re-invoke the AI with the same context to get a corrected response. The Realtime tool-call path has no such single-call surface — the model is in a continuous streaming session. The right pattern on Realtime is one-shot safeParse + breadcrumb + reject-via-function-output, so the model receives feedback ("Invalid correction shape...") and can self-correct on its NEXT tool-call invocation. No retry loop; same observability via Sentry breadcrumb with allowlisted keys.
- **Per-turn buffer with response.done sweep (Story 11-1 § AC #3).** The `pendingToolCorrectionsRef` lifetime is per-AI-turn. The buffer's only consumer is the `parseCorrections` drain inside `appendIfNew` when the terminal `response.output_audio_transcript.done` fires. Catch-all clear on `response.done` defends against the theoretical-but-not-observed case where a tool-call lands after the turn-end event; the Sentry breadcrumb gives us a signal if it ever happens in prod. Similar belt-and-suspenders pattern to Story 9-5's `inflightItemIdRef = null` + `currentAiTextRef = ""` resets at `response.done` and `error`.
- **Mode-agnostic prompt block (Story 11-1 § AC #5).** The new `## Correction Reporting (Tool-Call)` block lives outside the `if (mode === "debate")` / `if (mode === "tcf_simulation")` branches. All three modes share the same tool-call instruction. The pre-11-1 Correction Report block was also mode-agnostic; Story 11-1 preserves this. Mode-specific corrections (e.g., "in TCF simulation mode, only correct after Task 3 ends") could be added in a future story but are out of scope here.
- **Forward-compat with stored history (Story 11-1 § AC #6).** Historic `conversation_messages` rows written before Story 11-1 may carry the legacy Story 10-7 plain-text Correction Report in `content` AND the regex-parsed Corrections in `corrections`. The conversation history viewer at `app/(tabs)/conversation/history.tsx` renders these via `TranscriptView` which calls `getDisplayText` which still strips the legacy sentinels. No backfill migration is needed; the legacy stripper retains backward-compat indefinitely.
- **Story 9-4 invariants preserved.** `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude at the bottom of `buildConversationPrompt` are byte-for-byte unchanged. Story 11-1's prompt edits are confined to the Correction Report block at lines 62-76; the wrappers at lines 158-194 are out of scope.
- **Story 9-5 invariants preserved.** `output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP` / FIFO eviction all unchanged. The Realtime modality stays audio-only; the tool-call side-channel is orthogonal to the audio + transcript event streams.
- **Story 9-7 invariants preserved (orthogonal surface).** `chatCompletionJSON` retry contract unchanged. The post-conversation `ConversationFeedback` generation at `use-realtime-voice.ts:632-660` continues to use `chatCompletionJSON(_, conversationFeedbackSchema)` — that's a separate AI call with its own retry semantics, not the Realtime path. Story 11-1 does not touch it.
- **Story 9-8 / 10-6 invariants preserved (orthogonal surface).** The TCF Speaking record-and-grade flow at `app/(tabs)/mock-test/speaking.tsx` uses `transcribe → chatCompletionJSON(speakingTaskEvaluationSchema)` — also separate from Realtime. Story 11-1 does not touch it.
- **Story 10-7 surfaces preserved.** Debate-mode 3-category split + `CEFR_LEVELS.nameFr` Alliance Française + Québécois drop + `force est de constater` echo fixes all preserved. The `mode === "debate"` block is mode-specific (Story 10-7 owned); the new tool-call block is mode-agnostic (Story 11-1 adds). The two coexist in `buildConversationPrompt` cleanly.

### Pulling forward Epic 9 + Epic 10 lessons

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Polish AC #Z bakes this in for the new test files + the new story file. The new files under `src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts` (or `src/lib/__tests__/realtime-corrections.test.ts`) should show as untracked when first written.
- **Epic 9 retro A3** (review-patch budget — "an implementation that passes type-check, lint, and existing tests is ~70% done, not 100%"; Epic 10 confirmed 6-14 patches per story): expect 5-12 patches in this story's review. High-risk surfaces for review-patch findings: (a) the per-turn buffer lifetime semantics (the `response.done` vs `response.output_audio_transcript.done` ordering — the review will probe edge cases the Threat/failure model section enumerated but the tests may not cover exhaustively), (b) the deletion claims (negative `not.toContain(...)` assertions on the new prompt — review may catch a substring that legitimately appears elsewhere, mirroring the Story 10-7 P5 anti-pattern where `force est de constater` legitimately appeared in `vocabulary-tiers.ts`), (c) cross-story Sentry breadcrumb hygiene — the new `feature: "realtime-report-correction"` value is short + bounded, but the review will check it against the allowlist length rule (80 chars; this is 28). Blind Hunter is likely to surface (i) the missing `RealtimeEvent` type guard if `event.arguments` is malformed JSON (caught by the existing `try/catch` at `handleFunctionCall:226` — verify), (ii) the parallel-tool-call ordering (multiple `report_correction` calls in one turn — verify the buffer accumulates in insertion order without race), (iii) any pre-11-1 `parseCorrections` import that this story missed (the function is removed; grep should be empty), (iv) the `_text` ESLint disuse warning (mark intentionally).
- **Epic 9 retro A6** (Sentry allowlist explicit-extension reviews): Story 11-1 does NOT extend the allowlist. The new breadcrumbs use existing allowlisted keys (`category`, `feature`, `code`). Verify by re-reading `src/lib/sentry.ts:25-52` and confirming each new breadcrumb's `data` keys are in the Set. The `feature: "realtime-report-correction"` value is a short categorical string (well under the 80-char redaction threshold).
- **Story 9-7 lesson** (Zod schema is the runtime guard): mirrored here for the tool-call args. The schema's `z.enum(...)` + `z.string().min(1)` + `z.object({...})` shape replaces the type-system `Correction["category"]` literal-union as the RUNTIME contract; the type-system contract is preserved via `ReportCorrectionArgs = z.infer<typeof reportCorrectionArgsSchema>` (Story 9-7 pattern for `WritingEvaluation` / `ConversationFeedback`).
- **Story 9-8 / 10-6 lesson** (cross-story NOT-touched discipline): Story 11-1 explicitly enumerates 12 verified-correct surfaces in the "Out of scope" section. The Acceptance Auditor will diff-verify each negative claim.
- **Story 10-2 lesson** ("delete don't alias"): two deletes — the regex + the `inferCategory` heuristic — are total removals, not feature-flagged or commented out. The 15-line prompt block is total removal, not commented out.
- **Story 10-3 lesson** (single source of truth for a derived constant): `correctionCategorySchema` is exported as the single source of truth for the 4-literal `Correction["category"]` union. The existing `note_error_pattern` tool entry at `use-realtime-voice.ts:750` has the same enum inlined manually — Story 11-1 does NOT refactor that surface (additive only), but a future hardening story could collapse both inlined enums into `correctionCategorySchema._def.values`. Filed as a deferred consolidation.
- **Story 10-4 lesson** (cross-cutting integration with positional invariance): the `buildVocabularyConstraintBlock(cefrLevel)` integration continues to render at its existing position between `## Language Adaptation` and the new `## Correction Reporting (Tool-Call)` block. The position is preserved; the block AFTER it changes, but the block ITSELF is unchanged. Verified by `vocabulary-integration.test.ts` staying green.
- **Story 10-5 lesson** (regression tests pin deletion claims): AC #7 tests include explicit negative assertions (`not.toContain("## Correction Report (Plain Text — Read Aloud)")`, `not.toContain("Use ASCII straight double quotes")`, `not.toContain('"User said" → "Correct form"')`) that defend the Story 11-1 deletion. Same pattern Story 10-5 used for the `top-500` / `top-1000` deletions.
- **Story 10-6 lesson** (forward-only schema/contract changes): Story 11-1's tool-call argument shape is forward-only — pre-11-1 stored `conversation_messages.corrections` rows hold regex-parsed Corrections in the same shape (`{ original, corrected, explanation, category }`) so no DB migration is needed; the shape is the same, only the SOURCE of the data changes from regex-over-text to tool-call-over-side-channel.
- **Story 10-7 lesson** (categorical re-labeling over content removal — but with discipline): Story 11-1 does NOT preserve the legacy text-format alongside the new tool-call. The two pipelines would conflict (the regex would match text the new model isn't supposed to emit, producing duplicate Corrections). Clean cutover: delete the regex, delete the prompt block, replace with tool-call. The Story 10-7 conversational-flow guidance ("Do NOT interrupt the user's conversational flow") is preserved verbatim in the new tool-call block — that pedagogical instruction is mode-and-protocol-agnostic.
- **Story 10-8 lesson** (anti-repetition is a per-skill contract): Story 11-1's correction protocol is per-conversation; it doesn't interact with the exercise dedup contract. The `text-hash.ts` module + `question_stem_hashes` column are untouched.

### Source tree components to touch

| File                                                                                                       | Action                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/schemas/ai-responses.ts](src/lib/schemas/ai-responses.ts)                                         | UPDATE — add `correctionCategorySchema` + `reportCorrectionArgsSchema` + `ReportCorrectionArgs` type alias                                                                                                                                                                                                                            |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts)                                         | UPDATE — replace `## Correction Report (Plain Text — Read Aloud)` block with `## Correction Reporting (Tool-Call)` block                                                                                                                                                                                                              |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts)                                         | UPDATE — register the third tool; add `pendingToolCorrectionsRef` + `report_correction` handler branch + rewrite `parseCorrections` to drain the buffer; DELETE `inferCategory` + the regex                                                                                                                                          |
| [src/components/conversation/TranscriptView.tsx](src/components/conversation/TranscriptView.tsx)           | UPDATE — JSDoc only on `getDisplayText` (Story 11-1 clarification on legacy sentinel scope); function body unchanged                                                                                                                                                                                                                  |
| [src/lib/schemas/\_\_tests\_\_/ai-responses.test.ts](src/lib/schemas/__tests__/ai-responses.test.ts)       | UPDATE — add `reportCorrectionArgsSchema` describe block                                                                                                                                                                                                                                                                              |
| [src/lib/prompts/\_\_tests\_\_/conversation.test.ts](src/lib/prompts/__tests__/conversation.test.ts)       | UPDATE — add Story 11-1 tool-call Correction Reporting describe block; DELETE Story 10-7 `PARSE_CORRECTIONS_REGEX` constant + consumer cases; UPDATE block-scope regex in retained Story 10-7 tests                                                                                                                                   |
| [src/lib/\_\_tests\_\_/realtime-dedup.test.ts](src/lib/__tests__/realtime-dedup.test.ts)                   | UPDATE — DELETE Case 14 + `parseCorrectionsForTest` mirror function; all other cases unchanged                                                                                                                                                                                                                                        |
| [src/hooks/\_\_tests\_\_/use-realtime-voice-tool-calls.test.ts](src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts) | CREATE (or `src/lib/__tests__/realtime-corrections.test.ts` if pure-helper extraction path is taken) — 6 cases covering valid/invalid tool-call args + parallel calls + drain + clear-on-response-done + clear-on-error                                                                                                               |
| [CLAUDE.md](CLAUDE.md)                                                                                     | UPDATE — add new "Realtime correction tool-call protocol" architecture line after the Story 10-8 line                                                                                                                                                                                                                                 |
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md)                                                         | UPDATE — append "ARCHITECTURAL SUCCESSOR DONE — closed by Story 11-1" closure stamp to §8.4                                                                                                                                                                                                                                            |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md)                                                   | UPDATE — flip §8 row 4 ✓ Verified-with-caveat → ✓ Verified with Story 11-1 trailer                                                                                                                                                                                                                                                    |

**Not touched (verified-correct):**

| File                                                                                                       | Reason                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/realtime.ts](src/lib/realtime.ts)                                                                 | `RealtimeSession` + `RealtimeEvent` types + `configureSession` + `sendFunctionResult` already support tool-call registration + invocation + result; additive call into existing infrastructure                                                                                                  |
| [src/lib/realtime-transcript.ts](src/lib/realtime-transcript.ts)                                           | Story 9-5 pure helpers (`appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP`); the `AppendOptions.parseCorrections: (text: string) => Correction[]` signature is preserved, so the module is byte-for-byte unchanged                                                       |
| [src/types/conversation.ts](src/types/conversation.ts)                                                     | `Correction` interface unchanged; `ConversationMode` unchanged; `ConversationFeedback` re-export unchanged                                                                                                                                                                                      |
| [src/lib/sentry.ts](src/lib/sentry.ts)                                                                     | `SENTRY_EXTRAS_ALLOWLIST` unchanged — Story 11-1 reuses existing `category` / `feature` / `code` keys                                                                                                                                                                                           |
| [src/components/conversation/CorrectionBubble.tsx](src/components/conversation/CorrectionBubble.tsx)       | Consumes `Correction[]`; array shape unchanged; no styling change                                                                                                                                                                                                                              |
| [src/lib/error-tracker.ts](src/lib/error-tracker.ts)                                                       | `extractErrorsFromCorrections` consumes `correctionsRef.current` flat array; shape unchanged                                                                                                                                                                                                    |
| [src/lib/prompts/listening.ts](src/lib/prompts/listening.ts) + writing.ts + placement.ts + speaking.ts + echo.ts + translation.ts + grammar.ts + reading.ts + mock-test.ts + vocabulary-tiers.ts | Story 10-3 / 10-4 / 10-5 / 10-6 / 10-7 surfaces; not touched                                                                                                                                                                                                                                    |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts) `mode === "debate"` block               | Story 10-7's 3-category split (Connecteurs / Locutions verbales figées / Déclencheurs du subjonctif); not touched                                                                                                                                                                               |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts) `mode === "tcf_simulation"` block       | Story 10-7 P4's plain-text `Task N (M minutes):` task headers; not touched                                                                                                                                                                                                                      |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts) `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers | Story 9-4 stored-prompt-injection defense; not touched                                                                                                                                                                                                                                          |
| [app/(tabs)/mock-test/speaking.tsx](<app/(tabs)/mock-test/speaking.tsx>)                                   | Story 9-8 / 10-6 record-and-grade flow via `chatCompletionJSON(speakingTaskEvaluationSchema)`; separate from Realtime                                                                                                                                                                          |
| [app/(tabs)/conversation/history.tsx](<app/(tabs)/conversation/history.tsx>)                               | Renders historical `conversation_messages` via `TranscriptView`; the legacy sentinel stripper handles pre-11-1 content automatically                                                                                                                                                            |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts) `save_vocabulary` / `note_error_pattern` handlers | Story 1-2 surfaces; not touched (additive only — the new tool joins the array)                                                                                                                                                                                                                  |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts) post-conversation flow (lines 592-627)  | `extractErrorsFromCorrections` / `updateSkillProgress` / `incrementDailyActivity` / `updateStreak` / `checkCefrPromotion`; consume `correctionsRef.current` shape unchanged                                                                                                                     |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts) speaking-score formula (lines 611-614)  | Unchanged — may produce slightly more pessimistic scores post-11-1 because the regex's silent-zero failure mode no longer suppresses real corrections; correctness improvement, not a regression                                                                                                |
| [supabase/migrations/](supabase/migrations/)                                                               | No DB schema change; the `corrections` JSONB column on `conversation_messages` accepts the same shape pre- and post-11-1                                                                                                                                                                       |
| [supabase/functions/](supabase/functions/)                                                                 | No Edge Function change; the ephemeral-token + ai-proxy paths are unchanged                                                                                                                                                                                                                    |

### Anti-pattern prevention

- **Do NOT preserve the legacy regex as a fallback** — the new tool-call is the single source. A dual-pipeline would produce duplicate Corrections (the tool-call AND the regex match if the model accidentally emits both formats) or invisibly suppress some (if the regex is matched ahead of the buffer drain). Single source: delete the regex.
- **Do NOT add a `provide_tip` tool** — out of scope; the inline `Tip:` line is dropped. The model continues to weave pedagogical encouragement into natural speech.
- **Do NOT add a feature flag** for the new tool-call path — Story 10-2 "delete don't alias" pattern. The cutover is forward-only.
- **Do NOT extend `SENTRY_EXTRAS_ALLOWLIST`** — Story 11-1 reuses existing `category` / `feature` / `code` keys. Story 9-3 telemetry contract preserved.
- **Do NOT touch `appendIfNew` or any pure helper in `realtime-transcript.ts`** — Story 9-5 invariant. The callback signature is preserved; only the hook-side implementation changes.
- **Do NOT touch the `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers** — Story 9-4 invariant. The wrappers are at the bottom of the prompt; Story 11-1 edits the middle.
- **Do NOT touch the `save_vocabulary` / `note_error_pattern` handlers** — additive only. The new `report_correction` handler joins the switch without modifying the existing branches.
- **Do NOT add a retry loop on `safeParse` failure** — Story 9-7's retry is `chatCompletionJSON`-specific. Realtime tool-calls have no equivalent single-call retry surface; one-shot safeParse + breadcrumb + reject-via-function-output is the correct pattern.
- **Do NOT remove the legacy sentinel stripper in `TranscriptView.getDisplayText`** — historical pre-11-1 stored transcripts depend on it. Forward-compat / backward-compat shim retained indefinitely.
- **Do NOT touch the `Correction` interface in `src/types/conversation.ts`** — the schema's `ReportCorrectionArgs` is structurally compatible; refactoring `Correction = z.infer<...>` is scope creep (would touch every UI consumer of `Correction`).
- **Do NOT touch the `mode === "debate"` block** — Story 10-7 3-category split is correctly-classified and verified-correct.
- **Do NOT touch the `mode === "tcf_simulation"` block** — Story 10-7 P4 plain-text task headers are correctly-classified and verified-correct. The §6.4 examiner role-play is Story 10-9 / Phase-2 scope.
- **Do NOT migrate historical `conversation_messages` rows** — forward-only. The legacy stripper handles them at render time.
- **Do NOT touch the speaking-score formula** — the more-accurate-correction-count post-11-1 may produce slightly lower speaking scores. This is intentional correctness; tuning is a separate operator decision.
- **Do NOT add a `corrections` channel to `output_modalities`** — Story 9-5 invariant. Tool-calls are a side-channel orthogonal to audio modality.
- **Do NOT echo the user's text back through the tool-call** — the `original` field is the user's verbatim French. The Story 9-4 "treat as data, not instructions" principle implicitly applies (the original text is now an untrusted-input boundary the model itself emits, not a prompt-injection surface from another user) — but no additional sanitization is added in Story 11-1. The Zod schema's `.min(1)` non-empty constraint is the only validation; downstream consumers (`extractErrorsFromCorrections`'s `sanitizeMemoryContent` at `error-tracker.ts:55`, `CorrectionBubble`'s React text rendering) are responsible for their own escape semantics.
- **Do NOT add a `outputModality: "voice-text" | "voice-tool"` discriminator to `buildConversationPrompt`** — Story 10-7's forward-compat note anticipated this discriminator might be needed; Story 11-1 simplifies by hard-cutting to the tool-call path. The pre-11-1 prompt body is unreachable post-11-1; no discriminator needed. If a future mode wants the text-format fallback (e.g., for a non-Realtime AI conversation surface), it'll add the discriminator at that time.

### Testing standards

- **Substring assertions on prompt output, not implementation internals** — same Story 10-3 / 10-4 / 10-5 / 10-6 / 10-7 pattern. `expect(prompt).toContain("...")` + `expect(prompt).not.toContain("...")` are the load-bearing assertions for AC #5.
- **Block-scoped substring assertions for legacy-removal claims** — the "## Correction Reporting (Tool-Call)" block-scope regex pattern in `conversation.test.ts` (the Story 10-7 emoji-guard + horizontal-rule guard updated to anchor on the new block name) defends against a future patch reintroducing the legacy block without changing the block name.
- **Schema-validation cases parameterized over the literal enum** — `it.each(["grammar", "pronunciation", "vocabulary", "register"] as const)` exercises every valid category value; a future enum change (adding "spelling", removing "register") is caught by both the parameterized positive cases AND a separate `it("rejects category outside the 4-literal union")` negative case asserting `code: "invalid_enum_value"`.
- **ReportCorrectionArgs ↔ Correction structural compatibility via const assignment** — the same Story 10-7 `@ts-expect-error` regression-lock pattern, inverted: this case proves the assignment SUCCEEDS at compile time. A future schema drift that breaks structural compat fails type-check.
- **Tool-call handler tests scope to pure behavior** — the new `use-realtime-voice-tool-calls.test.ts` (or `realtime-corrections.test.ts`) does NOT render the React hook; it tests the pure handler logic (or a pure-helper extraction) with synthetic `RealtimeEvent` payloads and a mocked `sessionRef.current.sendFunctionResult` capture. Same pattern as Story 9-5's `realtime-dedup.test.ts` exercising pure helpers without rendering.
- **Negative substring assertions defend deletion claims** — same Story 10-5 / 10-7 pattern. `expect(prompt).not.toContain("## Correction Report (Plain Text — Read Aloud)")` + `expect(prompt).not.toContain('"User said" → "Correct form"')` + `expect(prompt).not.toContain("Use ASCII straight double quotes")` + `expect(prompt).not.toMatch(/^Tip: \[/m)` defend the pre-11-1 block deletion.
- **Each per-mode assertion is its own `it.each` row** — Story 10-3 review patch P5 lesson. The new tool-call-block presence is asserted across 6 levels × 3 modes = 18 cases via `it.each` patterns.
- **Don't test the AI's behavior** — only the prompt-builder's output + the tool-call handler's mechanical contract + the schema's validation contract. Whether the AI actually invokes `report_correction` correctly is prod-telemetry's reporting job (via the `addBreadcrumb` infrastructure).
- **Sentry breadcrumb assertions** — the new tool-call handler test should mock `addBreadcrumb` and assert (a) the breadcrumb fires on safeParse failure with `category: "ai"` + `feature: "realtime-report-correction"` + `code: <ZodIssueCode>`, (b) the breadcrumb does NOT fire on safeParse success (only the success path's `sendFunctionResult` does), (c) the "Pending tool corrections dropped at response.done" breadcrumb fires only when the buffer is non-empty at `response.done`. Mocking pattern: `jest.mock("@/src/lib/sentry", () => ({ addBreadcrumb: jest.fn(), captureError: jest.fn() }))`.

### Project Structure Notes

- All non-test changes are to existing files. **1 new test file** is created: `src/hooks/__tests__/use-realtime-voice-tool-calls.test.ts` (or `src/lib/__tests__/realtime-corrections.test.ts` if pure-helper extraction is taken). The `src/hooks/__tests__/` directory already exists from Story 10-8's `use-exercise.test.ts`.
- **No new module files** unless the dev agent picks the pure-helper extraction path for `parseCorrections` drain semantics — in which case `src/lib/realtime-corrections.ts` is created with the single export `drainPendingCorrections(ref: { current: Correction[] }): Correction[]`. Operator-acceptable either way; the test-surface decision drives the module decision.
- **No DB migrations.** The `corrections` JSONB column on `conversation_messages` accepts the same shape pre- and post-11-1 (`{ original, corrected, explanation, category }`).
- **No Edge Function changes.** The `realtime-session` Edge Function (ephemeral-token issuer) + the `ai-proxy` Edge Function (chat / TTS / transcribe / embedding routes) are both unchanged. The tool-call protocol runs entirely client-side ↔ OpenAI Realtime API over the existing WebSocket.
- **No new dependencies.** `zod` is already in `package.json`; `@sentry/react-native` is already in `package.json`; the `RealtimeSession` class + `useRealtimeVoice` hook already exist.
- **No app router changes.** The voice conversation screen continues to mount via the existing `[sessionId].tsx` route. The tool-call protocol is invisible to the UI layer.
- **Documentation localized to §8.4 + new CLAUDE.md line + 1 citations-matrix row.**

### References

- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 181 — Epic 11.1 deliverable "Correction protocol via tool-calls — replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. Covers P1-6, P2-1."]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 58 — P1-6 finding "Correction parsing uses brittle regex `/\"X\"\\s\*→\\s\*\"Y\"\\s\*\\(...\\)/g` — curly quotes, em-dashes, paraphrased corrections silently produce zero corrections; speaking-score pipeline depends on this"]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 79 — P2-1 finding "Conversation prompt instructs Realtime voice model to emit emoji-formatted markdown corrections — TTS will literally say the asterisks or skip them"]
- [Source: \_bmad-output/implementation-artifacts/10-7-linguistic-accuracy-pass.md — Story 10-7 minimum-viable §8.4 bridge documentation; "the Realtime correction-protocol tool-call rewrite (`report_correction` function call replacing the regex parser) per shippable-roadmap.md Epic 11.1 is out of scope and remains the architectural successor"]
- [Source: \_bmad-output/implementation-artifacts/epic-10-retro-2026-05-10.md — Epic 10 retro action item B4 "Epic 11.1 (Correction protocol via tool-calls) — supersedes Story 10-7's `parseCorrections` regex bridge; closes §8.4 architecturally; **first story of Epic 11**"]
- [Source: docs/tcf-spec-source.md §8.4 — voice-mode emoji + markdown output; Story 10-7 closure stamp + Epic 11.1 deferral note]
- [Source: docs/tcf-spec-citations.md §8 row 4 — ✓ Verified-with-caveat status; Epic 11.1 architectural-successor pointer]
- [Source: src/lib/prompts/conversation.ts:62-76 — current `## Correction Report (Plain Text — Read Aloud)` block to be deleted]
- [Source: src/lib/prompts/conversation.ts:106-124 — `mode === "debate"` block, Story 10-7 verified-correct, NOT touched]
- [Source: src/lib/prompts/conversation.ts:127-150 — `mode === "tcf_simulation"` block, Story 10-7 P4 verified-correct, NOT touched]
- [Source: src/lib/prompts/conversation.ts:158-194 — Story 9-4 `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers, NOT touched]
- [Source: src/hooks/use-realtime-voice.ts:142-149 — `inferCategory` keyword-matching heuristic to be DELETED]
- [Source: src/hooks/use-realtime-voice.ts:152-171 — `parseCorrections` regex callback to be REWRITTEN as buffer-drain]
- [Source: src/hooks/use-realtime-voice.ts:224-266 — `handleFunctionCall` to be EXTENDED with `report_correction` branch]
- [Source: src/hooks/use-realtime-voice.ts:443-452 — `case "response.done"` handler to gain pending-buffer clear]
- [Source: src/hooks/use-realtime-voice.ts:454-484 — `case "error"` handler to gain pending-buffer clear]
- [Source: src/hooks/use-realtime-voice.ts:592-627 — post-conversation flow (`extractErrorsFromCorrections` / `updateSkillProgress("speaking")` / etc.); consumes `correctionsRef.current` shape unchanged]
- [Source: src/hooks/use-realtime-voice.ts:611-614 — speaking-score formula `Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))`; unchanged behavior, more accurate inputs post-11-1]
- [Source: src/hooks/use-realtime-voice.ts:632-660 — `chatCompletionJSON(_, conversationFeedbackSchema)` post-conversation feedback; NOT touched]
- [Source: src/hooks/use-realtime-voice.ts:670-795 — `start()` callback; gains `pendingToolCorrectionsRef = []` reset; otherwise unchanged]
- [Source: src/hooks/use-realtime-voice.ts:726-757 — `RealtimeConfig.tools: [...]` array; gains the third `report_correction` entry]
- [Source: src/lib/realtime.ts:88-93 — `response.function_call_arguments.done` event type (existing infrastructure)]
- [Source: src/lib/realtime.ts:114-120 — `RealtimeConfig.tools` type (permissive enough for the new entry)]
- [Source: src/lib/realtime.ts:283-311 — `configureSession` sends `session.update` with `tools: this.config.tools ?? []` (existing wiring)]
- [Source: src/lib/realtime.ts:347-357 — `sendFunctionResult` sends `conversation.item.create` with `type: "function_call_output"` + triggers `response.create` (existing infrastructure)]
- [Source: src/lib/realtime-transcript.ts:74-80 — `AppendOptions` interface; `parseCorrections: (text: string) => Correction[]` signature preserved]
- [Source: src/lib/realtime-transcript.ts:109-155 — `appendIfNew` pure helper; NOT touched]
- [Source: src/components/conversation/TranscriptView.tsx:42-90 — `getDisplayText` legacy sentinel stripper; JSDoc updated, body NOT touched]
- [Source: src/types/conversation.ts:33-38 — `Correction` interface; NOT touched]
- [Source: src/lib/schemas/ai-responses.ts:30-46 — Zod import + `SCHEMA_MAX_PRE_SANITIZE_CHARS` (existing patterns)]
- [Source: src/lib/schemas/ai-responses.ts:442-458 — `speakingTaskEvaluationSchema` (placement reference — the new schema is appended after this block)]
- [Source: src/lib/sentry.ts:25-52 — `SENTRY_EXTRAS_ALLOWLIST` includes `category` / `feature` / `code` (NO new keys needed)]
- [Source: src/lib/error-tracker.ts:212-273 — `extractErrorsFromCorrections` consumer; `correctionsRef.current` flat array shape unchanged]
- [Source: src/lib/error-tracker.ts:55 — `sanitizeMemoryContent` boundary for downstream `error_patterns.error_description` storage]
- [Source: src/lib/__tests__/realtime-dedup.test.ts:31-45 — `parseCorrectionsForTest` mirror function; to be DELETED with the production regex]
- [Source: src/lib/__tests__/prompt-injection.test.ts:294-389 — Story 9-4 `buildConversationPrompt` `<USER_FACTS>` / `<USER_WEAK_AREAS>` regression suite; stays green]
- [Source: src/lib/prompts/__tests__/conversation.test.ts (Story 10-7) — Story 11-1 extends with the new tool-call block describe; updates block-scope regex from `"## Correction Report (Plain Text — Read Aloud)"` to `"## Correction Reporting (Tool-Call)"`]
- [Source: src/lib/schemas/__tests__/ai-responses.test.ts (Story 9-7) — Story 11-1 extends with the new `reportCorrectionArgsSchema` describe]
- [Source: Story 9-3 — Sentry telemetry allowlist contract (unchanged; reuses existing keys)]
- [Source: Story 9-4 — `<USER_FACTS>` / `<USER_WEAK_AREAS>` stored-prompt-injection defense (preserved unchanged)]
- [Source: Story 9-5 — voice transcript dedup + `output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP` (preserved unchanged)]
- [Source: Story 9-7 — `chatCompletionJSON` retry contract + Zod schema pattern + `z.infer<...>` type derivation (mirrored for the one-shot Realtime path; no retry loop)]
- [Source: Story 9-8 / 10-6 — TCF Speaking record-and-grade flow (separate from Realtime; NOT touched)]
- [Source: Story 10-2 — "delete don't alias" pattern (mirrored for the regex + heuristic + prompt-block deletes)]
- [Source: Story 10-7 — minimum-viable §8.4 bridge (superseded by Story 11-1); debate-mode 3-category split + tcf_simulation P4 plain-text task headers + `CEFR_LEVELS.nameFr` Alliance Française + Québécois drop + `force est de constater` echoes (all preserved unchanged)]
- [Source: Story 10-8 — exercise dedup + `text-hash.ts` + `question_stem_hashes` (separate exercise surface; NOT touched)]
- [Source: OpenAI Realtime API GA reference — `session.update` `session.tools[]` declaration; `response.function_call_arguments.done` payload `{ call_id, name, arguments }`; `conversation.item.create` `function_call_output` round-trip; `tool_choice: "auto"` default for unforced calls (verified via Context7 2026-05-11)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/11-1-correction-protocol-tool-calls` (from `main` at `cad0de9` — post-Story-10-8 PR #66 merge + retros).
- Quality gates:
  - `npm run type-check` ✓ (0 errors) — no cascade from the new schema export, new tool registration, or the pure-helper extraction.
  - `npm run lint` ✓ (0 errors, 0 warnings, `--max-warnings 0`) — initial run flagged 2 `import/order` warnings on `ai-responses.test.ts` (the new `import type { Correction }` line ordering); auto-fixed via `npm run lint -- --fix`.
  - `npm run format:check` ✓ — initial run flagged 3 files (`docs/tcf-spec-citations.md` table column widths, `src/lib/__tests__/realtime-corrections.test.ts`, `src/lib/speaking-score.ts`); auto-fixed via `npx prettier --write`.
  - `npm test` ✓ (945 passing, was 894 pre-story → +51 net tests). 34 test suites; no regressions.
  - `npm run check:colors` ✓ ("No hardcoded hex colors found.")
- CI guards (run locally via grep mirroring `.github/workflows/ci.yml`):
  - Sentry DSN leak guard ✓ (no matches in `src/` or `app/`)
  - Submit credentials leak guard ✓ (only pre-existing illustrative example in Story 9-9's own doc; not introduced by 11-1)
- Story file `_bmad-output/implementation-artifacts/11-1-correction-protocol-tool-calls.md` shows as Untracked in `git status`; `git check-ignore -v` returns exit 1 (Epic 9 retro A1 satisfied).

### Completion Notes List

**Registered the `report_correction` Realtime tool** in `useRealtimeVoice`'s `RealtimeConfig.tools` array (`src/hooks/use-realtime-voice.ts`) alongside the existing `save_vocabulary` and `note_error_pattern` tool entries. The new tool's `parameters` JSON schema constrains `category` to the same 4-literal union as `Correction["category"]`. Hook file's top-of-file JSDoc updated to mention `report_correction` alongside the two existing tools.

**Added `reportCorrectionArgsSchema` + `correctionCategorySchema` + `ReportCorrectionArgs` type** at `src/lib/schemas/ai-responses.ts` (positioned after `speakingTaskEvaluationSchema` per the story's AC #2 anchor). The schema mirrors `Correction` structurally. `correctionCategorySchema` is exported separately so future surfaces (e.g., the inline `note_error_pattern` enum) could consume it as a single source of truth in a future hardening story (Story 11-1 does NOT refactor that surface — additive only).

**Extracted pure helpers** at `src/lib/realtime-corrections.ts` so the tool-call pipeline can be unit-tested without rendering React: `processReportCorrectionCall(parsed: unknown): { outcome: "recorded" | "invalid", ... }` owns the safeParse + result-string contract; `drainPendingCorrections(buffer: Correction[]): Correction[]` mutates the buffer in place (`length = 0`) and returns a defensive copy of its prior contents. The hook then routes args through these helpers and owns only the side effects (Sentry breadcrumb + `sendFunctionResult` + buffer push).

**Extended `handleFunctionCall`** at `src/hooks/use-realtime-voice.ts` with a `name === "report_correction"` branch. On valid args: push to `pendingToolCorrectionsRef.current` + `sendFunctionResult(callId, "Correction recorded.")`. On invalid args: emit a Sentry breadcrumb with `category: "ai"` + `feature: "realtime-report-correction"` + `code: <ZodIssueCode>` and `sendFunctionResult(callId, "Invalid correction shape; correction not recorded.")` so the model can self-correct on its next invocation. No retry loop on the Realtime path (one-shot safeParse + breadcrumb pattern; mirrors Story 9-7 architecture but without `chatCompletionJSON`'s outer retry surface which Realtime doesn't have).

**Added `pendingToolCorrectionsRef = useRef<Correction[]>([])`** alongside the other refs at `use-realtime-voice.ts`. Reset in three places per AC #3 with the precise placement reviewed during story authoring: (1) in `start()` at the end of the existing ref-reset block; (2) in `case "response.done"` immediately before `inflightItemIdRef.current = null;` with a `"Pending tool corrections dropped at response.done"` breadcrumb fired only if non-empty (the actual leak signal worth tracking); (3) in `case "error"` immediately after the existing `currentAiTextRef.current = "";` and before the `if (event.error.code === "connection_lost")` branch — silent clear (no breadcrumb, because the parent `case "error"` already emits `captureError` so adding a buffer-clear breadcrumb would be log-doubling).

**Rewrote `parseCorrections`** at `use-realtime-voice.ts` to drain the buffer via the new pure helper `drainPendingCorrections(pendingToolCorrectionsRef.current)`. Signature preserved as `(text: string) => Correction[]` (the `text` parameter is intentionally unused — marked `_text`); the `appendIfNew` consumer at `src/lib/realtime-transcript.ts` (Story 9-5 pure module) is byte-for-byte unchanged. No drain-empty breadcrumb — rejected during story authoring to avoid flooding Sentry with low-signal noise on every turn that produces no corrections (most do).

**Deleted the brittle regex** `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` and the `inferCategory` keyword-matching heuristic at `use-realtime-voice.ts:142-171` (Story 10-2 "delete don't alias" pattern). Verified by `grep -rn '/"\([^"]+\)' src/hooks/` returning zero matches outside the legacy display-only stripper in `TranscriptView.getDisplayText` (retained as forward-compat / backward-compat shim for pre-11-1 stored transcripts).

**Replaced the `## Correction Report (Plain Text — Read Aloud)` block** (15 lines) at `src/lib/prompts/conversation.ts:62-76` with a new `## Correction Reporting (Tool-Call)` block that instructs the model to invoke `report_correction({ original, corrected, explanation, category })` whenever it detects an error. The new block explicitly tells the model to invoke silently (no audio leak) and permits multiple invocations per turn. The "Skip invocation when an error does NOT change the meaning" guidance preserves Story 10-7's "don't interrupt the conversational flow" pedagogical intent. The Story 9-4 `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude at the bottom of the prompt are byte-for-byte unchanged.

**Cleaned up the debate-mode stale anchor** at `src/lib/prompts/conversation.ts:115` — the pre-11-1 line `"- Score their argumentation quality in the Correction Report"` referenced the now-deleted Correction Report block. Replaced with `"- When their argumentation has structural weaknesses (logical gaps, weak rebuttals, missing concessions), comment on the rhetorical issue naturally in your spoken response — argumentation feedback is part of the conversation, not a tool-call"`. The Story 10-7 3-category split (Connecteurs / Locutions verbales figées / Déclencheurs du subjonctif) immediately above is preserved byte-for-byte.

**Updated `TranscriptView.getDisplayText` JSDoc only** at `src/components/conversation/TranscriptView.tsx:42-90`. The function body is unchanged. The JSDoc now documents that the sentinel-based stripper is a forward-compat / backward-compat shim for pre-11-1 stored transcripts (rendered via the conversation history screen at `app/(tabs)/conversation/history.tsx`); new post-11-1 assistant turns never trigger any sentinel.

**Extracted `computeSpeakingScore`** to `src/lib/speaking-score.ts` (review enhancement #3 from story authoring). Formula unchanged from the hook's inline implementation (`Math.max(20, Math.round(100 - (correctedEntries / Math.max(totalEntries, 1)) * 30))` with 70 default for zero-utterance sessions); extraction enables baseline-pin tests so any future tuning story has explicit reference points. The hook now imports and calls the helper instead of inlining the formula.

**Added test files**:
- `src/lib/schemas/__tests__/ai-responses.test.ts` (EXTENDED) — 9 new `reportCorrectionArgsSchema` cases: well-formed grammar correction + parameterized 4-category accept + invalid-category reject (with `invalid_enum_value` issue code pin) + 3-field empty-string reject + missing-field reject + non-string type reject + `ReportCorrectionArgs` ↔ `Correction` structural-compat (compile-time const assignment) + `correctionCategorySchema.options` pin.
- `src/lib/__tests__/realtime-corrections.test.ts` (NEW) — 16 cases across two describe blocks: `processReportCorrectionCall` (well-formed + parameterized 4-category accept + missing-field reject with non-empty `issueCode` + invalid-enum reject + empty-string reject + null/undefined/non-object reject + invalid-shape result-message surfacing) + `drainPendingCorrections` (mutation + empty-out behavior + insertion-order preservation across simulated multi-invocation turn + idempotence on empty buffer + defensive-copy invariant + same-buffer-reference accepts new pushes after drain).
- `src/lib/__tests__/speaking-score.test.ts` (NEW) — 9 baseline-pin cases: zero-entries default 70 + defensive negative-totalUserEntries fallback + no-corrections 100 + 1/10 = 97 + 5/10 = 85 + 10/10 = 70 + 2/2 = 70 (small-N boundary) + floor at 20 when corrections >> entries (1, 10 case) + rounding correctness (3, 1 → 90 and 7, 1 → 96).
- `src/lib/prompts/__tests__/conversation.test.ts` (EXTENDED) — block-scope anchor updated from `"## Correction Report (Plain Text — Read Aloud)"` to `"## Correction Reporting (Tool-Call)"`; deleted Story 10-7's `PARSE_CORRECTIONS_REGEX` constant + 2 consumer cases (regex deleted from production); deleted the `No corrections.` legacy test (sentinel deleted from prompt); deleted the legacy "Correction Report instructs..." test (block deleted); added a new Story 11-1 describe block with 5 it/it.each blocks covering tool-call block header presence (parameterized over 6 CEFR levels) + legacy block drop (parameterized over 3 modes) + legacy parser-format instructions drop + silent-invocation phrasing + multiple-invocations-per-turn permission + Story 10-7 debate-mode 3-category split regression guard + Story 10-7 debate-mode stale-anchor cleanup guard + Story 10-7 tcf_simulation plain-text task header regression.
- `src/lib/__tests__/realtime-dedup.test.ts` (EXTENDED) — Case 14 `parseCorrectionsForTest` mirror function DELETED with the production regex; Cases 1-13 + 15+ stay green; dedup contract (Story 9-5) preserved unchanged.

**Citations matrix `docs/tcf-spec-citations.md §8` row 4** — flipped ✓ Verified-with-caveat → ✓ Verified with the Story 11-1 trailer documenting the architectural closure of P1-6 and P2-1. The code-location cell expands to enumerate all new surfaces (Correction Reporting prompt block + `report_correction` handler + Zod schema + pure helpers at `realtime-corrections.ts`).

**Source-of-truth `docs/tcf-spec-source.md §8.4`** — appended an "ARCHITECTURAL SUCCESSOR DONE — closed by Story 11-1 on 2026-05-11" closure stamp after the existing Story 10-7 closure stamp. Documents the full closure plus the `TranscriptView.getDisplayText` forward-compat shim retention plus the speaking-score-formula behavioral-change note.

**`CLAUDE.md`** gained a new "Realtime correction tool-call protocol" architecture line after the Story 10-8 line. Documents the full Epic 11.1 architectural closure, the tool registration, the `pendingToolCorrectionsRef` buffer lifetime (start / drain / response.done / case "error"), the regex + `inferCategory` deletes, the speaking-score-formula extraction (input accuracy improvement, formula unchanged), the citations matrix flip, and the Story 9-4 / 9-5 / 9-7 / 9-8 / 10-6 / 10-7 / 10-8 invariants preserved.

**Story 9-4 stored-prompt-injection defense holds** — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude in `buildConversationPrompt` are byte-for-byte unchanged. Verified by re-reading `conversation.ts:158-194` post-edit + by `prompt-injection.test.ts` `buildConversationPrompt` describe block staying green.

**Story 9-5 voice transcript dedup holds** — `output_modalities: ["audio"]` config in `realtime.ts:288` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` / `DEDUP_SET_CAP` in `realtime-transcript.ts` NOT modified. Verified by `realtime-dedup.test.ts` Cases 1-13 + 15+ staying green.

**Story 9-7 Zod schema retry contract holds (orthogonal surface)** — `chatCompletionJSON` is unchanged. The `report_correction` tool-call uses a one-shot `safeParse` + breadcrumb (different path from the `chatCompletionJSON` retry loop). Verified by `chat-completion-json.test.ts` staying green.

**Story 9-8 / 10-6 speaking pipeline holds (orthogonal surface)** — `transcribe → chatCompletionJSON(speakingTaskEvaluationSchema)` flow at `app/(tabs)/mock-test/speaking.tsx` NOT touched. Verified by `speaking-mock-test-persist.test.ts` + `speaking-evaluator.test.ts` + `speaking-scoring.test.ts` staying green.

**Story 10-2 per-skill scoring contract holds** — `rawPercentToListeningReadingScore` / `rawPercentToWritingSpeakingScore` / `IRCC_CLB_BANDS` NOT touched.

**Story 10-3 / 10-4 / 10-5 contracts hold** — per-CEFR passage ranges + `buildVocabularyConstraintBlock` cross-cutting integration + `buildPlacementTestPrompt` extraction all NOT touched. Verified by `passage-calibration.test.ts` + `vocabulary-tiers.test.ts` + `vocabulary-integration.test.ts` + `placement.test.ts` staying green.

**Story 10-7 surfaces hold** — debate-mode 3-category split + `CEFR_LEVELS.nameFr` Alliance Française convention + Québécois drop in `listening.ts` + `force est de constater` echo fixes in `writing.ts` / `placement.ts` NOT touched. The debate-mode stale anchor cleanup (the `"Score their argumentation quality in the Correction Report"` line) is the only Story 10-7 surface touched and it's a downstream-coherence fix, not a 3-category-split fix. Verified by `cefr.test.ts` + `listening.test.ts` + `writing.test.ts` + `placement.test.ts` + the Story 10-7 describe block in `conversation.test.ts` all staying green.

**Story 10-8 exercise dedup + `text-hash.ts` + `question_stem_hashes` column** — NOT touched (separate exercise surface, not voice). Verified by `text-hash.test.ts` + `exercise-dedup.test.ts` + `exercise-dedup-db.test.ts` + `use-exercise.test.ts` staying green.

**Out of scope (deferred per story):** A `provide_tip` tool for structured pedagogical hints (the inline `Tip:` line is dropped entirely; model continues to weave teaching encouragement into natural speech); auto-reconnect + barge-in handling (Epic 11.2); Edge Function upstream timeouts (Epic 11.3); Realtime examiner role-play for TCF Speaking (Story 10-9 / Phase-2); per-user daily AI spend cap (Epic 11.5); embedding-based dedupe in error-tracker (Epic 11.6); prompt truncation for memories + error patterns (Epic 11.7); migrating historical pre-11-1 stored transcripts (forward-only — the `TranscriptView.getDisplayText` legacy stripper handles them at render time); updating the existing `save_vocabulary` / `note_error_pattern` tool handlers (additive only); adding a `Correction = z.infer<typeof reportCorrectionArgsSchema>` type-system refactor (scope creep — would touch every UI consumer); speaking-score formula re-tuning (formula unchanged; the more-accurate input is a correctness improvement); updating `app/(tabs)/conversation/history.tsx` (legacy stripper handles pre-11-1 content automatically); adding a TranscriptView component-level test for `getDisplayText` (no pre-existing tests; out-of-scope churn).

### File List

**Created:**

- `src/lib/realtime-corrections.ts` — pure helpers `processReportCorrectionCall` + `drainPendingCorrections` extracted from the hook for testability
- `src/lib/speaking-score.ts` — pure helper `computeSpeakingScore` extracted from the hook for baseline-pin + future-tuning reference
- `src/lib/__tests__/realtime-corrections.test.ts` — 16 cases covering valid/invalid tool-call args + buffer drain semantics
- `src/lib/__tests__/speaking-score.test.ts` — 9 baseline-pin cases (zero-entries default + corrections-ratio + floor + rounding)

**Modified:**

- `src/lib/schemas/ai-responses.ts` (added `correctionCategorySchema` + `reportCorrectionArgsSchema` + `ReportCorrectionArgs` + `CorrectionCategoryInferred` type re-exports)
- `src/hooks/use-realtime-voice.ts` (registered third `report_correction` tool in `RealtimeConfig.tools`; added `pendingToolCorrectionsRef`; extended `handleFunctionCall` with the new branch using `processReportCorrectionCall`; rewrote `parseCorrections` to call `drainPendingCorrections`; deleted `inferCategory` callback; deleted the brittle regex; added buffer resets in `start()` + `case "response.done"` + `case "error"`; replaced inline speaking-score formula with `computeSpeakingScore` import + call; updated top-of-file JSDoc to mention the new tool)
- `src/lib/prompts/conversation.ts` (replaced `## Correction Report (Plain Text — Read Aloud)` block (15 lines) with `## Correction Reporting (Tool-Call)` block; cleaned up the debate-mode `"Score in the Correction Report"` stale anchor — only Story 10-7 surface touched)
- `src/components/conversation/TranscriptView.tsx` (JSDoc-only update on `getDisplayText` documenting the Story 11-1 forward-compat shim status; function body unchanged)
- `src/lib/schemas/__tests__/ai-responses.test.ts` (EXTENDED with 9 new `reportCorrectionArgsSchema` cases + the `import type { Correction }` for the structural-compat case)
- `src/lib/prompts/__tests__/conversation.test.ts` (deleted `PARSE_CORRECTIONS_REGEX` constant + consumer cases + `No corrections.` + legacy "Correction Report instructs..." case; updated block-scope anchor to "Correction Reporting (Tool-Call)"; added Story 11-1 describe block with ~10 it/it.each cases)
- `src/lib/__tests__/realtime-dedup.test.ts` (DELETED Case 14 + `parseCorrectionsForTest` mirror function; Cases 1-13 + 15+ unchanged)
- `CLAUDE.md` (added "Realtime correction tool-call protocol" architecture line after the Story 10-8 line)
- `docs/tcf-spec-source.md` (§8.4 — appended "ARCHITECTURAL SUCCESSOR DONE — closed by Story 11-1" closure stamp after the Story 10-7 closure stamp)
- `docs/tcf-spec-citations.md` (§8 row 4 — flipped ✓ Verified-with-caveat → ✓ Verified; expanded code-location cell to enumerate all new surfaces; table widths reformatted by prettier auto-fix)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-1: backlog → ready-for-dev → in-progress → review; epic-11: backlog → in-progress)
- `_bmad-output/implementation-artifacts/11-1-correction-protocol-tool-calls.md` (this story file — Status flipped, all AC + Task checkboxes [x], Dev Agent Record + File List + Change Log filled)

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-11 | Story 11-1 story file created; closes audit P1-6 (brittle parseCorrections regex) + P2-1 (voice-mode emoji format) architecturally via `report_correction` Realtime tool-call replacing the Story 10-7 minimum-viable bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-11 | Story 11-1 implementation complete on `feature/11-1-correction-protocol-tool-calls`. New `report_correction` Realtime tool registered with strict Zod schema validation; per-turn `pendingToolCorrectionsRef` buffer with drain-on-transcript-done + clear-on-response.done + clear-on-error semantics; the brittle correction-extraction regex and the `inferCategory` keyword heuristic both deleted (Story 10-2 "delete don't alias"); `## Correction Report (Plain Text — Read Aloud)` prompt block replaced with `## Correction Reporting (Tool-Call)`; pure helpers extracted at `src/lib/realtime-corrections.ts` + `src/lib/speaking-score.ts` for testability + baseline-pin; +51 net tests (894 → 945); all quality gates green; citations matrix §8 row 4 flipped to ✓ Verified; status → review. |
| 2026-05-11 | Senior Developer Review patches P1–P15 applied (3 HIGH + 7 MED + 5 LOW); +4 net tests (945 → 949); all quality gates green. See "Senior Developer Review (AI)" section below for triage detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-11 | Round 2 of Senior Developer Review applied — the round-1 patches were themselves reviewed adversarially. 5 follow-up patches (1 HIGH P16 widen-inflight-gate + 2 MED P17 setState-snapshot + P18 mergeOrphanCorrections-pure-helper-extraction-with-coverage + 2 LOW P19 MAX_PENDING_CORRECTIONS-pinned-to-20 + P20 standardized-Rejected-shape); +6 net tests (949 → 955); all quality gates green; status → review (post-round-2-patches). |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-11 (round 1) + 2026-05-11 (round 2 — patches reviewed)
**Reviewers:** Blind Hunter (general adversarial, no project context) + Edge Case Hunter (project-aware path tracer) + Acceptance Auditor (spec-vs-diff, full project read access)
**Outcome:** Round 1: Changes Requested → 15 patch findings applied. Round 2 on the patched code: Changes Requested → 5 follow-up patch findings applied → APPROVED.

### Round 2 — review of the round 1 patches

The 15 round-1 patches were themselves reviewed adversarially. The Acceptance Auditor returned a clean APPROVED verdict ("All 15 patches verified present; NOT-touched surfaces preserved; spec consistency intact"). The Blind Hunter + Edge Case Hunter surfaced 30 raw findings on the patched code → 5 patches applied (1 HIGH + 2 MED + 2 LOW) + 6 defers + remainder rejected:

- [x] **[HIGH] P16** (Blind Hunter BH3 + Edge Case Hunter ECH-A) The round-1 P1 inflight gate at `use-realtime-voice.ts` `handleFunctionCall` used `inflightItemIdRef.current === null` as the sole acceptance signal. `inflightItemIdRef` is set by the FIRST audio-transcript delta — but the OpenAI Realtime API permits tool-calls to fire BEFORE any audio delta in tool-only turns (model invokes `report_correction` with no audible response). The narrow gate over-rejected legitimate first-of-turn tool-calls and dropped real corrections. Patched: added a new `responseInFlightRef` set on `input_audio_buffer.speech_stopped` (when the user's turn ends and the AI's response window opens) and cleared on `response.done` + `case "error"` (alongside the existing `inflightItemIdRef = null` resets). The widened gate is `if (!responseInFlightRef.current && inflightItemIdRef.current === null)` — accepts a tool-call when EITHER signal is active, rejects only when both are off (i.e., outside the response window entirely). Also reset in `start()` so retries are clean.
- [x] **[MED] P17** (Blind Hunter BH2 + Edge Case Hunter ECH-N) Round-1 P2 and P3 orphan-drain code passed `setState((s) => ({ ...s, allCorrections: correctionsRef.current }))` — a live alias to the mutable ref. If a downstream `report_correction` push happened between the ref mutation and React's render commit, the UI would render the post-mutation value instead of the at-setState-time snapshot. Patched: changed both call sites to `setState((s) => ({ ...s, allCorrections: [...correctionsRef.current] }))` — snapshot spread so consumers reading `state.allCorrections` get a stable array, not a live alias.
- [x] **[MED] P18** (Blind Hunter BH11 + BH15) The round-1 P2/P3 orphan-drain code paths (3 HIGH-severity fixes that silently preserve user-correction data on the no-audio / connection-lost paths) shipped with zero unit-test coverage — the test surface explicitly noted "lifecycle assertions for the response.done / case error cleanup paths live in the hook integration surface and are not tested here." Patched: extracted the merge pattern into a new pure helper `mergeOrphanCorrections(conversation, buffer): { conversation, shouldBreadcrumb }` in `realtime-corrections.ts`; the hook now calls this helper in both response.done and case error branches; added 5 unit tests covering empty-buffer no-op + non-empty merge + idempotence + insertion-order preservation across multiple rounds + input-immutability. Also added a buffer-cap integration test that simulates `MAX_PENDING_CORRECTIONS + 5` invocations and verifies the cap correctly accepts the first 20 + rejects the overflow.
- [x] **[LOW] P19** (Blind Hunter BH5) The `MAX_PENDING_CORRECTIONS` test merely checked `Number.isInteger` + `> 0` + `< 1000` — a maintainer could silently change 20 → 1 (breaks every realistic turn) or 20 → 1000 (defeats the runaway-model defense) without explicit test update. Patched: pinned the exact value `expect(MAX_PENDING_CORRECTIONS).toBe(20)`.
- [x] **[LOW] P20** (Blind Hunter BH6) The three rejection paths in the `report_correction` handler emitted three different result-message shapes (`"Outside turn; ..."` / `"Buffer full; ..."` / `"Invalid correction shape (issue: ...)..."`), making it harder for the model to pattern-match and self-correct uniformly. Patched: standardized to `"Rejected: <reason>. <detail>. <recovery hint>."` shape across all three paths. The outside-turn message: `"Rejected: outside-turn. Tool-call arrived outside the AI response window; correction not recorded."`. The buffer-full message: `"Rejected: buffer-full. Reached MAX_PENDING_CORRECTIONS for this turn; correction not recorded. Skip further invocations until the next turn."`. The invalid-shape message (in `processReportCorrectionCall`): `"Rejected: invalid-shape. Issue: <code> at <path>. Correction not recorded. Check field names + types + the 4-literal category enum."`. The model now sees a consistent grammar and can route its self-correction logic uniformly.

### Round 2 — deferred items (filed for follow-up)

- **DEFER-7** (Blind Hunter BH8 + Edge Case Hunter dedup of BH/ECH#14) Lockstep enum-sync test (P15 from round 1) embeds an inline mirror of the `note_error_pattern` enum instead of reading from the actual tool registration in `use-realtime-voice.ts`. The test technically passes even if the inline literal in the hook drifts. Closing this requires extracting the enum to a shared constant + having the hook's tool registration consume it — out of scope per the original story's "note_error_pattern is NOT touched (additive only)" constraint. Filed as Epic 11.X / Epic 12.X consolidation.
- **DEFER-8** (Blind Hunter BH12) `RealtimeConfig.tools` array entries lack `additionalProperties: false` in their JSON Schema parameters — the OpenAI Realtime API's strict mode requires this for tight tool-call validation. Adding it would tighten the contract but requires empirical verification against the current GA API behavior (the spec sanctioned the permissive type in AC #1). Filed as future-Epic robustness improvement.
- **DEFER-9** (Edge Case Hunter ECH-D) `FUNCTION_RESULT_ACK = "ok"` could theoretically be echoed by GPT-Realtime models as French "okay" in the audio response. Empirical observation suggests this doesn't happen with the current model family (tool-call results don't get echoed as audio output), but if a future model regression introduces this behavior, the constant is centralized for easy adjustment (e.g., to a non-word token). Filed as a runtime-monitoring follow-up.
- **DEFER-10** (Blind Hunter BH14) `parseCorrections` callback signature `(_text: string) => Correction[]` keeps the unused `text` parameter for AppendOptions API compatibility with Story 9-5's pure helper. The unused parameter is a minor maintenance hazard but the alternative (changing the AppendOptions signature) is explicitly forbidden by Story 11-1's NOT-touched list (the pure helper is Story 9-5 surface). Filed as a future-Epic API-cleanup follow-up.
- **DEFER-11** (Edge Case Hunter ECH-M) `correctionsRef.current` can grow unboundedly across many turns in long conversations — each turn's orphan-drain can add up to `MAX_PENDING_CORRECTIONS` corrections. For a 1-hour conversation with 60 turns + 20 corrections each, that's 1200 entries in JSONB persisted to `conversation_messages.corrections`. Out of scope for Story 11-1; filed as Epic 11.5 (cost discipline) or Epic 13 (performance) follow-up — both have memory-bounds work in their charters.
- **DEFER-12** (Blind Hunter BH10) Documentation count drift in the change-log table — Story 11-1's first "implementation complete" entry says "+51 net tests (894 → 945)" and the round-1 review section says "+55 across the whole story" while the round-2 final count is 955 (+61 net). Each row is internally consistent at its point in time; the table now spans three review states. Filed as a documentation cleanup if Epic 11 retro decides to reconcile.

### Round 2 — rejected items (false positives, intentional, or contradicted by diff)

- **REJECT-7** (Edge Case Hunter "double-drain across response.done + case error") False alarm: `case "error"` is fired by the WebSocket close path; `response.done` is fired by the API at the end of a normal response. They don't fire for the same turn in practice.
- **REJECT-8** (Edge Case Hunter "buffer-cap counts invalid tool-calls") False alarm: the cap is checked BEFORE `processReportCorrectionCall` runs; invalid calls never reach the push, so the buffer length stays the same; subsequent valid calls correctly see the unchanged length.
- **REJECT-9** (Edge Case Hunter "processReportCorrectionCall throws synchronously") False alarm: the function uses `safeParse` which doesn't throw; the outer `try/catch` on `JSON.parse(args)` covers the only realistic throw path.
- **REJECT-10** (Edge Case Hunter "orphan drain in error path before endRef invoked") False alarm: the diff places the drain BEFORE the `if (connection_lost) { ... endRef.current?.() }` branch, so endRef sees the drained correctionsRef when it reads it inside persistConversation.
- **REJECT-11** (Edge Case Hunter "Case 14 spy passes trivially") False alarm: the test explicitly asserts `toHaveBeenCalledTimes(1)` after the first call, `toHaveBeenCalledTimes(1)` after the dedup replay (unchanged), and `toHaveBeenCalledTimes(2)` after the new key — a zero-call-count refactor would fail the first assertion.
- **REJECT-12** (Edge Case Hunter "appendIfNew dedup leaks buffer") False alarm: when a `.done` event with the same key is retransmitted, the original `.done`'s drain already captured everything; the buffer is empty by the time the dedup-hit fires; nothing to leak.

### Round 2 — final verification

- **955 tests passing** (was 949 after round 1; was 894 pre-story → net **+61 across the whole story** including both review rounds)
- All quality gates green: type-check (0 errors), lint (0 errors / 0 warnings), format (prettier-clean), check:colors (clean)
- CI Sentry DSN + Submit credentials leak guards both pass
- 0 HIGH findings remaining (3 from round 1 patched + 1 new HIGH P16 patched = 4 total HIGH closed)
- 0 MED findings remaining (7 from round 1 patched + 2 new MED P17/P18 patched = 9 total MED closed)
- 0 LOW findings remaining (5 from round 1 patched + 2 new LOW P19/P20 patched + 6 deferred per documented rationale = 13 total LOW addressed)

### Round 1 outcome (unchanged history retained below)


### Triage outcome

- **33 findings** raised across 3 reviewers (25 Blind Hunter + 8 Edge Case Hunter + 0 Acceptance Auditor — the Acceptance Auditor returned a clean "0 violations across 10 numbered ACs + AC #Z polish — spec was followed faithfully" verdict). After deduplication (BH1 ↔ ECH3 ↔ BH23 race-on-late-tool-call; BH2 ↔ BH3 ↔ BH5 contract drift; BH6 ↔ BH16 missing single-drain test; BH9 ↔ ECH7 case "error" silent clear): **28 distinct findings**.
- **15 patch findings applied** in this story branch (3 HIGH + 7 MED + 5 LOW).
- **6 defer findings** filed for follow-up (real but low-likelihood, out-of-scope per story's NOT-TOUCHED list, or acceptable trade-offs that are best addressed in a future hardening story).
- **6 reject findings** dropped as noise (false positives, intentional defensive code, or claims contradicted by the actual diff).
- **0 violations** from the Acceptance Auditor on the 10 numbered ACs + AC #Z polish — the spec was followed faithfully, including the pure-helper extraction path explicitly sanctioned by AC #7 dev-notes.

### Action Items (all resolved)

- [x] **[HIGH] P1** (Blind Hunter BH1 + Edge Case Hunter ECH3 + BH23) Race condition: a `report_correction` tool-call that lands AFTER `response.done` (theoretically possible per the GA API) would push into `pendingToolCorrectionsRef.current` and pollute the NEXT AI turn's correction set with wrong attribution. The original implementation's only defense was the `response.done` buffer clear — but pushes happening AFTER that clear would land in the freshly-emptied buffer. Patched: gated the push in `handleFunctionCall` on `inflightItemIdRef.current !== null` (set on the first delta of a turn, cleared on `response.done`). Tool-calls outside the window are dropped with a `"report_correction outside in-flight turn dropped"` Sentry breadcrumb (`feature: "realtime-report-correction"`) and the model receives `"Outside turn; correction not recorded."` so it can self-correct on its next invocation.
- [x] **[HIGH] P2** (Edge Case Hunter ECH2) `response.done` cleanup silently DROPPED buffered corrections via `pendingToolCorrectionsRef.current = []`. If a turn ended without a terminal `response.output_audio_transcript.done` event firing (e.g., model invoked `report_correction` but produced no audible response, or the transcript event was suppressed), the corrections were lost from the persisted record AND from `extractErrorsFromCorrections` + the speaking-score formula. Patched: drain the orphan corrections into `correctionsRef.current` (so the post-conversation pipeline still sees them) before clearing the buffer; state updated with the merged corrections so the UI reflects them; breadcrumb fires only when non-empty (the actual leak signal).
- [x] **[HIGH] P3** (Blind Hunter BH9 + Edge Case Hunter ECH7) `case "error"` cleanup silently DROPPED buffered corrections on the `connection_lost` branch — where `end()` then persists `correctionsRef.current` to Supabase. Real validated corrections from successful tool-calls that landed BEFORE the error were being lost from the persisted record. Patched: drain into `correctionsRef.current` first (mirroring P2's pattern) so the persisted snapshot is complete; breadcrumb on non-empty drain; the existing parent `captureError(event.error, "realtime-voice-error")` for the API failure stays in place.
- [x] **[MED] P4** (Blind Hunter BH2 + BH3 + BH5) `drainPendingCorrections` contract drift — the implementation does both in-place truncation (`buffer.length = 0`) AND returns a defensive copy (`buffer.slice()`), but the JSDoc described only one of those behaviors. Two test cases (defensive-copy + same-buffer-push-after-drain) verified DIFFERENT invariants without explaining that both held. Patched: rewrote the JSDoc to document both contracts explicitly ("buffer is empty after the call" + "returned array is a fresh copy"), with worked examples of each invariant's consumer.
- [x] **[MED] P5** (Blind Hunter BH6 + BH16) Test coverage gap: pre-11-1 `realtime-dedup.test.ts` Case 14 verified `parseCorrections` was invoked exactly once per AI turn (replayed events did not double-count). The pre-11-1 case was DELETED with the production regex it mirrored — but no test replaced the single-invocation-per-key contract. A future refactor that accidentally double-invokes `parseCorrections` for the same `item_id` would silently drain the buffer twice (first call returns corrections; second returns empty), losing real corrections without visible failure. Patched: added a new Case 14 that uses a `jest.fn()` spy for `parseCorrections` and verifies (a) callback fires exactly once on first `appendIfNew` for a key, (b) callback does NOT fire on dedup-blocked replay, (c) callback fires exactly once more on a new unique key.
- [x] **[MED] P6** (Blind Hunter BH18) Single error message for all parse failures meant the model couldn't self-correct meaningfully — every failure returned the SAME `"Invalid correction shape; correction not recorded."` string regardless of which field was wrong. Patched: `processReportCorrectionCall` now includes the Zod issue path (e.g., "category" or "explanation") + issue code in the result message: `"Invalid correction shape (issue: invalid_type at explanation); correction not recorded. Check field names + types + the 4-literal category enum."`. The path is bounded (schema field names are short literals) so the message stays well under any reasonable token budget. Updated tests to assert the field name appears in the result message.
- [x] **[MED] P7** (Blind Hunter BH10) `ReportCorrectionArgs` ↔ `Correction` structural-compat test was uni-directional — only checked schema → interface assignability, not the inverse. If `Correction` gained an optional field in a future story, the test would still pass even though the schema diverged. Patched: added the inverse `argsRoundTrip: ReportCorrectionArgs = correction` assignment so bi-directional structural equality is enforced at compile time.
- [x] **[MED] P8** (Blind Hunter BH13) The result string `"Correction recorded."` sent to the model as `function_call_output` risked being echoed in the model's audio response (the API feeds function results back as context for the model's continuing turn). Patched: exported a `FUNCTION_RESULT_ACK = "ok"` constant from `realtime-corrections.ts` — short lowercase token that's unambiguously NOT a phrase the model would surface in its spoken French. The invalid path uses a longer diagnostic string (per P6) because the model NEEDS to see field-level error context to self-correct; the success path uses the minimal ack to avoid audio leak.
- [x] **[MED] P9** (Edge Case Hunter ECH4) No size cap on the `pendingToolCorrectionsRef` buffer — a runaway model could spam `report_correction` calls unbounded. Patched: exported `MAX_PENDING_CORRECTIONS = 20` from `realtime-corrections.ts` (sane upper bound for a single AI turn that typically has 3-4 corrections; small enough to prevent runaway memory growth, large enough not to clip realistic turns). The handler checks the cap BEFORE calling `processReportCorrectionCall` and rejects with a Sentry breadcrumb + `"Buffer full; correction not recorded."` result message when reached.
- [x] **[MED] P10** (Edge Case Hunter ECH5) No max-length on the schema's three string fields (`original`, `corrected`, `explanation`) — only `.min(1)` was enforced. A degenerate model could inject arbitrarily large strings into `conversation_messages.corrections` JSONB. Patched: exported `REPORT_CORRECTION_MAX_LENGTH = { original: 500, corrected: 500, explanation: 1000 }` and applied `.max()` constraints on each schema field. Caps match the publisher's expected utterance lengths for TCF Canada with comfortable headroom. Added a test that verifies `too_big` issue code on over-cap input.
- [x] **[LOW] P11** (Blind Hunter BH7 + BH17) Negative assertions in `conversation.test.ts` were over-broad — `not.toContain("No corrections.")` would false-positive if "No corrections." legitimately appeared anywhere else in the prompt (matching the Story 10-7 P5 anti-pattern where `force est de constater` legitimately surfaced in `vocabulary-tiers.ts`). Similarly `toMatch(/multiple times within a single response/)` could match prose in a different prompt section. Patched: scoped the `"No corrections."` assertion to `^No corrections\.$/m` (anchored line-start + line-end) so only the directive shape fails; scoped the `"multiple times within a single response"` positive assertion to the `## Correction Reporting (Tool-Call)` block slice using the same `startIdx` / `nextSectionIdx` pattern the emoji-guard tests use.
- [x] **[LOW] P12** (Blind Hunter BH11) `ProcessReportCorrectionResult.issueCode` was typed as `string` instead of `ZodIssueCode | "unknown"`, leaving the door open for a future refactor to leak Zod issue `path` or `message` content into the Sentry breadcrumb. Patched: tightened the type to `ZodIssueCode | "unknown"` in the discriminated union; the `firstIssue?.code ?? "unknown"` resolver coerces correctly.
- [x] **[LOW] P13** (Blind Hunter BH12) Invalid-input test asserted only `outcome === "invalid"` for the `[null, undefined, 42, "string", [], true]` loop — order-dependent on Zod version (a future Zod release could change the `invalid_type` issue code or how empty arrays parse against `z.object`). Patched: pinned `result.issueCode === "invalid_type"` inside the loop so any drift in Zod's issue-code semantics fails CI loudly.
- [x] **[LOW] P14** (Blind Hunter BH14) Documentation count drift — CLAUDE.md's "TCF realtime correction tool-call protocol" architecture paragraph claimed `realtime-corrections.test.ts` had "16 cases" but the actual count is 13 (which became 16 after the P9/P10/P13 review-patch additions, but the original CLAUDE.md narrative was written before those patches). Also: the prose said "9 new `reportCorrectionArgsSchema` cases" but the actual count was 7 (now 10 after P7/P10/P14 review-patch additions). Patched: rewrote the test-narrative paragraph in CLAUDE.md to be specific about case categories (well-formed, parameterized accept, invalid-category reject, etc.) WITHOUT pinning case counts — exact counts drift with maintenance; the surface coverage is the durable fact.
- [x] **[LOW] P15** (Blind Hunter BH24) `correctionCategorySchema` was created "for future single-source-of-truth use" but the existing `note_error_pattern` Realtime tool's inline `enum: ["grammar", "pronunciation", "vocabulary", "register"]` literal was NOT migrated (additive only, per story scope). The two enums could drift silently if a future contributor extends one without the other. Patched: added a lockstep regression test that asserts the inline enum's set equals `correctionCategorySchema.options`'s set. If either drifts, CI fails. Story 11-1 still does NOT refactor the `note_error_pattern` handler — that's a future Epic 11.X consolidation — but the test pins the contract.

### Deferred items (filed for follow-up)

- **DEFER-1** (Blind Hunter BH4) `pendingToolCorrectionsRef` not reset on unmount cleanup. Mostly benign: `useRef` discards on unmount, and a remount re-initializes to `[]`. The only real exposure would be if the unmount-during-active-conversation path consumed the buffer — verified-correct: it doesn't (the persist path consumes `correctionsRef.current`, not the pending buffer). Filed as a Story 12.5 (`ExpoPlayAudioStream` lifecycle) follow-up if the broader hook-lifecycle audit surfaces additional cleanup gaps.
- **DEFER-2** (Blind Hunter BH8) `correctionCategorySchema` not consumed by the inline `note_error_pattern` `enum: [...]` literal. Story 11-1 explicitly defers this consolidation per the "additive only" scope; P15's regression test pins the lockstep contract until then. Future Epic 11.X / Epic 12.X consolidation story.
- **DEFER-3** (Blind Hunter BH21) Zod `.options` array ordering not guaranteed across major version migrations. P14's order-independent set-based test addresses the immediate concern; full migration would require a tsd-style `Equal<>` type-test which is an Epic 15.X test-infra story.
- **DEFER-4** (Blind Hunter BH22) Tool description duplicated between the JSON schema `description` strings and the markdown prompt body. Both surfaces are intentional — the JSON schema surfaces to the model directly via the API, the prompt body documents the contract for the model's reasoning. The duplication is a trade-off, not a defect. Filed as a documentation-architecture follow-up.
- **DEFER-5** (Blind Hunter BH25) `getDisplayText` JSDoc-only update — no new test for the "verbatim passthrough" path. Story 11-1 explicitly scopes this as out of scope ("adding a TranscriptView component-level test for `getDisplayText` — the function is exported-by-name from inside the component file; existing test coverage is absent. Adding a co-located test is out-of-scope churn"). Filed as Epic 15.X / Story 1-2 follow-up.
- **DEFER-6** (Edge Case Hunter ECH6) Cross-item drift attribution — `appendIfNew` could attribute corrections to a non-matching turn if a stray `.done` with a different `item_id` arrived between the in-flight turn's tool-calls and its terminal `.done`. With Story 9-5's `output_modalities: ["audio"]` configuration only one terminal event fires per response, making this extremely low-likelihood. Filed as Epic 11.2 (Realtime reconnect + barge-in) follow-up since reconnect is the most plausible trigger.

### Rejected items (noise / false positives / contradicted by diff)

- **REJECT-1** (Blind Hunter BH4 partial — see DEFER-1 for the keep-able portion) Buffer-not-cleaned-up-on-unmount is benign per the analysis above; the deferred follow-up covers the audit, not a code change.
- **REJECT-2** (Blind Hunter BH15) `computeSpeakingScore`'s defensive negative-input branch (`totalUserEntries <= 0` → 70) is unreachable in production but INTENTIONAL — the helper is exposed as a small public API in `src/lib/speaking-score.ts` and the defensive branch protects future callers. Story 11-1 deliberately documented the contract.
- **REJECT-3** (Blind Hunter BH19) The block-length sanity check `> 50` was claimed to be a no-op now; actual test uses `> 200`. Reviewer misread the threshold. The current `> 200` is still meaningful — the new "Correction Reporting (Tool-Call)" block content is ~1000 chars including the bullet list of argument descriptions, well above the threshold.
- **REJECT-4** (Edge Case Hunter ECH1) Buffer drain "lost on dedup branch" — false alarm: if `.done` is duplicated, the original `.done` already drained the buffer; the duplicate finds an empty buffer; nothing is lost.
- **REJECT-5** (Edge Case Hunter ECH8) `report_correction` doesn't gate on `user` like other handlers — false alarm: the Realtime session can't START without an authenticated user (the ephemeral-token Edge Function gates on auth). By the time tool-calls fire, `user` is guaranteed non-null.
- **REJECT-6** (Blind Hunter BH20) Type narrows to schema not interface — addressed structurally by P7's bi-directional compat test. The narrowing was a non-issue once the test was strengthened.

### Final verification

- **949 tests passing** (was 945 post-implementation, 894 pre-story; net **+55 across the whole story including the review patches**)
- All quality gates green: `npm run type-check` (0 errors), `npm run lint` (0 errors / 0 warnings), `npm run format:check`, `npm test`, `npm run check:colors`
- CI Sentry DSN + Submit credentials leak guards both pass (no new credentials / DSN literals introduced)
- 0 HIGH findings remaining (3 patched)
- 0 MED findings remaining (7 patched, 0 deferred — all MED-severity findings were addressable in this round)
- 0 LOW findings remaining (5 patched, 6 deferred per documented rationale)

### Cross-story consistency

- Story 9-3 Sentry telemetry allowlist contract — preserved unchanged; new breadcrumbs reuse existing allowlisted keys (`category`, `feature`, `code`).
- Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + bilingual "treat as data" prelude) — NOT touched by patches; verified by re-reading `conversation.ts` post-patch.
- Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` + FIFO-capped 256-entry dedup Set + the entire `realtime-transcript.ts` pure module) — NOT touched. The new Case 14 in `realtime-dedup.test.ts` exercises Story 9-5's `appendIfNew` callback-invocation contract; the pure helper module is byte-for-byte unchanged.
- Story 9-7 Zod schema retry contract — NOT applicable (the `report_correction` Realtime path uses one-shot `safeParse` + breadcrumb without the `chatCompletionJSON` retry loop). The schema's `.max()` length constraints follow the same Story 9-7 pattern of declarative validation replacing hand-rolled validators.
- Story 9-8 / 10-6 speaking pipeline (5-dimension rubric + `RUBRIC_TO_COMPOSITE = 1.0` + `speaking.test.ts:145` emoji guard) — NOT touched.
- Story 10-2 per-skill scoring + `IRCC_CLB_BANDS` — NOT touched.
- Story 10-3 per-CEFR passage ranges + `writingTaskWordRange` helper — NOT touched.
- Story 10-4 `buildVocabularyConstraintBlock` integration in 9 prompt builders — NOT touched.
- Story 10-5 `buildPlacementTestPrompt` helper signature + `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` — NOT touched.
- Story 10-7 surfaces (debate-mode 3-category split + `CEFR_LEVELS` `nameFr` Alliance Française + Québécois drop + `force est de constater` echo fixes) — preserved. The debate-mode "Score in the Correction Report" stale anchor cleanup is a Story 11-1 downstream-coherence fix; the Story 10-7 3-category split immediately above is byte-for-byte preserved.
- Story 10-8 exercise dedup + `text-hash.ts` + `question_stem_hashes` column — NOT touched (separate exercise surface, not voice).
