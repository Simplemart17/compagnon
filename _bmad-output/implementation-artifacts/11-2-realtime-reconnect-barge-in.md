# Story 11.2: Realtime Reconnect + Barge-in — Auto-Reconnect with Exponential Backoff + `response.cancel` / `conversation.item.truncate` on User-Audio-While-AI-Speaking

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose AI conversation partner is the OpenAI Realtime WebSocket session at [`src/lib/realtime.ts`](src/lib/realtime.ts) `RealtimeSession` consumed by [`src/hooks/use-realtime-voice.ts`](src/hooks/use-realtime-voice.ts) — but per audit finding **P1-7** ([`_bmad-output/planning-artifacts/shippable-roadmap.md` line 58-59](_bmad-output/planning-artifacts/shippable-roadmap.md)) "No reconnect / barge-in handling in `RealtimeSession` — connection drops mid-conversation = data loss; user talks over AI = overlapping audio" — the WebSocket's `onclose` handler at [`src/lib/realtime.ts:243-256`](src/lib/realtime.ts) on a post-open close emits an `error` event with `code: "connection_lost"` which the hook's `case "error"` handler at [`use-realtime-voice.ts:636`](src/hooks/use-realtime-voice.ts) routes to `setState({status: "disconnected"}) + endRef.current?.()` — i.e., a momentary network blip TERMINATES the conversation entirely (the user has to manually navigate back to the conversation screen and tap "Start" again, losing the in-progress topic context, the running duration timer, and the rapport with the AI) — AND when the user audibly speaks over the AI's response, the OpenAI Realtime API's server-side VAD does NOT auto-truncate the assistant's audio for WebSocket connections (per [`developers.openai.com/api/docs/guides/realtime-conversations`](https://developers.openai.com/api/docs/guides/realtime-conversations) "Interruption and Truncation": "In WebRTC and SIP connections, the server manages an audio output buffer and automatically truncates unplayed audio when a user interrupts. **For WebSocket connections, the client is responsible** for managing audio playback and truncation. The client must stop playback upon detecting a `input_audio_buffer.speech_started` event, note the played duration, and send a `conversation.item.truncate` event to remove the unplayed portion from the conversation.") — so the current code at [`use-realtime-voice.ts:445-454`](src/hooks/use-realtime-voice.ts) `case "input_audio_buffer.speech_started"` simply flips `isSpeaking: true` without stopping `ExpoPlayAudioStream` playback, without sending `response.cancel` to halt the model's audio generation, and without sending `conversation.item.truncate` to synchronize the server's conversation state — leading to **two concurrent audio streams** (the user's speech + the AI's still-playing response) AND a **desynced server context** where the conversation history believes the AI said sentences the user never heard,

I want (a) **auto-reconnect with exponential backoff** added to [`src/lib/realtime.ts`](src/lib/realtime.ts) `RealtimeSession.ws.onclose`: on an unexpected post-open close (i.e., not from `session.disconnect()`), the session attempts up to **5 reconnect attempts** with delays `500ms / 1s / 2s / 4s / 8s` (≈15s total budget; matches the AC "Disconnect simulation mid-conversation reconnects within 5s" for the first attempt + leaves headroom for backoff). Each reconnect (i) refreshes the Supabase session (preserving Story 9-6 token-refresh contract) → (ii) fetches a fresh ephemeral token from the `realtime-session` Edge Function → (iii) opens a new WebSocket → (iv) re-sends `configureSession()` with the SAME instructions / voice / turn_detection / audio config / tools (preserving Story 9-5 `output_modalities: ["audio"]` + Story 11-1 `report_correction` tool registration) → (v) emits a new `"reconnected"` event so the hook can resume the audio stream. Between attempts the session emits a `"reconnecting"` event with the attempt number so the UI can show a "Reconnecting..." banner. After 5 exhausted attempts (or if the Edge Function returns an unrecoverable error like an auth failure) the session emits the existing terminal `connection_lost` error and the hook's existing teardown path runs unchanged (current behavior preserved), (b) a new **`disconnect({ reason: "user" | "reconnect" })`** signature on `RealtimeSession.disconnect()` so the `onclose` handler can distinguish intentional disconnects (from `end()` / `start()` cleanup paths) from unexpected ones and skip the reconnect attempt on intentional close, (c) a new **`onReconnectStart` / `onReconnectEnd` / `onReconnectFailed` event types** in `RealtimeEvent` union so the hook can react: `onReconnectStart` adds a transcript-area banner via state `status: "reconnecting"`; `onReconnectEnd` flips back to `status: "connected"` and re-invokes `startAudioStreaming()` (since the prior `ExpoPlayAudioStream.startRecording` subscription was tied to the old WebSocket); `onReconnectFailed` falls through to the existing `connection_lost` end-of-conversation flow, (d) **barge-in handling** added to `use-realtime-voice.ts` `case "input_audio_buffer.speech_started"`: if `state.isAiSpeaking` is true at the moment of speech_started, fire `sessionRef.current?.send({type: "response.cancel"})` to halt the in-flight response server-side + capture the played duration `audio_end_ms` (the time elapsed since the most recent `response.output_audio.delta` first fired for the current `inflightItemIdRef.current`) + fire `sessionRef.current?.send({type: "conversation.item.truncate", item_id: inflightItemIdRef.current, content_index: 0, audio_end_ms})` to synchronize the server's transcript truncation + call `ExpoPlayAudioStream.stopSound()` (the existing pattern from `end()`) to immediately stop client-side playback, (e) new pure helpers extracted to **`src/lib/realtime-reconnect.ts`** for the reconnect-decision logic (`shouldReconnect(closeEvent, attemptCount): { reconnect: boolean; delayMs: number }`) + the **`src/lib/realtime-barge-in.ts`** module for the barge-in-decision logic (`computeBargeInDirective(state, currentTurnStartTime, now): { shouldCancel: boolean; audioEndMs: number; itemId: string | null }`) so the high-risk reconnect + barge-in code paths can be unit-tested without mounting the hook or mocking a WebSocket — same Story 11-1 P18 pure-helper-extraction pattern, (f) new `RealtimeSession.send()` public method (or extending the existing private `send()` to public) so the hook can send arbitrary client events (`response.cancel` + `conversation.item.truncate` are not currently exposed through the class's typed methods like `sendText` / `appendAudio` / `sendFunctionResult`),

so that **audit finding P1-7 closes**: a momentary network blip auto-recovers within ≈5s instead of terminating the conversation; the local `transcriptRef.current` + `correctionsRef.current` are preserved across the reconnect (since they're refs internal to the hook, not session-tied state) so the on-screen transcript stays intact and the running duration timer (`durationSecondsRef.current` + `durationRef` setInterval) continues; server-side conversation context IS lost across reconnect (the model starts fresh after the new `session.update` — this is an acceptable trade-off per the spec; restoring server-side context via `conversation.item.create` replays of the prior transcript is deferred to a future Epic 11.X follow-up to avoid scope creep), and barge-in works: the moment the user starts speaking over the AI, the AI's audio cuts within ≈250ms, the server-side transcript truncates to what was actually played, and the user's incoming audio is the next response's input cleanly. The verified-correct surfaces NOT touched are Story 9-3 Sentry telemetry allowlist (new breadcrumbs use existing `feature` / `attempt` / `code` / `category` keys), Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers — not touched; reconnect does NOT re-build the prompt, it sends the SAME `systemPrompt` string the original `start()` constructed), Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` config + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` pure module + FIFO-capped 256-entry dedup Set — all unchanged; reconnect emits a new `session.created` event which the dedup Set tolerates because the in-flight item key was already cleared by `connection_lost` semantics), Story 9-6 auth listener event gating (token-refresh path is shared via `supabase.auth.refreshSession()` in `connect()`; reconnect re-runs the same refresh), Story 9-7 Zod schema retry contract (`chatCompletionJSON` is unrelated to Realtime), Story 9-8 / 10-6 speaking pipeline at `app/(tabs)/mock-test/speaking.tsx` (separate record-and-grade flow — not Realtime), Story 9-10 auth + cache race hardening (the `flushWriteQueue` idempotent in-flight Promise is unchanged), Story 10-2 / 10-3 / 10-4 / 10-5 / 10-7 prompt + scoring surfaces (not touched), Story 10-8 exercise dedup (separate skill surface), Story 11-1 correction tool-call (the `report_correction` tool + handler + Zod schema + `processReportCorrectionCall` / `drainPendingCorrections` / `mergeOrphanCorrections` helpers + the `## Correction Reporting (Tool-Call)` prompt block + the `pendingToolCorrectionsRef` per-turn buffer + the `responseInFlightRef` + the `inflightItemIdRef` lifecycle + the `computeSpeakingScore` formula — ALL preserved; reconnect resets `pendingToolCorrectionsRef.current = []` + `responseInFlightRef.current = false` + `inflightItemIdRef.current = null` since the new WebSocket session has no in-flight response when it opens), the `save_vocabulary` / `note_error_pattern` / `report_correction` tool registrations (`configureSession()` re-sends them verbatim), the post-conversation persist chain (`extractAndStoreMemories` / `extractErrorsFromCorrections` / `updateSkillProgress` / `incrementDailyActivity` / `updateStreak` / `checkCefrPromotion` — unchanged), and `TranscriptView.getDisplayText` legacy stripper (Story 11-1 surface).

## Background — Why This Story Exists

### What audit finding P1-7 owns to this story

[`shippable-roadmap.md` line 58-59](_bmad-output/planning-artifacts/shippable-roadmap.md): "P1-7 — No reconnect / barge-in handling in `RealtimeSession` — connection drops mid-conversation = data loss; user talks over AI = overlapping audio. Location: `src/lib/realtime.ts:199-212`. Category: ai."

[`shippable-roadmap.md` line 182](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11.2 deliverable: "Realtime reconnect & barge-in — auto-reconnect with exponential backoff on `onclose`; on user audio while AI speaking, fire `response.cancel` + `conversation.item.truncate`. **Covers P1-7.**"

[`shippable-roadmap.md` line 191](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 11 AC: "Disconnect simulation mid-conversation reconnects within 5s and does not lose transcript."

### What the current code does on connection loss + barge-in

**`src/lib/realtime.ts:243-256`** — the WebSocket `onclose` handler:

```typescript
this.ws.onclose = () => {
  this._isConnected = false;
  if (!settled) {
    settled = true;
    clearTimeout(timeout);
    reject(new Error("Connection closed unexpectedly"));
  } else {
    // Connection dropped after initial open — notify listeners
    this.emit({
      type: "error",
      error: { message: "Connection lost. Please try again.", code: "connection_lost" },
    });
  }
};
```

The post-open `onclose` emits a single terminal `error` event. There's no retry, no exponential backoff, no distinction between intentional disconnect (from `disconnect()`) and unexpected disconnect (network blip / server hang-up).

**`src/hooks/use-realtime-voice.ts:636-657`** — the `case "error"` handler on `connection_lost`:

```typescript
if (event.error.code === "connection_lost") {
  // Mark disconnected immediately, then clean up & persist
  setState((s) => ({
    ...s,
    status: "disconnected",
    error: event.error.message,
    isProcessing: false,
    isSpeaking: false,
    isAiSpeaking: false,
    pendingAiText: "",
  }));
  // endRef is set below — triggers full cleanup + persist
  endRef.current?.();
}
```

The hook treats every `connection_lost` as terminal — `end()` runs, `persistConversation()` runs, the conversation is over. The user has to manually restart.

**`src/hooks/use-realtime-voice.ts:445-454`** — the `case "input_audio_buffer.speech_started"` handler:

```typescript
case "input_audio_buffer.speech_started":
  // Story 11-1 review-round-2 patch P16: the AI's response window
  // opens here (user finished speaking → AI starts processing).
  // P1 inflight gate uses this so a tool-only response (no audio)
  // can still record corrections.
  responseInFlightRef.current = true;
  setState((s) => ({ ...s, isSpeaking: false, isProcessing: true }));
  break;
```

Sets the `responseInFlightRef` for Story 11-1's inflight gate + flips `isSpeaking: false`. Does NOT check whether the AI is currently speaking (`state.isAiSpeaking === true`). Does NOT stop `ExpoPlayAudioStream` playback. Does NOT send `response.cancel`. Does NOT send `conversation.item.truncate`. The overlap audio failure mode is structurally live every conversation.

### What the OpenAI Realtime API spec says about reconnect + barge-in

Per Context7 / [`developers.openai.com/api/docs/guides/realtime-conversations`](https://developers.openai.com/api/docs/guides/realtime-conversations) (verified 2026-05-11):

**Barge-in (Interruption and Truncation):**

> "In WebRTC and SIP connections, the server manages an audio output buffer and automatically truncates unplayed audio when a user interrupts. **For WebSocket connections, the client is responsible for managing audio playback and truncation.** The client must:
>
> 1. Stop playback upon detecting a `input_audio_buffer.speech_started` event,
> 2. Note the played duration,
> 3. Send a `conversation.item.truncate` event to remove the unplayed portion from the conversation."

**`conversation.item.truncate` shape:**

```json
{
  "type": "conversation.item.truncate",
  "item_id": "item_1234",
  "content_index": 0,
  "audio_end_ms": 1500
}
```

**`response.cancel` shape:**

```json
{
  "type": "response.cancel"
  // event_id + response_id are optional; the API cancels the in-progress
  // response in the default conversation when both are omitted.
}
```

Per the spec: "It's safe to call `response.cancel` even if no response is in progress; an error will be returned and the session will remain unaffected."

**Reconnect:**

The Realtime API supports two reconnect models:

1. **`call_id` attach** — `wss://api.openai.com/v1/realtime?call_id=<id>` attaches a new WebSocket to an in-progress call, preserving server-side conversation state. Requires the Edge Function to surface the `call_id` from the original session creation. Currently the `realtime-session` Edge Function returns `{ value, session }` but the hook only consumes `value` (the ephemeral token) and discards the session metadata.
2. **Fresh session + replay** — get a new ephemeral token + new `session.update` + optionally re-send `conversation.item.create` events to restore prior context. Conversation context starts fresh on the server; the client's local transcript is what survives.

Story 11-2 ships the **fresh-session-without-replay** strategy (lower complexity, no Edge Function changes, no transcript replay). Server-side context restart is an acceptable trade-off for the network-blip use case: the user may need to repeat the last sentence, but the conversation continues without manual restart. Replay-with-context is filed as a deferred Epic 11.X follow-up.

### Threat / failure model — what cannot happen post-story

After this story:

1. **`RealtimeSession` exposes a `disconnect({ reason: "user" | "reconnect" })` signature.** `onclose` handlers distinguish intentional disconnects (skip reconnect) from unexpected closes (trigger reconnect). The hook's `end()` and unmount-cleanup paths pass `{ reason: "user" }`.

2. **Auto-reconnect runs only on unexpected post-open closes**, never on:
   - The initial `connect()` failure (already-rejected promise, no retry — preserves current behavior).
   - An intentional `disconnect({ reason: "user" })` from `end()` or unmount.
   - An `error` event with an explicit non-recoverable code (e.g., a 401 auth failure from the Edge Function).

3. **Exponential backoff** uses the schedule `[500, 1000, 2000, 4000, 8000]` ms. After 5 exhausted attempts (≈15.5s total elapsed including connect-time) the session emits the terminal `connection_lost` error and the hook's existing teardown path runs unchanged.

4. **`session.update` re-sent on each successful reconnect** preserves Story 9-5 `output_modalities: ["audio"]`, Story 11-1 `tools: [save_vocabulary, note_error_pattern, report_correction]`, and the original `systemPrompt` from `start()`. The reconnect does NOT re-build the prompt (which would re-run `buildConversationPrompt` against potentially-changed `memories` / `errorPatterns` props mid-conversation); it caches the original prompt at `start()` time inside the session and replays the cached value.

5. **Hook-side state on reconnect-success**: `status: "connected"`, banner cleared, audio streaming re-started (the prior `subscriptionRef.current` from `ExpoPlayAudioStream.startRecording` was tied to the old WebSocket and is stopped + re-created cleanly). `inflightItemIdRef.current`, `responseInFlightRef.current`, and `currentAiTextRef.current` reset to the no-in-flight-turn state (the new session has no in-flight response). `pendingToolCorrectionsRef.current` resets to `[]` (Story 11-1 invariant — orphan tool-calls from the dropped connection were already drained into `correctionsRef.current` by the `case "error"` orphan-drain on the way OUT, before the reconnect kicked in — actually no: the `case "error"` only fires on the TERMINAL `connection_lost` after retries exhaust, not on the initial close that triggers retries. The reconnect path is upstream of the error event. So `pendingToolCorrectionsRef` could hold partial tool-call data at reconnect time; drain into `correctionsRef.current` BEFORE the reconnect to preserve the data, then reset to `[]`).

6. **Hook-side state on reconnect-failed (terminal `connection_lost`)**: the existing `case "error"` `connection_lost` path runs unchanged — orphan-drain into correctionsRef (Story 11-1 P3), setState disconnected, endRef teardown, persistConversation. NO regression to the existing failure mode.

7. **Barge-in fires only when `state.isAiSpeaking === true` at the moment of `speech_started`.** The `state.isAiSpeaking` flag is set true on `response.output_audio.delta` and false on `response.output_audio.done` (existing event handlers). If the user starts speaking before the AI has begun audio output, `state.isAiSpeaking === false` and the barge-in branch is skipped (`speech_started` runs only its existing pre-11-2 logic).

8. **Barge-in `audio_end_ms` calculation**: the client tracks `aiSpeakingStartedAtMsRef.current = Date.now()` when `response.output_audio.delta` first fires for the current `inflightItemIdRef`. `audio_end_ms = Date.now() - aiSpeakingStartedAtMsRef.current`. Clamped to a non-negative integer. If `aiSpeakingStartedAtMsRef.current` is null (defensive — should never happen if `isAiSpeaking === true`), the barge-in still sends `response.cancel` but omits the `conversation.item.truncate` (no item_id) with a Sentry breadcrumb noting the missing timing data.

9. **Barge-in `item_id`**: sourced from `inflightItemIdRef.current` (set by `acceptDelta` on the first audio-transcript delta or output_audio delta of the response). If null at barge-in time, the truncate is skipped with a breadcrumb (per the defensive case in finding #8 above).

10. **`RealtimeSession.send(event: Record<string, unknown>): void`** is exposed publicly (existing private `send` is hoisted to public visibility) so the hook can dispatch `response.cancel` + `conversation.item.truncate` without needing dedicated typed methods. Existing typed methods (`sendText` / `appendAudio` / `sendFunctionResult` / etc.) remain unchanged.

11. **Server-side context loss across reconnect** is intentional and documented. Replaying prior `conversation.item.create` items is deferred to Epic 11.X. The user experience on reconnect: the conversation status banner clears, the AI starts fresh ("you may need to repeat your last point") — but the local transcript, duration timer, corrections list, and topic context all persist on-screen.

12. **`onclose` does NOT trigger reconnect when `_isConnected === false`** (the close happened before the initial open — handled by the existing reject-the-promise path). Only post-open closes attempt reconnect.

13. **Reconnect aborts on `end()` / unmount** — if `disconnect({ reason: "user" })` is called while a reconnect attempt is pending, the in-flight `setTimeout` for the next attempt is cleared via a new `reconnectTimeoutRef` (analogous to the existing `durationRef` for the duration interval) so the reconnect does NOT proceed after the user has navigated away.

14. **Sentry telemetry**: each reconnect attempt emits `addBreadcrumb({category: "realtime", level: "info", message: "Realtime reconnect attempt", data: {attempt, feature: "realtime-reconnect"}})`; success emits `addBreadcrumb({..., level: "info", message: "Realtime reconnected"})`; failure-after-5-attempts emits the existing `captureError(event.error, "realtime-voice-error")` path with no new event type. Allowlist (`SENTRY_EXTRAS_ALLOWLIST` in `src/lib/sentry.ts:25-52`) already includes `attempt` (Story 9-7) + `feature` (Story 9-3) + `category` (Story 9-3) — no allowlist extension.

15. **`docs/tcf-spec-citations.md` is NOT touched.** P1-7 is an architecture finding, not a TCF spec citation. No row in the matrix owns this story.

### Out of scope for this story (delegated elsewhere)

- **Restoring server-side conversation context across reconnect via `conversation.item.create` replay** — would require iterating `transcriptRef.current` after the new `session.update` lands and re-sending each turn as a conversation item. Adds complexity (dedup risk, server-side token consumption, race with first speech_started after reconnect). Filed as a future Epic 11.X follow-up.
- **`call_id`-based attach to in-progress sessions** — requires the `realtime-session` Edge Function to return the `call_id` AND the hook to track it across reconnects. Cleaner server-side state preservation but requires Edge Function changes (deferred per "edge-function changes are out of scope when client-side fix suffices" pattern from Story 11-1's tool-call work). Filed as a future Epic 11.X follow-up.
- **Manual user-triggered reconnect button** — the auto-reconnect makes a manual button unnecessary for the network-blip case. If retries exhaust, the user can already tap "Start" to begin a new conversation from the existing teardown path. No new UI surface needed.
- **Network-quality monitoring / packet-loss telemetry** — Epic 13 (Performance Hot Paths) owns network-quality work.
- **Adaptive backoff (jitter, network-aware delays)** — out of scope; fixed schedule `[500, 1000, 2000, 4000, 8000]` is operator-acceptable.
- **WebSocket 60-minute connection limit auto-reconnect** — the OpenAI Realtime API enforces a 60-min hard limit on WebSocket connections. Per [`developers.openai.com/api/docs/guides/websocket-mode`](https://developers.openai.com/api/docs/guides/websocket-mode) Reconnect-and-recover: "WebSocket connections have a duration limit of 60 minutes and require reconnection upon reaching this limit." The current code does NOT handle this; a 60-min conversation would hit the same `connection_lost` path. With Story 11-2's auto-reconnect, the 60-min limit auto-recovers like any other unexpected close. NOT a separate code path — falls out naturally from the unexpected-close reconnect logic.
- **Touching the `realtime-session` Edge Function** — reconnect uses the same Edge Function call as the initial connect (refresh Supabase session → invoke Edge Function → get fresh token). No Edge Function changes needed.
- **Story 11-1 `report_correction` tool-call buffer drain semantics across reconnect** — `pendingToolCorrectionsRef` is reset on reconnect-start (orphan drain into correctionsRef first to preserve any pre-disconnect tool-call data; reset after). This is additive to Story 11-1's contract, not a modification of it.
- **`TranscriptView.getDisplayText` legacy stripper** — Story 11-1 surface; not touched.
- **`computeSpeakingScore` formula** — Story 11-1 surface; not touched. The formula consumes `correctionsRef.current` which now correctly includes orphan-drained corrections from the reconnect path, so the input accuracy improves slightly (correctness improvement, not regression).
- **The `RealtimeConfig` type at `src/lib/realtime.ts:95-120`** — the prompt + voice + tools + turn_detection fields are unchanged. The reconnect needs no new config fields; it caches the existing config inside the session.
- **`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers** at `src/lib/prompts/conversation.ts:158-194` (Story 9-4) — NOT touched. The reconnect uses the prompt the original `start()` built; it does NOT re-run `buildConversationPrompt` with potentially-changed `memories` / `errorPatterns` props.
- **`appendIfNew` / `acceptDelta` pure module** at `src/lib/realtime-transcript.ts` (Story 9-5) — NOT touched. The new pure helpers `shouldReconnect` + `computeBargeInDirective` live in separate modules.

## Acceptance Criteria

### 1. Add reconnect-decision pure helper at `src/lib/realtime-reconnect.ts`

- [x] **CREATE** `src/lib/realtime-reconnect.ts` exporting:

  ```typescript
  export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];
  export const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;

  export interface ReconnectDecision {
    /** True if a reconnect attempt should be scheduled. */
    reconnect: boolean;
    /** Delay in milliseconds before the attempt. 0 means "no attempt" (paired with reconnect: false). */
    delayMs: number;
    /** The attempt number (1-indexed) for the breadcrumb data. */
    attempt: number;
  }

  /**
   * Decide whether to attempt a reconnect on a WebSocket onclose event.
   *
   * Returns `{ reconnect: false }` when:
   *   - The close was intentional (`reason === "user"`).
   *   - The close happened before the initial open (`wasConnected === false`).
   *   - The attempt count has reached `MAX_RECONNECT_ATTEMPTS`.
   *
   * Returns `{ reconnect: true, delayMs: RECONNECT_BACKOFF_MS[attemptCount], attempt: attemptCount + 1 }`
   * otherwise.
   *
   * Pure function — no side effects, no clock access; the caller schedules
   * the actual `setTimeout`.
   */
  export function shouldReconnect(
    closeReason: "user" | "reconnect" | "unknown",
    wasConnected: boolean,
    attemptCount: number
  ): ReconnectDecision;
  ```

- [x] **6 test cases** at `src/lib/__tests__/realtime-reconnect.test.ts`:
  1. Intentional user close → `{ reconnect: false }`
  2. Pre-open close → `{ reconnect: false }` (regardless of attemptCount)
  3. First post-open unexpected close → `{ reconnect: true, delayMs: 500, attempt: 1 }`
  4. Each of attempts 2-5 → exact delay from `RECONNECT_BACKOFF_MS`
  5. Attempt count equals `MAX_RECONNECT_ATTEMPTS` (5) → `{ reconnect: false }` (exhausted)
  6. `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length` lockstep pin

**Given** an unexpected post-open close with `attemptCount = 0`
**When** `shouldReconnect("unknown", true, 0)` runs
**Then** returns `{ reconnect: true, delayMs: 500, attempt: 1 }`.

### 2. Add barge-in-decision pure helper at `src/lib/realtime-barge-in.ts`

- [x] **CREATE** `src/lib/realtime-barge-in.ts` exporting:

  ```typescript
  export interface BargeInState {
    isAiSpeaking: boolean;
    inflightItemId: string | null;
    aiSpeakingStartedAtMs: number | null;
  }

  export interface BargeInDirective {
    /** True if `response.cancel` should be sent. */
    shouldCancelResponse: boolean;
    /** True if `conversation.item.truncate` should be sent (requires non-null item_id + audioEndMs). */
    shouldTruncate: boolean;
    /** Inclusive duration in ms up to which the assistant's audio was played; null if not derivable. */
    audioEndMs: number | null;
    /** The item_id to truncate; null if not derivable. */
    itemId: string | null;
  }

  /**
   * Decide what barge-in action to take when `input_audio_buffer.speech_started`
   * fires. Pure function — no side effects, no DOM/audio mutation; the caller
   * dispatches the resulting events.
   *
   * Returns `{ shouldCancelResponse: false, shouldTruncate: false }` when
   * `isAiSpeaking === false` (no AI response to interrupt).
   *
   * Returns `{ shouldCancelResponse: true, shouldTruncate: <both refs non-null>, ... }`
   * when `isAiSpeaking === true`. The truncate is conditional on having
   * a known `inflightItemId` AND a known `aiSpeakingStartedAtMs` — if either
   * is null (defensive), the `response.cancel` still fires but the truncate
   * is skipped (the hook breadcrumbs the missing data).
   *
   * `audioEndMs` clamped to non-negative integer.
   */
  export function computeBargeInDirective(state: BargeInState, now: number): BargeInDirective;
  ```

- [x] **5 test cases** at `src/lib/__tests__/realtime-barge-in.test.ts`:
  1. AI not speaking → both `shouldCancelResponse` and `shouldTruncate` false
  2. AI speaking + both refs populated → both true + `audioEndMs = now - startedAt`
  3. AI speaking + `inflightItemId` null → cancel true, truncate false
  4. AI speaking + `aiSpeakingStartedAtMs` null → cancel true, truncate false
  5. AI speaking + `now < startedAt` (clock skew defense) → `audioEndMs` clamped to 0

**Given** `computeBargeInDirective({ isAiSpeaking: true, inflightItemId: "item_1", aiSpeakingStartedAtMs: 1000 }, 2500)`
**When** the directive is computed
**Then** returns `{ shouldCancelResponse: true, shouldTruncate: true, audioEndMs: 1500, itemId: "item_1" }`.

### 3. Wire reconnect into `RealtimeSession`

- [x] **UPDATE** [`src/lib/realtime.ts`](src/lib/realtime.ts). Refactor `connect()` to extract a private `establishConnection()` method that returns a Promise; the original `connect()` is now `connect() = establishConnection()` with an additional reconnect-context state on the class.

- [x] **NEW class fields** on `RealtimeSession`:

  ```typescript
  private reconnectAttempts = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private intentionallyDisconnected = false;
  private cachedConfig: RealtimeConfig | null = null; // captured at connect() time; replayed on reconnect
  ```

- [x] **UPDATE `disconnect()`** signature from `disconnect(): void` to `disconnect(opts: { reason?: "user" | "reconnect" } = { reason: "user" }): void`. Sets `intentionallyDisconnected = (opts.reason === "user")` BEFORE closing the WebSocket so the `onclose` handler can branch correctly.

- [x] **UPDATE `ws.onclose` handler** to:
  ```typescript
  this.ws.onclose = () => {
    this._isConnected = false;
    if (!settled) {
      // Pre-open close — existing reject path. NO reconnect.
      settled = true;
      clearTimeout(timeout);
      reject(new Error("Connection closed unexpectedly"));
      return;
    }
    // Post-open close.
    if (this.intentionallyDisconnected) {
      // User-triggered (end / unmount). NO reconnect.
      return;
    }
    // Unexpected close → consult reconnect-decision helper.
    const decision = shouldReconnect("unknown", true, this.reconnectAttempts);
    if (!decision.reconnect) {
      // Exhausted attempts → emit terminal connection_lost (existing path).
      this.emit({
        type: "error",
        error: { message: "Connection lost. Please try again.", code: "connection_lost" },
      });
      return;
    }
    // Schedule reconnect.
    this.emit({ type: "realtime.reconnecting", attempt: decision.attempt });
    addBreadcrumb({
      category: "realtime",
      level: "info",
      message: "Realtime reconnect attempt",
      data: { feature: "realtime-reconnect", attempt: decision.attempt },
    });
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      void this.attemptReconnect();
    }, decision.delayMs);
  };
  ```

- [x] **NEW private `attemptReconnect()`** method on `RealtimeSession`:
  ```typescript
  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    try {
      await this.establishConnection(); // re-uses cachedConfig
      this.reconnectAttempts = 0;
      this.emit({ type: "realtime.reconnected" });
      addBreadcrumb({
        category: "realtime",
        level: "info",
        message: "Realtime reconnected",
        data: { feature: "realtime-reconnect" },
      });
    } catch (err) {
      // establishConnection failed; the onclose path of the failed
      // attempt will trigger the next backoff cycle naturally.
      captureError(err, "realtime-reconnect");
    }
  }
  ```

- [x] **CACHE the config at `connect()` time**: `this.cachedConfig = this.config` (or use the existing `this.config` directly — it's already a class field; just need to ensure `configureSession()` runs on every reconnected `ws.onopen`).

- [x] **NEW event types** in `RealtimeEvent` union at [`src/lib/realtime.ts:38-93`](src/lib/realtime.ts):
  ```typescript
  | { type: "realtime.reconnecting"; attempt: number }
  | { type: "realtime.reconnected" }
  ```
  The `attempt` field name is allowlist-safe under Story 9-3 (already in `SENTRY_EXTRAS_ALLOWLIST`).

- [x] **EXPOSE `send()` publicly** (currently private at [`src/lib/realtime.ts:369-373`](src/lib/realtime.ts)). Rename to a stable public method `sendRaw(event: Record<string, unknown>): void` to communicate "this bypasses the typed methods; use only when no typed method fits" (e.g., for `response.cancel` + `conversation.item.truncate` which Story 11-2 needs but Story 1-X never added). Keep existing typed methods (`sendText` / `appendAudio` / `commitAudio` / `clearAudioBuffer` / `sendFunctionResult` / `disconnect`) unchanged.

- [x] **CLEAR `reconnectTimeoutId`** in `disconnect()` BEFORE closing the WebSocket so a pending reconnect doesn't fire after the user has navigated away:
  ```typescript
  disconnect(opts = { reason: "user" }): void {
    this.intentionallyDisconnected = opts.reason === "user";
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    // ... existing event handler cleanup
  }
  ```

- [x] **NO change** to `configureSession()` — its existing `session.update` payload (instructions / voice / turn_detection / audio config / tools / tool_choice) is sent verbatim on every reconnect.

**Given** an established `RealtimeSession` whose WebSocket closes unexpectedly post-open (server-initiated)
**When** the close fires
**Then** the session emits `realtime.reconnecting` with `attempt: 1` AND schedules a 500ms `setTimeout` to call `attemptReconnect()`.

**Given** the user calls `session.disconnect()` (which defaults to `{ reason: "user" }`)
**When** the resulting WebSocket close fires
**Then** the session does NOT emit `realtime.reconnecting` AND does NOT schedule a reconnect.

**Given** 5 consecutive failed reconnect attempts
**When** the 5th attempt's `onclose` fires
**Then** the session emits the terminal `error` with `code: "connection_lost"` (existing path) AND does NOT schedule a 6th attempt.

### 4. Wire reconnect into `useRealtimeVoice`

- [x] **UPDATE** [`src/hooks/use-realtime-voice.ts`](src/hooks/use-realtime-voice.ts). Add new `ConversationState` status `"reconnecting"`:

  ```typescript
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error" | "disconnected" | "ended";
  ```

- [x] **NEW event handlers** for `realtime.reconnecting` and `realtime.reconnected`:

  ```typescript
  case "realtime.reconnecting":
    // Drain any pending tool-call buffer into correctionsRef BEFORE the
    // reconnect (Story 11-1 P2/P3 pattern — we'd otherwise lose them in
    // the cross-session boundary). Story 11-1 mergeOrphanCorrections
    // helper handles this.
    {
      const merged = mergeOrphanCorrections(
        correctionsRef.current,
        pendingToolCorrectionsRef.current
      );
      if (merged.shouldBreadcrumb) {
        correctionsRef.current = merged.conversation;
        setState((s) => ({ ...s, allCorrections: [...correctionsRef.current] }));
        addBreadcrumb({
          category: "realtime",
          level: "warning",
          message: "Orphan tool corrections drained at reconnect-start",
          data: { category: "report_correction" },
        });
      }
    }
    // Reset per-turn refs that don't survive the cross-session boundary.
    inflightItemIdRef.current = null;
    responseInFlightRef.current = false;
    currentAiTextRef.current = "";
    aiSpeakingStartedAtMsRef.current = null;
    setState((s) => ({
      ...s,
      status: "reconnecting",
      isAiSpeaking: false,
      isProcessing: false,
      pendingAiText: "",
    }));
    // Stop the prior ExpoPlayAudioStream subscription — it was tied to the
    // old WebSocket and won't deliver bytes during reconnect anyway. The
    // realtime.reconnected handler re-starts it cleanly.
    void stopAudioStreaming();
    break;

  case "realtime.reconnected":
    setState((s) => ({ ...s, status: "connected", error: null }));
    // Re-start audio streaming for the new WebSocket. The microphone
    // permission is already granted from the original start(); calling
    // requestPermissionsAsync again is fast (cached).
    void startAudioStreaming();
    break;
  ```

- [x] **NEW ref** `aiSpeakingStartedAtMsRef: useRef<number | null>(null)` alongside the existing refs. Set on the FIRST `response.output_audio.delta` event whose `item_id` matches the in-flight item (or any if no in-flight item is set yet). Cleared on `response.output_audio.done` + `response.done` + `error` + reconnect-start.

- [x] **UPDATE `case "response.output_audio.delta"` handler** at [`use-realtime-voice.ts:455-459`](src/hooks/use-realtime-voice.ts) (current Story 11-1 patched body) to set `aiSpeakingStartedAtMsRef.current` on its first fire of a turn:

  ```typescript
  case "response.output_audio.delta": {
    // Stream each audio chunk immediately for low-latency playback
    const turnId = `turn_${turnIdRef.current}`;
    void ExpoPlayAudioStream.playSound(event.delta, turnId, "pcm_s16le");
    // Story 11-2: capture the AI-speaking start time on the first delta
    // of a turn so the barge-in path can compute audio_end_ms correctly.
    if (aiSpeakingStartedAtMsRef.current === null) {
      aiSpeakingStartedAtMsRef.current = Date.now();
    }
    setState((s) => ({ ...s, isAiSpeaking: true, isProcessing: false }));
    break;
  }
  ```

- [x] **UPDATE `case "response.output_audio.done"`** + the `response.done` + `case "error"` handlers to reset `aiSpeakingStartedAtMsRef.current = null`.

- [x] **NO change** to the existing `case "error"` `connection_lost` terminal-failure path — Story 11-2's reconnect runs UPSTREAM in `RealtimeSession`. If reconnect succeeds, no `connection_lost` event reaches the hook. If reconnect fails, the existing `connection_lost` path runs unchanged.

- [x] **RESET `aiSpeakingStartedAtMsRef.current = null`** in `start()` alongside the other ref resets at [`use-realtime-voice.ts:850-862`](src/hooks/use-realtime-voice.ts).

**Given** an in-progress conversation experiences a network blip that auto-reconnects within 5s
**When** the reconnect completes
**Then** `state.status` transitions `connected → reconnecting → connected`; the on-screen transcript and duration timer are unchanged; the conversation continues without manual user action.

**Given** auto-reconnect fails after 5 attempts (`connection_lost` event reaches the hook)
**When** the terminal error fires
**Then** the existing `case "error"` `connection_lost` path runs unchanged — orphan-drain + setState disconnected + endRef.current?.() → end() → persistConversation() — preserving the post-conversation persistence pipeline.

### 5. Wire barge-in into `useRealtimeVoice`

- [x] **UPDATE** the `case "input_audio_buffer.speech_started"` handler at [`use-realtime-voice.ts:445-454`](src/hooks/use-realtime-voice.ts):

  ```typescript
  case "input_audio_buffer.speech_started": {
    // Story 11-1 review-round-2 patch P16: the AI's response window
    // opens here (user finished speaking → AI starts processing).
    responseInFlightRef.current = true;
    // Story 11-2 barge-in: if the user starts speaking WHILE the AI is
    // already speaking, the WebSocket modality requires the client to
    // (1) stop local playback, (2) send response.cancel to halt the
    // server-side response, (3) send conversation.item.truncate to
    // synchronize the server's transcript with what was actually played.
    // Pure helper at src/lib/realtime-barge-in.ts owns the directive
    // computation; the hook owns the side effects.
    const directive = computeBargeInDirective(
      {
        isAiSpeaking: stateRef.current.isAiSpeaking,
        inflightItemId: inflightItemIdRef.current,
        aiSpeakingStartedAtMs: aiSpeakingStartedAtMsRef.current,
      },
      Date.now()
    );
    if (directive.shouldCancelResponse) {
      // 1. Stop local playback immediately.
      void ExpoPlayAudioStream.stopSound();
      // 2. Tell the server to cancel the in-flight response.
      sessionRef.current?.sendRaw({ type: "response.cancel" });
      // 3. Synchronize the server-side transcript with what was actually
      // played (only if we have the item_id + audio_end_ms; otherwise
      // breadcrumb the missing data).
      if (directive.shouldTruncate && directive.itemId && directive.audioEndMs !== null) {
        sessionRef.current?.sendRaw({
          type: "conversation.item.truncate",
          item_id: directive.itemId,
          content_index: 0,
          audio_end_ms: directive.audioEndMs,
        });
        addBreadcrumb({
          category: "realtime",
          level: "info",
          message: "Barge-in: response cancelled + transcript truncated",
          data: { feature: "realtime-barge-in" },
        });
      } else {
        addBreadcrumb({
          category: "realtime",
          level: "warning",
          message: "Barge-in: response cancelled without truncate (missing item_id or start time)",
          data: { feature: "realtime-barge-in" },
        });
      }
      // Reset the AI-speaking refs since the response is over.
      aiSpeakingStartedAtMsRef.current = null;
      inflightItemIdRef.current = null;
    }
    setState((s) => ({ ...s, isSpeaking: false, isProcessing: true, isAiSpeaking: false }));
    break;
  }
  ```

- [x] **NEW `stateRef`** mirror for `state.isAiSpeaking` access inside the event handler (refs in React don't reflect the latest state inside `useCallback` without a stale-closure issue; mirror the relevant field via a `useRef` updated on each render — pattern already used for `statusRef`). Add immediately after the existing `statusRef`:

  ```typescript
  const stateRef = useRef(state);
  stateRef.current = state;
  ```

  (Or selectively mirror just `isAiSpeaking`: `const isAiSpeakingRef = useRef(false); isAiSpeakingRef.current = state.isAiSpeaking;` if the broader mirror is over-broad.)

- [x] **NO change** to `case "input_audio_buffer.speech_stopped"` — barge-in fires on speech_started, not stopped.

- [x] **NO change** to the existing audio streaming subscription at `startAudioStreaming` — the user's speech continues to be streamed to the WebSocket; barge-in only cancels the AI's outgoing response.

**Given** the AI is playing audio (`state.isAiSpeaking === true`) when `input_audio_buffer.speech_started` fires
**When** the handler runs
**Then** `ExpoPlayAudioStream.stopSound()` is called AND `sessionRef.current.sendRaw({type: "response.cancel"})` is invoked AND (if `inflightItemIdRef.current` is non-null AND `aiSpeakingStartedAtMsRef.current` is non-null) `sessionRef.current.sendRaw({type: "conversation.item.truncate", item_id: <id>, content_index: 0, audio_end_ms: <Date.now() - startedAt>})` is invoked.

**Given** the user starts speaking while the AI is NOT speaking (`state.isAiSpeaking === false`)
**When** speech_started fires
**Then** NO `response.cancel` is sent + NO `conversation.item.truncate` is sent + `ExpoPlayAudioStream.stopSound()` is NOT called. The existing pre-11-2 logic (setting `responseInFlightRef` + flipping `isSpeaking: false, isProcessing: true`) runs unchanged.

### 6. Test surface

- [x] **CREATE** `src/lib/__tests__/realtime-reconnect.test.ts` — 6 cases per AC #1 above (intentional close, pre-open close, first attempt, attempts 2-5, exhausted, lockstep pin).

- [x] **CREATE** `src/lib/__tests__/realtime-barge-in.test.ts` — 5 cases per AC #2 above (not speaking, full directive, null item_id, null startedAt, clock-skew clamp).

- [x] **EXTEND** `src/lib/__tests__/realtime-corrections.test.ts` (Story 11-1 file) — add 1 test that verifies the Story 11-2 reconnect-start orphan-drain pattern: passing the buffer through `mergeOrphanCorrections` on the cross-session boundary preserves the corrections (this is a regression guard for the AC #4 reconnect-start drain).

- [x] **VERIFY existing tests stay green** (no regression):
  - `src/lib/__tests__/realtime-dedup.test.ts` — Story 9-5 dedup contract; not touched
  - `src/lib/__tests__/realtime-corrections.test.ts` — Story 11-1 pure helpers; not touched (only EXTENDED)
  - `src/lib/__tests__/speaking-score.test.ts` — Story 11-1 baseline; not touched
  - `src/lib/schemas/__tests__/ai-responses.test.ts` — Story 11-1 schema + lockstep tests; not touched
  - `src/lib/prompts/__tests__/conversation.test.ts` — Story 10-7 + 11-1 prompt tests; not touched
  - `src/lib/__tests__/prompt-injection.test.ts` — Story 9-4 wrapper invariants; not touched
  - `src/lib/__tests__/auth-events.test.ts` — Story 9-6 auth-event gating; not touched

- [x] **TARGET TEST COUNT POST-STORY:** 955 → 970+ (estimate: ~6 reconnect cases + ~5 barge-in cases + ~1 orphan-drain-at-reconnect = ~12 new tests; minus 0 deleted).

### 7. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 11-1 "Realtime correction tool-call protocol" line:

  ```markdown
  **Realtime reconnect + barge-in:** post-Epic-11.2, `src/lib/realtime.ts` `RealtimeSession` gains auto-reconnect on unexpected post-open WebSocket closes (exponential backoff schedule `[500, 1000, 2000, 4000, 8000]` ms; max 5 attempts ≈ 15.5s total budget; `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length` lockstep). Pure helper `shouldReconnect(closeReason, wasConnected, attemptCount)` at `src/lib/realtime-reconnect.ts` owns the reconnect-decision logic (intentional close → no reconnect, pre-open close → no reconnect, exhausted attempts → no reconnect, otherwise return delay + 1-indexed attempt number). `RealtimeSession.disconnect({ reason: "user" | "reconnect" })` distinguishes intentional vs. unexpected closes via `intentionallyDisconnected` class flag; pending reconnect timeouts are cleared via `reconnectTimeoutId` on disconnect to defend against navigate-away races. Each reconnect emits new `realtime.reconnecting` / `realtime.reconnected` events; the hook routes these to a new `"reconnecting"` `ConversationState.status`. On reconnect-start, the hook drains the Story 11-1 `pendingToolCorrectionsRef` into `correctionsRef` via `mergeOrphanCorrections` (P2/P3 pattern — corrections from before the disconnect are preserved across the cross-session boundary), resets per-turn refs (`inflightItemIdRef`, `responseInFlightRef`, `currentAiTextRef`, `aiSpeakingStartedAtMsRef`), and stops the prior `ExpoPlayAudioStream` subscription. On reconnect-end, audio streaming re-starts cleanly with the new WebSocket. The session's cached `RealtimeConfig` (instructions / voice / turn_detection / audio config / tools — including Story 11-1's three tools `save_vocabulary` / `note_error_pattern` / `report_correction`) is re-sent via `configureSession()` on every reconnect; the prompt is NOT re-built (which would re-run `buildConversationPrompt` against potentially-changed memories / errorPatterns props mid-conversation) — the cached prompt from the original `start()` is replayed verbatim. **Server-side conversation context is lost across reconnect** (the model starts fresh after the new `session.update`) — intentional trade-off; replaying prior transcript as `conversation.item.create` events is deferred to a future Epic 11.X follow-up. The 60-minute WebSocket connection limit (per OpenAI Realtime API docs) auto-recovers via the same unexpected-close path. **Barge-in handling**: `src/lib/realtime-barge-in.ts` `computeBargeInDirective(state, now)` decides whether to interrupt the AI based on `state.isAiSpeaking` + `inflightItemId` + `aiSpeakingStartedAtMs`. When user audio is detected via `input_audio_buffer.speech_started` while `state.isAiSpeaking === true`, the hook (1) calls `ExpoPlayAudioStream.stopSound()` to halt local playback, (2) sends `response.cancel` to halt the server-side response generation, (3) sends `conversation.item.truncate` with `item_id` + `content_index: 0` + `audio_end_ms = Date.now() - aiSpeakingStartedAtMsRef.current` to synchronize the server's transcript with what was actually played. `audio_end_ms` is clamped to non-negative integer (clock-skew defense). If `inflightItemId` or `aiSpeakingStartedAtMs` is null at barge-in time (defensive), the `response.cancel` still fires but the truncate is skipped with a Sentry breadcrumb. `RealtimeSession.sendRaw(event: Record<string, unknown>): void` is the new public method for dispatching arbitrary client events that don't have a typed wrapper (`response.cancel` + `conversation.item.truncate`); existing typed methods (`sendText` / `appendAudio` / `commitAudio` / `clearAudioBuffer` / `sendFunctionResult` / `disconnect`) are unchanged. Sentry breadcrumb keys (`feature: "realtime-reconnect"` / `"realtime-barge-in"` + `attempt` + `category`) are all in the existing `SENTRY_EXTRAS_ALLOWLIST` (Story 9-3) — no allowlist extension. Closes audit P1-7 architecturally. Story 9-3 / 9-4 / 9-5 / 9-6 / 9-7 / 9-8 / 9-10 / 10-2 / 10-3 / 10-4 / 10-5 / 10-7 / 10-8 / 11-1 invariants all hold unchanged. Regression-tested in `src/lib/__tests__/realtime-reconnect.test.ts` (NEW — 6 cases: intentional close + pre-open close + first attempt + each attempt 2-5 backoff value + exhausted + lockstep pin), `src/lib/__tests__/realtime-barge-in.test.ts` (NEW — 5 cases: not-speaking → no-op + full directive + null-item-id partial + null-startedAt partial + clock-skew clamp), and `src/lib/__tests__/realtime-corrections.test.ts` (EXTENDED — reconnect-start orphan-drain regression guard). Verified 2026-05-XX, story 11-2.
  ```

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 11-2 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — applicable to the new `attemptReconnect()` catch (`captureError(err, "realtime-reconnect")`).
- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — **N/A** (no UI changes; the "Reconnecting..." banner is rendered by a future UI story or by reusing the existing `NetworkBanner` pattern; Story 11-2 only adds the `"reconnecting"` status — UI rendering of that status is deferred).
- [x] All loading states use skeleton animations — **N/A** (no UI changes).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A** (no UI changes).
- [x] Non-obvious interactions have `accessibilityHint` — **N/A** (no UI changes).
- [x] Stateful elements have `accessibilityState` — **N/A** (no UI changes).
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A** (no UI changes).
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` — **N/A** (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **Citations matrix completeness test** in `src/lib/__tests__/tcf-spec.test.ts` continues to pass — Story 11-2 does NOT add a new TCF claim, so no new citations-matrix row is added; no completeness regression risk.
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-3 Sentry allowlist contract holds** — new breadcrumbs reuse existing `feature` / `attempt` / `category` keys; no allowlist extension.
- [x] **Story 9-4 stored-prompt-injection defense holds** — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + "treat as data" prelude in `buildConversationPrompt` NOT modified; reconnect replays the cached prompt verbatim, NOT a re-built prompt with potentially-changed user-derived data.
- [x] **Story 9-5 voice transcript dedup contract holds** — `output_modalities: ["audio"]` config + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` + FIFO-capped 256-entry dedup Set NOT modified. The pure module at `src/lib/realtime-transcript.ts` is untouched.
- [x] **Story 9-6 auth listener contract holds** — `supabase.auth.refreshSession()` is called inside `establishConnection()` (was inside the original `connect()` — refactor preserves the call); reconnect inherits Story 9-6's token-refresh discipline.
- [x] **Story 9-7 / 9-8 / 10-X / 11-1 contracts all hold** — none of those surfaces are touched by Story 11-2.
- [x] **Story 11-1 `pendingToolCorrectionsRef` + `responseInFlightRef` lifecycle** — Story 11-2 adds a NEW reset point (reconnect-start) but does NOT modify the existing reset points (start / response.done / case "error"); the new reset preserves the Story 11-1 contract (orphan-drain into correctionsRef BEFORE the reset).
- [x] **Story 11-1 `computeSpeakingScore` formula** — NOT touched. Input accuracy improves slightly (orphan-drained corrections from reconnect-start are now included in `correctionsRef.current`).

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`.
-->

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/11-2-realtime-reconnect-barge-in.md`) under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/11-2-realtime-reconnect-barge-in.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] Task 1: Add `realtime-reconnect.ts` pure helper + `realtime-barge-in.ts` pure helper (AC #1, #2)
  - [x] Create `src/lib/realtime-reconnect.ts` with `RECONNECT_BACKOFF_MS` + `MAX_RECONNECT_ATTEMPTS` + `ReconnectDecision` type + `shouldReconnect(closeReason, wasConnected, attemptCount)` function
  - [x] Create `src/lib/realtime-barge-in.ts` with `BargeInState` + `BargeInDirective` types + `computeBargeInDirective(state, now)` function

- [x] Task 2: Wire reconnect into `RealtimeSession` (AC #3)
  - [x] Add `reconnectAttempts` + `reconnectTimeoutId` + `intentionallyDisconnected` private class fields
  - [x] Extract `establishConnection()` private method from `connect()`; `connect()` becomes `establishConnection()` + state initialization
  - [x] Update `ws.onclose` to consult `shouldReconnect()` on post-open closes; schedule `setTimeout(attemptReconnect, delay)` on non-exhausted attempts; fall through to the existing `connection_lost` emission on exhaustion
  - [x] Add `attemptReconnect()` private method: increments counter → calls `establishConnection()` → on success emits `realtime.reconnected` + resets counter; on failure relies on the new `onclose` to schedule the next attempt
  - [x] Update `disconnect()` signature to `disconnect(opts: { reason?: "user" | "reconnect" } = { reason: "user" })`; set `intentionallyDisconnected` BEFORE closing the WebSocket; clear pending `reconnectTimeoutId`
  - [x] Add new event types `realtime.reconnecting` + `realtime.reconnected` to `RealtimeEvent` union
  - [x] Expose existing private `send()` as new public `sendRaw(event)` method
  - [x] Verify `configureSession()` runs on every successful `ws.onopen` (existing behavior — confirm)

- [x] Task 3: Wire reconnect into `useRealtimeVoice` (AC #4)
  - [x] Add `"reconnecting"` to `ConversationState.status` union
  - [x] Add `aiSpeakingStartedAtMsRef = useRef<number | null>(null)` alongside other refs
  - [x] Add `stateRef = useRef(state); stateRef.current = state` (or a narrower `isAiSpeakingRef`) for handler-time state access
  - [x] Add `case "realtime.reconnecting"` handler: drain `pendingToolCorrectionsRef` into `correctionsRef` via `mergeOrphanCorrections` + reset per-turn refs + setState `status: "reconnecting"` + `stopAudioStreaming()`
  - [x] Add `case "realtime.reconnected"` handler: setState `status: "connected", error: null` + `startAudioStreaming()`
  - [x] Update `case "response.output_audio.delta"` to set `aiSpeakingStartedAtMsRef.current = Date.now()` on first fire
  - [x] Update `case "response.output_audio.done"` + `case "response.done"` + `case "error"` to reset `aiSpeakingStartedAtMsRef.current = null`
  - [x] Reset `aiSpeakingStartedAtMsRef.current = null` in `start()` alongside other ref resets

- [x] Task 4: Wire barge-in into `useRealtimeVoice` (AC #5)
  - [x] Update `case "input_audio_buffer.speech_started"` to call `computeBargeInDirective` + dispatch `ExpoPlayAudioStream.stopSound()` + `sessionRef.current.sendRaw({type: "response.cancel"})` + (conditionally) `sessionRef.current.sendRaw({type: "conversation.item.truncate", ...})` when `state.isAiSpeaking === true`
  - [x] Add Sentry breadcrumbs for the barge-in success path + the partial-data fallback path
  - [x] Reset `aiSpeakingStartedAtMsRef.current = null` + `inflightItemIdRef.current = null` after barge-in
  - [x] Verify the existing pre-11-2 logic (setting `responseInFlightRef` + flipping `isSpeaking: false, isProcessing: true`) is preserved on the non-barge-in path

- [x] Task 5: Test surface (AC #6)
  - [x] CREATE `src/lib/__tests__/realtime-reconnect.test.ts` — 6 cases
  - [x] CREATE `src/lib/__tests__/realtime-barge-in.test.ts` — 5 cases
  - [x] EXTEND `src/lib/__tests__/realtime-corrections.test.ts` — 1 case for reconnect-start orphan-drain
  - [x] VERIFY all existing tests stay green per AC #6 enumeration

- [x] Task 6: Update CLAUDE.md (AC #7) — add new "Realtime reconnect + barge-in" architecture line after the Story 11-1 line

- [x] Task 7: Quality gates (AC #Z)
  - [x] `npm run type-check` passes (0 errors)
  - [x] `npm run lint` passes (0 errors, 0 warnings)
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 970+ tests (was 955 post-11-1)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN + Submit credentials leak guards pass
  - [x] `git status` shows the story file as untracked-but-not-ignored
  - [x] `npx prettier --check` on the story file passes

## Dev Notes

### Architecture pattern alignment

- **Pure-helper extraction (Story 11-1 P18 pattern).** The reconnect-decision logic + the barge-in-decision logic both live in pure modules at `src/lib/realtime-reconnect.ts` + `src/lib/realtime-barge-in.ts`. The hook + the session class own only the side effects (setTimeout, WebSocket events, `ExpoPlayAudioStream.stopSound`, `sendRaw`). The pure helpers can be unit-tested without mounting React or mocking a WebSocket — mirrors how Story 11-1 extracted `processReportCorrectionCall` + `drainPendingCorrections` + `mergeOrphanCorrections`.
- **Lockstep constant + max-iterations pattern (Story 11-1 P9 + P19).** `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length` (5) is pinned by a test so a maintainer can't change one without the other. Same defense Story 11-1 used for `MAX_PENDING_CORRECTIONS = 20`.
- **`disconnect({ reason })` discriminated union (typed-intent pattern).** The hook can intentionally disconnect (`{ reason: "user" }`) and have the session NOT reconnect; an unexpected close gets reconnect treatment. Type-safe distinction prevents the silent "every close is the same" anti-pattern.
- **Cross-session orphan-drain (Story 11-1 P2/P3 pattern).** On reconnect-start, the hook drains `pendingToolCorrectionsRef` into `correctionsRef` via `mergeOrphanCorrections` — same pattern Story 11-1 used at `response.done` + `case "error"`. The reconnect boundary is a third "cross-session boundary" where orphan tool-call data must be preserved.
- **State-ref mirror for handler-time state access (existing `statusRef` pattern).** The barge-in branch reads `state.isAiSpeaking` inside an event handler that has a stale closure over `state` from the `useCallback` deps. Mirror via `stateRef.current = state` (updated on each render) is the existing fix for this. Story 11-2 either extends the `statusRef` to a broader `stateRef` or adds a narrower `isAiSpeakingRef` — dev-agent choice.
- **Public `sendRaw` for un-typed events.** Story 11-2 needs `response.cancel` + `conversation.item.truncate` which aren't typed methods on `RealtimeSession`. Rather than add typed wrappers for two single-use events, expose the existing private `send` as a public `sendRaw` so the hook can dispatch arbitrary client events. Future stories adding more un-typed events can reuse the same surface; if multiple stories accumulate `sendRaw` usage for the same event type, a future hardening story can promote them to typed methods.
- **No re-build of the prompt on reconnect.** The session caches the `RealtimeConfig` (which includes the `systemPrompt` string built by `buildConversationPrompt` at the original `start()` time). Reconnect replays the cached value verbatim. Story 9-4's `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + "treat as data" prelude are preserved by definition — the prompt isn't re-built, so no user-derived prop change can alter the prompt mid-conversation.
- **Server-side context loss across reconnect is intentional + documented.** The cleanest minimum-viable reconnect skips conversation-item replay. The user may need to repeat the last sentence after reconnect; the AI gets a fresh context. This is acceptable for the network-blip use case and significantly simpler than the replay alternative (which has dedup risk, token cost, and race conditions with the first speech_started after reconnect).
- **Story 9-6 token-refresh discipline preserved.** `establishConnection()` calls `supabase.auth.refreshSession()` (existing behavior in `connect()` — preserved via the refactor). Each reconnect refreshes the Supabase session, so a token expiry that happens during a long conversation auto-recovers on the next reconnect cycle.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Polish AC #Z bakes this in for the new story file + the new pure-helper modules + the new test files.
- **Epic 9 + 10 retros A3** (review-patch budget — stories that pass type-check + lint + tests are typically ~70% done; budget for 5-15 review patches per story): Story 11-2's reconnect + barge-in touch the highest-risk part of the codebase (WebSocket lifecycle + audio + cross-session state). Expect 10-20 review patches. High-risk surfaces for review-patch findings: (a) race conditions in the reconnect lifecycle (what happens if the user calls `end()` while a reconnect is pending?), (b) audio playback state during reconnect (is `stopSound` followed by `startRecording` clean? does the prior `subscriptionRef` get cleaned up?), (c) breadcrumb hygiene under reconnect storms (a flaky network could fire many reconnects — does Sentry get flooded?), (d) the `aiSpeakingStartedAtMsRef` timing (`Date.now()` is non-monotonic — clock skew defense via the AC #2 case 5 clamp is necessary), (e) the `state.isAiSpeaking` capture at handler time vs. render time (the `stateRef` mirror pattern).
- **Story 9-5 lesson** (`output_modalities: ["audio"]` + pure-helper module): the reconnect re-sends `session.update` with the SAME modality config. The Story 9-5 contract holds across reconnect by construction.
- **Story 11-1 P18 lesson** (pure-helper extraction for testability): Story 11-2 extracts TWO pure helpers (`shouldReconnect` + `computeBargeInDirective`) so the high-risk logic is unit-testable without React or WebSocket mocking. Mirrors the Story 11-1 `processReportCorrectionCall` + `drainPendingCorrections` + `mergeOrphanCorrections` pattern.
- **Story 11-1 P9 lesson** (cap with sane upper bound): `MAX_RECONNECT_ATTEMPTS = 5` + `RECONNECT_BACKOFF_MS.length === 5` lockstep — a maintainer can't silently change one without the other thanks to the AC #1 case 6 test.
- **Story 11-1 P20 lesson** (standardized rejection message shape): not directly applicable; reconnect doesn't return messages to the model. But the Sentry breadcrumb category + feature naming follows the same `feature: "realtime-<surface>"` convention (`"realtime-reconnect"`, `"realtime-barge-in"`).
- **Story 9-3 telemetry-allowlist contract**: new breadcrumbs use only existing allowlisted keys (`feature`, `attempt`, `category`). Verified by re-reading `src/lib/sentry.ts:25-52` post-patch.

### Source tree components to touch

| File                                                                                       | Action                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/realtime.ts](src/lib/realtime.ts)                                                 | UPDATE — refactor `connect()` into `establishConnection()` + initial state setup; add reconnect lifecycle to `ws.onclose`; new `attemptReconnect()` private method; `disconnect({reason})` signature; new `RealtimeEvent` union members `realtime.reconnecting` + `realtime.reconnected`; expose `send()` as public `sendRaw()` |
| [src/lib/realtime-reconnect.ts](src/lib/realtime-reconnect.ts)                             | CREATE — `RECONNECT_BACKOFF_MS` + `MAX_RECONNECT_ATTEMPTS` + `ReconnectDecision` + `shouldReconnect(closeReason, wasConnected, attemptCount)` pure function                                                                                                                                            |
| [src/lib/realtime-barge-in.ts](src/lib/realtime-barge-in.ts)                               | CREATE — `BargeInState` + `BargeInDirective` types + `computeBargeInDirective(state, now)` pure function                                                                                                                                                                                              |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts)                         | UPDATE — `"reconnecting"` status; `aiSpeakingStartedAtMsRef`; `stateRef` (or `isAiSpeakingRef`) mirror; new `case "realtime.reconnecting"` + `case "realtime.reconnected"` handlers; barge-in branch in `case "input_audio_buffer.speech_started"`; `aiSpeakingStartedAtMsRef` set in `response.output_audio.delta` + reset in done/error/start |
| [src/lib/\_\_tests\_\_/realtime-reconnect.test.ts](src/lib/__tests__/realtime-reconnect.test.ts)   | CREATE — 6 cases per AC #1                                                                                                                                                                                                                                                                            |
| [src/lib/\_\_tests\_\_/realtime-barge-in.test.ts](src/lib/__tests__/realtime-barge-in.test.ts)     | CREATE — 5 cases per AC #2                                                                                                                                                                                                                                                                            |
| [src/lib/\_\_tests\_\_/realtime-corrections.test.ts](src/lib/__tests__/realtime-corrections.test.ts) | EXTEND — 1 case for reconnect-start orphan-drain regression guard                                                                                                                                                                                                                                     |
| [CLAUDE.md](CLAUDE.md)                                                                     | UPDATE — add new "Realtime reconnect + barge-in" architecture line after the Story 11-1 line                                                                                                                                                                                                          |

**Not touched (verified-correct):**

| File                                                                                                       | Reason                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/realtime-transcript.ts` (Story 9-5)                                                               | Pure dedup module; unchanged                                                                                                                                                                                                                                                                    |
| `src/lib/realtime-corrections.ts` (Story 11-1)                                                             | Pure correction-protocol helpers; unchanged                                                                                                                                                                                                                                                     |
| `src/lib/speaking-score.ts` (Story 11-1)                                                                   | Speaking-score formula; unchanged                                                                                                                                                                                                                                                               |
| `src/lib/schemas/ai-responses.ts`                                                                          | Story 11-1 + earlier schemas; unchanged (no new schema needed for reconnect / barge-in events)                                                                                                                                                                                                  |
| `src/lib/prompts/conversation.ts` (Story 9-4 + 10-7 + 11-1)                                                | Prompt builder; unchanged. Reconnect replays the cached prompt from the original `start()`; does NOT re-run `buildConversationPrompt`.                                                                                                                                                          |
| `src/lib/sentry.ts` `SENTRY_EXTRAS_ALLOWLIST`                                                              | Story 9-3 contract; unchanged. New breadcrumbs reuse `feature` / `attempt` / `category` keys.                                                                                                                                                                                                   |
| `src/components/conversation/TranscriptView.tsx` (Story 11-1)                                              | Legacy display stripper; unchanged                                                                                                                                                                                                                                                              |
| `app/(tabs)/mock-test/speaking.tsx` (Story 9-8 / 10-6)                                                     | Separate record-and-grade flow; not Realtime                                                                                                                                                                                                                                                    |
| `app/(tabs)/conversation/history.tsx`                                                                      | Renders historical conversations; not Realtime                                                                                                                                                                                                                                                  |
| `supabase/functions/realtime-session/*`                                                                    | Edge Function; unchanged. Reconnect uses the same Edge Function call as the initial connect (refresh Supabase session → invoke → get fresh token).                                                                                                                                              |
| The `save_vocabulary` / `note_error_pattern` / `report_correction` tool registrations (Story 11-1)         | Tool array in `useRealtimeVoice` is passed via `RealtimeConfig.tools` to the session; the session re-sends it on every reconnect via `configureSession()`. NOT touched.                                                                                                                       |

### Anti-pattern prevention

- **Do NOT attempt reconnect on the initial `connect()` failure.** That's a different failure mode (the user manually retries from the UI). Reconnect is for post-open closes only.
- **Do NOT attempt reconnect after `disconnect({ reason: "user" })`.** The intentionally-disconnected flag is the signal; respect it.
- **Do NOT preserve server-side conversation context across reconnect.** Replaying `conversation.item.create` events for each prior transcript entry is deferred to Epic 11.X. The cleanest minimum-viable reconnect lets the AI start fresh after the new `session.update`.
- **Do NOT re-build the prompt on reconnect.** The cached `systemPrompt` from the original `start()` is replayed verbatim. Re-running `buildConversationPrompt` against potentially-changed `memories` / `errorPatterns` props mid-conversation would create cross-session prompt drift.
- **Do NOT touch `src/lib/realtime-transcript.ts`** — Story 9-5 pure module. Reconnect events don't route through `appendIfNew`; they're discrete `realtime.reconnecting` / `realtime.reconnected` events.
- **Do NOT touch the `report_correction` / `save_vocabulary` / `note_error_pattern` tool registrations.** They're inside the `RealtimeConfig.tools` array that the session caches + replays on reconnect.
- **Do NOT add new keys to `SENTRY_EXTRAS_ALLOWLIST`.** Reuse `feature` / `attempt` / `category` (all already allowlisted).
- **Do NOT call `response.cancel` defensively when the AI is not speaking.** Per the API docs, `response.cancel` returns an error if no response is in flight — harmless but log-pollution. Gate on `state.isAiSpeaking === true` strictly.
- **Do NOT call `conversation.item.truncate` without a valid `item_id`.** Server-side error response; breadcrumb + skip is the safe path.
- **Do NOT clamp `audio_end_ms` to the actual played duration of the audio buffer** (which would require coordinating with `ExpoPlayAudioStream`'s internal state). `Date.now() - aiSpeakingStartedAtMsRef.current` is the right proxy and matches the spec: "the player has played `audio_end_ms` of the assistant audio buffer." Non-negative clamp is the only defense needed.
- **Do NOT call `start()` from the reconnect path.** `start()` resets ALL refs (including `transcriptRef.current`) which would erase the on-screen conversation. Reconnect MUST preserve `transcriptRef` + `correctionsRef` + the duration timer.
- **Do NOT remove the existing `connection_lost` terminal-failure path.** Reconnect runs upstream; if reconnect fails after 5 attempts, the existing path runs unchanged. NO regression to the prior failure mode.
- **Do NOT skip the orphan-drain at reconnect-start.** Story 11-1 P2/P3 established the pattern: tool-call data in the buffer must be preserved across cross-session boundaries. The reconnect boundary is a new instance of the same boundary.
- **Do NOT make the backoff schedule configurable** (e.g., via a `RealtimeConfig.reconnect` field). Hardcoded `[500, 1000, 2000, 4000, 8000]` is operator-acceptable; configurability is over-engineering for the v1 reconnect.
- **Do NOT introduce a new ConversationState.error message format on reconnect**. The existing `error: string | null` field is unchanged; `error = null` on reconnect-success.

### Testing standards

- **Pure-helper testing first.** The reconnect-decision + barge-in-decision logic is testable WITHOUT React or WebSocket mocking via the two new pure modules. Same pattern Story 11-1 used for `processReportCorrectionCall` + `mergeOrphanCorrections`.
- **Lockstep constant pin.** `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length` test prevents silent drift between the two constants. Same defense Story 11-1's P19 used for `MAX_PENDING_CORRECTIONS = 20`.
- **Clock-skew defense.** `audio_end_ms` is clamped to non-negative; the `Date.now() < startedAt` test case pins the defense.
- **Negative substring assertions**. The new pure-module test files include negative cases (intentional close → NO reconnect; AI not speaking → NO `response.cancel`) so a future patch that broadens the conditions loudly fails CI.
- **Hook integration testing deliberately out of scope.** The pure helpers are the load-bearing logic; the hook's wiring is mechanical glue. Adding hook-level integration tests (mock RealtimeSession + assert state transitions) would require React Testing Library + complex async setup — high effort, low marginal coverage. Filed as a future Epic 15.X follow-up.

### Project Structure Notes

- All non-test changes are to existing files OR new pure-helper modules at `src/lib/`. Story 11-2 does NOT introduce new directories.
- **No DB migrations.**
- **No Edge Function changes.** The `realtime-session` Edge Function flow is unchanged; reconnect re-uses the same call.
- **No new dependencies.** `zod` (already in package.json), React refs/state (already in use), `setTimeout` (browser builtin).
- **No app router changes.** The new `"reconnecting"` state is consumed by the existing conversation screen at `app/(tabs)/conversation/[sessionId].tsx`; UI rendering of the new status is delegated to a future UI-polish story (or can be a trivial banner showing the existing `state.error` string when `state.status === "reconnecting"`).

### References

- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 58-59 — P1-7 finding]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 182 — Epic 11.2 deliverable]
- [Source: \_bmad-output/planning-artifacts/shippable-roadmap.md line 191 — Epic 11 AC "Disconnect simulation mid-conversation reconnects within 5s"]
- [Source: \_bmad-output/implementation-artifacts/11-1-correction-protocol-tool-calls.md — Story 11-1 (P18 pure-helper extraction pattern + P2/P3 orphan-drain pattern + P9/P19 lockstep constant pattern)]
- [Source: src/lib/realtime.ts:243-256 — current `ws.onclose` handler]
- [Source: src/lib/realtime.ts:144-258 — current `connect()` method to refactor into `establishConnection()`]
- [Source: src/lib/realtime.ts:276-312 — `configureSession()` (unchanged; re-sent on each reconnect)]
- [Source: src/lib/realtime.ts:359-367 — current `disconnect()` to extend with `{ reason }`]
- [Source: src/lib/realtime.ts:369-373 — current private `send()` to expose as public `sendRaw()`]
- [Source: src/lib/realtime.ts:38-93 — current `RealtimeEvent` union to extend]
- [Source: src/hooks/use-realtime-voice.ts:131-151 — current refs declared in the hook]
- [Source: src/hooks/use-realtime-voice.ts:445-454 — current `case "input_audio_buffer.speech_started"` handler]
- [Source: src/hooks/use-realtime-voice.ts:455-466 — current `case "response.output_audio.delta"` handler]
- [Source: src/hooks/use-realtime-voice.ts:543-591 — current `case "response.done"` handler + Story 11-1 orphan-drain]
- [Source: src/hooks/use-realtime-voice.ts:593-658 — current `case "error"` handler + connection_lost terminal path]
- [Source: src/hooks/use-realtime-voice.ts:845-1003 — current `start()` method]
- [Source: src/hooks/use-realtime-voice.ts:1026-1054 — current `end()` method]
- [Source: src/lib/sentry.ts:25-52 — `SENTRY_EXTRAS_ALLOWLIST` (unchanged; new breadcrumbs reuse existing keys)]
- [Source: src/lib/realtime-corrections.ts — Story 11-1 `mergeOrphanCorrections` helper (re-used for reconnect-start orphan-drain)]
- [Source: developers.openai.com/api/docs/guides/realtime-conversations — "Interruption and Truncation" section: client-side truncation for WebSocket connections]
- [Source: developers.openai.com/api/docs/api-reference/realtime-client-events/response/cancel — `response.cancel` event spec]
- [Source: developers.openai.com/api/docs/api-reference/realtime-client-events/conversation/item/truncate — `conversation.item.truncate` event spec (audio_end_ms + content_index: 0 + item_id)]
- [Source: developers.openai.com/api/docs/guides/websocket-mode — WebSocket 60-min connection limit + reconnect strategy]
- [Source: Story 9-3 — Sentry allowlist contract (preserved)]
- [Source: Story 9-4 — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers (preserved; reconnect replays cached prompt)]
- [Source: Story 9-5 — voice transcript dedup + `output_modalities: ["audio"]` (preserved; pure module not touched)]
- [Source: Story 9-6 — auth listener token-refresh discipline (preserved; reconnect calls `supabase.auth.refreshSession()` inside `establishConnection()`)]
- [Source: Story 11-1 — `pendingToolCorrectionsRef` + `responseInFlightRef` + `inflightItemIdRef` lifecycle + `mergeOrphanCorrections` pure helper (re-used at reconnect-start)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/11-2-realtime-reconnect-barge-in` (from `main` at `1b288d4` — post-Story-11-1 done-flip commit).
- Quality gates: `npm run type-check` ✓ (0 errors), `npm run lint` ✓ (0 errors, 0 warnings, `--max-warnings 0`), `npm run format:check` ✓ (auto-fixed one file via `npx prettier --write src/hooks/use-realtime-voice.ts`), `npm test` ✓ (976 passing, was 955 pre-story → +21 net tests across 11 reconnect cases + 7 barge-in cases + 1 reconnect-start orphan-drain regression guard + 2 lockstep/canonical-schedule pins), `npm run check:colors` ✓ ("No hardcoded hex colors found.").
- CI guards: Sentry DSN leak guard ✓ (no matches in src/ or app/). Submit credentials leak guard ✓ (no new Apple Team ID / ASC App ID literals introduced).
- Story file `_bmad-output/implementation-artifacts/11-2-realtime-reconnect-barge-in.md` shows as Untracked in `git status`; `git check-ignore -v` returns exit 1 (Epic 9 retro A1 satisfied). `npx prettier --check` clean.

### Completion Notes List

**Created `src/lib/realtime-reconnect.ts` pure helper** with `RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000]` + `MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length` (5) + `CloseReason` type union + `ReconnectDecision` interface + `shouldReconnect(closeReason, wasConnected, attemptCount)` function. The helper returns `{ reconnect: false, delayMs: 0, attempt: 0 }` for intentional closes, pre-open closes, and exhausted attempts; otherwise returns the next backoff delay + 1-indexed attempt number. Pure function — no side effects, no clock access.

**Created `src/lib/realtime-barge-in.ts` pure helper** with `BargeInState` + `BargeInDirective` types + `computeBargeInDirective(state, now)` function. Returns `{ shouldCancelResponse: false, shouldTruncate: false, audioEndMs: null, itemId: null }` when `isAiSpeaking === false`; otherwise sets `shouldCancelResponse: true` and conditionally `shouldTruncate: true` when both `inflightItemId` and `aiSpeakingStartedAtMs` are non-null. `audioEndMs` is computed as `Math.max(0, Math.floor(now - aiSpeakingStartedAtMs))` (non-negative integer; clock-skew defense).

**Wired reconnect into `src/lib/realtime.ts` `RealtimeSession`**:
- Added private fields `reconnectAttempts` (counter, reset on success), `reconnectTimeoutId` (pending setTimeout handle, cleared on disconnect), `intentionallyDisconnected` (signal to skip reconnect on user-initiated close), `wasConnected` (set in `ws.onopen` so the close handler can distinguish pre-open from post-open closes).
- Refactored `connect()` into `connect()` (resets state + delegates) + private `establishConnection()` (shared code path between initial connect and per-attempt reconnect).
- Updated `ws.onclose` to consult `shouldReconnect(reason, wasConnected, attemptCount)`; on reconnect: emit `realtime.reconnecting` + Sentry breadcrumb + schedule `setTimeout(attemptReconnect, decision.delayMs)`. On no-reconnect (user / pre-open / exhausted): fall through to the existing terminal `connection_lost` error emission (or NO emission for user-initiated, since `end()` already handles teardown).
- Updated `ws.onopen` to set `wasConnected = true` so the close handler can distinguish reconnect-eligible post-open closes from pre-open reject paths.
- New private `attemptReconnect()` method: defensive check on `intentionallyDisconnected` at entry + after the `establishConnection()` await (closes the new ws immediately if the user navigated away mid-reconnect — defense against the disconnect-during-reconnect race). On success: reset `reconnectAttempts = 0` + emit `realtime.reconnected` + Sentry breadcrumb. On synchronous failure (e.g., offline / Edge Function error): manually schedule the next backoff cycle since no `ws.onclose` would fire to drive it naturally (with defense against double-scheduling if `reconnectTimeoutId` is already non-null from a parallel onclose path).
- Updated `disconnect()` signature to `disconnect(opts: { reason?: "user" | "reconnect" } = { reason: "user" })`; clears pending `reconnectTimeoutId` BEFORE closing the WebSocket.
- New `RealtimeEvent` union members `realtime.reconnecting` (with `attempt: number`) + `realtime.reconnected`.
- New public method `sendRaw(event: Record<string, unknown>): void` for dispatching arbitrary client events without typed wrappers (used by the barge-in branch for `response.cancel` + `conversation.item.truncate`).

**Wired reconnect + barge-in into `src/hooks/use-realtime-voice.ts`**:
- Extended `ConversationState.status` union with `"reconnecting"`.
- Added new refs `aiSpeakingStartedAtMsRef` (captured on first `response.output_audio.delta` of a turn; reset on done / error / barge-in / reconnect-start / `start()`) and `isAiSpeakingRef` (mirror of `state.isAiSpeaking` for handler-time access, same pattern as `statusRef`).
- Added `case "realtime.reconnecting"` handler: drains `pendingToolCorrectionsRef` into `correctionsRef` via `mergeOrphanCorrections` (Story 11-1 P2/P3 cross-session-boundary pattern, third instance) + resets `inflightItemIdRef` / `responseInFlightRef` / `currentAiTextRef` / `aiSpeakingStartedAtMsRef` + sets `state.status: "reconnecting"` + stops the prior `ExpoPlayAudioStream` subscription.
- Added `case "realtime.reconnected"` handler: sets `state.status: "connected", error: null` + re-starts audio streaming for the new WebSocket.
- Added barge-in branch to `case "input_audio_buffer.speech_started"` that computes the directive via `computeBargeInDirective` and dispatches: (1) `ExpoPlayAudioStream.stopSound()` to halt local playback, (2) `sessionRef.current?.sendRaw({type: "response.cancel"})` to halt the server-side response, (3) `sessionRef.current?.sendRaw({type: "conversation.item.truncate", item_id, content_index: 0, audio_end_ms})` to synchronize the server-side transcript (only if both `inflightItemId` and `aiSpeakingStartedAtMs` are non-null; otherwise breadcrumb the missing data). Sentry breadcrumbs use `feature: "realtime-barge-in"` (allowlist-safe).
- Updated `case "response.output_audio.delta"` to capture `aiSpeakingStartedAtMsRef.current = Date.now()` on the first delta of a turn.
- Updated `case "response.output_audio.done"` + `case "response.done"` + `case "error"` to reset `aiSpeakingStartedAtMsRef.current = null`.
- Added `aiSpeakingStartedAtMsRef.current = null` reset in `start()` alongside the other per-conversation ref resets.
- Updated `handleEvent`'s `useCallback` dep list to include `startAudioStreaming` and `stopAudioStreaming` (both have empty `useCallback` deps so stable identity is preserved).

**Tests**:
- `src/lib/__tests__/realtime-reconnect.test.ts` (NEW — 11 cases): intentional close no-reconnect + pre-open close no-reconnect (across 6 attempt counts) + first-attempt 500ms + parameterized backoff schedule (attempts 0-4 → delays 500/1000/2000/4000/8000ms) + exhausted at MAX + defensive over-MAX + intentional-trumps-everything + lockstep `MAX_RECONNECT_ATTEMPTS === RECONNECT_BACKOFF_MS.length === 5` pin + canonical schedule total-15500ms pin.
- `src/lib/__tests__/realtime-barge-in.test.ts` (NEW — 7 cases): AI-not-speaking no-op + full directive (cancel + truncate + audio_end_ms) + null-item-id partial (cancel only) + null-startedAt partial (cancel only) + clock-skew clamp (`now < startedAt` → audio_end_ms = 0) + same-instant boundary + non-integer-input flooring.
- `src/lib/__tests__/realtime-corrections.test.ts` (EXTENDED — 1 new case): "Story 11-2 reconnect-start: preserves tool-call data across cross-session boundary" — regression guard that `mergeOrphanCorrections` correctly handles the third cross-session boundary (in addition to Story 11-1's response.done + case "error" boundaries).

**CLAUDE.md** gained a new "Realtime reconnect + barge-in" architecture line after the Story 11-1 line. Documents the full lifecycle: pure-helper extraction, lockstep constants, `disconnect({reason})` discriminated union, `wasConnected` flag, `attemptReconnect()` race defenses (entry + post-await + double-schedule), `RealtimeConfig` cached + replayed on each reconnect (preserving Story 9-4 prompt invariants by definition), server-side context loss as intentional trade-off, 60-min connection limit auto-recovery, barge-in 3-step dispatch (stopSound + response.cancel + conversation.item.truncate), `audio_end_ms` clamp + integer flooring, defensive null-item-id / null-startedAt fallback. Closes audit P1-7 architecturally. Story 9-3 / 9-4 / 9-5 / 9-6 / 9-7 / 9-8 / 9-10 / 10-2 / 10-3 / 10-4 / 10-5 / 10-7 / 10-8 / 11-1 invariants all hold unchanged.

**Cross-story invariant verification**:
- **Story 9-3** Sentry allowlist holds — new breadcrumbs use only `feature` / `attempt` / `category` keys (all existing allowlist members).
- **Story 9-4** stored-prompt-injection defense holds — reconnect replays the CACHED `systemPrompt` from the original `start()`; does NOT re-run `buildConversationPrompt` with potentially-changed user-derived props mid-conversation.
- **Story 9-5** voice transcript dedup holds — `output_modalities: ["audio"]` + `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` pure module + FIFO-capped 256-entry dedup Set NOT modified. Reconnect re-sends `configureSession()` with the same modality config.
- **Story 9-6** auth listener token-refresh discipline holds — `supabase.auth.refreshSession()` runs inside the refactored `establishConnection()` (was inside the original `connect()` — preserved across the refactor).
- **Story 9-7 / 9-8** schema-validation contracts hold — orthogonal to Realtime.
- **Story 11-1** correction tool-call contract holds — `pendingToolCorrectionsRef` + `responseInFlightRef` + `inflightItemIdRef` lifecycle preserved; new reset point added at reconnect-start (after orphan-drain via `mergeOrphanCorrections`) without modifying the existing reset points at `start()` / `response.done` / `case "error"`. The cached `RealtimeConfig.tools` array (containing `save_vocabulary` / `note_error_pattern` / `report_correction`) is re-sent on every reconnect via `configureSession()`.

**Out of scope (deferred per story)**: server-side context replay across reconnect (deferred to future Epic 11.X); `call_id`-based attach-to-existing-session (requires Edge Function changes); manual reconnect button (auto-reconnect makes it unnecessary); network-quality monitoring (Epic 13); adaptive backoff with jitter; hook-level integration tests (filed as Epic 15.X follow-up — the pure-helper coverage is sufficient for v1).

### File List

**Created:**

- `src/lib/realtime-reconnect.ts` — pure helper `shouldReconnect` + `RECONNECT_BACKOFF_MS` + `MAX_RECONNECT_ATTEMPTS` + `CloseReason` type + `ReconnectDecision` interface
- `src/lib/realtime-barge-in.ts` — pure helper `computeBargeInDirective` + `BargeInState` + `BargeInDirective` types
- `src/lib/__tests__/realtime-reconnect.test.ts` — 11 cases (intentional close + pre-open + parameterized backoff + exhausted + lockstep + canonical schedule pin)
- `src/lib/__tests__/realtime-barge-in.test.ts` — 7 cases (not-speaking no-op + full directive + 2 partial paths + clock-skew clamp + same-instant boundary + non-integer flooring)

**Modified:**

- `src/lib/realtime.ts` (refactored `connect()` into `connect()` + private `establishConnection()`; added reconnect state fields + `attemptReconnect()` method; updated `ws.onclose` + `ws.onopen` for reconnect lifecycle; new `disconnect({reason})` signature; new `RealtimeEvent` union members `realtime.reconnecting` + `realtime.reconnected`; new public `sendRaw()` method)
- `src/hooks/use-realtime-voice.ts` (added `"reconnecting"` to `ConversationState.status`; new refs `aiSpeakingStartedAtMsRef` + `isAiSpeakingRef` mirror; new `case "realtime.reconnecting"` + `case "realtime.reconnected"` handlers; new barge-in branch in `case "input_audio_buffer.speech_started"`; `aiSpeakingStartedAtMsRef` set in `response.output_audio.delta` + reset in `response.output_audio.done` / `response.done` / `case "error"` / `start()`; `useCallback` dep array updated to include `startAudioStreaming` + `stopAudioStreaming`)
- `src/lib/__tests__/realtime-corrections.test.ts` (EXTENDED — 1 new case for the Story 11-2 reconnect-start orphan-drain regression guard)
- `CLAUDE.md` (added "Realtime reconnect + barge-in" architecture line after the Story 11-1 line)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (11-2: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/11-2-realtime-reconnect-barge-in.md` (this story file — Status flipped, all AC + Task checkboxes [x], Dev Agent Record + File List + Change Log filled)

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-11 | Story 11-2 story file created; closes audit P1-7 (no reconnect / no barge-in in RealtimeSession) via exponential-backoff reconnect on unexpected `ws.onclose` + `response.cancel` + `conversation.item.truncate` on user-audio-while-AI-speaking.                                                                                                                                                                                  |
| 2026-05-11 | Story 11-2 implementation complete on `feature/11-2-realtime-reconnect-barge-in`. Two new pure-helper modules at `src/lib/realtime-reconnect.ts` + `src/lib/realtime-barge-in.ts` (Story 11-1 P18 testability pattern). `RealtimeSession` gains reconnect lifecycle + `disconnect({reason})` discriminated-union signature + public `sendRaw()` method + new `realtime.reconnecting` / `realtime.reconnected` events. Hook routes the new events into a `"reconnecting"` status, drains the Story 11-1 pending-correction buffer into `correctionsRef` via `mergeOrphanCorrections` (third cross-session boundary), and re-starts audio streaming on reconnect-success. Barge-in branch added to `case "input_audio_buffer.speech_started"` dispatches `response.cancel` + `conversation.item.truncate` + `ExpoPlayAudioStream.stopSound()` when the AI is currently speaking. +21 net tests (955 → 976); all quality gates green; CLAUDE.md updated; status → review. |
| 2026-05-11 | Round-2 Senior Developer Review patches P21-P28 + P30 applied (4 HIGH + 4 MED). +1 net test (976 → 977); all quality gates green. See "Senior Developer Review (AI)" section below for triage detail. |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-11
**Reviewers:** Blind Hunter (general adversarial, no project context) + Edge Case Hunter (project-aware path tracer) + Acceptance Auditor (spec-vs-diff)
**Outcome:** Changes Requested → 8 patch findings applied → APPROVED

### Triage outcome

- **37 findings** raised across 3 reviewers (20 Blind Hunter + 17 Edge Case Hunter + 0 Acceptance Auditor — the Acceptance Auditor returned a clean "0 violations across all numbered ACs + AC #Z polish — spec was followed faithfully" verdict). After deduplication: **~24 distinct findings**.
- **8 patch findings applied** in this branch (4 HIGH + 4 MED).
- **8 defer findings** filed as future-Epic follow-ups.
- **4 reject findings** dropped (false alarms; spec was correct; or claims contradicted by the actual diff).
- **0 violations** from the Acceptance Auditor on the 7 numbered ACs + AC #Z polish.

### Action Items (all resolved)

- [x] **[HIGH] P21** (Blind Hunter #1 + Edge Case Hunter ECH-C + ECH-N) When `attemptReconnect()` runs `establishConnection()`, the new WebSocket assignment (`this.ws = new RNWebSocket(...)`) did NOT detach the OLD socket's event handlers first. A queued late `onclose` from the stale socket (which captured `this` lexically) could fire AFTER a successful reconnect-end and re-evaluate `shouldReconnect("unknown", true, this.reconnectAttempts === 0)` — triggering a second concurrent reconnect chain despite a healthy live connection. Patched: at the top of `establishConnection()`, before assigning a new ws, null out the old socket's handlers (`this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null`) + call `this.ws.close()` (no-op if already closed) + null `this.ws` — late onclose from the stale socket is now silent.
- [x] **[HIGH] P22** (Blind Hunter #4) `isAiSpeakingRef.current = state.isAiSpeaking` at render-time has a narrow stale window: a `speech_started` event firing BETWEEN the `response.output_audio.delta` handler's `setState` enqueue and React's render commit reads the previous render's value (`false`), causing the barge-in branch to silently skip the first user interrupt of a turn. Patched: set the ref synchronously alongside the setState call in `response.output_audio.delta` (→ true), `response.output_audio.done` (→ false), the barge-in branch (→ false), and `realtime.reconnecting` (→ false). Render-time mirror retained as a safety net for cases the synchronous path misses.
- [x] **[HIGH] P24** (Blind Hunter #11) The hook stopped the `ExpoPlayAudioStream` subscription on `realtime.reconnecting` and restarted it on `realtime.reconnected`. Reconnect window is up to 15.5s — mic capture was MUTED for the entire window, losing all mid-utterance user speech. Also introduced a `stopAudio` → `startAudio` race (BH#7). Patched: removed both calls. The mic subscription's `onAudioStream` callback already gates on `sessionRef.current?.isConnected` (which is false during reconnect, true after) so audio bytes are auto-routed correctly without restart. The `useCallback` dep array on `handleEvent` reverts to the pre-patch list (no more `startAudioStreaming` / `stopAudioStreaming` deps).
- [x] **[HIGH] P25** (Edge Case Hunter ECH-A + ECH-B) `start()` only guarded against `statusRef.current === "connecting" | "connected"`. A `start()` called while status is `"reconnecting"` (e.g., user taps "Start" again during the reconnect banner) would proceed, race the pending `setTimeout` from the prior session's onclose, and consume an Edge Function call on the stale reconnect target. Patched: added `"reconnecting"` to the early-return guard.
- [x] **[MED] P26** (Blind Hunter #3 + Edge Case Hunter ECH-D + ECH-Q) Defense-in-depth for the disconnect-during-reconnect-await race. The post-await check in `attemptReconnect()` closes the new ws if the user disconnected during the await — but only AFTER `configureSession()` has run and consumed a server-side Realtime session. Patched: added an earlier check inside `ws.onopen` (before `configureSession()`) that closes the new socket immediately if `intentionallyDisconnected === true` at open-time. Two-layer defense: ws.onopen check (saves the configureSession call) + attemptReconnect post-await check (saves the rest of the wiring).
- [x] **[MED] P27** (Blind Hunter #5) `sendRaw` silently no-ops when the WebSocket is not OPEN. Barge-in concurrent with a network blip (`ws.readyState === CLOSING`) dropped `response.cancel` + `conversation.item.truncate` without telemetry. Patched: `sendRaw` now emits a `feature: "realtime-sendraw-dropped"` Sentry breadcrumb when the readyState check fails. Operators can correlate dropped barge-in events with reconnect attempts in Sentry.
- [x] **[MED] P28** (Edge Case Hunter ECH-G + ECH-H) `response.cancel` returns a server `error` event with `code: "no_response_to_cancel"` when no response is in flight (per OpenAI docs: "It's safe to call response.cancel even if no response is in progress; an error will be returned and the session will remain unaffected"). Similarly, `conversation.item.truncate` returns an error for stale `item_id`s. Pre-patch, the hook routed these through the existing `case "error"` handler → `captureError` + `setState({status: "error"})` → terminated the conversation. Patched: suppress known-benign barge-in race codes (`no_response_to_cancel`, `invalid_truncate_audio`, `item_not_found`) with an info-level breadcrumb (`feature: "realtime-barge-in"`, `code: <code>`); the conversation continues uninterrupted.
- [x] **[MED] P30** (Blind Hunter #19) On barge-in, the server truncates the assistant message to `audio_end_ms`, but the local hook's `currentAiTextRef.current` held transcript text from prior `response.audio_transcript.delta` events that arrived faster than playback. The unplayed text could prefix the next turn via `acceptDelta`'s adopt path. Patched: clear `currentAiTextRef.current` in the barge-in branch alongside the other ref resets. Note: full local/server transcript sync (trimming the partial assistant entry in `transcriptRef.current` to the played duration) is deferred — the cancelled response's `response.output_audio_transcript.done` still fires with the truncated server-side text, which is what gets persisted.

### Deferred items (filed for follow-up)

- **DEFER-13** (Blind Hunter #8) `this.config = config` stored by reference, not clone. Consumer mutation of the original `RealtimeConfig` would affect cached config replays on reconnect. Filed as a future hardening (low-likelihood with current usage; the hook constructs a fresh config object per `start()`).
- **DEFER-14** (Blind Hunter #9) Breadcrumb storm on reconnect chains. Each attempt fires 2-3 breadcrumbs; 5 attempts = ~10-15 breadcrumbs per incident. Sentry ring buffer is 100 entries so a single reconnect storm consumes 10-15% of the buffer. Filed as a deduplication / rate-limit follow-up if Sentry diagnostics deteriorate in prod.
- **DEFER-15** (Blind Hunter #14) No hook-level integration tests covering reconnect state transitions, orphan-drain at reconnect-start, barge-in dispatch sequencing. The pure-helper tests + the round-2 P21-P28 patches close the highest-risk gaps; full integration testing requires WebSocket mocking + fake-timer infrastructure that doesn't currently exist in the project. Filed as Epic 15.X follow-up.
- **DEFER-16** (Blind Hunter #17) `useCallback` dep churn was a concern but the round-2 P24 patch (removing audio stop/restart) removes the new deps; only the pre-existing deps remain. No churn risk introduced.
- **DEFER-17** (Blind Hunter #18) `content_index: 0` modality coupling — currently safe under Story 9-5's `output_modalities: ["audio"]` invariant. Future modality changes would need to revisit. Filed as a Story 9-5 / Story 11-2 documentation cross-link follow-up.
- **DEFER-18** (Blind Hunter #20) `Date.now()` proxy for played-audio time slightly overestimates by network-to-speaker latency. Within tolerance for v1; a future hardening could query `ExpoPlayAudioStream` for actual played duration.
- **DEFER-19** (Edge Case Hunter ECH-E) Parallel `attemptReconnect` invocations via overlapping setTimeouts. Mitigated by `reconnectTimeoutId` being cleared in `disconnect()` and the catch-path double-schedule guard at line 535. Filed for future verification.
- **DEFER-20** (Edge Case Hunter ECH-K + ECH-M) Component-unmount-mid-reconnecting + stale `state.error` through reconnect window — both are general React concerns rather than Story 11-2-specific defects. Filed as cleanup follow-ups.

### Rejected items

- **REJECT-13** (Blind Hunter #10) Claim: "the new diff REPLACES `case 'input_audio_buffer.speech_started'` entirely and the new code does NOT set `responseInFlightRef.current = true`. Story 11-1 P16 contract broken." — False alarm: Story 11-1 P16 set the ref on `speech_stopped` (user finished speaking → AI's response window opens), NOT on `speech_started` (user starts speaking). The Story 11-2 barge-in patch correctly targets `speech_started` and leaves `speech_stopped` (and thus the P16 contract) byte-for-byte unchanged. Verified by re-reading the diff.
- **REJECT-14** (Blind Hunter #2) Claim: `reconnectAttempts` counter off-by-one — incremented BEFORE `establishConnection()` await, so a post-open failure sees count=1 and schedules with delay[1]=1000ms "for what was actually the first failure." — False alarm: the counter increment + helper-index alignment is correct. After the 1st attempt's failure, scheduling the 2nd attempt with delay 1000ms is the intended semantics ("5 attempts max, exponential backoff; each unique attempt uses the next slot"). Walking the lifecycle: 1st attempt at 500ms → fails → schedule 2nd at 1000ms → fails → schedule 3rd at 2000ms → ... → 5th attempt at 8000ms → fails → counter=5 → `shouldReconnect` returns `{reconnect: false}` → emit terminal `connection_lost`. Total 5 attempts at [500, 1000, 2000, 4000, 8000]ms = 15.5s budget. Matches the spec.
- **REJECT-15** (Blind Hunter #15) Test count claim is "unverified" — the dev-agent ran `npm test` and verified 976 passing post-implementation; the round-2 patches add 1 more case (now 977). Verified by `npm test` outputs at multiple points in the patch round.
- **REJECT-16** (Blind Hunter #16) `addBreadcrumb` fires on success path even after user-disconnect — the post-await `intentionallyDisconnected` check at attemptReconnect handles this; the breadcrumb fires after the check, so it only fires when the reconnect actually succeeded against a non-disconnected session.

### Final verification

- **977 tests passing** (was 976 post-implementation; +1 from the round-2 P25 boundary lifecycle test). Pre-story: 955 → **+22 net across the whole story**.
- All quality gates green: type-check (0 errors), lint (0 errors / 0 warnings), format (prettier-clean), check:colors (clean).
- CI Sentry DSN + Submit credentials leak guards both pass (no credentials / DSN literals introduced).
- 0 HIGH findings remaining (4 patched).
- 0 MED findings remaining (4 patched, 4 deferred per documented rationale).
- 0 LOW findings remaining (0 patched, 4 deferred per documented rationale).

### Cross-story consistency

- Story 9-3 Sentry allowlist — preserved. New breadcrumb keys (`feature: "realtime-sendraw-dropped"`, `code` for the barge-in suppress path) reuse existing allowlist members.
- Story 9-4 stored-prompt-injection — preserved. Reconnect replays cached `systemPrompt` from original `start()`; round-2 patches do NOT touch prompt construction.
- Story 9-5 voice transcript dedup — preserved. `output_modalities: ["audio"]` re-sent on every reconnect. Pure module `realtime-transcript.ts` not touched.
- Story 9-6 token-refresh discipline — preserved. `supabase.auth.refreshSession()` runs inside the refactored `establishConnection()`.
- Story 11-1 correction tool-call contract — preserved. The round-2 P22 sync ref update + P30 currentAiTextRef clear maintain the cross-session boundary semantics; the `mergeOrphanCorrections` drain at `realtime.reconnecting` is unchanged.
