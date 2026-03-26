import type { CEFRLevel, TCFSkill, TCFScore } from "@/src/types/cefr";
import { CEFR_LEVELS, CEFR_ORDER, levelFromScore } from "@/src/types/cefr";

import { TCF } from "./constants";

/** Convert a raw percentage score (0-100) to TCF scale (0-699) */
export function rawToTCFScore(rawPercent: number): TCFScore {
  // Clamp to 0-100
  const clamped = Math.max(0, Math.min(100, rawPercent));

  // Non-linear mapping to TCF scale:
  // - 0-20%  maps to 0-99   (below A1)
  // - 21-35% maps to 100-199 (A1)
  // - 36-50% maps to 200-299 (A2)
  // - 51-65% maps to 300-399 (B1)
  // - 66-80% maps to 400-499 (B2)
  // - 81-90% maps to 500-599 (C1)
  // - 91-100% maps to 600-699 (C2)

  if (clamped <= 20) {
    return Math.round((clamped / 20) * 99);
  } else if (clamped <= 35) {
    return Math.round(100 + ((clamped - 20) / 15) * 99);
  } else if (clamped <= 50) {
    return Math.round(200 + ((clamped - 35) / 15) * 99);
  } else if (clamped <= 65) {
    return Math.round(300 + ((clamped - 50) / 15) * 99);
  } else if (clamped <= 80) {
    return Math.round(400 + ((clamped - 65) / 15) * 99);
  } else if (clamped < 90) {
    return Math.round(500 + ((clamped - 80) / 10) * 99);
  } else {
    return Math.round(600 + ((clamped - 90) / 10) * 99);
  }
}

/** Calculate TCF score from correct answers count */
export function calculateSectionScore(
  correctAnswers: number,
  totalQuestions: number
): { rawPercent: number; tcfScore: TCFScore; cefrLevel: CEFRLevel | null } {
  const rawPercent = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
  const tcfScore = rawToTCFScore(rawPercent);
  const cefrLevel = levelFromScore(tcfScore);

  return { rawPercent, tcfScore, cefrLevel };
}

/** Weights for each skill in composite score calculation */
const SKILL_WEIGHTS: Record<TCFSkill, number> = {
  listening: 0.2,
  reading: 0.2,
  grammar: 0.2,
  speaking: 0.2,
  writing: 0.2,
};

/** Calculate weighted composite TCF score across all skills */
export function calculateCompositeScore(skillScores: Partial<Record<TCFSkill, TCFScore>>): {
  compositeScore: TCFScore;
  cefrLevel: CEFRLevel | null;
  distanceToC1: number;
} {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [skill, score] of Object.entries(skillScores)) {
    const weight = SKILL_WEIGHTS[skill as TCFSkill];
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
