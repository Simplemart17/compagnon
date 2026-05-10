/**
 * TCF Canada Expression Orale per-task evaluation chain.
 *
 * Story 9-8 — extracted from `app/(tabs)/mock-test/speaking.tsx` so the
 * Promise.allSettled + per-task `-task-N` Sentry tag emission can be unit-
 * tested in isolation (no React harness required). The screen calls this
 * helper after all 3 transcripts are captured (or on retry of failed tasks).
 *
 * Story 9-8 review patches P2 / P4 / P7.
 */

import { chatCompletionJSON } from "@/src/lib/openai";
import {
  speakingTaskEvaluationSchema,
  type SpeakingTaskEvaluation,
} from "@/src/lib/schemas/ai-responses";
import { captureError } from "@/src/lib/sentry";
import { buildSpeakingEvaluatorPrompt } from "@/src/lib/prompts/speaking";
import type { CEFRLevel } from "@/src/types/cefr";
import type { SpeakingTaskNumber, SpeakingTaskPromptResult } from "@/src/lib/prompts/speaking";

const TASK_NUMBERS: SpeakingTaskNumber[] = [1, 2, 3];

export interface EvaluateSpeakingTasksParams {
  cefrLevel: CEFRLevel;
  prompts: Record<SpeakingTaskNumber, SpeakingTaskPromptResult>;
  transcripts: Record<SpeakingTaskNumber, string>;
  /**
   * Per-task evaluation overrides. Tasks with overrides skip the LLM call
   * entirely and use the supplied evaluation directly. Used for:
   *   - Skipped tasks (zero evaluation injected by the screen) — P3.
   *   - Retries that re-fire only the failing tasks (cost discipline) — P2.
   */
  evaluationOverrides?: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>>;
}

export interface EvaluateSpeakingTasksResult {
  /** Successful per-task evaluations (includes overrides + LLM successes). */
  successes: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>>;
  /** Tasks whose LLM evaluation rejected (one captureError per failed task). */
  failedTaskNumbers: SpeakingTaskNumber[];
  /** Last failure message — surfaced to the user on the evaluation-failed screen. */
  failureMessage: string;
}

/**
 * Evaluate up to 3 speaking tasks in parallel via `chatCompletionJSON`. Tasks
 * present in `evaluationOverrides` skip the LLM call. Each rejected LLM call
 * fires exactly one `captureError(_, "speaking-mock-test-eval-task-${n}",
 * { phase: "step-eval-task" })` event — pairs with the `ai-schema-parse-failed`
 * event from `chatCompletionJSON` per the AC #9 cardinality contract.
 *
 * NEVER throws. Returns a result object the caller renders the
 * `evaluation-failed` UI from, or proceeds to persistence with.
 */
export async function evaluateSpeakingTasks(
  params: EvaluateSpeakingTasksParams
): Promise<EvaluateSpeakingTasksResult> {
  const { cefrLevel, prompts, transcripts, evaluationOverrides = {} } = params;

  const tasksToEvaluate = TASK_NUMBERS.filter((n) => !evaluationOverrides[n]);

  const settled = await Promise.allSettled(
    tasksToEvaluate.map(async (taskNumber) => {
      const taskPrompt = prompts[taskNumber];
      const transcript = transcripts[taskNumber];
      const evaluation = await chatCompletionJSON(
        [
          {
            role: "system",
            content: buildSpeakingEvaluatorPrompt({
              cefrLevel,
              taskNumber,
              taskInstruction: taskPrompt.instruction,
              transcript,
            }),
          },
        ],
        speakingTaskEvaluationSchema,
        { temperature: 0.3, maxTokens: 1024, feature: `speaking-eval-task-${taskNumber}` }
      );
      return { taskNumber, evaluation };
    })
  );

  const successes: Partial<Record<SpeakingTaskNumber, SpeakingTaskEvaluation>> = {
    ...evaluationOverrides,
  };
  const failedTaskNumbers: SpeakingTaskNumber[] = [];
  let failureMessage = "Could not evaluate your responses.";

  settled.forEach((result, idx) => {
    const taskNumber = tasksToEvaluate[idx];
    if (result.status === "fulfilled") {
      successes[result.value.taskNumber] = result.value.evaluation;
    } else {
      failedTaskNumbers.push(taskNumber);
      // P4: per-task `-task-N` tag (not the previous ambiguous
      // `speaking-mock-test-eval`). One captureError per failure pairs with
      // the `ai-schema-parse-failed` event from `chatCompletionJSON` for the
      // AC #9 cardinality contract.
      captureError(result.reason, `speaking-mock-test-eval-task-${taskNumber}`, {
        phase: "step-eval-task",
      });
      if (result.reason instanceof Error) failureMessage = result.reason.message;
    }
  });

  return { successes, failedTaskNumbers, failureMessage };
}
