/**
 * Story 9-8 review patches P2 / P4 / P7 — `evaluateSpeakingTasks` cardinality
 * + per-task tag + Promise.allSettled tests.
 *
 * Verifies the AC #9 cardinality contract: a single failed evaluation produces
 * exactly ONE `ai-schema-parse-failed` Sentry event (from `chatCompletionJSON`,
 * which we mock to throw a representative Zod-style error) PLUS exactly ONE
 * outer `speaking-mock-test-eval-task-N` event from this helper.
 */

import { chatCompletionJSON } from "@/src/lib/openai";
import { captureError } from "@/src/lib/sentry";

import { evaluateSpeakingTasks } from "../speaking-evaluator";
import type { SpeakingTaskEvaluation } from "../schemas/ai-responses";
import type { SpeakingTaskNumber, SpeakingTaskPromptResult } from "../prompts/speaking";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// `chatCompletionJSON` is mocked at the module boundary so we can drive
// per-task fulfillment and rejection paths deterministically.
jest.mock("../openai", () => ({
  __esModule: true,
  chatCompletionJSON: jest.fn(),
  transcribeAudio: jest.fn(),
}));

const mockedChat = chatCompletionJSON as jest.Mock;
const mockedCapture = captureError as jest.Mock;

const PROMPTS: Record<SpeakingTaskNumber, SpeakingTaskPromptResult> = {
  1: { instruction: "Task 1", promptFr: "Présentez-vous.", expectedDurationSec: 120 },
  2: { instruction: "Task 2", promptFr: "Scénario.", expectedDurationSec: 330 },
  3: { instruction: "Task 3", promptFr: "Sujet.", expectedDurationSec: 270 },
};

const TRANSCRIPTS: Record<SpeakingTaskNumber, string> = {
  1: "Je m'appelle Marc.",
  2: "Bonjour, je voudrais réserver.",
  3: "Je pense que les réseaux sociaux...",
};

function evalOf(partial: Partial<SpeakingTaskEvaluation> = {}): SpeakingTaskEvaluation {
  return {
    pronunciationFluencyScore: 16,
    vocabularyScore: 14,
    grammarScore: 15,
    interactionScore: 18,
    // Story 10-6: Sociolinguistique (5th publisher category per §6.3) is
    // required. A representative B2-level score (~16/20) for realistic fixture
    // behavior; individual cases override via `partial`.
    sociolinguisticScore: 16,
    overallScore: 79,
    strengths: ["ok"],
    improvements: ["ok"],
    ...partial,
  };
}

describe("evaluateSpeakingTasks (story 9-8 review patches P2/P4/P7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("happy path: all 3 tasks succeed → no captureError, all successes populated", async () => {
    mockedChat.mockImplementation(async (_msgs, _schema, opts: { feature: string }) => {
      const taskNum = Number(opts.feature.replace("speaking-eval-task-", ""));
      return evalOf({ overallScore: 70 + taskNum });
    });

    const result = await evaluateSpeakingTasks({
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
    });

    expect(result.failedTaskNumbers).toEqual([]);
    expect(Object.keys(result.successes).sort()).toEqual(["1", "2", "3"]);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("P4 cardinality: a single failed task produces exactly ONE captureError with the per-task tag", async () => {
    // Task 2 throws; tasks 1 + 3 succeed. The cardinality contract from AC #9
    // requires ONE outer `speaking-mock-test-eval-task-2` event.
    mockedChat.mockImplementation(async (_msgs, _schema, opts: { feature: string }) => {
      if (opts.feature === "speaking-eval-task-2") {
        throw new Error("AI schema parse failed: pronunciationFluencyScore — too_big");
      }
      return evalOf({ overallScore: 80 });
    });

    const result = await evaluateSpeakingTasks({
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
    });

    expect(result.failedTaskNumbers).toEqual([2]);
    expect(result.successes[1]).toBeDefined();
    expect(result.successes[3]).toBeDefined();
    expect(result.successes[2]).toBeUndefined();
    expect(result.failureMessage).toMatch(/AI schema parse failed/);

    // Exactly ONE captureError, and the tag is per-task (not the previous
    // ambiguous `speaking-mock-test-eval`).
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(mockedCapture).toHaveBeenCalledWith(
      expect.any(Error),
      "speaking-mock-test-eval-task-2",
      { phase: "step-eval-task" }
    );
  });

  it("P2 cost discipline: overrides bypass the LLM (no chat call for overridden tasks)", async () => {
    mockedChat.mockResolvedValue(evalOf({ overallScore: 70 }));

    const overrideEval = evalOf({ overallScore: 0, strengths: ["—"], improvements: ["skipped"] });
    const result = await evaluateSpeakingTasks({
      cefrLevel: "B2",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluationOverrides: { 1: overrideEval, 3: overrideEval },
    });

    // Only task 2 should reach `chatCompletionJSON`.
    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(mockedChat.mock.calls[0][2]).toMatchObject({ feature: "speaking-eval-task-2" });

    // Overrides flow through to `successes` unchanged.
    expect(result.successes[1]).toBe(overrideEval);
    expect(result.successes[3]).toBe(overrideEval);
    expect(result.failedTaskNumbers).toEqual([]);
  });

  it("P2 retry path: only failed tasks re-fire when overrides carry prior successes", async () => {
    // Simulate the user retrying Task 2 after it failed. Tasks 1 + 3 are passed
    // as overrides (the prior successes); only Task 2 hits the model.
    mockedChat.mockResolvedValueOnce(evalOf({ overallScore: 60 }));

    const priorSuccess = evalOf({ overallScore: 80 });
    const result = await evaluateSpeakingTasks({
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
      evaluationOverrides: { 1: priorSuccess, 3: priorSuccess },
    });

    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(result.successes[2]).toMatchObject({ overallScore: 60 });
    expect(result.failedTaskNumbers).toEqual([]);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("P2 multiple failures: each rejected task gets its own per-task captureError", async () => {
    // Tasks 1 + 3 throw, task 2 succeeds.
    mockedChat.mockImplementation(async (_msgs, _schema, opts: { feature: string }) => {
      if (opts.feature === "speaking-eval-task-2") return evalOf({ overallScore: 75 });
      throw new Error(`fail ${opts.feature}`);
    });

    const result = await evaluateSpeakingTasks({
      cefrLevel: "B1",
      prompts: PROMPTS,
      transcripts: TRANSCRIPTS,
    });

    expect(result.failedTaskNumbers.sort()).toEqual([1, 3]);
    expect(result.successes[2]).toBeDefined();
    expect(mockedCapture).toHaveBeenCalledTimes(2);
    const tags = mockedCapture.mock.calls.map((c) => c[1] as string).sort();
    expect(tags).toEqual(["speaking-mock-test-eval-task-1", "speaking-mock-test-eval-task-3"]);
  });
});
