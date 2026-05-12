/**
 * Realtime barge-in decision helper — Story 11-2.
 *
 * Pure function that decides what barge-in action to take when the
 * `input_audio_buffer.speech_started` event fires. Per the OpenAI Realtime
 * API docs (https://developers.openai.com/api/docs/guides/realtime-conversations
 * "Interruption and Truncation"):
 *
 *   "In WebRTC and SIP connections, the server manages an audio output
 *   buffer and automatically truncates unplayed audio when a user
 *   interrupts. For WebSocket connections, the client is responsible for
 *   managing audio playback and truncation. The client must:
 *     1. Stop playback upon detecting a `input_audio_buffer.speech_started` event,
 *     2. Note the played duration,
 *     3. Send a `conversation.item.truncate` event to remove the unplayed
 *        portion from the conversation."
 *
 * Extracted from `src/hooks/use-realtime-voice.ts` so the barge-in-decision
 * logic can be unit-tested without React or audio mocking.
 *
 * Lifecycle (consumer = `useRealtimeVoice` `case "input_audio_buffer.speech_started"`):
 *   1. speech_started fires → consumer calls `computeBargeInDirective(state, Date.now())`.
 *   2. If `shouldCancelResponse: false` → no AI response to interrupt;
 *      consumer runs only the existing pre-11-2 logic (set
 *      `responseInFlightRef` + flip `isSpeaking: false, isProcessing: true`).
 *   3. If `shouldCancelResponse: true`:
 *      - Consumer calls `ExpoPlayAudioStream.stopSound()` to halt local playback.
 *      - Consumer sends `{ type: "response.cancel" }` to halt server-side
 *        response generation.
 *      - If `shouldTruncate: true` (both `itemId` and `audioEndMs` non-null):
 *        consumer sends `{ type: "conversation.item.truncate", item_id,
 *        content_index: 0, audio_end_ms }` to synchronize the server-side
 *        transcript with what was actually played.
 *      - If `shouldTruncate: false` (defensive — `inflightItemId` or
 *        `aiSpeakingStartedAtMs` null at barge-in time): the response.cancel
 *        still fires but the truncate is skipped; consumer breadcrumbs the
 *        missing data.
 */

export interface BargeInState {
  /** Whether the AI is currently playing audio. Mirror of `state.isAiSpeaking`. */
  isAiSpeaking: boolean;
  /**
   * `item_id` of the assistant message currently being played. Set by
   * `acceptDelta` on the first audio-transcript or output-audio delta of a
   * response. Required by `conversation.item.truncate`.
   */
  inflightItemId: string | null;
  /**
   * `Date.now()` captured when the FIRST `response.output_audio.delta`
   * fired for the current response. Used to compute `audio_end_ms`. Null
   * before any audio delta of the current turn.
   */
  aiSpeakingStartedAtMs: number | null;
}

export interface BargeInDirective {
  /**
   * True if the consumer should call `ExpoPlayAudioStream.stopSound()`
   * AND send `{ type: "response.cancel" }`.
   */
  shouldCancelResponse: boolean;
  /**
   * True if the consumer should send `{ type: "conversation.item.truncate",
   * item_id, content_index: 0, audio_end_ms }`. Requires both `itemId` and
   * `audioEndMs` to be non-null.
   */
  shouldTruncate: boolean;
  /**
   * Inclusive duration in ms up to which the assistant's audio was played.
   * Computed as `now - aiSpeakingStartedAtMs`, clamped to a non-negative
   * integer (clock-skew defense). Null when `aiSpeakingStartedAtMs` is null.
   */
  audioEndMs: number | null;
  /** The `item_id` to truncate. Null when `inflightItemId` is null. */
  itemId: string | null;
}

/**
 * Compute the barge-in directive for a `speech_started` event.
 *
 * Pure function — no side effects, no DOM/audio mutation; the caller
 * dispatches the resulting events.
 */
export function computeBargeInDirective(state: BargeInState, now: number): BargeInDirective {
  if (!state.isAiSpeaking) {
    // No AI response in progress → no interrupt needed.
    return {
      shouldCancelResponse: false,
      shouldTruncate: false,
      audioEndMs: null,
      itemId: null,
    };
  }

  // AI is speaking. Always cancel; conditionally truncate.
  const audioEndMs =
    state.aiSpeakingStartedAtMs === null
      ? null
      : // Clock-skew defense: if `now < startedAt` (system clock changed
        // mid-conversation), clamp to 0 rather than emit a negative value
        // that the server would reject.
        Math.max(0, Math.floor(now - state.aiSpeakingStartedAtMs));

  const shouldTruncate = state.inflightItemId !== null && audioEndMs !== null;

  return {
    shouldCancelResponse: true,
    shouldTruncate,
    audioEndMs,
    itemId: state.inflightItemId,
  };
}
