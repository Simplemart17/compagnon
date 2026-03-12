/** CEFR (Common European Framework of Reference) levels for language proficiency */
export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** TCF skill categories matching the 5 test components */
export type TCFSkill = "listening" | "reading" | "speaking" | "writing" | "grammar";

/** TCF score range: 0-699 */
export type TCFScore = number;

/** CEFR level metadata */
export interface CEFRLevelInfo {
  level: CEFRLevel;
  name: string;
  nameFr: string;
  description: string;
  tcfScoreMin: number;
  tcfScoreMax: number;
}

/** Mapping of CEFR levels to TCF score ranges */
export const CEFR_LEVELS: Record<CEFRLevel, CEFRLevelInfo> = {
  A1: {
    level: "A1",
    name: "Beginner",
    nameFr: "Élémentaire",
    description: "Can understand and use basic everyday expressions.",
    tcfScoreMin: 100,
    tcfScoreMax: 199,
  },
  A2: {
    level: "A2",
    name: "Elementary",
    nameFr: "Élémentaire avancé",
    description: "Can understand sentences about familiar topics and communicate in simple tasks.",
    tcfScoreMin: 200,
    tcfScoreMax: 299,
  },
  B1: {
    level: "B1",
    name: "Intermediate",
    nameFr: "Intermédiaire",
    description: "Can deal with most travel situations and describe experiences.",
    tcfScoreMin: 300,
    tcfScoreMax: 399,
  },
  B2: {
    level: "B2",
    name: "Upper Intermediate",
    nameFr: "Intermédiaire avancé",
    description: "Can interact fluently and express viewpoints on a wide range of topics.",
    tcfScoreMin: 400,
    tcfScoreMax: 499,
  },
  C1: {
    level: "C1",
    name: "Advanced",
    nameFr: "Avancé",
    description: "Can use language flexibly for academic, professional, and social purposes.",
    tcfScoreMin: 500,
    tcfScoreMax: 599,
  },
  C2: {
    level: "C2",
    name: "Mastery",
    nameFr: "Maîtrise",
    description: "Can understand virtually everything and express with precision.",
    tcfScoreMin: 600,
    tcfScoreMax: 699,
  },
};

/** Ordered list of CEFR levels for progression */
export const CEFR_ORDER: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Determine CEFR level from a TCF score */
export function levelFromScore(score: TCFScore): CEFRLevel | null {
  if (score < 100) return null;
  for (const level of [...CEFR_ORDER].reverse()) {
    if (score >= CEFR_LEVELS[level].tcfScoreMin) return level;
  }
  return null;
}
