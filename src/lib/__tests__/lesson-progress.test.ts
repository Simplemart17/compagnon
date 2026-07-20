/**
 * Story 19-2 — lesson progress persistence + resume pointer.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

const mockUpsert = jest.fn();
const mockSelectEq = jest.fn();
// R1: capture the table name — pre-R1 the mock discarded it, so a typo'd
// table string passed every test while production silently 404'd.
const mockFrom = jest.fn();

jest.mock("@/src/lib/supabase", () => ({
  __esModule: true,
  supabase: {
    from: (table: string) => {
      mockFrom(table);
      return {
        upsert: (...args: unknown[]) => mockUpsert(...args),
        select: () => ({ eq: (...args: unknown[]) => mockSelectEq(...args) }),
      };
    },
  },
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { CURRICULUM_LESSONS } from "@/src/lib/curriculum";
import {
  getCompletedLessonIds,
  markLessonCompleted,
  nextLessonForUser,
} from "@/src/lib/lesson-progress";
import { captureError } from "@/src/lib/sentry";

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
  mockSelectEq.mockResolvedValue({ data: [], error: null });
});

describe("Story 19-2 — markLessonCompleted", () => {
  it("upserts idempotently on (user_id, lesson_id)", async () => {
    await markLessonCompleted("user-1", "a1-u1-l1");
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: "user-1", lesson_id: "a1-u1-l1" },
      { onConflict: "user_id,lesson_id", ignoreDuplicates: true }
    );
    expect(mockFrom).toHaveBeenCalledWith("lesson_progress");
    expect(captureError).not.toHaveBeenCalled();
  });

  it("fail-soft: a Postgres error routes to captureError and never throws (fire-and-forget contract)", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "RLS denied" } });
    await expect(markLessonCompleted("user-1", "a1-u1-l1")).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), "lesson-progress-mark", {
      lessonId: "a1-u1-l1",
    });
  });
});

describe("Story 19-2 — getCompletedLessonIds", () => {
  it("returns the id set", async () => {
    mockSelectEq.mockResolvedValue({
      data: [{ lesson_id: "a1-u1-l1" }, { lesson_id: "a1-u1-l2" }],
      error: null,
    });
    const ids = await getCompletedLessonIds("user-1");
    expect(ids).toEqual(new Set(["a1-u1-l1", "a1-u1-l2"]));
    expect(mockFrom).toHaveBeenCalledWith("lesson_progress");
  });

  it("fail-soft: errors yield an EMPTY set (spine renders not-started, surface never blocks)", async () => {
    mockSelectEq.mockResolvedValue({ data: null, error: { message: "offline" } });
    const ids = await getCompletedLessonIds("user-1");
    expect(ids.size).toBe(0);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), "lesson-progress-fetch");
  });
});

describe("Story 19-2 — nextLessonForUser (pure resume pointer)", () => {
  it("empty set → the first spine lesson", () => {
    expect(nextLessonForUser(new Set())?.id).toBe(CURRICULUM_LESSONS[0].id);
  });

  it("skips completed lessons to the first gap — even out-of-order completions", () => {
    // Completing l1 + l3 (l2 skipped via direct navigation) resumes at l2.
    const completed = new Set([CURRICULUM_LESSONS[0].id, CURRICULUM_LESSONS[2].id]);
    expect(nextLessonForUser(completed)?.id).toBe(CURRICULUM_LESSONS[1].id);
  });

  it("all shipped content completed → undefined (ahead of the curriculum)", () => {
    expect(nextLessonForUser(new Set(CURRICULUM_LESSONS.map((l) => l.id)))).toBeUndefined();
  });
});
