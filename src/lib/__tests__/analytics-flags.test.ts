/**
 * Story 21-2/21-3 — PostHog analytics wrapper + feature flags.
 *
 * Runtime cases: the no-op guard (unconfigured/test env), the event
 * taxonomy pins, scoreBand boundaries, and the FAIL-OPEN flag defaults
 * (a kill switch must never brick offline/unconfigured users — Story 11-4
 * fail-OPEN precedent). Drift cases pin the emission points + the privacy
 * contract surfaces.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  ANALYTICS_EVENTS,
  isAnalyticsEnabled,
  getAnalyticsClient,
  identifyUser,
  resetAnalytics,
  scoreBand,
  trackEvent,
} from "@/src/lib/analytics";
import { FEATURE_FLAGS, FLAG_DEFAULTS, isFeatureEnabled } from "@/src/lib/feature-flags";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 21-2 — analytics wrapper", () => {
  it("taxonomy: six stable snake_case events", () => {
    expect(Object.values(ANALYTICS_EVENTS).sort()).toEqual([
      "app_opened",
      "conversation_completed",
      "conversation_started",
      "exercise_completed",
      "mock_test_completed",
      "nudge_opened",
    ]);
    for (const name of Object.values(ANALYTICS_EVENTS)) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("test/unconfigured runtime: analytics disabled, client null, every call a silent no-op", () => {
    // JEST_WORKER_ID is set in this process — the guard must catch it even
    // if a key leaks into the test env.
    expect(isAnalyticsEnabled()).toBe(false);
    expect(getAnalyticsClient()).toBeNull();
    expect(() => trackEvent(ANALYTICS_EVENTS.APP_OPENED)).not.toThrow();
    expect(() => identifyUser("user-123")).not.toThrow();
    expect(() => resetAnalytics()).not.toThrow();
  });

  it("scoreBand boundaries", () => {
    expect(scoreBand(0)).toBe("0-25");
    expect(scoreBand(25)).toBe("0-25");
    expect(scoreBand(26)).toBe("26-50");
    expect(scoreBand(50)).toBe("26-50");
    expect(scoreBand(51)).toBe("51-75");
    expect(scoreBand(75)).toBe("51-75");
    expect(scoreBand(76)).toBe("76-100");
    expect(scoreBand(100)).toBe("76-100");
  });
});

describe("Story 21-3 — feature flags (FAIL-OPEN contract)", () => {
  it("kill-switch-class flags default TRUE; experiment-class default FALSE", () => {
    expect(FLAG_DEFAULTS[FEATURE_FLAGS.AI_CONVERSATIONS_ENABLED]).toBe(true);
    expect(FLAG_DEFAULTS[FEATURE_FLAGS.REALTIME_FULL_MODEL]).toBe(false);
  });

  it("unconfigured client → isFeatureEnabled returns the local default (fail-open exercised for real)", () => {
    // In the Jest runtime getAnalyticsClient() is null, so this executes
    // the exact fallback path an offline/unconfigured production user hits.
    expect(isFeatureEnabled(FEATURE_FLAGS.AI_CONVERSATIONS_ENABLED)).toBe(true);
    expect(isFeatureEnabled(FEATURE_FLAGS.REALTIME_FULL_MODEL)).toBe(false);
  });
});

describe("Story 21-2/21-3 — emission-point + privacy drift pins", () => {
  it("realtime.ts: pinned MODEL constant intact + SESSION-PINNED model at both consumption sites (R1)", () => {
    const src = readSrc("src/lib/realtime.ts");
    // The Story 11-5 P10 cost-table pin regex must keep matching (first
    // `const MODEL =` in the file is the mini constant).
    expect(src).toMatch(/const MODEL = "gpt-realtime-mini"/);
    expect(src).toMatch(/const FULL_MODEL = "gpt-realtime"/);
    // R1: the model is resolved ONCE per session in connect() and PINNED —
    // per-site resolution could mint a token for one model and connect
    // with another, or silently swap models across a reconnect.
    expect(src).toMatch(/this\.sessionModel = getRealtimeModel\(\)/);
    expect(src).toMatch(/model: this\.sessionModel \?\? getRealtimeModel\(\)/);
    expect(src).toMatch(/\?model=\$\{this\.sessionModel \?\? getRealtimeModel\(\)\}/);
    // NEGATIVE: no direct MODEL consumption remains.
    expect(src).not.toMatch(/model: MODEL,/);
  });

  it("R1: feature-flags reads getFeatureFlagResult (missing-flag-safe), never bare isFeatureEnabled", () => {
    const src = readSrc("src/lib/feature-flags.ts");
    // v4 isFeatureEnabled returns FALSE for a MISSING flag once ≥1 flag is
    // loaded — an uncreated kill-switch key would brick the feature
    // app-wide through the exact mechanism meant to prevent that.
    expect(src).toMatch(/client\.getFeatureFlagResult\(flag\)/);
    expect(src).not.toMatch(/client\.isFeatureEnabled\(/);
  });

  it("R1: SDK privacy options — sendFeatureFlagEvent disabled; HOST uses || (empty-string-safe)", () => {
    const src = readSrc("src/lib/analytics.ts");
    expect(src).toMatch(/sendFeatureFlagEvent: false/);
    // CI injects "" for unset secrets; ?? would accept the empty host and
    // ship analytics-dead builds silently.
    // (Pattern stops before the URL — the test's comment-stripper eats
    // the `//` inside the string literal.)
    expect(src).toMatch(/EXPO_PUBLIC_POSTHOG_HOST \|\|/);
    expect(src).not.toMatch(/EXPO_PUBLIC_POSTHOG_HOST \?\?/);
  });

  it("R1: _layout resets identity ONLY on an identified→signed-out transition (funnel-preserving)", () => {
    const src = readSrc("app/_layout.tsx");
    expect(src).toMatch(/lastIdentifiedIdRef\.current !== null/);
  });

  it("R1: conversation lifecycle is status-transition-driven — started on connected; completed on BOTH terminal states with terminated_by", () => {
    const src = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(src).toMatch(/conversation\.status === "connected" && !hasTrackedStartRef\.current/);
    expect(src).toMatch(
      /conversation\.status === "ended" \|\| conversation\.status === "disconnected"/
    );
    expect(src).toMatch(/terminated_by/);
    // NEGATIVE: no pre-start emission in handleStart (overcounted by the
    // retry/connect-failure rate).
    const handleStart = src.slice(src.indexOf("const handleStart"), src.indexOf("const handleEnd"));
    expect(handleStart).not.toContain("CONVERSATION_STARTED");
  });

  it("R1: exercise capture sits ABOVE the offline early-return; speaking route emits mock_test_completed on the 0-20 scale", () => {
    const exercise = readSrc("src/hooks/use-exercise.ts");
    const captureIdx = exercise.indexOf("ANALYTICS_EVENTS.EXERCISE_COMPLETED");
    const persistIdx = exercise.indexOf('from("exercises").insert');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(persistIdx);
    const speaking = readSrc("app/(tabs)/mock-test/speaking.tsx");
    expect(speaking).toMatch(/ANALYTICS_EVENTS\.MOCK_TEST_COMPLETED/);
    // Story 20-4 R2: compositeOverall is ALREADY 0-100 — banding it directly
    // is correct; the pre-R2 `/20 × 100` inflated the band input ×5 and
    // top-banded every speaking completion.
    expect(speaking).toMatch(/scoreBand\(Math\.round\(summary\.compositeOverall\)\)/);
    expect(speaking).not.toMatch(/compositeOverall \/ 20/);
  });

  it("[sessionId]: kill switch gates handleStart + both conversation events fire", () => {
    const src = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(src).toMatch(/isFeatureEnabled\(FEATURE_FLAGS\.AI_CONVERSATIONS_ENABLED\)/);
    expect(src).toMatch(/ANALYTICS_EVENTS\.CONVERSATION_STARTED/);
    expect(src).toMatch(/ANALYTICS_EVENTS\.CONVERSATION_COMPLETED/);
  });

  it("_layout: app_opened once + identify/reset lifecycle wired", () => {
    const src = readSrc("app/_layout.tsx");
    expect(src).toMatch(/ANALYTICS_EVENTS\.APP_OPENED/);
    expect(src).toMatch(/identifyUser\(user\.id\)/);
    expect(src).toMatch(/resetAnalytics\(\)/);
  });

  it("exercise + mock-test + nudge emission points wired with banded scores only", () => {
    expect(readSrc("src/hooks/use-exercise.ts")).toMatch(/score_band: scoreBand\(score\)/);
    expect(readSrc("app/(tabs)/mock-test/[testId].tsx")).toMatch(
      /ANALYTICS_EVENTS\.MOCK_TEST_COMPLETED/
    );
    expect(readSrc("src/hooks/use-notifications.ts")).toMatch(/ANALYTICS_EVENTS\.NUDGE_OPENED/);
  });

  it("PRIVACY: analytics module never imports profile/memory surfaces; policy discloses PostHog", () => {
    const analytics = readSrc("src/lib/analytics.ts");
    expect(analytics).not.toContain("companion_memory");
    expect(analytics).not.toContain("profile");
    const policy = readFileSync(
      join(__dirname, "../../..", "app/(tabs)/profile/privacy-policy.tsx"),
      "utf8"
    );
    expect(policy).toContain("PostHog (posthog.com)");
  });
});
