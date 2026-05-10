/**
 * IRCC CLB ↔ TCF Canada per-skill equivalency bands.
 *
 * Source: docs/tcf-spec-source.md §2.2 (transcribed from canada.ca with
 * caveat — operator-verifiable; canada.ca returns HTTP 403 to WebFetch so
 * the table is third-party-transcribed and snapshotted at
 * docs/tcf-canada-snapshots/ircc-clb-equivalency-2026-05-10.md).
 *
 * Used by:
 * - src/lib/scoring.ts per-skill conversion functions (Story 10-2)
 * - future placement-test, promotion-engine migrations (deferred)
 *
 * Each band is INCLUSIVE-INCLUSIVE for raw values within range. CLB
 * thresholds for promotion (e.g., "user is at CLB 7+ in listening") use the
 * band's `min` value. CLB 7 is the typical Express Entry threshold.
 *
 * Two scales coexist:
 * - Listening + Reading: 0–699 (QCM-based; CLB-relevant from 331/342)
 * - Writing + Speaking: 0–20 (production-task rubric sum; CLB-relevant from 4)
 *
 * Story 10-2.
 */

import type { TCFScore, WritingSpeakingScore } from "@/src/types/cefr";

export const IRCC_CLB_BANDS = {
  listeningReading: {
    "1-3": { listening: [0, 330], reading: [0, 341] },
    "4": { listening: [331, 368], reading: [342, 374] },
    "5": { listening: [369, 397], reading: [375, 405] },
    "6": { listening: [398, 457], reading: [406, 452] },
    "7": { listening: [458, 502], reading: [453, 498] },
    "8": { listening: [503, 522], reading: [499, 523] },
    "9": { listening: [523, 548], reading: [524, 548] },
    "10-12": { listening: [549, 699], reading: [549, 699] },
  },
  writingSpeaking: {
    "1-3": [0, 3],
    "4": [4, 5],
    "5": [6, 6],
    "6": [7, 9],
    "7": [10, 11],
    "8": [12, 13],
    "9": [14, 15],
    "10-12": [16, 20],
  },
} as const;

export type CLBLevel = keyof typeof IRCC_CLB_BANDS.listeningReading;

const CLB_ORDER: CLBLevel[] = ["1-3", "4", "5", "6", "7", "8", "9", "10-12"];

function findBand(
  score: number,
  ranges: { level: CLBLevel; range: readonly [number, number] }[]
): CLBLevel | null {
  if (!Number.isFinite(score) || score < 0) return null;
  for (const { level, range } of ranges) {
    if (score >= range[0] && score <= range[1]) return level;
  }
  return null;
}

/** Lookup the CLB level for a Listening TCF score (0–699 scale). */
export function clbLevelFromListeningScore(score: TCFScore): CLBLevel | null {
  return findBand(
    score,
    CLB_ORDER.map((level) => ({
      level,
      range: IRCC_CLB_BANDS.listeningReading[level].listening,
    }))
  );
}

/** Lookup the CLB level for a Reading TCF score (0–699 scale). */
export function clbLevelFromReadingScore(score: TCFScore): CLBLevel | null {
  return findBand(
    score,
    CLB_ORDER.map((level) => ({
      level,
      range: IRCC_CLB_BANDS.listeningReading[level].reading,
    }))
  );
}

/** Lookup the CLB level for a Writing/Speaking score (0–20 scale). */
export function clbLevelFromWritingSpeakingScore(score: WritingSpeakingScore): CLBLevel | null {
  return findBand(
    score,
    CLB_ORDER.map((level) => ({
      level,
      range: IRCC_CLB_BANDS.writingSpeaking[level],
    }))
  );
}
