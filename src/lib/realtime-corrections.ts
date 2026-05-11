/**
 * Realtime correction-protocol helpers — Story 11-1.
 *
 * Pure functions that implement the `report_correction` Realtime tool-call
 * pipeline outside React. Extracted from `src/hooks/use-realtime-voice.ts`
 * so the tool-call handler behavior can be unit-tested without mounting
 * the hook or mocking a WebSocket.
 *
 * Lifecycle:
 *   1. The Realtime model invokes `report_correction({...})` during an AI
 *      turn. The hook routes the event to `processReportCorrectionCall`
 *      which `safeParse`s the args, returns either `outcome: "recorded"`
 *      with the validated Correction or `outcome: "invalid"` with a
 *      diagnostic result message. The hook then pushes (on success) and
 *      sends the result message back via `sendFunctionResult`.
 *   2. On the terminal `response.output_audio_transcript.done`, the hook's
 *      `parseCorrections` callback drains the buffer via
 *      `drainPendingCorrections` and `appendIfNew` (Story 9-5 pure helper)
 *      attaches the drained corrections to the assistant TranscriptEntry.
 *   3. On `response.done` and `case "error"`, the hook drains any orphan
 *      corrections into `correctionsRef.current` (so the post-conversation
 *      pipeline still sees them) and then resets the buffer to `[]`.
 *
 * The Realtime path does NOT use Story 9-7's `chatCompletionJSON` retry
 * loop because the Realtime session has no single-call retry surface;
 * one-shot safeParse + breadcrumb + reject-via-function-output lets the
 * model self-correct on its next invocation. The result message includes
 * the issue path so the model has a concrete signal to fix.
 */

import type { ZodIssueCode } from "zod";

import type { Correction } from "@/src/types/conversation";
import { reportCorrectionArgsSchema } from "@/src/lib/schemas/ai-responses";

/**
 * Per-turn upper bound on accumulated `report_correction` tool-calls. A
 * single AI turn rarely exceeds 3–4 corrections; the cap exists to defend
 * against a runaway model that spams the tool. When reached, additional
 * invocations are rejected with a Sentry breadcrumb and the model receives
 * a bounded result message so it can self-correct.
 *
 * Story 11-1 review patch P9.
 */
export const MAX_PENDING_CORRECTIONS = 20;

/**
 * Short, lowercase function-call result string. The OpenAI Realtime API
 * feeds `function_call_output` back to the model as context for its
 * continuing response. Sending a verbose acknowledgment like "Correction
 * recorded." risks the model echoing the phrase in its audio output. A
 * short lowercase token like `"ok"` is unambiguously NOT a phrase the
 * model would surface in its spoken French response. Story 11-1 review
 * patch P8.
 */
export const FUNCTION_RESULT_ACK = "ok";

/**
 * Outcome of processing a `report_correction` tool-call invocation.
 *
 * - `outcome: "recorded"` — args parsed cleanly; the correction is in
 *   `correction`. The hook pushes it to `pendingToolCorrectionsRef.current`
 *   and calls `sendFunctionResult(callId, resultMessage)`.
 * - `outcome: "invalid"` — args failed Zod validation. The hook fires a
 *   Sentry breadcrumb with `feature: "realtime-report-correction"` + the
 *   `issueCode`, then calls `sendFunctionResult(callId, resultMessage)`
 *   so the model can self-correct on its next invocation. The result
 *   message includes the issue path (e.g., "category") so the model has
 *   a concrete signal to fix.
 */
export type ProcessReportCorrectionResult =
  | { outcome: "recorded"; correction: Correction; resultMessage: string }
  | {
      outcome: "invalid";
      issueCode: ZodIssueCode | "unknown";
      resultMessage: string;
    };

/**
 * Process the args payload of a `report_correction` tool-call invocation.
 *
 * @param parsed - the JSON-parsed args object the Realtime API delivers.
 *   The caller is responsible for `JSON.parse(event.arguments)`; this
 *   function handles arbitrary `unknown` input via `safeParse`.
 */
export function processReportCorrectionCall(parsed: unknown): ProcessReportCorrectionResult {
  const result = reportCorrectionArgsSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const code: ZodIssueCode | "unknown" = firstIssue?.code ?? "unknown";
    // Include the issue path (e.g., "category" or "original") so the model
    // can self-correct on its next invocation. Field name is bounded
    // (schema field names are short literals) so this is allowlist-safe
    // under the Sentry 80-char redaction rule even though it isn't logged
    // to Sentry directly — the result message is sent back to the model
    // as function_call_output, not to Sentry. Story 11-1 review patch P6.
    const path =
      firstIssue?.path && firstIssue.path.length > 0 ? firstIssue.path.join(".") : "args";
    return {
      outcome: "invalid",
      issueCode: code,
      resultMessage: `Rejected: invalid-shape. Issue: ${code} at ${path}. Correction not recorded. Check field names + types + the 4-literal category enum.`,
    };
  }
  return {
    outcome: "recorded",
    correction: result.data,
    resultMessage: FUNCTION_RESULT_ACK,
  };
}

/**
 * Drain the per-turn correction buffer.
 *
 * Truncates the passed-in array in place (via `length = 0`) AND returns a
 * defensive copy of its prior contents. Two return-shape invariants the
 * callers can rely on:
 *
 *   - **The buffer is empty after the call** — the hook's `parseCorrections`
 *     callback relies on this so subsequent `pendingToolCorrectionsRef.current.push`
 *     invocations from a new turn's tool-calls land in the (now-empty)
 *     same array.
 *   - **The returned array is a fresh copy** — callers (e.g., the hook's
 *     `case "response.done"` orphan-drain path that merges drained
 *     corrections into `correctionsRef.current`) can mutate the returned
 *     array without affecting the original buffer.
 *
 * Idempotent on an empty buffer (returns `[]`).
 *
 * Story 11-1 review patch P4: documented the defensive-copy + in-place
 * truncation contract explicitly so future maintainers can rely on both
 * invariants.
 */
export function drainPendingCorrections(buffer: Correction[]): Correction[] {
  const drained = buffer.slice();
  buffer.length = 0;
  return drained;
}

/**
 * Merge orphan tool-call corrections from the per-turn pending buffer into
 * the conversation-level corrections list, returning the new conversation
 * list and a boolean indicating whether a Sentry breadcrumb should fire.
 *
 * Pure-helper extraction of the `case "response.done"` and `case "error"`
 * orphan-drain pattern from `use-realtime-voice.ts`. Story 11-1 review-
 * round-2 patch P18 extracted this so the high-risk orphan-drain code path
 * (which silently preserves user-correction data on the error / no-audio
 * paths) is unit-testable.
 *
 * Mutates `buffer` in place (drained to empty) and returns a NEW
 * conversation array (input `conversation` is not mutated).
 *
 * Contract:
 *   - Empty buffer → returns the input conversation unchanged + breadcrumb
 *     suppressed.
 *   - Non-empty buffer → returns `[...conversation, ...drained]` with the
 *     buffer emptied + breadcrumb-fire signal true.
 *   - Idempotent on repeated invocation with the same empty buffer.
 */
export function mergeOrphanCorrections(
  conversation: Correction[],
  buffer: Correction[]
): { conversation: Correction[]; shouldBreadcrumb: boolean } {
  if (buffer.length === 0) {
    return { conversation, shouldBreadcrumb: false };
  }
  const drained = drainPendingCorrections(buffer);
  return {
    conversation: [...conversation, ...drained],
    shouldBreadcrumb: true,
  };
}
