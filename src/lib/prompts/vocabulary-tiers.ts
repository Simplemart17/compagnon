import { CEFR_ORDER } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Per-CEFR vocabulary-frequency tiers for prompt-builder consumption.
 *
 * Source of truth: `docs/tcf-spec-source.md §7.2` (operator-derived
 * heuristic caps; **NOT Beacco-verbatim** — operator-action TODO per
 * `docs/tcf-spec-source.md §10b` item #5 to fetch the Beacco
 * _Niveau A1/A2/B1/B2 pour le français_ volumes (Didier 2007–2011)
 * and replace these numbers with publisher-grade data in a Phase-2
 * follow-up).
 *
 * **Phase 1 / Phase 2 split:** the Beacco volumes are paywalled
 * academic publications; the dev agent cannot fetch them. Story 10-4
 * (Phase 1) ships the heuristic caps + curated exemplars + forbidden
 * tokens documented below; the citations matrix flags the row as
 * ✓ Verified-with-caveat until Beacco data lands.
 *
 * Exemplars are 10-20 hand-curated high-frequency French words per
 * level, sourced from the open Wiktionary "Liste des 1000 mots les
 * plus fréquents en français" (CC-BY-SA) + Échelle DGLF /
 * Service-Public.gouv.fr usage frequency. They are calibration
 * anchors for the AI; NOT exhaustive dictionaries (the AI knows the
 * full tier from its training). **Each token appears at exactly ONE
 * tier — its introduction level** (Story 10-4 review patch P2). A
 * regression test asserts no cross-tier exemplar duplication.
 *
 * Forbidden-tier lists name connectors / lexical items that must NOT
 * appear at this CEFR level. **Lists are derived from a single
 * `LEXICAL_MIN_LEVEL` map** so monotonicity holds by construction:
 * if a token has min-level B1, it is forbidden at A1 AND A2 (Story
 * 10-4 review patch P1 — fixes the BH-flagged inconsistency where
 * A1 forbade `cependant` but A2 silently allowed it). Sourced from
 * `docs/tcf-spec-source.md §8.1` (e.g., `force est de constater` is
 * a fixed C1+ expression; the existing misclassification at
 * `src/lib/prompts/conversation.ts` is owned by Epic 10.7) plus
 * standard FLE-pedagogy connector conventions.
 *
 * **Spec choice for C1+:** C1 and C2 candidates "wield the full
 * upper register" — both forbidden lists are intentionally empty
 * even though some C2 exemplars (`idiosyncrasie`, `palimpseste`)
 * are rare lexical items. Rationale: the C1 evaluator is a CEFR
 * grader, not a generator gate, so C1 prompts permit any vocab.
 *
 * **Story 9-4 stored-prompt-injection defense holds:** this module
 * accepts only a typed `CEFRLevel` enum argument; no user input
 * flows in. Outputs are deterministic, byte-identical for repeated
 * calls with the same argument (asserted by test).
 *
 * Citations: `docs/tcf-spec-citations.md §9` row flips
 * 🟡 GAP → ✓ Verified-with-caveat by Story 10-4.
 */

export interface VocabularyTier {
  /** Approximate distinct word-form ceiling at this CEFR level (heuristic; per §7.2). */
  approxWordCap: number;
  /** Human-readable explanation tying back to §7.2 (rendered into the prompt). */
  capRationale: string;
  /** 10-20 canonical high-frequency French words at this tier (calibration anchors only). */
  exemplars: string[];
  /**
   * Words / connectors that must NOT appear at this CEFR level.
   * Computed at module load from `LEXICAL_MIN_LEVEL` so monotonicity
   * holds by construction (Story 10-4 review patch P1).
   */
  forbiddenLowerTier: string[];
}

/**
 * Single source of truth for "minimum CEFR level at which this token
 * may appear in generated content." A token with min-level X is
 * forbidden at every CEFR level strictly below X. Sourced from
 * `docs/tcf-spec-source.md §8.1` + FLE-pedagogy connector convention.
 *
 * **Sorted intentionally:** items are listed in approximate
 * pedagogical-canonicality order within each tier — fixed expressions
 * (`force est de constater`) come BEFORE generic connectors so the
 * mock-test aggregated table's slice rendering surfaces the most
 * diagnostic tokens first (Story 10-4 review patch P4).
 */
const LEXICAL_MIN_LEVEL: readonly (readonly [string, CEFRLevel])[] = [
  // C1+ tier — fixed expressions and high-register markers (most diagnostic first)
  ["force est de constater", "C1"],
  ["il sied de", "C1"],
  ["il n'en demeure pas moins", "C1"],
  ["en l'occurrence", "C1"],
  ["quoi qu'il en soit", "C1"],
  ["néanmoins", "C1"],
  ["toutefois", "C1"],
  ["idiosyncrasie", "C1"],
  ["palimpseste", "C1"],
  // B2+ tier — formal connectors
  ["par conséquent", "B2"],
  ["en effet", "B2"],
  // B1+ tier — common intermediate connectors
  ["cependant", "B1"],
  ["pourtant", "B1"],
];

/**
 * Returns the forbidden-token list for a given CEFR level by filtering
 * `LEXICAL_MIN_LEVEL` to tokens whose min-level is strictly higher than
 * the argument. Pure function — no module-level state.
 */
function computeForbiddenAt(cefrLevel: CEFRLevel): string[] {
  const currentIdx = CEFR_ORDER.indexOf(cefrLevel);
  return LEXICAL_MIN_LEVEL.filter(([, minLevel]) => CEFR_ORDER.indexOf(minLevel) > currentIdx).map(
    ([token]) => token
  );
}

const TIERS: Record<CEFRLevel, VocabularyTier> = {
  A1: {
    approxWordCap: 700,
    capRationale: "midpoint of §7.2 range 500–900 most-frequent words",
    exemplars: [
      "bonjour",
      "merci",
      "oui",
      "non",
      "je",
      "tu",
      "manger",
      "boire",
      "aller",
      "venir",
      "petit",
      "grand",
      "rouge",
      "bleu",
      "un",
      "deux",
      "aujourd'hui",
      "demain",
      "maison",
      "école",
    ],
    forbiddenLowerTier: computeForbiddenAt("A1"),
  },
  A2: {
    approxWordCap: 1700,
    capRationale: "midpoint of §7.2 range 1500–1800 most-frequent words",
    // Story 10-4 review patch P2: deduped — `parce que` previously appeared
    // at both A2 and B1; introduced at A2 only since A2 is when subordinate
    // causal clauses are pedagogically introduced.
    exemplars: [
      "parce que",
      "mais",
      "et",
      "aussi",
      "très",
      "souvent",
      "parfois",
      "voyage",
      "travail",
      "famille",
      "temps libre",
      "acheter",
      "vendre",
      "essayer",
      "pouvoir",
      "vouloir",
      "devoir",
      "hier",
      "matin",
      "soir",
    ],
    forbiddenLowerTier: computeForbiddenAt("A2"),
  },
  B1: {
    approxWordCap: 2800,
    capRationale: "midpoint of §7.2 range 2500–3000 most-frequent words",
    // Story 10-4 review patch P2: removed `parce que` (now A2-only); B1
    // introduces the connector pair `cependant` / `pourtant` and intermediate
    // verbs of opinion / proposition.
    exemplars: [
      "cependant",
      "pourtant",
      "donc",
      "alors",
      "vacances",
      "travailler",
      "apprendre",
      "expérience",
      "opinion",
      "proposer",
      "imaginer",
      "expliquer",
      "comprendre",
      "dépendre",
      "convenir",
    ],
    forbiddenLowerTier: computeForbiddenAt("B1"),
  },
  B2: {
    approxWordCap: 5000,
    capRationale: 'floor of §7.2 "5000+" most-frequent words',
    // Story 10-4 review patch P2: removed `cependant` (now B1-only); B2
    // introduces the formal-argumentation connector pair `en effet` /
    // `par conséquent` and discourse-marker pairs (`d'une part` / `d'autre part`).
    exemplars: [
      "en effet",
      "par conséquent",
      "d'une part",
      "d'autre part",
      "en revanche",
      "argument",
      "débat",
      "analyse",
      "cadre",
      "enjeu",
      "démarche",
      "il faut que",
      "pour que",
      "bien que",
      "à condition que",
    ],
    forbiddenLowerTier: computeForbiddenAt("B2"),
  },
  C1: {
    approxWordCap: 7500,
    capRationale: '§7.2 5000+ specialized lexicon (Beacco "Inventaire" tier; midpoint with C2)',
    exemplars: [
      "néanmoins",
      "toutefois",
      "en l'occurrence",
      "il n'en demeure pas moins",
      "quoi qu'il en soit",
      "discours",
      "paradigme",
      "nuance",
      "enjeu sociétal",
      "argumentation",
      "réfuter",
      "étayer",
      "corroborer",
    ],
    forbiddenLowerTier: computeForbiddenAt("C1"),
  },
  C2: {
    approxWordCap: 10000,
    capRationale: 'floor of §7.2 "10000+" with literary/archaic/regional registers',
    exemplars: [
      "force est de constater",
      "il sied de",
      "prêter à confusion",
      "s'apparenter à",
      "verbiage",
      "circonlocution",
      "truisme",
      "idiosyncrasie",
      "palimpseste",
      "naguère",
      "jadis",
    ],
    forbiddenLowerTier: computeForbiddenAt("C2"),
  },
};

/**
 * Returns the per-CEFR vocabulary tier (cap + exemplars + forbidden
 * lower-tier list). Throws on any non-CEFR input — the `CEFRLevel`
 * union narrows at compile time, but the throw guards against
 * deserialised DB rows or deep-link params that escape narrowing
 * (Story 10-3 `writingTaskWordRange` pattern).
 */
export function vocabularyTier(cefrLevel: CEFRLevel): VocabularyTier {
  const tier = TIERS[cefrLevel];
  if (!tier) {
    throw new Error(
      `vocabularyTier: unsupported cefrLevel (typeof=${typeof cefrLevel}, value=${JSON.stringify(cefrLevel)}; expected A1, A2, B1, B2, C1, or C2)`
    );
  }
  return tier;
}

/**
 * Wording shared between `buildVocabularyConstraintBlock` (per-level)
 * and `buildAggregatedVocabularyConstraintTable` (mock-test) so the AI
 * sees consistent calibration language across both render paths
 * (Story 10-4 review patch P15).
 */
const NO_FORBIDDEN_WORDING = "none — full upper register";

/**
 * Builds the markdown "Vocabulary Constraint" block ready to drop
 * into any CEFR-aware prompt. Renders deterministically (same input →
 * byte-identical output) so the AI sees a stable contract and the
 * Story 9-4 prompt-injection defense holds.
 *
 * The block has three sections:
 *  1. Cap line (numeric ceiling + §7.2 rationale)
 *  2. Exemplar nudge (small high-frequency anchor list)
 *  3. Forbidden-lower-tier list — for evaluator prompts this means
 *     "the AI must not include these tokens when scoring or rewriting
 *     content TARGETED at this CEFR level" (Story 10-4 review patch
 *     P3 — clarifies generation-vs-grading scope)
 */
export function buildVocabularyConstraintBlock(cefrLevel: CEFRLevel): string {
  const tier = vocabularyTier(cefrLevel);
  const exemplarLine = tier.exemplars.join(", ");
  const forbiddenSection =
    tier.forbiddenLowerTier.length > 0
      ? `\n- Forbidden when generating content TARGETED at ${cefrLevel} (per docs/tcf-spec-source.md §8.1; these tokens require a higher CEFR than ${cefrLevel}): ${tier.forbiddenLowerTier.join(", ")}`
      : `\n- Forbidden at ${cefrLevel}: ${NO_FORBIDDEN_WORDING}`;

  return `## Vocabulary Constraint (${cefrLevel}, per docs/tcf-spec-source.md §7.2)
- Approximate ceiling: ${tier.approxWordCap} distinct word-forms (${tier.capRationale}; heuristic, NOT Beacco-verbatim — Phase-2 follow-up will replace with publisher-grade data)
- Exemplar high-frequency words at this tier (calibration anchors, not exhaustive): ${exemplarLine}${forbiddenSection}`;
}

/**
 * Builds an aggregated table covering all 6 CEFR levels — used by
 * `mock-test.ts` where a single section spans A1–C2 difficulty and
 * a single per-level block would be miscalibrated. Renders one
 * compact row per level under one shared header.
 *
 * **Story 10-4 review patch P4:** forbidden-token rendering uses
 * `slice(0, 5)` (was 3) and the `LEXICAL_MIN_LEVEL` table is sorted
 * with canonical fixed expressions (`force est de constater`) first,
 * so the most diagnostic tokens always surface above the ellipsis.
 */
export function buildAggregatedVocabularyConstraintTable(): string {
  const levels: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const rows = levels.map((level) => {
    const tier = vocabularyTier(level);
    const forbidden =
      tier.forbiddenLowerTier.length > 0
        ? `forbidden: ${tier.forbiddenLowerTier.slice(0, 5).join(", ")}${tier.forbiddenLowerTier.length > 5 ? ", …" : ""}`
        : `forbidden: ${NO_FORBIDDEN_WORDING}`;
    return `- ${level}: ≤ ${tier.approxWordCap} distinct word-forms — exemplars: ${tier.exemplars.slice(0, 5).join(", ")} — ${forbidden}`;
  });
  return `## Vocabulary Constraints by CEFR Level (per docs/tcf-spec-source.md §7.2)
Each generated passage MUST respect the per-level vocabulary tier of its difficulty band:
${rows.join("\n")}
Heuristic caps (NOT Beacco-verbatim — Phase-2 replacement deferred per §10b item #5).`;
}
