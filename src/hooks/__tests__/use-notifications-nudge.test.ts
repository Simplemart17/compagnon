/**
 * Story 18-3 — nudge client helpers + deep-link drift.
 *
 * Runtime cases for the pure `localHourToUtcHour` conversion (timezone math
 * stays client-side per the Story 9-2 precedent) + NUDGE_TIME_SLOTS shape
 * pins + a source-drift case pinning the conversation deep-link arm.
 */

/* eslint-disable import/first -- jest.mock factories must precede imports */

jest.mock("expo-notifications", () => ({
  __esModule: true,
  addNotificationResponseReceivedListener: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[x]" })),
  setNotificationHandler: jest.fn(),
}));

jest.mock("@/src/lib/supabase", () => ({
  __esModule: true,
  supabase: { functions: { invoke: jest.fn(async () => ({ data: null, error: null })) } },
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { readFileSync } from "fs";
import { join } from "path";

import { localHourToUtcHour, NUDGE_TIME_SLOTS } from "@/src/hooks/use-notifications";

describe("Story 18-3 — localHourToUtcHour (pure)", () => {
  it("UTC (offset 0): identity", () => {
    expect(localHourToUtcHour(18, 0)).toBe(18);
  });

  it("CEST UTC+2 (offset -120): local 18 → 16 UTC", () => {
    expect(localHourToUtcHour(18, -120)).toBe(16);
  });

  it("EST UTC-5 (offset 300): local 18 → 23 UTC", () => {
    expect(localHourToUtcHour(18, 300)).toBe(23);
  });

  it("wraparound west: EST local 20 → 1 UTC (next day)", () => {
    expect(localHourToUtcHour(20, 300)).toBe(1);
  });

  it("wraparound east: Tokyo UTC+9 (offset -540) local 6 → 21 UTC (previous day)", () => {
    expect(localHourToUtcHour(6, -540)).toBe(21);
  });

  it("fractional-hour zone rounds to nearest hour: India UTC+5:30 (offset -330) local 18 → 13 UTC (12.5 rounds up)", () => {
    expect(localHourToUtcHour(18, -330)).toBe(13);
  });

  it("always returns an integer in [0, 23]", () => {
    for (let local = 0; local < 24; local += 1) {
      for (const offset of [-720, -540, -330, -120, 0, 300, 720]) {
        const utc = localHourToUtcHour(local, offset);
        expect(Number.isInteger(utc)).toBe(true);
        expect(utc).toBeGreaterThanOrEqual(0);
        expect(utc).toBeLessThanOrEqual(23);
      }
    }
  });
});

describe("Story 18-3 — NUDGE_TIME_SLOTS shape", () => {
  it("exposes the three slots with sensible local hours", () => {
    expect(NUDGE_TIME_SLOTS.map((s) => s.key)).toEqual(["morning", "afternoon", "evening"]);
    expect(NUDGE_TIME_SLOTS.map((s) => s.localHour)).toEqual([9, 14, 18]);
    // EN chrome per Story 14-1.
    expect(NUDGE_TIME_SLOTS.map((s) => s.label)).toEqual(["Morning", "Afternoon", "Evening"]);
  });
});

describe("Story 18-3 — deep-link drift (source pin)", () => {
  const SRC = readFileSync(join(__dirname, "../use-notifications.ts"), "utf8");
  const CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("the notification response listener routes screen 'conversation' to the conversation tab", () => {
    expect(CODE_ONLY).toMatch(/screen === "conversation"/);
    expect(CODE_ONLY).toMatch(/navigate\("\/\(tabs\)\/conversation"\)/);
  });

  it("preferences include dailyNudge with default true (opt-out model)", () => {
    expect(CODE_ONLY).toMatch(/dailyNudge: data\.dailyNudge \?\? true/);
  });
});
