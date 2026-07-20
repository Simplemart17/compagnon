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
  entryLessonIdForLevel,
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

  // Story 19-3: placement-aware entry point. Exercised with a MID-SPINE
  // entry id against the REAL registry (with only A1 shipped, every
  // level's entryLessonForLevel falls down to the spine start, so the
  // level→id mapping alone cannot exercise the scan semantics).
  describe("Story 19-3 — placement-aware entry", () => {
    const midEntry = "a1-u3-l1";
    const midIdx = CURRICULUM_LESSONS.findIndex((l) => l.id === midEntry);
    if (midIdx <= 0) {
      throw new Error(`Stale test fixture: mid-spine lesson "${midEntry}" no longer exists`);
    }

    it("scans FROM the entry lesson — earlier uncompleted lessons are skipped", () => {
      expect(nextLessonForUser(new Set(), midEntry)?.id).toBe(midEntry);
    });

    it("first uncompleted AT OR AFTER entry wins when the entry lesson is done", () => {
      expect(nextLessonForUser(new Set([midEntry]), midEntry)?.id).toBe(
        CURRICULUM_LESSONS[midIdx + 1].id
      );
    });

    it("never regresses below placement: everything at/after entry done → undefined, even with earlier gaps", () => {
      const fromEntryOn = new Set(CURRICULUM_LESSONS.slice(midIdx).map((l) => l.id));
      expect(nextLessonForUser(fromEntryOn, midEntry)).toBeUndefined();
    });

    it("unknown entry id falls back to the spine start", () => {
      expect(nextLessonForUser(new Set(), "z9-u1-l1")?.id).toBe(CURRICULUM_LESSONS[0].id);
    });

    it("production path today: entry at spine INDEX 0 composes through the pointer (entryIdx === 0 branch)", () => {
      // With only A1 shipped, EVERY real call is entry-at-index-0 — the
      // mid-spine cases above cannot catch a refactor wrong only in this
      // branch (review R1).
      const first = CURRICULUM_LESSONS[0];
      expect(nextLessonForUser(new Set(), entryLessonIdForLevel("A1"))?.id).toBe(first.id);
      expect(nextLessonForUser(new Set([first.id]), entryLessonIdForLevel("B1"))?.id).toBe(
        CURRICULUM_LESSONS[1].id
      );
    });

    it("entryLessonIdForLevel: undefined level (profile hydrating) → undefined; any level falls DOWN to the highest shipped level's start", () => {
      expect(entryLessonIdForLevel(undefined)).toBeUndefined();
      // With A1 as the only shipped level, every placement maps to the
      // spine start — the honest current behavior this pin documents.
      expect(entryLessonIdForLevel("A1")).toBe(CURRICULUM_LESSONS[0].id);
      expect(entryLessonIdForLevel("B1")).toBe(CURRICULUM_LESSONS[0].id);
      expect(entryLessonIdForLevel("C2")).toBe(CURRICULUM_LESSONS[0].id);
    });
  });
});
