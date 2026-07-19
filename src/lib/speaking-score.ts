/**
 * Realtime conversation speaking-score formula — Story 11-1.
 *
 * SEMANTICS (Story 20-4 speaking-honesty contract): this number is a
 * FLUENCY-PRACTICE heuristic — a corrections-per-utterance ratio from the
 * conversation transcript. It is NOT a pronunciation or exam-grade speaking
 * assessment: the pipeline never hears audio (corrections arrive via the
 * `report_correction` tool-call on transcribed text), so articulation,
 * intonation, and accent are structurally invisible to it. It feeds
 * `skill_progress.speaking` as PRACTICE evidence for the promotion engine
 * (Story 9-2) alongside exam-graded Expression Orale mock-test scores; the
 * conversation feedback sheet labels it accordingly ("Practice metrics from
 * this conversation — not an exam speaking score").
 *
 * Pure helper extracted from `src/hooks/use-realtime-voice.ts:657-662` so
 * the formula can be:
 *   1. Unit-tested without rendering the hook.
 *   2. Pinned to a baseline that any future tuning story has to diff against.
 *
 * Behavior unchanged by Story 11-1 — but the INPUT (`correctedEntries`) is
 * now more accurate post-11-1 because corrections arrive via the
 * `report_correction` tool-call instead of the brittle regex parser which
 * silently zeroed out when the model used non-ASCII quotes / nested parens
 * / paraphrased corrections. The same conversation will produce a slightly
 * lower (more accurate) speaking score post-11-1 than pre-11-1; this is a
 * correctness improvement, not a regression.
 *
 * Formula:
 *   - 0 user entries → 70 (default, "no signal")
 *   - 0 corrections out of N user entries → 100 (perfect)
 *   - N corrections out of N user entries → max(20, 100 - 30) = 70
 *   - 5 corrections out of 10 user entries → max(20, 100 - 15) = 85
 *   - Penalty cap: 30 points off when corrections == utterances (rare)
 *   - Floor: 20 (so even a session with many more corrections than
 *     utterances — which shouldn't happen but could in degenerate cases —
 *     doesn't drop below 20)
 */

/**
 * Compute the conversation-end speaking score from the user-utterance
 * count and the AI correction count.
 *
 * @param totalUserEntries — number of user-role TranscriptEntry rows
 *   (the denominator; floor of 1 to prevent division-by-zero, but a
 *   zero-utterance session takes the default branch)
 * @param correctedEntries — number of Correction objects accumulated
 *   during the session (from `report_correction` tool-call invocations
 *   post-Story-11-1; from the regex parser pre-Story-11-1)
 * @returns integer 0-100 score, floored at 20 (with the 70 default for
 *   zero-utterance sessions)
 */
export function computeSpeakingScore(totalUserEntries: number, correctedEntries: number): number {
  if (totalUserEntries <= 0) {
    return 70;
  }
  const ratio = correctedEntries / Math.max(totalUserEntries, 1);
  return Math.max(20, Math.round(100 - ratio * 30));
}
