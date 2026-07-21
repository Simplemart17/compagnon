/**
 * Story 19-4 — useLessonDrill CURATED-BANK path.
 *
 * A banked lesson (a1-u1-l1 ships an item bank) serves pre-authored items
 * INSTANTLY — no "generating" state, no chatCompletionJSON call — and
 * rotates items across rounds. The live-AI fallback path is covered in
 * use-lesson-drill.test.tsx (fixtured on an un-banked lesson).
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
import { getLesson } from "@/src/lib/curriculum";
import { getItemBank } from "@/src/lib/item-bank";
import { trackEvent } from "@/src/lib/analytics";
import { mountWithAct, registerMountCleanup } from "@/src/test-utils/react-test-renderer";

registerMountCleanup();

const BANKED_ID = "a1-u1-l1";
const maybeLesson = getLesson(BANKED_ID);
if (!maybeLesson) {
  throw new Error(`Stale test fixture: curriculum lesson "${BANKED_ID}" no longer exists`);
}
const LESSON = maybeLesson;

function HookHost({ onReturn }: { onReturn: (r: UseLessonDrillReturn) => void }) {
  onReturn(useLessonDrill(LESSON));
  return null;
}

function mountHook() {
  const ref: { current: UseLessonDrillReturn | null } = { current: null };
  mountWithAct(<HookHost onReturn={(r) => (ref.current = r)} />);
  return ref as { current: UseLessonDrillReturn };
}

function questionsOf(r: { current: UseLessonDrillReturn }): string[] {
  const s = r.current.state;
  return s.kind === "active" ? s.questions.map((q) => q.question) : [];
}

beforeEach(() => jest.clearAllMocks());

describe("Story 19-4 — useLessonDrill (curated bank)", () => {
  it("a1-u1-l1 actually ships a bank (guards this suite's premise)", () => {
    expect(getItemBank(BANKED_ID)).toBeDefined();
  });

  it("generate serves 3 bank items instantly — no 'generating' state, no AI call", async () => {
    const ref = mountHook();
    await act(async () => {
      await ref.current.generate();
    });
    expect(ref.current.state.kind).toBe("active");
    expect(questionsOf(ref)).toHaveLength(3);
    expect(mockChatCompletionJSON).not.toHaveBeenCalled();
  });

  it("rotates items across rounds — a second 'New round' shows different items", async () => {
    const ref = mountHook();
    await act(async () => {
      await ref.current.generate();
    });
    const round0 = questionsOf(ref);
    // Complete round 0.
    for (let i = 0; i < 3; i++) {
      act(() => ref.current.select("a"));
      act(() => ref.current.next());
    }
    // "New round".
    await act(async () => {
      await ref.current.generate();
    });
    const round1 = questionsOf(ref);
    expect(round1).toHaveLength(3);
    // Rotation → the two rounds are disjoint contiguous windows (bank ≥ 6).
    expect(round0).not.toEqual(round1);
    expect(round0.some((q) => round1.includes(q))).toBe(false);
    expect(mockChatCompletionJSON).not.toHaveBeenCalled();
  });

  it("scoring + completion analytics still fire on the bank path", async () => {
    const ref = mountHook();
    await act(async () => {
      await ref.current.generate();
    });
    // Answer all three with the true correct option so the score is deterministic.
    for (let i = 0; i < 3; i++) {
      const s = ref.current.state;
      const correctId =
        s.kind === "active"
          ? (s.questions[s.index].options.find((o) => o.isCorrect)?.id ?? "a")
          : "a";
      act(() => ref.current.select(correctId));
      act(() => ref.current.next());
    }
    expect(ref.current.state).toEqual({ kind: "done", correctCount: 3, total: 3 });
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("exercise_completed", {
      skill: "grammar",
      cefr_level: "A1",
      score_band: "76-100",
    });
  });
});
