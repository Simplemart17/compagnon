/**
 * Story 19-3 — buildTodayPlan runtime contract.
 *
 * The plan builder is pure over BriefingData (exported @internal), so the
 * guided-path ordering — the lesson item LEADS the plan — is pinned at
 * runtime without mounting the hook.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("@/src/lib/supabase", () => ({ __esModule: true, supabase: {} }));
jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock("@/src/lib/cache", () => ({
  __esModule: true,
  cacheWithFallback: jest.fn(),
  invalidateCache: jest.fn(),
  CACHE_KEYS: { HOME_AGGREGATE: "home_aggregate", DAILY_BRIEFING: "daily_briefing" },
  CACHE_TTL: { HOME_AGGREGATE: 1, DAILY_BRIEFING: 1 },
}));
jest.mock("@/src/lib/memory", () => ({
  __esModule: true,
  retrieveDailyGreetingMemories: jest.fn(),
  sanitizeMemoryContent: (t: string) => t,
}));
jest.mock("@/src/lib/home-aggregate", () => ({ __esModule: true, getHomeAggregate: jest.fn() }));

import { buildTodayPlan, type BriefingData } from "@/src/hooks/use-daily-briefing";

function baseData(overrides: Partial<BriefingData> = {}): BriefingData {
  return {
    memories: [],
    srsDueCount: 0,
    weakestSkill: null,
    errorPatterns: [],
    hasActivityToday: false,
    totalErrors: 0,
    resolvedErrors: 0,
    nextLesson: null,
    ...overrides,
  };
}

describe("Story 19-3 — buildTodayPlan", () => {
  it("the next curriculum lesson LEADS the plan and routes to the lesson player", () => {
    const plan = buildTodayPlan(
      baseData({
        nextLesson: { id: "a1-u1-l2", canDoEn: "I can say where I live" },
        srsDueCount: 5,
      })
    );
    expect(plan[0]).toMatchObject({
      id: "lesson-a1-u1-l2",
      title: "Continue your lessons",
      subtitle: "I can say where I live",
      route: "/(tabs)/practice/lesson/a1-u1-l2",
      badge: "suggested",
      iconName: "book-open",
    });
    expect(plan[1].id).toBe("srs-due");
  });

  it("no next lesson (spine done / fetch failed soft) → pre-19-3 plan shape, conversation fallback last", () => {
    const plan = buildTodayPlan(baseData());
    expect(plan.some((i) => i.id.startsWith("lesson-"))).toBe(false);
    expect(plan[plan.length - 1].id).toBe("conversation-fallback");
  });

  it("plan stays capped at 3 items with the lesson occupying a slot", () => {
    const plan = buildTodayPlan(
      baseData({
        nextLesson: { id: "a1-u1-l1", canDoEn: "I can greet people" },
        srsDueCount: 3,
        errorPatterns: [
          {
            id: "err-1",
            error_type: "grammar",
            error_description: "Confuses avoir and être",
            occurrences: 4,
            resolved: false,
          },
        ],
        weakestSkill: { skill: "listening", average_score: 40 },
      })
    );
    expect(plan).toHaveLength(3);
    expect(plan.map((i) => i.id)).toEqual(["lesson-a1-u1-l1", "srs-due", "error-err-1"]);
  });

  it("long can-do subtitles truncate for the compact plan row", () => {
    const long = "I can describe my whole family, my house, and my daily routine in detail";
    const plan = buildTodayPlan(baseData({ nextLesson: { id: "a1-u2-l1", canDoEn: long } }));
    expect(plan[0].subtitle.length).toBeLessThanOrEqual(48);
    expect(plan[0].subtitle.endsWith("...")).toBe(true);
  });
});
