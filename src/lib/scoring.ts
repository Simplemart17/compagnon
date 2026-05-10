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
 * candidate. Boundaries use `[lower, upper)` semantics (see `pickBand`):
 * a raw % at exactly an upper boundary (e.g., 75) lands in the next-higher
 * CLB band, not the lower one. The Express-Entry threshold (CLB 7) starts
 * at raw 75% under this convention.
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
 * Find the CLB band a clamped raw % falls into.
 *
 * Uses [lower, upper) semantics for non-final bands so adjacent boundary
 * endpoints (e.g., 35% in `[0, 35]` vs `[35, 50]`) deterministically
 * land in the higher band. The final band ("10-12") uses [lower, upper]
 * inclusive to capture 100% as the ceiling.
 */
function pickBand(clamped: number, boundaries: Record<CLBLevel, [number, number]>): CLBLevel {
  for (let i = 0; i < LR_BAND_ORDER.length; i++) {
    const level = LR_BAND_ORDER[i];
    const [rMin, rMax] = boundaries[level];
    const isFinal = i === LR_BAND_ORDER.length - 1;
    const inUpper = isFinal ? clamped <= rMax : clamped < rMax;
    if (clamped >= rMin && inUpper) return level;
  }
  // Unreachable for clamped in [0, 100], but TypeScript needs a return.
  return "10-12";
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
 *
 * Boundary semantics are `[lower, upper)` for non-final bands — exact
 * boundary values (e.g., raw 35%) land in the higher band, eliminating
 * the lower-band-wins discontinuity that ambiguous shared endpoints
 * would otherwise create.
 */
export function rawPercentToListeningReadingScore(
  rawPercent: number,
  skill: "listening" | "reading"
): TCFScore {
  const clamped = clampPercent(rawPercent);
  if (clamped === 0) return 0;
  if (clamped === 100) return 699;

  const level = pickBand(clamped, LR_BAND_RAW_PERCENT_BOUNDARIES);
  const rawBand = LR_BAND_RAW_PERCENT_BOUNDARIES[level];
  const scoreBand = IRCC_CLB_BANDS.listeningReading[level][skill];
  return Math.round(interpolateInBand(clamped, rawBand, scoreBand));
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

  const level = pickBand(clamped, WS_BAND_RAW_PERCENT_BOUNDARIES);
  const rawBand = WS_BAND_RAW_PERCENT_BOUNDARIES[level];
  const scoreBand = IRCC_CLB_BANDS.writingSpeaking[level];
  return Math.round(interpolateInBand(clamped, rawBand, scoreBand));
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
  skill: "listening" | "reading"
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
 * Composite return shape.
 *
 * `distanceToC1` is the gap (in 0–699 TCF points) between the current
 * composite and `TCF.C1_MIN` (UI round-number band per
 * `src/types/cefr.ts CEFR_LEVELS`). It is a UX continuity feature — a
 * "how far to the next milestone" hint shown on the home and mock-test
 * landing cards. **Not** a publisher metric; the publisher does not
 * produce a composite, and IRCC math uses `IRCC_CLB_BANDS`. Always `0`
 * when the composite is at or above `TCF.C1_MIN`.
 */
export interface InternalComposite {
  compositeScore: TCFScore;
  cefrLevel: CEFRLevel | null;
  /** UX continuity hint — gap to TCF.C1_MIN; not IRCC-equivalent. */
  distanceToC1: number;
}

/**
 * Internal-display-only composite for UI elements like "Today's level
 * estimate" and the mock-test landing card's "distance to C1" hint.
 *
 * **Scope: Listening and Reading only (0–699 scale).** Writing and
 * Speaking are on the publisher's 0–20 scale; mixing scales in a single
 * average produces meaningless numbers. Pass only `listening` and/or
 * `reading` scores; any other key (including `writing`, `speaking`,
 * `grammar`) is silently dropped. Per-skill production-task scores are
 * displayed individually elsewhere — they do not roll into a composite.
 *
 * **NOT IRCC-EQUIVALENT** — TCF Canada does not produce a composite;
 * Express Entry / IRCC scores are per-skill (see
 * `docs/tcf-spec-source.md §2.1`). **NOT used by the promotion engine**
 * (`src/lib/activity.ts` `evaluatePromotion` reads per-skill
 * `skill_progress` rows directly — story 9-2 contract).
 *
 * Use `calculateSectionScore` for any user-facing TCF-equivalence claim.
 * This composite is a soft estimate for UX continuity only.
 */
export function calculateInternalCompositeForUI(
  skillScores: Partial<Record<TCFSkill, TCFScore>>
): InternalComposite {
  // Only Listening and Reading share the 0–699 scale; Writing and Speaking
  // are on 0–20 (publisher's production-task scale) and cannot be
  // meaningfully averaged with L/R. Grammar is not part of TCF Canada
  // (operator decision per `docs/tcf-spec-source.md §10` follow-up #1).
  const COMPOSITE_SKILLS = ["listening", "reading"] as const;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const skill of COMPOSITE_SKILLS) {
    const score = skillScores[skill];
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    const weight = SKILL_WEIGHTS_TCF_CANADA[skill];
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

/** Format a TCF score for display with level badge (0–699 scale; Listening/Reading). */
export function formatTCFScore(score: TCFScore): string {
  const level = levelFromScore(score);
  return level ? `${score}/699 (${level})` : `${score}/699`;
}

/**
 * Format a Writing/Speaking publisher score for display with CEFR badge
 * (0–20 scale).
 *
 * Parallel to `formatTCFScore` for the production-task scale. Use this
 * for any UI surface displaying a `WritingSpeakingScore` — passing a 0–20
 * value to `formatTCFScore` would produce a misleading "X/699" string.
 */
export function formatWritingSpeakingScore(score: WritingSpeakingScore): string {
  const level = cefrLevelFromWritingSpeakingScore(score);
  return level ? `${score}/20 (${level})` : `${score}/20`;
}

/**
 * Map a 0–20 publisher Writing/Speaking score to a CEFR label via the IRCC
 * CLB equivalency table.
 *
 * Used by the Speaking mock-test persistence path (and, post-Epic-10.6, by
 * the Writing pipeline). Returns null only for non-finite or negative
 * inputs (defensive guard); valid scores in [0, 20] always produce a
 * CEFR label.
 *
 * Mapping (operator-derived from the standard CLB↔CEFR alignment; the
 * IRCC table groups CLB 10–12 as a single bucket so the C1/C2 split
 * within that bucket is a conservative interpolation — score 16–17 is
 * lower-band CLB 10 territory which most pedagogy sources align with C1,
 * not C2):
 *
 *   CLB 1–3 → A1     CLB 4 → A2     CLB 5–6 → B1
 *   CLB 7–8 → B2     CLB 9 + lower CLB 10 → C1     CLB 11–12 → C2
 *
 * Score 0 (silent submission) maps to A1 — the lowest CEFR level, since
 * CEFR has no formal "below A1" tier and downstream code (e.g., the
 * `mock_tests.cefr_result` column typed as `CEFRLevel`) requires a value
 * from the A1–C2 union. The "Below A1" label used by the QCM mock-test
 * path (`app/(tabs)/mock-test/[testId].tsx:567`) is a UI-display string;
 * this helper returns a typed `CEFRLevel` for DB persistence.
 */
export function cefrLevelFromWritingSpeakingScore(score: WritingSpeakingScore): CEFRLevel | null {
  if (!Number.isFinite(score) || score < 0) return null;
  if (score <= 3) return "A1"; // CLB 1–3 (publisher: "below CLB 4")
  if (score <= 5) return "A2"; // CLB 4
  if (score <= 9) return "B1"; // CLB 5–6
  if (score <= 13) return "B2"; // CLB 7–8 (Express Entry threshold at CLB 7)
  if (score <= 17) return "C1"; // CLB 9 + lower CLB 10–12 bucket
  return "C2"; // upper CLB 10–12 (score 18–20)
}
