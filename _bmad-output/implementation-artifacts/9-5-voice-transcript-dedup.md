# Story 9.5: Voice Transcript Dedup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a French learner having a voice conversation with the Companion,
I want every AI turn to appear exactly once in the live transcript view, persist exactly once to `conversation_messages`, and feed downstream pipelines (memory extraction, error-pattern extraction, speaking-score math, history viewer) exactly once,
so that the UI does not show duplicate AI bubbles, the DB does not accumulate doubled rows per session, and downstream AI calls do not see (and pay for) twice the content for every conversation I have.

## Background — Why This Story Exists

The 2026-05-06 independent audit (`_bmad-output/planning-artifacts/shippable-roadmap.md` §1) flagged this as **P0-6**, a release blocker:

> "Duplicate transcript entries in voice mode — both `output_text.done` and `output_audio_transcript.done` fire for same response; every assistant turn stored 2× in DB and shown 2× in UI. Files: `src/hooks/use-realtime-voice.ts:293-352`, `src/lib/realtime.ts:234`. Source agents: architecture."

A hands-on audit of the codebase against that finding confirmed the bug is live. The full chain of consequences — not just "UI looks wrong twice" — is:

| # | Defect | Location | Why it matters |
|---|--------|----------|----------------|
| **D1** | `realtime.ts:234` configures `output_modalities: ["text", "audio"]` for voice conversations. The GA Realtime API emits BOTH a text content-part AND an audio content-part (with its transcript) for the **same** `response_id` / `item_id`. | `src/lib/realtime.ts:222-258` (`configureSession`) | This is the root cause of the duplication: two terminal events fire for the same AI turn — `response.output_text.done` and `response.output_audio_transcript.done`. |
| **D2** | `use-realtime-voice.ts:293-318` (`response.output_text.done`) and `:327-352` (`response.output_audio_transcript.done`) each independently push a `TranscriptEntry` into `transcriptRef.current`, run `parseCorrections` over the same text twice, and append `corrections` to `correctionsRef.current` twice. | `src/hooks/use-realtime-voice.ts:293-352` | Live UI shows the AI bubble 2× per turn. `correctionsRef` is doubled for every "Correction Report" emitted, doubling the speaking-score penalty input and doubling the error-pattern extraction work. |
| **D3** | The two delta paths (`response.output_text.delta` at line 288-292 and `response.output_audio_transcript.delta` at line 322-325) BOTH append to the same `currentAiTextRef.current`. While the model is mid-turn, `pendingAiText` shows the streamed text concatenated with the streamed audio-transcript — i.e. roughly the AI's reply twice in a row, growing in real time. | `src/hooks/use-realtime-voice.ts:288-292, 322-325` | The "AI is speaking…" preview UI is corrupted during every voice turn until both `.done` events fire. |
| **D4** | `persistConversation` (`use-realtime-voice.ts:441-590`) maps `transcriptRef.current` directly to `conversation_messages` row inserts (line 505-513). The doubled transcript array → doubled row insert per AI turn. The same array is also flattened to `transcript = transcriptRef.current.map(...).join("\n")` (line 518) and passed to `extractAndStoreMemories` and the feedback-generation prompt. | `src/hooks/use-realtime-voice.ts:441-590` | DB has 2× the rows per session. Memory-extractor sees the AI message twice (more "memorable" facts to extract). The post-conversation feedback prompt receives a transcript with the AI half doubled — fluency / grammar ratings may skew. The downstream cost is real. |
| **D5** | `app/(tabs)/conversation/history.tsx:382-386` reads `conversation_messages` ordered by `created_at` and renders verbatim. The doubled rows show as two identical bubbles in the history viewer. | `app/(tabs)/conversation/history.tsx:382-398` | The bug is durable: even after a session ends and you reopen the history, you see double. |
| **D6** | The offline write-queue path (`use-realtime-voice.ts:472-490`) likewise queues the doubled `transcriptRef.current` rows. When the queue flushes (via `NetworkBanner`), the doubled rows land in the DB. | `src/hooks/use-realtime-voice.ts:472-490`, `src/lib/cache.ts` (write queue) | Offline-completed conversations are also affected; the bug is not network-conditional. |
| **D7** | The `RealtimeEvent` type discriminator (`src/lib/realtime.ts:29-49`) does NOT include the `response_id`, `item_id`, or `content_index` fields that the GA API actually sends on every response.* and conversation.* event. | `src/lib/realtime.ts:29-49` | This is a TS-level gap, not a runtime bug, but it blocks any dedup-keyed-off-`response_id` solution at the type system. The dev agent must extend the type before they can dedupe. |

These seven defects are coupled: the modality configuration causes duplicate events, the duplicate event handlers cause duplicate transcript entries, the duplicate entries pollute every downstream consumer (UI, DB persist, memory extractor, error-pattern extractor, speaking score, feedback summary, history viewer, offline queue). The story addresses the chain at two layers — primary fix (only one modality per response) and defense-in-depth (key-based dedup) — because eliminating the cause is cheap and asserting "no doubles ever land downstream" is the whole point of the regression test.

Epic 9 acceptance-criterion lineage (`shippable-roadmap.md` §2 line 135):

> *"9.5 Voice transcript dedup (mobile + ai-integration) — switch to single modality per response or de-dup keyed off `response.id`; verify no DB doubles. Covers P0-6."*

Epic 9 cross-cutting acceptance criterion (`shippable-roadmap.md` line 145):

> *"No transcript appears twice in DB or UI for any voice conversation in the test matrix."*

**This story owns both legs**: the modality switch (single-source-of-truth fix) **and** the response-id-keyed dedup (defense-in-depth fix). The CI regression test asserts no double can land in the prompt-shape / event-shape model the hook builds.

**Threat / failure model — what cannot happen post-story:**

After this story:

1. A normal voice conversation produces exactly one `TranscriptEntry` per AI turn in `transcriptRef.current`.
2. A normal voice conversation produces exactly one row per AI turn in `conversation_messages`.
3. `currentAiTextRef.current` is reset on every `response.created`/new `item_id` and contains exactly one stream of deltas (the audio transcript) until that response's `.done`.
4. `correctionsRef.current` contains each correction exactly once per AI turn.
5. The speaking-score formula (`correctedEntries / Math.max(totalEntries, 1)`) sees real correction count, not 2×.
6. The post-conversation feedback prompt and `extractAndStoreMemories` see each AI turn once in the transcript flattening.
7. If a future code change accidentally re-enables dual modalities OR a future GA API revision sends two terminal events for the same `item_id`, the dedup Set blocks the second insertion silently and a `Sentry.addBreadcrumb` records the dedup fire (so we can see if it ever triggers in production).

**Out of scope for this story (delegated elsewhere):**

- **Realtime reconnect / barge-in handling** → **Epic 11.2** (`shippable-roadmap.md` line 180). 9-5 only addresses transcript dedup; reconnect-after-disconnect, `response.cancel` on user-barge-in, and the ws-onclose retry loop are 11.2 territory.
- **`useRealtimeVoice` decomposition into a `RealtimeOrchestrator` class** → **Epic 12.1** (line 202). 9-5 stays in the hook — it does NOT extract a class. Surgical scope.
- **Atomic RPC mutations** for `incrementDailyActivity`/`updateStreak`/`updateSkillProgress` → **Epic 12.3** (line 204). 9-5 does not touch the activity-update chain.
- **Streaming mock-test generation, transcript-render-storm fix, home-query fan-out** → **Epic 13** (perf). 9-5 does not optimize.
- **Correction protocol via tool-calls (replacing regex parsing of corrections)** → **Epic 11.1** (line 179). 9-5 does NOT replace `parseCorrections` — it only ensures it runs once per turn instead of twice. The regex-parsing approach is preserved.
- **Top-N memory truncation in prompts** → **Epic 11.7** (line 185). Already shipped as `MAX_PROMPT_USER_ITEMS` in story 9-4.
- **Embedding-based dedupe of error patterns** → **Epic 11.6** (line 184). 9-5 fixes the *event-level* duplicate; pattern-string equivalence is a separate problem.
- **Backfill of pre-9-5 doubled rows in production** — the store has zero production users; the operator may run `DELETE FROM conversation_messages WHERE …` to clean staging if needed, gated on operator risk tolerance. The dev agent does NOT script or execute the cleanup.
- **`conversation_messages` schema change** (e.g. a UNIQUE constraint on `(conversation_id, role, content)`) — out of scope. The application-tier dedup is the right layer; a DB constraint would block legitimate identical user replies (e.g. "yes" said twice). Flagged as future hardening if the application-tier ever proves insufficient.
- **Edge Function `realtime-session` change** — out of scope. The token-mint Edge Function is content-agnostic; the modality and dedup are client-side.

## Acceptance Criteria

### 1. Single-Modality Configuration — Voice Sessions Emit One Terminal Event Per AI Turn

The session must be configured so that the GA Realtime API emits exactly **one** terminal `.done` event per AI response in voice mode (the audio transcript), not two.

- [x] In `src/lib/realtime.ts:234`, change `output_modalities: ["text", "audio"]` to `output_modalities: ["audio"]`.
- [x] **Why audio-only and not text-only:** the AI's voice is the primary user surface; the audio transcript is what we render in `TranscriptView` and persist to `conversation_messages.content`. Text-only would mean no voice playback (the whole feature breaks). Audio-only means voice playback continues working AND the audio transcript is the canonical text.
- [x] **Update the JSDoc on `RealtimeConfig` and `configureSession`** to note: "Voice sessions configure `output_modalities: ['audio']` to ensure exactly one terminal transcript event (`response.output_audio_transcript.done`) fires per response. See story 9-5."
- [x] **Tool-only responses still work**: if the AI emits a function call without text/audio (e.g. `note_error_pattern` with no spoken reply), the session emits only `response.function_call_arguments.done` and `response.done` — neither audio nor text — so no transcript event fires and no entry is added. Verified by inspection of the existing function-call handler logic (lines 379-381) which is unchanged.
- [x] **Verify with the GA API docs** (already verified by the story author against `https://platform.openai.com/docs/guides/realtime-websocket`): when `output_modalities` is `["audio"]`, the events fired for a normal assistant response are `response.created` → `response.output_item.added` → `response.content_part.added` (type "audio") → `response.output_audio_transcript.delta` × N → `response.output_audio.delta` × N → `response.output_audio_transcript.done` → `response.output_audio.done` → `response.content_part.done` → `response.output_item.done` → `response.done`. **No** `response.output_text.*` event in this stream.

**Given** a voice session has just opened
**When** the model produces an AI response
**Then** exactly one `response.output_audio_transcript.done` event fires for that response
**And** zero `response.output_text.done` events fire for that response

**Given** the AI produces a function call only (no spoken reply)
**When** `response.done` fires
**Then** no transcript event has fired
**And** no entry was added to `transcriptRef.current` for that response

### 2. Response-ID Dedup — Defense-in-Depth Against a Future Modality Drift or Duplicate-Event Bug

Even with single-modality config, the hook must self-protect against a duplicate `.done` event firing for the same `response_id`/`item_id`. This is the defense-in-depth leg.

- [x] In `src/hooks/use-realtime-voice.ts`, add a new ref:
  ```ts
  /** Set of response item ids whose terminal transcript event has already produced a TranscriptEntry. */
  const processedResponseItemsRef = useRef<Set<string>>(new Set());
  ```
- [x] **Reset the set on every `start()`** alongside the other ref resets at lines 599-606. Add: `processedResponseItemsRef.current = new Set();`
- [x] **Cap the set's size** to prevent unbounded growth across long sessions: when `.size > 256`, clear it (one full clear is cheaper than per-add eviction; 256 turns is well past the longest realistic session). This goes inside the centralized append helper in AC #3.
- [x] **Choose `item_id` as the dedup key, not `response_id`**: the GA API fires per-content-part `.done` events keyed off `item_id` (the message item). A single `response_id` may carry multiple items (rare, but possible — e.g. multi-message responses). `item_id` is the granular unit. **Fall back to `response_id` if `item_id` is missing** for any reason; **fall back to a stable hash of `(timestamp + first 32 chars of text)` if both are missing** so a malformed event still gets a key (and the regex bypass risk is one collision per ~4B turns).
- [x] **Sentry breadcrumb on dedup fire**: when an event arrives whose key is already in the set, call `addBreadcrumb({ category: "realtime", level: "warning", message: "Duplicate transcript event suppressed", data: { key } })` (via the wrapper in `@/src/lib/sentry`). Do **not** `captureError` — this is expected defensive behavior, not an anomaly. **Deviation:** the spec called for `data: { eventType, key, textPreview }`. `eventType` and `textPreview` are not on the story-9-3 Sentry-extras allowlist, and adding them is out of scope (sentry.ts is not in the modify list). `key` (an opaque OpenAI item id) is the diagnostically essential field; the top-level `category: "realtime"` already groups events. The 9-3 discipline (no free-text in logs) is preserved.

**Given** a single-modality voice session
**When** a `response.output_audio_transcript.done` event fires with `item_id: "item_abc"` and is processed
**Then** `processedResponseItemsRef.current` contains `"item_abc"`

**Given** the same `item_id` ever appears in a second `.done` event (synthetic duplicate test)
**When** the handler runs
**Then** no second `TranscriptEntry` is appended
**And** `correctionsRef.current` is not appended to a second time
**And** a Sentry breadcrumb is recorded with category `"realtime"`, level `"warning"`, message `"Duplicate transcript event suppressed"`

### 3. Centralized Transcript Append Helper — One Function, One Call Site Per Path

Replace the duplicated transcript-append logic in the two `.done` handlers (lines 293-318 and 327-352) with a single helper. The current code reaches the doubled state by *copy-pasting* the append logic; the fix is to move the logic into one place.

- [x] Add an inner helper inside the hook (between `handleFunctionCall` at line 256 and `handleEvent` at line 259):
  ```ts
  /**
   * Append a single AI-turn transcript entry, applying response-id dedup.
   * Returns true if the entry was added, false if it was deduped.
   *
   * Centralized so both the audio-transcript and text-fallback paths
   * route through one append + one parseCorrections call.
   */
  const appendAiTranscriptEntry = useCallback(
    (text: string, key: string): boolean => {
      // Dedup: same item_id / response_id should never produce two entries.
      if (processedResponseItemsRef.current.has(key)) {
        Sentry.addBreadcrumb({
          category: "realtime",
          level: "warning",
          message: "Duplicate transcript event suppressed",
          data: { key, textPreview: text.slice(0, 40) },
        });
        return false;
      }
      processedResponseItemsRef.current.add(key);
      // Cap the set's size — see AC #2.
      if (processedResponseItemsRef.current.size > 256) {
        processedResponseItemsRef.current = new Set();
      }

      const corrections = parseCorrections(text);
      const entry: TranscriptEntry = {
        id: `ai_${key}`, // stable id derived from the upstream key, not Date.now()
        role: "assistant",
        text,
        corrections: corrections.length > 0 ? corrections : undefined,
        timestamp: Date.now(),
      };

      transcriptRef.current = [...transcriptRef.current, entry];
      correctionsRef.current = [...correctionsRef.current, ...corrections];
      currentAiTextRef.current = "";

      setState((s) => ({
        ...s,
        transcript: transcriptRef.current,
        pendingAiText: "",
        allCorrections: correctionsRef.current,
      }));

      onTranscriptUpdate?.(transcriptRef.current);
      return true;
    },
    [parseCorrections, onTranscriptUpdate]
  );
  ```
- [x] Import `Sentry` from `@/src/lib/sentry` if it's not already imported in the hook (it is — `captureError` import at line 24). Add `addBreadcrumb` to the import.
- [x] **Use a stable id keyed off the upstream event** — change `id: \`ai_${Date.now()}\`` to `id: \`ai_${key}\``. The `Date.now()`-based id was a contributing cause of the bug being invisible to React (two entries with different `id`s render fine in `FlatList`). With a stable upstream-derived id, a duplicated event would have produced a React `keyExtractor` collision warning long before the audit found it. The change makes future dup bugs self-loud.
- [x] **Wire the helper into the audio-transcript path** at lines 327-352:
  ```ts
  case "response.output_audio_transcript.done": {
    const key = event.item_id ?? event.response_id ?? `fallback_${Date.now()}_${event.transcript.slice(0, 32)}`;
    appendAiTranscriptEntry(event.transcript, key);
    break;
  }
  ```
  Replace the entire existing block with the four-line version above.
- [x] **Wire the same helper into the text-fallback path** at lines 293-318:
  ```ts
  case "response.output_text.done": {
    // Defensive: with output_modalities=["audio"], this event should not fire.
    // If the modality config ever drifts, the helper's response-id dedup
    // ensures we don't double-append after the audio transcript already landed.
    const key = event.item_id ?? event.response_id ?? `fallback_${Date.now()}_${event.text.slice(0, 32)}`;
    appendAiTranscriptEntry(event.text, key);
    break;
  }
  ```
  Replace the existing block. The helper does the dedup; if the modality drift ever re-enables text emission, the audio-transcript event will land first (it's emitted at a similar timing) and add the entry — the text event arrives second and dedup-no-ops.
- [x] **Both delta paths reset on a new `item_id`** — see AC #4.

**Given** the audio-transcript handler is invoked with text "Bonjour!" and item_id "item_a1"
**When** `appendAiTranscriptEntry("Bonjour!", "item_a1")` runs the first time
**Then** the entry's `id` is `"ai_item_a1"`
**And** `transcriptRef.current` length increased by 1

**Given** an unexpected text-fallback event then arrives for the same `item_id "item_a1"`
**When** `appendAiTranscriptEntry` is called
**Then** the function returns `false`
**And** `transcriptRef.current` length is unchanged
**And** a Sentry breadcrumb is recorded

### 4. Delta-Path Hygiene — One Stream of Pending Text Per In-Flight Item

The streaming-deltas bug (D3) — both `output_text.delta` and `output_audio_transcript.delta` concatenating into `currentAiTextRef.current` — must be fixed by tracking which `item_id` is in-flight and ignoring deltas from other paths once one is established.

- [x] Add a ref to track the in-flight item:
  ```ts
  /** item_id of the AI response currently being streamed; null between turns. */
  const inflightItemIdRef = useRef<string | null>(null);
  ```
- [x] Reset `inflightItemIdRef.current = null;` on every `start()` (alongside the other resets at lines 599-606).
- [x] **On `response.output_audio_transcript.delta`**: set the in-flight item if not yet set; only append delta if `inflightItemIdRef.current === event.item_id` (or the in-flight is null and this is a new turn — adopt it).
  ```ts
  case "response.output_audio_transcript.delta": {
    const itemId = event.item_id ?? null;
    if (inflightItemIdRef.current === null && itemId) {
      inflightItemIdRef.current = itemId;
    }
    // Only stream deltas from the in-flight item — drops cross-modality deltas
    // and stray deltas from cancelled responses.
    if (itemId && inflightItemIdRef.current !== itemId) break;
    currentAiTextRef.current += event.delta;
    setState((s) => ({ ...s, pendingAiText: currentAiTextRef.current }));
    break;
  }
  ```
- [x] **On `response.output_text.delta`** (defensive — should not fire under audio-only config): apply the same guard.
- [x] **Clear `inflightItemIdRef` on the terminal `.done` events** AND on `response.done` (whichever lands first), so the next turn can adopt a fresh `item_id`. Add a clear at the end of `appendAiTranscriptEntry` (after `currentAiTextRef.current = ""`):
  ```ts
  inflightItemIdRef.current = null;
  ```
- [x] **Also clear on `response.done`** (line 383 of the existing switch):
  ```ts
  case "response.done":
    inflightItemIdRef.current = null;
    setState((s) => ({ ...s, isProcessing: false }));
    break;
  ```
  This is the safety net for the case where the delta path is the only one that fired (e.g. cancelled response).

**Given** a single voice turn that streams audio-transcript deltas "Bon", "jour", "!" all under `item_id: "item_a1"`
**When** all three deltas arrive
**Then** `currentAiTextRef.current === "Bonjour!"`
**And** `pendingAiText === "Bonjour!"`

**Given** a hypothetical scenario where both modalities are enabled and a `response.output_text.delta` fires for the same `item_id` mid-stream
**When** the delta arrives
**Then** `currentAiTextRef.current` is unchanged (the delta is dropped because the in-flight item already adopted the audio-transcript stream)

### 5. Type Extension — `RealtimeEvent` Discriminator Carries `response_id`, `item_id`, `content_index`

The `RealtimeEvent` union in `src/lib/realtime.ts:29-49` does not currently include the `response_id`, `item_id`, or `content_index` fields that the GA API sends on every response.* and conversation.* event. These fields exist on the wire; they're just not in the type. Without them, AC #2 / #3 / #4 cannot type-check.

- [x] Extend the relevant arms of `RealtimeEvent` to include the GA API fields:
  ```ts
  export type RealtimeEvent =
    | { type: "session.created"; session: Record<string, unknown> }
    | { type: "session.updated"; session: Record<string, unknown> }
    | { type: "response.output_audio.delta"; delta: string; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.output_audio.done"; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.output_text.delta"; delta: string; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.output_text.done"; text: string; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.output_audio_transcript.delta"; delta: string; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.output_audio_transcript.done"; transcript: string; response_id?: string; item_id?: string; content_index?: number }
    | { type: "response.done"; response: Record<string, unknown> }
    | { type: "input_audio_buffer.speech_started" }
    | { type: "input_audio_buffer.speech_stopped" }
    | { type: "input_audio_buffer.committed" }
    | { type: "conversation.item.created"; item: Record<string, unknown> }
    | { type: "response.function_call_arguments.done"; call_id: string; name: string; arguments: string }
    | { type: "error"; error: { message: string; code: string } };
  ```
- [x] **Optional fields, not required** — the GA API does send them on every response.* event in practice, but typing them as optional is defensive (a future protocol change or a malformed event won't break compilation; the runtime fallback to `response_id` → text-prefix hash in AC #3 covers it).
- [x] **No other type changes**: do not extend `session.created`, `conversation.item.created`, or function-call arms. Surgical scope.

**Given** TypeScript compilation
**When** `event.item_id` is read in the new transcript handlers
**Then** `npm run type-check` passes with no errors

### 6. Synthetic-Event Regression Test in CI

A pure-function regression suite that builds synthetic `RealtimeEvent` sequences and asserts the hook's transcript bookkeeping is correct. The suite is added to `src/lib/__tests__/` per the established convention (the suite tests the *event-handling logic* in pure form — see "Test strategy" below).

- [x] Create `src/lib/__tests__/realtime-dedup.test.ts` (new file). The suite is **event-shape regression** — it does not call the real OpenAI WebSocket; it builds synthetic event objects and runs them through a thin replay harness that mirrors the hook's switch.
- [x] **Test strategy:** the dedup logic and the in-flight item logic are easy to extract as pure functions. **Refactor opportunity (recommended, included in scope):** move the dedup/append helper logic into a small pure module `src/lib/realtime-transcript.ts` that exports:
  - `appendIfNew(state, key, text, parseCorrectionsFn): { state, appended }` — pure state transition
  - `acceptDelta(state, itemId, delta): { state }` — pure delta accumulator
  Then the hook calls into these and the test file tests the pure module. **This is the cleaner architecture.** If the dev finds the extraction adds >40 lines of plumbing, fall back to mocking the hook (use `@testing-library/react-native` `renderHook`) — but try the pure extraction first.
- [x] **Test cases** (each is one `it(...)` block):
  1. **Single audio-transcript event appends one entry** — replay `response.output_audio_transcript.done` with `item_id: "i1", transcript: "Bonjour!"`. Assert state has 1 entry with `id: "ai_i1"`, `text: "Bonjour!"`.
  2. **Duplicate audio-transcript events with same item_id** — replay the same event twice. Assert state still has 1 entry. Assert the second call returns `appended: false`.
  3. **Audio-transcript followed by stray text-done with same item_id** — replay audio-transcript-done then text-done with same `item_id`. Assert state has exactly 1 entry (audio came first, text deduped).
  4. **Two distinct AI turns produce two entries** — replay audio-transcript-done with `item_id: "i1"` then with `item_id: "i2"`. Assert state has 2 entries.
  5. **Missing item_id falls back to response_id** — replay event with `item_id: undefined, response_id: "r1", transcript: "X"`. Assert key is `"r1"`, entry id is `"ai_r1"`.
  6. **Missing both item_id and response_id falls back to deterministic hash of timestamp + text-prefix** — replay event with both missing. Assert an entry IS added (no crash, no skip), and a key with prefix `"fallback_"` appears in the dedup set.
  7. **Set caps at 256** — replay 257 distinct-`item_id` events. Assert the set's size is ≤ 256 after the cap fires (the set is cleared and the 257th item is the only one in the new set).
  8. **Delta accumulator: single-item stream concatenates correctly** — feed three deltas under `item_id: "i1"` ("Bon", "jour", "!"). Assert pending text is "Bonjour!".
  9. **Delta accumulator: cross-item delta is dropped** — set inflight to "i1", feed a delta with `item_id: "i2"`. Assert pending text is unchanged.
  10. **Delta accumulator: missing item_id on delta is tolerated** — set inflight to "i1", feed a delta with no `item_id`. Assert behavior matches the chosen pragmatic decision (recommend: append the delta — the missing-id case is "trust the protocol"; document the choice in the test name).
  11. **Reset on response.done clears inflight** — set inflight to "i1", call the response.done handler. Assert inflight is null.
  12. **Reset on `start()` clears the set and inflight** — populate both, call the reset, assert empty.
  13. **`appendIfNew` records a Sentry breadcrumb on dedup** — mock `Sentry.addBreadcrumb`, replay a duplicate, assert it was called with `category: "realtime"`, `level: "warning"`, `message: "Duplicate transcript event suppressed"`. (If the helper extraction fully decouples from Sentry, accept a callback and assert the callback fires — keeps the pure module truly pure.)
  14. **Corrections are extracted exactly once per AI turn** — feed an audio-transcript-done whose text contains `"foo" → "bar" (grammar)`. Assert `correctionsRef`/state has exactly one Correction entry. Replay the same event a second time. Assert correction count is unchanged (matches AC #2).

  Cases 1-13 are pure tests (against the extracted module or the in-line helpers). Case 14 is the "no double corrections" assertion that the audit specifically calls out.

- [x] **CI integration: no separate workflow step needed.** `.github/workflows/ci.yml` already runs `npm test` on every PR. Adding tests in `src/lib/__tests__/` is auto-picked-up.

**Given** the new test file
**When** `npm test` runs in CI
**Then** all 14 cases pass
**And** the test file follows the existing `src/lib/__tests__/` convention (same as `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`)

### 7. Documentation — CLAUDE.md Architecture Contract Line + Hook JSDoc

- [x] **CLAUDE.md** — under `## Architecture`, immediately after the existing "Stored-prompt-injection defense" line (added by story 9-4), add one new line:
  > **Voice transcript dedup:** `src/lib/realtime.ts` configures `output_modalities: ["audio"]` so exactly one terminal transcript event (`response.output_audio_transcript.done`) fires per AI turn. `src/hooks/use-realtime-voice.ts` (or `src/lib/realtime-transcript.ts` if extracted) appends transcript entries via a single dedup-aware helper keyed off `item_id` (with `response_id` and timestamp+text-prefix fallbacks) — duplicate events for the same key are suppressed and breadcrumbed to Sentry. Regression-tested in `src/lib/__tests__/realtime-dedup.test.ts`. Verified 2026-05-07, story 9-5.

- [x] **No `.env.example` change.** This story does not introduce env vars.
- [x] **No PRD edit.** PRD FR3 ("voice conversation") and FR4 ("transcript display") describe the user-facing experience; the dedup is an internal correctness fix.
- [x] **No privacy-policy edit.** No new data collected.
- [x] **JSDoc updates** on `RealtimeSession.configureSession` (note the audio-only modality decision) and on the new helper / module (note dedup contract, Sentry breadcrumb, key fallback chain).

### 8. No Existing Conversations / Tests Are Broken — Quality Gates Pass

- [x] **All existing call sites compile** — `RealtimeSession`, `useRealtimeVoice`, all consumers in `app/(tabs)/conversation/[sessionId].tsx`, `app/(tabs)/conversation/history.tsx`, `TranscriptView`, etc. retain unchanged public signatures.
- [x] **All existing tests still pass** — `scoring.test.ts`, `tcf-spec.test.ts`, `activity.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts` — nothing changes structurally outside this story's files.
- [ ] **Manual smoke test (mandatory before marking done):** start a voice conversation, exchange ≥3 turns, end the session. Verify in dev (1) the transcript shows each AI turn exactly once, (2) the row count in `conversation_messages` for the session matches the visible turn count (assistant rows = visible AI bubbles, user rows = user turns), and (3) `correctionsRef` / `state.allCorrections` count matches what's actually shown. Document the pass in Completion Notes. **Deferred to reviewer / user** — the dev agent cannot run a live OpenAI Realtime voice session in CI; this is a `review → done` gate, not a `in-progress → review` gate.
- [x] `npm run type-check` clean.
- [x] `npm run lint` clean (`--max-warnings 0`).
- [x] `npm run format:check` clean.
- [x] `npm test` clean — full suite + the new ~14 cases.

### Z. Polish Requirements

- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — no hardcoded hex *(N/A — no UI colors changed; this story is library + hook logic + tests only)*
- [x] All loading states use skeleton animations — no `ActivityIndicator` spinners *(N/A)*
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` *(N/A — no new interactive elements)*
- [x] Non-obvious interactions have `accessibilityHint` *(N/A)*
- [x] Stateful elements have `accessibilityState` *(N/A)*
- [x] All tappable elements have minimum 44x44pt touch targets *(N/A)*
- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — the dedup-fire path uses `addBreadcrumb` (not `captureError`) because dedup is expected behavior, not an error. Verify no new silent-throw paths are introduced.
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` *(N/A)*
- [x] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test`

## Tasks / Subtasks

- [x] Task 1: Configure single-modality voice session (AC: #1)
  - [x] 1.1 Change `output_modalities: ["text", "audio"]` → `["audio"]` at `src/lib/realtime.ts:234`
  - [x] 1.2 Update JSDoc on `configureSession` to note the modality decision and link story 9-5
  - [x] 1.3 Add a top-of-file comment block on `realtime.ts` summarizing the modality contract
- [x] Task 2: Extend `RealtimeEvent` type with `response_id` / `item_id` / `content_index` (AC: #5)
  - [x] 2.1 Add optional fields to the four response.output_*.delta and .done arms in `src/lib/realtime.ts:29-49`
  - [x] 2.2 Verify `npm run type-check` passes after the addition
- [x] Task 3: Centralized transcript-append helper + response-id dedup (AC: #2, #3)
  - [x] 3.1 Add `processedResponseItemsRef` ref + reset on `start()` in `src/hooks/use-realtime-voice.ts`
  - [x] 3.2 (Recommended) Extract dedup/append logic to a new pure module `src/lib/realtime-transcript.ts` exporting `appendIfNew` and `acceptDelta`. If extraction adds >40 lines of plumbing, keep the helper inline as `appendAiTranscriptEntry` inside the hook. — Pure module extracted. Hook plumbing was ~30 lines (under the 40-line threshold).
  - [x] 3.3 Wire `response.output_audio_transcript.done` to call the helper with key = `event.item_id ?? event.response_id ?? fallback hash`
  - [x] 3.4 Wire `response.output_text.done` to the same helper (defensive — should not fire under audio-only config)
  - [x] 3.5 Use a stable id keyed off `key` (`ai_${key}`) for `TranscriptEntry.id` instead of `Date.now()`
  - [x] 3.6 Add `addBreadcrumb` on dedup fire (category `"realtime"`, level `"warning"`)
  - [x] 3.7 Cap the dedup Set at 256 entries (clear when exceeded)
- [x] Task 4: Delta-path hygiene — single in-flight item (AC: #4)
  - [x] 4.1 Add `inflightItemIdRef` ref + reset on `start()`
  - [x] 4.2 In both `.delta` paths, adopt or guard against the in-flight item; drop deltas from other items
  - [x] 4.3 Clear `inflightItemIdRef` at the end of `appendAiTranscriptEntry` and on `response.done`
- [x] Task 5: Add the regression test suite (AC: #6)
  - [x] 5.1 Create `src/lib/__tests__/realtime-dedup.test.ts`
  - [x] 5.2 If pure module was extracted, test the module directly. Otherwise, use `@testing-library/react-native` `renderHook` against `useRealtimeVoice` with a mocked `RealtimeSession`. Prefer the pure-module path. — Pure-module path taken.
  - [x] 5.3 Implement test cases 1-14 from AC #6 — 14 case-named tests + 2 supplementary asserts (resolveTranscriptKey precedence, acceptDelta first-adopt).
  - [x] 5.4 Run `npx jest src/lib/__tests__/realtime-dedup.test.ts` — green (16/16 pass; full suite 175/175 pass).
- [x] Task 6: Documentation (AC: #7)
  - [x] 6.1 Add the one-line "Voice transcript dedup" architecture-contract note to `CLAUDE.md` immediately after the Stored-prompt-injection-defense line. Use today's date in the verification stamp. — Stamped 2026-05-07.
  - [x] 6.2 Update JSDoc on `RealtimeSession.configureSession` and on the new helper / module
- [ ] Task 7: Manual smoke test (AC: #8) — **deferred to reviewer / user** (cannot be run by the dev agent in CI)
  - [ ] 7.1 Start a voice conversation in the dev simulator (or device), exchange ≥3 AI turns, end the session
  - [ ] 7.2 Verify visible AI bubbles count matches expected
  - [ ] 7.3 Query `select count(*) from conversation_messages where conversation_id = '<id>' and role = 'assistant'` — must equal expected AI turn count, not 2×
  - [ ] 7.4 Document the pass (turn count, row count) in Completion Notes
- [x] Task 8: Quality gates (AC: #8 / #Z)
  - [x] 8.1 `npm run type-check` clean
  - [x] 8.2 `npm run lint` clean (`--max-warnings 0`)
  - [x] 8.3 `npm run format:check` clean
  - [x] 8.4 `npm test` clean — full suite green (existing tests + new ~14 cases)

## Dev Notes

### Why this story is so small in scope

Two touched files (`src/lib/realtime.ts`, `src/hooks/use-realtime-voice.ts`) — optionally three if the recommended `src/lib/realtime-transcript.ts` extraction is taken — one new test file (`realtime-dedup.test.ts`), one CLAUDE.md line. It is **not** a `useRealtimeVoice` rewrite. **If you find yourself opening:**

- `app/(tabs)/conversation/[sessionId].tsx` — stop. The screen passes `memories`/`errorPatterns` into the hook and renders `state.transcript` via `TranscriptView`. Pass-through is unchanged.
- `app/(tabs)/conversation/history.tsx` — stop. The history viewer reads `conversation_messages` ordered by `created_at`. With the dedup fix, there are no doubled rows; no client change needed.
- `src/components/conversation/TranscriptView.tsx` — stop. Uses `keyExtractor: item.id`. The id format change (`ai_${Date.now()}` → `ai_${item_id}`) is a content change, not a structural change. FlatList stability improves (stable upstream-derived ids).
- `src/components/conversation/CorrectionBubble.tsx` — stop. Renders `corrections` from a `TranscriptEntry`. With the dedup fix, each correction appears once. No client change.
- `src/lib/memory.ts`, `src/lib/error-tracker.ts` — stop. These read the (now-deduped) `transcriptRef.current` flattening and `correctionsRef.current` and behave correctly with the cleaner inputs.
- `supabase/migrations/*` — stop. **No DB change.** A `UNIQUE (conversation_id, role, content)` constraint would block legitimate identical user replies (e.g. "yes" twice). The application-tier dedup is the correct layer.
- `supabase/functions/realtime-session/*` — stop. The token-mint Edge Function is content-agnostic; the modality is configured client-side via `session.update`.
- `src/lib/cache.ts` (write queue) — stop. The queue replays whatever rows the offline path enqueued; with the dedup fix there are no doubled rows to enqueue.

The temptation will be to extract a `RealtimeOrchestrator` class (per Epic 12.1) while you're in the file. **Resist it.** Story 12.1 is a separate sprint item with its own scope. 9-5 is surgical: stop the duplicate from forming.

### Why both legs (modality switch AND response-id dedup)

The audit's exact wording is *"single modality per response **or** de-dup keyed off response.id"*. We do **both**:

1. **Modality switch is the primary fix** — it removes the *cause* of duplicate `.done` events. After this change, the GA API stops sending two terminal events for one response. This is cheap (a one-line config change), correct (audio-only is the right config for a voice product), and addresses the real problem.

2. **Response-id dedup is the safety net.** Three reasons it's worth the second leg:
   - **Future modality drift:** if a developer in a future story re-adds `"text"` to the modalities (e.g. for a "text-only debug" mode), the dup bug returns silently. The dedup makes the regression impossible at the hook layer.
   - **GA API protocol drift:** OpenAI may at any point start emitting additional `.done` variants (e.g. a `response.output_text.done` *summary* even under audio-only modality, mirroring how `conversation.item.created` arrives for assistant items). The dedup makes the hook resilient to that.
   - **Test asseratability:** the audit acceptance "no transcript appears twice in DB or UI for any voice conversation in the test matrix" — a regression test that asserts duplicate `.done` events with the same `item_id` produce one entry is far more meaningful than asserting "we configured audio-only modality" alone.

The cost is one Set, one centralized append helper, one breadcrumb. Negligible.

### Why a centralized append helper (extracted, ideally to a pure module)

This mirrors the pattern stories 9-2 (`evaluatePromotion`), 9-3 (`scrubEvent`), and 9-4 (`sanitizeMemoryContent`) used: extract pure logic, test pure logic. The current bug exists *because* the append logic is copy-pasted in two places. Forcing it through one helper means a future copy-paste bug is harder to introduce (only one site to copy from), and the test surface becomes a pure module instead of a hook + WebSocket mock.

The helper extraction is **recommended but conditional**: if the dev finds the plumbing nontrivial (e.g. it requires passing 5+ refs into the helper as args), keep it inline. The bar is ~40 lines of plumbing — beyond that, the cure is worse than the disease.

### Why `item_id` is the dedup key (not `response_id`)

The GA API event hierarchy is: a `response` contains one or more output `item`s; each `item` contains one or more `content_part`s; the terminal `.done` events fire per-item, keyed by `item_id`. Most assistant turns are one item per response, so `response_id` and `item_id` are 1:1 in practice — but a multi-message response (rare, but possible — e.g. a streamed reasoning prefix followed by a user-facing reply) has one `response_id` and multiple `item_id`s. We want each `item_id` to produce its own `TranscriptEntry`; deduping by `response_id` would suppress the legitimate second item.

The fallback chain is **`item_id` → `response_id` → `fallback_${timestamp}_${textPrefix}`**:
- `item_id` covers the canonical case.
- `response_id` covers events where the API didn't include `item_id` (defensive).
- The `timestamp + text-prefix` hash covers events where neither is sent (extremely defensive — a malformed event can still get a key, and the collision rate is one in ~4B turns).

### Why a stable id (`ai_${key}`) instead of `Date.now()`

`Date.now()` produces a fresh id on every event handler call. Two duplicate events under the bug produced two different ids — React's FlatList rendered both happily because `keyExtractor` saw distinct keys. With a stable upstream-derived id (`ai_${item_id}`), a duplicate event would have caused a `keyExtractor` collision warning at runtime — the bug would have been self-loud during development. Switching to a stable id is a cheap, durable improvement.

The user-side analogue (`user_${Date.now()}` at line 365 and 725) is left unchanged for now — there's no analogous duplicate-event source on the user side (user transcripts come via `conversation.item.created`, not via a multi-modality split). A future story may unify both paths if a user-side dup is ever observed.

### What the manual smoke test buys

The CI test asserts the *event-handler logic* is dedup-correct. It does NOT replay a real WebSocket and does NOT exercise the GA Realtime API. The manual smoke test (Task 7) is the bridge: it confirms that under the *real* GA API and our *real* `output_modalities: ["audio"]` config, the assistant emits exactly one terminal transcript event per turn, and the DB row count matches the visible bubble count. Without it, we're trusting the Azure SDK docs (which describe the protocol) and the OpenAI GA spec (which describes our model) without actually verifying. The cost is one ~3-minute manual session; the gain is real.

If the manual smoke test reveals the audio-transcript event does *not* fire (e.g. under some edge condition), the dedup safety net is what saves us — the hook still works, but only the text-fallback path lands the entry. That's degraded behavior (no audio playback), but at least the transcript is correct. The test confirms the happy path.

### Existing utilities — DO NOT recreate

| Utility | Location | Use For |
|---------|----------|---------|
| `RealtimeSession` class | `@/src/lib/realtime` | Existing — used by `useRealtimeVoice`. Do NOT extract a new class; only edit `configureSession` and the `RealtimeEvent` type. |
| `parseCorrections` (inner `useCallback` in the hook) | `src/hooks/use-realtime-voice.ts:142-161` | Existing — preserved unchanged. The helper from AC #3 calls it; do not rewrite it. The Epic 11.1 tool-call protocol replaces this — out of scope here. |
| `captureError`, `addBreadcrumb` | `@/src/lib/sentry` | Existing — `addBreadcrumb` is the right channel for the dedup-fire signal (not `captureError`). |
| `Sentry` import | `@sentry/react-native` (transitively via `@/src/lib/sentry`) | Existing — `addBreadcrumb` is exported from the same module surface. |
| `TranscriptEntry` interface | `src/hooks/use-realtime-voice.ts:36-42` | Existing — leave shape unchanged. Only the `id` value changes (now stable instead of `Date.now()`-derived). |
| `TranscriptView` component | `@/src/components/conversation/TranscriptView` | Existing — its `keyExtractor: item.id` is the consumer of the stable id change. No component change needed. |
| `appendAiTranscriptEntry` (the helper from AC #3) | NEW — inside the hook OR extracted to `src/lib/realtime-transcript.ts` | NEW — single source of truth for transcript append + dedup. |
| `processedResponseItemsRef`, `inflightItemIdRef` | NEW — refs inside the hook | NEW — dedup state and in-flight delta tracking. |
| `ProcessedKey` / `DedupState` types (if module is extracted) | NEW — in `src/lib/realtime-transcript.ts` | NEW — pure types if the module is extracted. Keep minimal. |

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/__tests__/realtime-dedup.test.ts` | 14-case Jest suite covering modality contract (in JSDoc/header), dedup helper purity, key fallback chain, set capping, in-flight item delta accumulator, response.done reset, breadcrumb-on-dedup, and "no double corrections" assertion. |
| `src/lib/realtime-transcript.ts` (recommended, conditional) | NEW pure module exporting `appendIfNew` and `acceptDelta`. Drop if extraction adds >40 lines of plumbing. |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/realtime.ts` | Change `output_modalities: ["text", "audio"]` → `["audio"]` at line 234. Extend the four `response.output_*` arms of `RealtimeEvent` with optional `response_id`, `item_id`, `content_index` fields. Update JSDoc on `configureSession`. |
| `src/hooks/use-realtime-voice.ts` | Add `processedResponseItemsRef` and `inflightItemIdRef` (resets on `start()`). Add `appendAiTranscriptEntry` helper (or import `appendIfNew` / `acceptDelta` from `realtime-transcript.ts`). Replace bodies of `response.output_audio_transcript.done` (lines 327-352) and `response.output_text.done` (lines 293-318) with helper calls. Add in-flight guards on both `.delta` paths. Clear in-flight on `response.done`. Use stable `ai_${key}` for `TranscriptEntry.id`. Add `Sentry.addBreadcrumb` import (already imports `captureError`). |
| `CLAUDE.md` | Add one-line "Voice transcript dedup" architecture-contract note under `## Architecture`, immediately after the existing "Stored-prompt-injection defense" line. |

### What This Story Does NOT Include

- **NO** DB constraint or migration on `conversation_messages` (flagged as future hardening; out of scope).
- **NO** backfill / cleanup of existing doubled rows (operator action only; staging only — no production users).
- **NO** changes to `RealtimeSession.connect`, the WebSocket protocol, the ephemeral-token flow, or the `realtime-session` Edge Function.
- **NO** rewrite of `parseCorrections` to a tool-call protocol (Epic 11.1).
- **NO** decomposition of `useRealtimeVoice` into a `RealtimeOrchestrator` class (Epic 12.1).
- **NO** atomic RPC mutations for activity updates (Epic 12.3).
- **NO** changes to `extractAndStoreMemories`, `extractErrorsFromCorrections`, or downstream consumer logic — they automatically benefit from the deduped input.
- **NO** changes to `app/(tabs)/conversation/[sessionId].tsx`, `history.tsx`, `TranscriptView`, `CorrectionBubble`, or any other consumer of `state.transcript`.
- **NO** changes to the user-side `TranscriptEntry` id pattern (`user_${Date.now()}`) — out of scope.
- **NO** new env vars, no `app.json` change, no SDK upgrades, no new dependencies.
- **NO** changes to `output_text.delta`/`done` removal — the cases are kept as defensive fallbacks with dedup guards (in case a future modality-config change happens).
- **NO** changes to barge-in / response.cancel behavior (Epic 11.2).

### Audit excerpts for reference

From `_bmad-output/planning-artifacts/shippable-roadmap.md`:

> **P0-6** — Duplicate transcript entries in voice mode — both `output_text.done` and `output_audio_transcript.done` fire for same response; every assistant turn stored 2× in DB and shown 2× in UI.
> Files: `src/hooks/use-realtime-voice.ts:293-352`, `src/lib/realtime.ts:234`. Severity: P0. Specialists: architecture.

Epic 9 deliverable 9.5 (line 135):

> *"Voice transcript dedup (mobile + ai-integration) — switch to single modality per response or de-dup keyed off `response.id`; verify no DB doubles. Covers P0-6."*

Epic 9 acceptance criterion (line 145):

> *"No transcript appears twice in DB or UI for any voice conversation in the test matrix."*

Relevant NFRs:
- **NFR3** (`epics.md` "voice latency") — orthogonal; the dedup is a correctness fix, not a latency change. Modality switch *may* have a minor positive latency effect (one fewer content-part being streamed), but this is not a goal of the story.
- **NFR8** (AI keys server-side only) — orthogonal.
- **NFR15** (no PII in logs) — orthogonal; the new Sentry breadcrumb logs `key` (an opaque OpenAI item id) and a 40-char text preview, both safe.

### Sentry / Error handling

This story introduces one new Sentry signal: `Sentry.addBreadcrumb` on dedup fire. Rationale:
- `captureError` is wrong: a duplicate event is expected behavior of the dedup safety net, not an error condition.
- A breadcrumb gives us visibility into how often the safety net fires in production. If it fires regularly, we know the modality switch alone wasn't sufficient (e.g. the API protocol changed). If it fires never, we have evidence the modality switch is doing the work and the safety net is true defense-in-depth.
- Breadcrumbs are scrubbed by `scrubEvent` (story 9-3) — the 40-char text preview is well under the 80-char redaction threshold; the `key` is an opaque OpenAI id with no user content. Both safe under existing rules.

The existing error-handling envelope of `useRealtimeVoice` is preserved. No new `try/catch` is added.

### Testing standards summary

- New tests live under `src/lib/__tests__/` (existing pattern — `scoring.test.ts`, `tcf-spec.test.ts`, `mock-test-prompt.test.ts`, `tcf.test.ts`, `activity.test.ts`, `sentry-init.test.ts`, `sentry-scrubber.test.ts`, `prompt-injection.test.ts`).
- `jest.setup.js` already stubs Supabase env vars. No new test infrastructure is needed for the pure-module path.
- For the hook-level integration test (case 14 — verifying corrections are appended once), prefer the pure-module extraction path. If the extraction is taken, the test imports the module directly and feeds synthetic `RealtimeEvent` arrays; no `renderHook`, no React, no Supabase mock.
- If the extraction is not taken, fall back to `@testing-library/react-native` `renderHook` against the hook with `RealtimeSession` mocked at the constructor level (`jest.mock("@/src/lib/realtime")`). The activity.test.ts mocking pattern is the closest precedent.
- Path alias `@/*` → repo root.

### Dependencies on previous stories

- **Story 9-1** (TCF Canada pivot) — no overlap.
- **Story 9-2** (CEFR promotion engine fix) — established the **pure-helper-extracted-for-testability** pattern (`evaluatePromotion()`); 9-5 follows the same pattern with `appendIfNew` / `acceptDelta` if extraction is taken.
- **Story 9-3** (Sentry leak remediation) — established the breadcrumb-vs-captureError discipline. 9-5's dedup-fire breadcrumb follows the same rule (defensive expected behavior is a breadcrumb, not an error).
- **Story 9-4** (Stored-prompt-injection defense) — established the **architecture-contract one-liner in CLAUDE.md** convention. 9-5 mirrors that note style. The `MAX_PROMPT_USER_ITEMS = 20` precedent (top-N cap to bound prompt token cost) is also a conceptual sibling — both stories add cheap caps to prevent unbounded growth of an internal list.
- **No story is blocked by 9-5 directly**. 9-5 unblocks Epic 11 (AI robustness) by providing a clean, deduped transcript surface for the correction-protocol-via-tool-calls work (11.1) and the realtime reconnect work (11.2). Both 11.1 and 11.2 will benefit from a single source of truth for the transcript append.

### Project Structure Notes

- All touched files (`src/lib/realtime.ts`, `src/hooks/use-realtime-voice.ts`, optionally `src/lib/realtime-transcript.ts`) live under `src/`. No screen, store, or component is touched.
- The `components/` directory at repo root is unused boilerplate per CLAUDE.md — do not put anything there.
- New tests live in `src/lib/__tests__/` per existing convention.
- Path alias `@/*` → repo root.

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md — §1 P0-6 (line 41), §2 Epic 9 deliverable 9.5 (line 135), Epic 9 acceptance criterion line 145, Epic 11 (lines 175-194), Epic 12 (lines 198-220)]
- [Source: _bmad-output/planning-artifacts/prd.md — FR3 voice conversation, FR4 transcript display]
- [Source: _bmad-output/planning-artifacts/architecture.md — voice conversation data flow (§Data Flow)]
- [Source: _bmad-output/planning-artifacts/epics.md — NFR3 voice latency (informational, orthogonal)]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml — Epic 9 `in-progress`, story 9-5 `backlog` (line 126)]
- [Source: _bmad-output/implementation-artifacts/9-4-stored-prompt-injection-defense.md — pure-function extraction pattern, CLAUDE.md contract-note convention, breadcrumb-vs-captureError discipline]
- [Source: _bmad-output/implementation-artifacts/9-3-sentry-leak-remediation.md — breadcrumb discipline, scrubbing rules]
- [Source: _bmad-output/implementation-artifacts/9-2-cefr-promotion-engine-fix.md — pure-decision-helper extraction pattern]
- [Source: src/lib/realtime.ts — `RealtimeSession` (line 80), `configureSession` (lines 222-258), `output_modalities` (line 234), `RealtimeEvent` type (lines 29-49)]
- [Source: src/hooks/use-realtime-voice.ts — `TranscriptEntry` (lines 36-42), refs (lines 115-130), `parseCorrections` (lines 142-161), `handleEvent` switch (lines 259-413), `response.output_audio_transcript.done` (lines 327-352), `response.output_text.done` (lines 293-318), delta paths (lines 288-292, 322-325), `response.done` (line 383), `start` resets (lines 599-606), `persistConversation` (lines 441-590), `conversation_messages.insert` (line 513)]
- [Source: src/components/conversation/TranscriptView.tsx — `keyExtractor` line 242, `FlatList` virtualization]
- [Source: app/(tabs)/conversation/history.tsx — `conversation_messages` read at lines 382-386]
- [Source: src/lib/sentry.ts — `addBreadcrumb` re-export, `scrubEvent` rules (story 9-3)]
- [Source: src/lib/__tests__/scoring.test.ts, tcf-spec.test.ts, activity.test.ts, sentry-scrubber.test.ts, prompt-injection.test.ts — existing pure-function test patterns to follow]
- [Source: jest.config.js, jest.setup.js — `jest-expo` preset, `@/*` alias, supabase env stubbing already in place]
- [Source: supabase/migrations/20260301000000_initial_schema.sql:92-111 — `conversation_messages` schema and RLS]
- [Source: OpenAI GA Realtime API docs (https://platform.openai.com/docs/guides/realtime-websocket) — event lifecycle, `output_modalities` semantics, `response_id` / `item_id` / `content_index` fields]
- [Source: CLAUDE.md — `## Architecture` section, location for new "Voice transcript dedup" line]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- ESLint: initially flagged a missing `onTranscriptUpdate` dependency on the `handleEvent` `useCallback`. Resolved by re-adding the dependency (the user-side `conversation.item.created` branch still calls it).
- ESLint: `import/order` warning on test file fixed by separating the `@/src/types/conversation` import group.
- Prettier: auto-fixed minor formatting drift in the new test file.

### Completion Notes List

**Implementation summary**

- **Primary fix (modality switch):** `src/lib/realtime.ts:configureSession` now sends `output_modalities: ["audio"]`, eliminating the duplicate terminal events at the source. JSDoc on `configureSession` and a top-of-file modality-contract block document the decision and link this story.
- **Defense-in-depth (response-id dedup):** Pure helpers `appendIfNew`, `acceptDelta`, `resolveTranscriptKey` extracted to `src/lib/realtime-transcript.ts`. The hook routes both `.done` paths and both `.delta` paths through these helpers via a single `appendAiTranscriptEntry` callback. Dedup keys cascade `item_id → response_id → fallback_${now}_${textPrefix.slice(0,32)}`.
- **Stable transcript ids:** `TranscriptEntry.id` is now `ai_${key}` for AI-side entries — a future double would surface as a `FlatList` `keyExtractor` collision warning, making latent dup bugs self-loud. User-side ids (`user_${Date.now()}`) are unchanged per story scope.
- **Set cap:** the dedup set caps at `DEDUP_SET_CAP = 256`. When the next add would exceed the cap, the set is cleared first so the new key survives the wrap (matching test case 7).
- **In-flight item tracking:** `inflightItemIdRef` adopts the first `item_id` seen on a turn's deltas; subsequent cross-item deltas are dropped (defends D3). Cleared on terminal `.done` (via the helper) and on `response.done` (catch-all for cancelled / tool-only turns).
- **Sentry breadcrumb on dedup fire:** routed through the local `addBreadcrumb` wrapper from `@/src/lib/sentry` (which scrubs through the story-9-3 allowlist). `data: { key }` only — no free-text content. **Deviation from spec:** AC #2 specified `data: { eventType, key }` and AC #3 illustrative code added `textPreview`. Neither `eventType` nor `textPreview` is on the Sentry-extras allowlist; adding them would require modifying `src/lib/sentry.ts`, which is not in the story's "Files to Modify" list. `key` (an opaque OpenAI item id) is the diagnostically essential field; the top-level `category: "realtime"` already groups events. The 9-3 "no free-text in logs" discipline is preserved.

**Pure-module decision (AC #6 / Task 5.2)**

Extracted to `src/lib/realtime-transcript.ts`. Hook plumbing for the helper is ~30 lines of glue (under the 40-line threshold the story author set), and the test file gets to assert the contract directly without `renderHook` or WebSocket mocking.

**Test coverage**

`src/lib/__tests__/realtime-dedup.test.ts` — 16 tests across 4 describe blocks: `appendIfNew` (cases 1, 2, 3, 4, 7, 13, 14), `resolveTranscriptKey` (cases 5, 6, plus precedence), `acceptDelta` (cases 8, 9, 10, plus first-adopt), and hook-side reset semantics (cases 11, 12). All pass.

**Quality gates**

- `npm run type-check` — clean (0 errors)
- `npm run lint --max-warnings 0` — clean
- `npm run format:check` — clean
- `npm test` — 175/175 pass across 9 suites

**Manual smoke test (AC #8 / Task 7) — DEFERRED**

The manual smoke test (start a voice session, exchange ≥3 AI turns, verify DB row count matches visible bubble count) is mandatory before marking the story `done` but cannot be performed by the dev agent — it requires an OpenAI API key, a microphone-permitted simulator/device, and a live network connection. AC #8 is also explicit that this is a `before marking done` gate, not a `before marking review` gate. **Reviewer / user action required:** run the smoke test before transitioning the story to `done` in sprint-status.yaml. Quote the visible AI-bubble count and the `select count(*) from conversation_messages where conversation_id = '<id>' and role = 'assistant'` row count in this Completion Notes section before promoting.

**Out-of-scope items NOT touched (per story Dev Notes "What This Story Does NOT Include")**

No changes to: `app/(tabs)/conversation/[sessionId].tsx`, `history.tsx`, `TranscriptView`, `CorrectionBubble`, `memory.ts`, `error-tracker.ts`, `cache.ts`, supabase migrations, or the `realtime-session` Edge Function. Public signatures of `RealtimeSession`, `useRealtimeVoice`, and `TranscriptEntry` are unchanged (the type is now re-exported from the hook for backwards compat with `TranscriptView`).

### File List

**Created**

- `src/lib/realtime-transcript.ts` — pure helpers `appendIfNew`, `acceptDelta`, `resolveTranscriptKey`, types `TranscriptEntry`, `AppendInput`, `AppendOptions`, `AppendResult`, `DeltaState`, `AcceptDeltaResult`, constant `DEDUP_SET_CAP`.
- `src/lib/__tests__/realtime-dedup.test.ts` — 16-case regression suite covering AC #6 cases 1–14 plus 2 supplementary precedence/adopt asserts.

**Modified**

- `src/lib/realtime.ts` — `output_modalities: ["text", "audio"]` → `["audio"]`; extended four `response.output_*.delta`/`.done` arms of `RealtimeEvent` with optional `response_id` / `item_id` / `content_index`; updated JSDoc on `configureSession`; added top-of-file modality-contract block.
- `src/hooks/use-realtime-voice.ts` — added `processedResponseItemsRef` and `inflightItemIdRef` (reset on `start()`); added `appendAiTranscriptEntry` callback wiring the pure module to refs + setState; replaced bodies of `response.output_text.done`, `response.output_audio_transcript.done`, `response.output_text.delta`, `response.output_audio_transcript.delta` with helper-driven versions; cleared `inflightItemIdRef` on `response.done`; re-exported `TranscriptEntry` from the new pure module; added `addBreadcrumb` to the sentry import.
- `CLAUDE.md` — added "Voice transcript dedup" architecture-contract line under `## Architecture` immediately after the "Stored-prompt-injection defense" line. Verified 2026-05-07.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status `9-5-voice-transcript-dedup: ready-for-dev` → `review`; bumped `last_updated`.
- `_bmad-output/implementation-artifacts/9-5-voice-transcript-dedup.md` — Status `ready-for-dev` → `review`; tasks 1–6 + 8 + subtasks marked `[x]`; ACs #1–#7, #8 (except manual smoke test), #Z marked `[x]`; Dev Agent Record populated.

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-07 | Story 9-5 implemented: single-modality voice config + pure dedup helpers + `inflightItemId` delta hygiene + 16-case regression suite + CLAUDE.md contract line + JSDoc updates. Manual smoke test deferred to reviewer. | dev-agent (claude-opus-4-7) |
