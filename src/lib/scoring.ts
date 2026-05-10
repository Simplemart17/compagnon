import type { CEFRLevel, TCFSkill, TCFScore, WritingSpeakingScore } from "@/src/types/cefr";
import { CEFR_LEVELS, CEFR_ORDER, levelFromScore } from "@/src/types/cefr";

import { TCF } from "./constants";
import { IRCC_CLB_BANDS, type CLBLevel } from "./ircc-bands";

/**
 * Per-skill scoring contract (Story 10-2).
 *
 * The legacy `rawToTCFScore` 7-band linear interpolation was deleted because
 * (a) the publisher's CLB bands are non-linear and empirically anchored, and
 * (b) Listening/Reading and Writing/Speaking use different scales
 * (0–699 vs 0–20) — one function with one return shape was wrong for both.
 *
 * The two functions below map raw % to publisher-scale scores via the IRCC
 * CLB equivalency table at `src/lib/ircc-bands.ts` (sourced from
 * `docs/tcf-spec-source.md §2.2`).
 *
 * The contract is: given a raw %, return a score that lands inside the CLB
 * band a candidate at that raw % is expected to occupy. The 39-question QCM
 * has statistical floor noise that the app cannot eliminate — these
 * functions produce band-anchored estimates, not perfect predictions.
 */

const LR_BAND_ORDER: CLBLevel[] = ["1-3", "4", "5", "6", "7", "8", "9", "10-12"];

/**
 * Per-CLB anchor raw-% values that calibrate where the conversion places a
 * candidate. The boundaries are derived from the IRCC equivalency table:
 * a candidate at the top of CLB 7 is roughly at 75% raw correct on the QCM
 * (the EE threshold sits around mid-band).
 *
 * These are calibration anchors, not hard cutoffs — what matters for the
 * contract is that raw % X lands in the same CLB band a real candidate at
 * X% would occupy. See docs/tcf-spec-source.md §2.4 obs 1.
 */
const LR_BAND_RAW_PERCENT_BOUNDARIES: Record<CLBLevel, [number, number]> = {
  "1-3": [0, 35],
  "4": [35, 50],
  "5": [50, 60],
  "6": [60, 75],
  "7": [75, 82],
  "8": [82, 88],
  "9": [88, 93],
  "10-12": [93, 100],
};

const WS_BAND_RAW_PERCENT_BOUNDARIES: Record<CLBLevel, [number, number]> = {
  "1-3": [0, 20],
  "4": [20, 30],
  "5": [30, 35],
  "6": [35, 50],
  "7": [50, 60],
  "8": [60, 70],
  "9": [70, 80],
  "10-12": [80, 100],
};

/** Clamp a value to [min, max]; non-finite values become 0. */
function clampPercent(rawPercent: number): number {
  if (!Number.isFinite(rawPercent)) return 0;
  return Math.max(0, Math.min(100, rawPercent));
}

/** Linearly interpolate inside [score band], given a [raw% band]. */
function interpolateInBand(
  rawPercent: number,
  rawBand: readonly [number, number],
  scoreBand: readonly [number, number]
): number {
  const [rMin, rMax] = rawBand;
  const [sMin, sMax] = scoreBand;
  if (rMax === rMin) return sMin;
  const t = (rawPercent - rMin) / (rMax - rMin);
  return sMin + t * (sMax - sMin);
}

/**
 * Convert a raw % (0–100) on a Listening or Reading QCM to a TCF score
 * (0–699) that lands inside the IRCC CLB band a candidate at that raw %
 * is expected to occupy.
 *
 * Boundary anchors come from `LR_BAND_RAW_PERCENT_BOUNDARIES`; band score
 * ranges come from `IRCC_CLB_BANDS.listeningReading[level][skill]`. The
 * function is monotonic non-decreasing in raw %, clamps to [0, 699], and
 * satisfies the round-trip property that raw% in a CLB band's raw range
 * produces a score in that CLB band's score range.
 */
export function rawPercentToListeningReadingScore(
  rawPercent: number,
  skill: "listening" | "reading"
): TCFScore {
  const clamped = clampPercent(rawPercent);
  if (clamped === 0) return 0;
  if (clamped === 100) return 699;

  for (const level of LR_BAND_ORDER) {
    const [rMin, rMax] = LR_BAND_RAW_PERCENT_BOUNDARIES[level];
    if (clamped >= rMin && clamped <= rMax) {
      const scoreBand = IRCC_CLB_BANDS.listeningReading[level][skill];
      return Math.round(interpolateInBand(clamped, [rMin, rMax], scoreBand));
    }
  }
  return 0;
}

/**
 * Convert a raw % (0–100) on a Writing or Speaking production-task rubric
 * to a 0–20 publisher score that lands inside the IRCC CLB band a
 * candidate at that raw % is expected to occupy.
 *
 * Same contract as `rawPercentToListeningReadingScore` but on the 0–20
 * scale. The Writing + Speaking scales are identical per IRCC equivalency
 * (both use the same 0–20 band table), so this function does not need a
 * `skill` parameter.
 */
export function rawPercentToWritingSpeakingScore(rawPercent: number): WritingSpeakingScore {
  const clamped = clampPercent(rawPercent);
  if (clamped === 0) return 0;
  if (clamped === 100) return 20;

  for (const level of LR_BAND_ORDER) {
    const [rMin, rMax] = WS_BAND_RAW_PERCENT_BOUNDARIES[level];
    if (clamped >= rMin && clamped <= rMax) {
      const scoreBand = IRCC_CLB_BANDS.writingSpeaking[level];
      return Math.round(interpolateInBand(clamped, [rMin, rMax], scoreBand));
    }
  }
  return 0;
}

/**
 * Calculate a Listening/Reading section score from a correct-answer count.
 *
 * Wraps `rawPercentToListeningReadingScore` with the standard
 * raw% → TCF score → CEFR label flow. The CEFR label uses
 * `CEFR_LEVELS.tcfScoreMin/Max` round-number bands (UI-labeling only;
 * see JSDoc on `CEFR_LEVELS`).
 */
export function calculateSectionScore(
  correctAnswers: number,
  totalQuestions: number,
  skill: "listening" | "reading" = "listening"
): { rawPercent: number; tcfScore: TCFScore; cefrLevel: CEFRLevel | null } {
  const rawPercent = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  const tcfScore = rawPercentToListeningReadingScore(rawPercent, skill);
  const cefrLevel = levelFromScore(tcfScore);

  return { rawPercent, tcfScore, cefrLevel };
}

/**
 * Per-skill composite weights for TCF Canada (4 mandatory sections).
 *
 * The publisher does NOT produce a composite — TCF Canada scores are
 * reported per-skill. This composite is internal-display-only; see
 * `calculateInternalCompositeForUI` JSDoc. Equal-fifths is the only
 * defensible default because the publisher does not publish a weighting.
 *
 * `grammar` is explicitly excluded: TCF Canada has 4 sections, not 5
 * (operator decision per docs/tcf-spec-source.md §10 follow-up #1).
 * Grammar remains in the `TCFSkill` union as a non-TCF practice skill.
 */
const SKILL_WEIGHTS_TCF_CANADA: Record<Exclude<TCFSkill, "grammar">, number> = {
  listening: 0.25,
  reading: 0.25,
  writing: 0.25,
  speaking: 0.25,
};

/**
 * Internal-display-only composite for UI elements like "Today's level
 * estimate" and the mock-test landing card's "distance to C1" hint.
 *
 * **NOT IRCC-EQUIVALENT** — TCF Canada does not produce a composite;
 * Express Entry / IRCC scores are per-skill (see
 * `docs/tcf-spec-source.md §2.1`). **NOT used by the promotion engine**
 * (`src/lib/activity.ts` `evaluatePromotion` reads per-skill
 * `skill_progress` rows directly — story 9-2 contract).
 *
 * Use `calculateSectionScore` for any user-facing TCF-equivalence claim.
 * This composite is a soft estimate for UX continuity only.
 *
 * Silently drops a `grammar` entry from `skillScores` because TCF Canada
 * has 4 sections, not 5 (operator decision per
 * `docs/tcf-spec-source.md §10` follow-up #1).
 */
export function calculateInternalCompositeForUI(skillScores: Partial<Record<TCFSkill, TCFScore>>): {
  compositeScore: TCFScore;
  cefrLevel: CEFRLevel | null;
  distanceToC1: number;
} {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [skill, score] of Object.entries(skillScores)) {
    if (skill === "grammar") continue;
    const tcfSkill = skill as Exclude<TCFSkill, "grammar">;
    const weight = SKILL_WEIGHTS_TCF_CANADA[tcfSkill];
    if (weight === undefined) continue;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  const compositeScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const cefrLevel = levelFromScore(compositeScore);
  const distanceToC1 = Math.max(0, TCF.C1_MIN - compositeScore);

  return { compositeScore, cefrLevel, distanceToC1 };
}

/** Determine if a user is ready for the next CEFR level based on skill scores */
export function isReadyForNextLevel(
  currentLevel: CEFRLevel,
  skillScores: Record<TCFSkill, TCFScore>
): { ready: boolean; weakestSkill: TCFSkill | null; strongestSkill: TCFSkill | null } {
  const nextIdx = CEFR_ORDER.indexOf(currentLevel) + 1;

  if (nextIdx >= CEFR_ORDER.length) {
    return { ready: false, weakestSkill: null, strongestSkill: null };
  }

  const nextLevel = CEFR_ORDER[nextIdx];
  const nextLevelInfo = CEFR_LEVELS[nextLevel];

  let weakestSkill: TCFSkill | null = null;
  let strongestSkill: TCFSkill | null = null;
  let minScore = Infinity;
  let maxScore = -Infinity;
  let allAboveThreshold = true;

  for (const [skill, score] of Object.entries(skillScores)) {
    if (score < minScore) {
      minScore = score;
      weakestSkill = skill as TCFSkill;
    }
    if (score > maxScore) {
      maxScore = score;
      strongestSkill = skill as TCFSkill;
    }
    // Require at least the minimum score for the next level in each skill
    if (score < nextLevelInfo.tcfScoreMin) {
      allAboveThreshold = false;
    }
  }

  return { ready: allAboveThreshold, weakestSkill, strongestSkill };
}

/** Format a TCF score for display with level badge */
export function formatTCFScore(score: TCFScore): string {
  const level = levelFromScore(score);
  return level ? `${score}/699 (${level})` : `${score}/699`;
}

/**
 * Map a 0–20 publisher Writing/Speaking score to a CEFR label via the IRCC
 * CLB equivalency table.
 *
 * Used by the Speaking mock-test persistence path (and, post-Epic-10.6, by
 * the Writing pipeline). Returns null only for scores below CLB 4 (≤ 3),
 * which the publisher reports as "below CLB 4" with no CEFR equivalent.
 *
 * Mapping follows the standard CLB ↔ CEFR alignment (e.g., CLB 7 = B2):
 *   CLB 1–3 → null    CLB 4 → A2    CLB 5–6 → B1
 *   CLB 7–8 → B2      CLB 9 → C1    CLB 10–12 → C2
 */
export function cefrLevelFromWritingSpeakingScore(score: WritingSpeakingScore): CEFRLevel | null {
  if (!Number.isFinite(score) || score <= 3) return null;
  if (score <= 5) return "A2";
  if (score <= 9) return "B1";
  if (score <= 13) return "B2";
  if (score <= 15) return "C1";
  return "C2";
}
