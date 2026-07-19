/** CEFR (Common European Framework of Reference) levels for language proficiency */
export type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/**
 * TCF skill categories.
 *
 * NOTE: TCF Canada has 4 mandatory sections (listening, reading, writing,
 * speaking) — Grammar is retained in this union as a non-TCF practice skill
 * per operator decision (2026-05-07; see docs/tcf-spec-source.md §10
 * follow-up #1). The TCF Canada composite (see `SKILL_WEIGHTS_TCF_CANADA`
 * in src/lib/scoring.ts) explicitly excludes `grammar`.
 */
export type TCFSkill = "listening" | "reading" | "speaking" | "writing" | "grammar";

/**
 * Listening / Reading TCF score (0–699).
 *
 * **Documentation-only naming convention** — this is a structural alias
 * for `number`, NOT a nominal/branded type. TypeScript will not catch
 * passing a `WritingSpeakingScore` (0–20) where a `TCFScore` (0–699) is
 * expected, since both are `number`. The two aliases exist to make call
 * sites self-documenting — confirm at the call site (or at the data
 * source) which scale a value is on; the compiler cannot enforce it.
 *
 * The publisher scales Listening + Reading on 0–699 (CLB-relevant from
 * 331/342 per docs/tcf-spec-source.md §2.1).
 */
export type TCFScore = number;

/**
 * Writing / Speaking score (0–20).
 *
 * **Documentation-only naming convention** — see `TCFScore` JSDoc above.
 * This is a structural alias for `number`; mixing with `TCFScore` will
 * NOT produce a TypeScript error. Use the function-naming conventions
 * (`rawPercentToWritingSpeakingScore`, `cefrLevelFromWritingSpeakingScore`)
 * to signal scale at the call site, and verify input ranges by reading
 * the function JSDoc when in doubt.
 *
 * The publisher scales Writing + Speaking on 0–20 (CLB-relevant from 4
 * per docs/tcf-spec-source.md §2.1).
 */
export type WritingSpeakingScore = number;

/** CEFR level metadata */
export interface CEFRLevelInfo {
  level: CEFRLevel;
  name: string;
  nameFr: string;
  description: string;
  tcfScoreMin: number;
  tcfScoreMax: number;
}

/**
 * UI-display CEFR ↔ TCF round-number bands.
 *
 * **NOT IRCC-EQUIVALENT** — these are convenience labels for self-assessment
 * grid display (e.g., the "B2" pill on the home screen). For IRCC / Express
 * Entry math (CLB equivalency, promotion gates), use
 * `src/lib/ircc-bands.ts` `IRCC_CLB_BANDS` instead, which is sourced
 * verbatim from the IRCC equivalency table.
 *
 * Source: round-number convention used by HiTCF, ouizami, tcfprep
 * third-party tables (per docs/tcf-spec-source.md §2.3). The publisher
 * (France Éducation International) does not publish a verbatim
 * TCF-score → CEFR-level table on its landing page.
 *
 * **`nameFr` convention (Story 10-7 / docs/tcf-spec-source.md §8.2).**
 * The French short labels follow the **Alliance Française school
 * convention** uniformly across all six levels: Élémentaire 1 / 2,
 * Intermédiaire 1 / 2, Avancé 1 / 2. §8.2 lists four institutional
 * conventions (Service-Public.gouv.fr 3-tier, Eduscol CEFR-bracketed,
 * Beacco/Didier bare codes, Alliance Française school convention) and
 * directs Epic 10.7 to pick one and apply it uniformly. Alliance
 * Française was chosen because it (a) preserves the existing 3-family
 * structure (Élémentaire / Intermédiaire / Avancé), (b) uses a natural
 * "1" / "2" sub-level distinguisher between A1↔A2, B1↔B2, C1↔C2, and
 * (c) is familiar to French-as-a-foreign-language students. The
 * pre-10-7 `nameFr: "Élémentaire avancé"` for A2 was non-canonical
 * (closest match was the CEFR Companion Volume's informal A2+) and
 * `nameFr: "Maîtrise"` for C2 mixed in an Eduscol parenthetical
 * descriptor — both replaced for convention-uniformity.
 */
export const CEFR_LEVELS: Record<CEFRLevel, CEFRLevelInfo> = {
  A1: {
    level: "A1",
    name: "Beginner",
    nameFr: "Élémentaire 1",
    description: "Can understand and use basic everyday expressions.",
    tcfScoreMin: 100,
    tcfScoreMax: 199,
  },
  A2: {
    level: "A2",
    name: "Elementary",
    nameFr: "Élémentaire 2",
    description: "Can understand sentences about familiar topics and communicate in simple tasks.",
    tcfScoreMin: 200,
    tcfScoreMax: 299,
  },
  B1: {
    level: "B1",
    name: "Intermediate",
    nameFr: "Intermédiaire 1",
    description: "Can deal with most travel situations and describe experiences.",
    tcfScoreMin: 300,
    tcfScoreMax: 399,
  },
  B2: {
    level: "B2",
    name: "Upper Intermediate",
    nameFr: "Intermédiaire 2",
    description: "Can interact fluently and express viewpoints on a wide range of topics.",
    tcfScoreMin: 400,
    tcfScoreMax: 499,
  },
  C1: {
    level: "C1",
    name: "Advanced",
    nameFr: "Avancé 1",
    description: "Can use language flexibly for academic, professional, and social purposes.",
    tcfScoreMin: 500,
    tcfScoreMax: 599,
  },
  C2: {
    level: "C2",
    name: "Mastery",
    nameFr: "Avancé 2",
    description: "Can understand virtually everything and express with precision.",
    tcfScoreMin: 600,
    tcfScoreMax: 699,
  },
};

/** Ordered list of CEFR levels for progression */
export const CEFR_ORDER: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Story 18-2 R1+R2: shared "beginner band" (A1-A2) predicate for
 * English-comprehension-support policies. Consumers: the Story 18-2
 * correction-explanation display default (`defaultCorrectionExplanationLanguage`)
 * and the Story 18-1 prompt-side band ternaries in
 * `src/lib/prompts/conversation.ts` (idiom + filler + comprehension
 * gating). The COMPREHENSION_SUPPORT Record's A1/A2 rows are mapped
 * explicitly and carry a lockstep cross-reference comment — widening the
 * band means editing BOTH this predicate AND that Record.
 * `undefined` (profile not yet hydrated / history surfaces) is NOT
 * beginner — French-primary is the safe default.
 */
export function isBeginnerCefrLevel(level: CEFRLevel | undefined): boolean {
  return level === "A1" || level === "A2";
}

/** Determine CEFR level from a TCF score.
 *  Returns null only for score 0 (no data). Scores 1-99 map to "Below A1"
 *  conceptually but return null since there is no CEFR level for that range. */
export function levelFromScore(score: TCFScore): CEFRLevel | null {
  if (score < 100) return null;
  for (const level of [...CEFR_ORDER].reverse()) {
    if (score >= CEFR_LEVELS[level].tcfScoreMin) return level;
  }
  return null;
}
