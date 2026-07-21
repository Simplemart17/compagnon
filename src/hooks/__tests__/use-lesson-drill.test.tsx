/**
 * Story 19-2 (drill slice) — useLessonDrill state machine, LIVE-GENERATION
 * (fallback) path.
 *
 * Runtime contract via react-test-renderer + a mocked chatCompletionJSON:
 * generation, answer scoring, advancement, completion analytics, the
 * double-tap guard, and the error path.
 *
 * Story 19-4: this suite fixtures on an UN-banked lesson (a1-u2-l1) so it
 * exercises the AI fallback. The curated-bank path (which serves items with
 * NO AI call) is covered in use-lesson-drill-item-bank.test.tsx.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

const mockChatCompletionJSON = jest.fn();

jest.mock("@/src/lib/openai", () => ({
  __esModule: true,
  chatCompletionJSON: (...args: unknown[]) => mockChatCompletionJSON(...args),
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("@/src/lib/analytics", () => {
  // Review R1: spread the REAL taxonomy + banding — a production event
  // rename or band change must fail this suite, not pass a stale literal.
  const actual = jest.requireActual<typeof import("@/src/lib/analytics")>("@/src/lib/analytics");
  return {
    __esModule: true,
    ANALYTICS_EVENTS: actual.ANALYTICS_EVENTS,
    scoreBand: actual.scoreBand,
    trackEvent: jest.fn(),
  };
});

import { act } from "react-test-renderer";

import { useLessonDrill, type UseLessonDrillReturn } from "@/src/hooks/use-lesson-drill";
import { getLesson, getUnitForLesson } from "@/src/lib/curriculum";
import { getItemBank } from "@/src/lib/item-bank";
import { captureError } from "@/src/lib/sentry";
import { trackEvent } from "@/src/lib/analytics";
import { mountWithAct, registerMountCleanup } from "@/src/test-utils/react-test-renderer";

registerMountCleanup();

// Story 19-4: fixture on an UN-banked lesson so generate() takes the live-AI
// fallback path (a1-u1-* now ship curated banks).
const AI_FIXTURE_ID = "a1-u2-l1";
const maybeLesson = getLesson(AI_FIXTURE_ID);
if (!maybeLesson) {
  throw new Error(`Stale test fixture: curriculum lesson "${AI_FIXTURE_ID}" no longer exists`);
}
// Review R1: fail LOUD if a future 19.4 slice banks this fixture — otherwise
// generate() would silently take the bank path and this whole suite would
// stop exercising the live-AI branch (with confusing scoring errors, not a
// clear "you banked the fixture"). Mirrors the banked suite's premise guard.
if (getItemBank(AI_FIXTURE_ID)) {
  throw new Error(
    `Fixture "${AI_FIXTURE_ID}" now ships an item bank — this AI-path suite needs an UN-banked lesson; pick another.`
  );
}
const LESSON = maybeLesson;

function q(correctId: string) {
  return {
    question: "Je ___ Marie.",
    options: [
      { id: "a", text: "suis", isCorrect: correctId === "a" },
      { id: "b", text: "es", isCorrect: correctId === "b" },
      { id: "c", text: "est", isCorrect: correctId === "c" },
      { id: "d", text: "ai", isCorrect: correctId === "d" },
    ],
    explanation: "With je, être is suis.",
  };
}

function HookHost({ onReturn }: { onReturn: (r: UseLessonDrillReturn) => void }) {
  onReturn(useLessonDrill(LESSON));
  return null;
}

function mountHook() {
  const ref: { current: UseLessonDrillReturn | null } = { current: null };
  mountWithAct(<HookHost onReturn={(r) => (ref.current = r)} />);
  return ref as { current: UseLessonDrillReturn };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockChatCompletionJSON.mockResolvedValue({ questions: [q("a"), q("b"), q("c")] });
});

describe("Story 19-2 — useLessonDrill", () => {
  it("generate: idle → generating → active with 3 questions; prompt + schema + options wired", async () => {
    const ref = mountHook();
    expect(ref.current.state.kind).toBe("idle");
    await act(async () => {
      await ref.current.generate();
    });
    expect(ref.current.state.kind).toBe("active");
    const [messages, , opts] = mockChatCompletionJSON.mock.calls[0] as [
      { role: string; content: string }[],
      unknown,
      { maxTokens: number; feature: string; temperature: number },
    ];
    expect(messages[0].content).toContain(LESSON.grammarTarget);
    expect(opts).toEqual({ temperature: 0.4, maxTokens: 900, feature: "lesson-drill" });
  });

  it("select scores once and locks; next advances; finishing emits ONE banded exercise_completed", async () => {
    const ref = mountHook();
    await act(async () => {
      await ref.current.generate();
    });
    // Q1: correct (a). Second select while showResult is a no-op — the
    // score AND the highlighted selection must both stay locked (review R1).
    act(() => ref.current.select("a"));
    act(() => ref.current.select("d"));
    let s = ref.current.state;
    expect(s.kind === "active" && s.correctCount).toBe(1);
    expect(s.kind === "active" && s.selected).toBe("a");
    act(() => ref.current.next());
    // Q2: wrong (correct is b).
    act(() => ref.current.select("d"));
    act(() => ref.current.next());
    // Q3: correct (c).
    act(() => ref.current.select("c"));
    act(() => ref.current.next());
    s = ref.current.state;
    expect(s).toEqual({ kind: "done", correctCount: 2, total: 3 });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    // Review R1: the level is DERIVED from the lesson's unit, never a
    // hardcoded "A1" (the 21-2 R2 banding-bug class).
    expect(trackEvent).toHaveBeenCalledWith("exercise_completed", {
      skill: "grammar",
      cefr_level: getUnitForLesson(LESSON.id)!.level,
      score_band: "51-75", // 2/3 → 67
    });
  });

  it("a SECOND round ('New round') emits its own completion event — the per-round guard resets", async () => {
    const ref = mountHook();
    for (let round = 0; round < 2; round++) {
      await act(async () => {
        await ref.current.generate();
      });
      act(() => ref.current.select("a"));
      act(() => ref.current.next());
      act(() => ref.current.select("b"));
      act(() => ref.current.next());
      act(() => ref.current.select("c"));
      act(() => ref.current.next());
      expect(ref.current.state.kind).toBe("done");
    }
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });

  it("double-tap guard: concurrent generate() calls fire ONE completion request", async () => {
    const ref = mountHook();
    let resolveCall!: (v: unknown) => void;
    mockChatCompletionJSON.mockImplementation(
      () => new Promise((resolve) => (resolveCall = resolve))
    );
    await act(async () => {
      const p1 = ref.current.generate();
      const p2 = ref.current.generate();
      resolveCall({ questions: [q("a"), q("b"), q("c")] });
      await Promise.all([p1, p2]);
    });
    expect(mockChatCompletionJSON).toHaveBeenCalledTimes(1);
  });

  it("generation failure → error state + captureError with the lesson id; reset returns to idle", async () => {
    const ref = mountHook();
    mockChatCompletionJSON.mockRejectedValue(new Error("schema parse failed"));
    await act(async () => {
      await ref.current.generate();
    });
    expect(ref.current.state.kind).toBe("error");
    expect(captureError).toHaveBeenCalledWith(expect.anything(), "lesson-drill-generate", {
      lessonId: LESSON.id,
    });
    act(() => ref.current.reset());
    expect(ref.current.state.kind).toBe("idle");
  });

  it("select before showResult only; next before select is a no-op", async () => {
    const ref = mountHook();
    await act(async () => {
      await ref.current.generate();
    });
    act(() => ref.current.next()); // no-op: nothing selected yet
    expect(ref.current.state.kind === "active" && ref.current.state.index).toBe(0);
  });
});
