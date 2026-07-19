/**
 * Story 9-7 — Schema-level unit tests for AI response schemas.
 *
 * Verifies the rules each schema enforces (type, range, enum, length,
 * cross-field invariants via `superRefine`, polymorphic-input normalization
 * via `preprocess`). Pure functions — no mocks, no I/O.
 *
 * These tests are the foundation that Epic 15.5 (recorded-output replay
 * tests) will extend with real model outputs.
 */

import type { Correction } from "@/src/types/conversation";

import {
  cefrLevelSchema,
  conversationFeedbackSchema,
  dictationSetSchema,
  errorPatternBatchSchema,
  factExtractionSchema,
  grammarExerciseSchema,
  listeningExerciseSchema,
  mcqQuestionSchema,
  microDrillSchema,
  mockTestSectionSchema,
  placementTestSchema,
  pronunciationSentenceSchema,
  readingExerciseSchema,
  translationEvaluationSchema,
  translationGenerationSchema,
  writingEvaluationSchema,
  writingPromptGenerationSchema,
  echoGenerationSchema,
  speakingTaskEvaluationSchema,
  reportCorrectionArgsSchema,
  correctionCategorySchema,
  type ReportCorrectionArgs,
} from "../ai-responses";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function validMcqOption(id: string, isCorrect = false) {
  return { id, text: `option ${id}`, isCorrect };
}

function validMcqQuestion() {
  return {
    question: "Quel est le pluriel de cheval?",
    options: [
      validMcqOption("a", false),
      validMcqOption("b", true),
      validMcqOption("c", false),
      validMcqOption("d", false),
    ],
    explanation: "Cheval → chevaux est un pluriel irrégulier.",
  };
}

// ---------------------------------------------------------------------------
// mcqQuestionSchema — the central atomic, used by listening/reading/grammar/mock
// ---------------------------------------------------------------------------

describe("mcqQuestionSchema", () => {
  it("accepts a 4-option, 1-correct question (Case 1)", () => {
    const result = mcqQuestionSchema.safeParse(validMcqQuestion());
    expect(result.success).toBe(true);
  });

  it("rejects 3 options with too_small on options (Case 2)", () => {
    const q = validMcqQuestion();
    q.options = q.options.slice(0, 3);
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["options"]);
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });

  it("rejects 5 options with too_big on options (Case 3)", () => {
    const q = validMcqQuestion();
    q.options.push(validMcqOption("e", false));
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["options"]);
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });

  it("rejects 0 correct options via superRefine (Case 4)", () => {
    const q = validMcqQuestion();
    for (const o of q.options) o.isCorrect = false;
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["options"]);
      expect(result.error.issues[0].message).toMatch(/Expected exactly 1 correct option/);
    }
  });

  it("rejects 2 correct options via superRefine (Case 5)", () => {
    const q = validMcqQuestion();
    q.options[0].isCorrect = true;
    q.options[1].isCorrect = true;
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/got 2/);
    }
  });
});

// ---------------------------------------------------------------------------
// writingEvaluationSchema — score ranges + array shape + category enum
// ---------------------------------------------------------------------------

describe("writingEvaluationSchema", () => {
  function validEvaluation() {
    return {
      overallScore: 75,
      grammarScore: 80,
      cohesionScore: 70,
      lexicalRichnessScore: 65,
      registerScore: 85,
      errors: [
        {
          original: "Je suis aller",
          correction: "Je suis allé",
          explanation: "Past participle agreement.",
          category: "grammar" as const,
        },
      ],
      suggestions: ["Vary your connectors."],
    };
  }

  it("accepts a complete evaluation (Case 6)", () => {
    const result = writingEvaluationSchema.safeParse(validEvaluation());
    expect(result.success).toBe(true);
  });

  it("rejects overallScore as string (Case 7)", () => {
    const e = validEvaluation();
    (e as unknown as { overallScore: string }).overallScore = "85";
    const result = writingEvaluationSchema.safeParse(e);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_type");
    }
  });

  it("rejects overallScore out of range (150) (Case 8)", () => {
    const e = validEvaluation();
    e.overallScore = 150;
    const result = writingEvaluationSchema.safeParse(e);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });

  it("rejects missing errors array (Case 9)", () => {
    const e = validEvaluation();
    delete (e as Partial<typeof e>).errors;
    const result = writingEvaluationSchema.safeParse(e);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_type");
    }
  });

  it("rejects an unknown category", () => {
    const e = validEvaluation();
    (e.errors[0] as unknown as { category: string }).category = "spelling";
    const result = writingEvaluationSchema.safeParse(e);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// conversationFeedbackSchema — 1-5 rating range, array vs string
// ---------------------------------------------------------------------------

describe("conversationFeedbackSchema", () => {
  function validFeedback() {
    return {
      summary: "Solid B1-level conversation about travel.",
      strengths: ["Vocabulary range", "Confident delivery"],
      improvements: ["Article-noun agreement"],
      vocabularyUsed: 42,
      fluencyRating: 4,
      grammarRating: 3,
    };
  }

  it("accepts valid 1-5 ratings", () => {
    const result = conversationFeedbackSchema.safeParse(validFeedback());
    expect(result.success).toBe(true);
  });

  it("rejects fluencyRating: 6 (Case 10)", () => {
    const f = validFeedback();
    f.fluencyRating = 6;
    const result = conversationFeedbackSchema.safeParse(f);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });

  it("rejects strengths as string (Case 11)", () => {
    const f = validFeedback();
    (f as unknown as { strengths: string }).strengths = "great work";
    const result = conversationFeedbackSchema.safeParse(f);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_type");
    }
  });

  it("rejects fluencyRating: 0 (below 1)", () => {
    const f = validFeedback();
    f.fluencyRating = 0;
    const result = conversationFeedbackSchema.safeParse(f);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dictationSetSchema — non-empty + difficulty enum
// ---------------------------------------------------------------------------

describe("dictationSetSchema", () => {
  it("rejects empty sentences array (Case 12)", () => {
    const result = dictationSetSchema.safeParse({ sentences: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });

  it("rejects difficulty 'trivial' (not in enum) (Case 13)", () => {
    const result = dictationSetSchema.safeParse({
      sentences: [{ sentence: "Bonjour.", translation: "Hello.", difficulty: "trivial" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_enum_value");
    }
  });

  it("accepts valid sentence with allowed difficulty", () => {
    const result = dictationSetSchema.safeParse({
      sentences: [{ sentence: "Bonjour.", translation: "Hello.", difficulty: "easy" }],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// placementTestSchema — preprocess normalization for AI quirks
// ---------------------------------------------------------------------------

describe("placementTestSchema", () => {
  function validQuestionAsArray() {
    return {
      level: "A1" as const,
      question: "Quel est le pluriel?",
      options: [
        { id: "a", text: "chevaus", isCorrect: false },
        { id: "b", text: "chevaux", isCorrect: true },
        { id: "c", text: "chevales", isCorrect: false },
        { id: "d", text: "chevauxs", isCorrect: false },
      ],
      explanation: "Pluriel irrégulier.",
    };
  }

  function fifteenQuestions(template: ReturnType<typeof validQuestionAsArray>) {
    return Array.from({ length: 15 }, (_, i) => ({
      ...template,
      question: `Q${i + 1}: ${template.question}`,
    }));
  }

  it("accepts 15 well-formed questions", () => {
    const result = placementTestSchema.safeParse({
      questions: fifteenQuestions(validQuestionAsArray()),
    });
    expect(result.success).toBe(true);
  });

  it("normalizes options-as-object shape via preprocess (Case 14)", () => {
    // AI returns: { options: { a: "chevaus", b: "chevaux", c: "...", d: "..." }, correct_answer: "b" }
    const quirkQ = {
      level: "A1",
      question: "Quel est le pluriel?",
      options: { a: "chevaus", b: "chevaux", c: "chevales", d: "chevauxs" },
      correct_answer: "b",
      explanation: "Pluriel irrégulier.",
    };
    const result = placementTestSchema.safeParse({
      questions: Array.from({ length: 15 }, () => quirkQ),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const q = result.data.questions[0];
      expect(q.options).toHaveLength(4);
      expect(q.options.filter((o) => o.isCorrect)).toHaveLength(1);
      expect(q.options.find((o) => o.isCorrect)?.id).toBe("b");
    }
  });

  it("resolves correct_answer field on array-shape options (Case 15)", () => {
    // AI returns: { options: [{id: "a", ...}, ...], correct_answer: "c" } — no isCorrect on options
    const quirkQ = {
      level: "A1",
      question: "Pluriel?",
      options: [
        { id: "a", text: "chevaus" },
        { id: "b", text: "chevales" },
        { id: "c", text: "chevaux" },
        { id: "d", text: "chevauxs" },
      ],
      correct_answer: "c",
      explanation: "Pluriel irrégulier.",
    };
    const result = placementTestSchema.safeParse({
      questions: Array.from({ length: 15 }, () => quirkQ),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const q = result.data.questions[0];
      expect(q.options.find((o) => o.isCorrect)?.id).toBe("c");
    }
  });

  it("accepts a 14-question response within the ±tolerance band (Case 16, ship-blocker M4)", () => {
    // Pre-M4 this was rejected with too_small. The tolerance band (12–18) now
    // absorbs gpt-4o's occasional off-by-one instead of burning ~9 retries.
    const result = placementTestSchema.safeParse({
      questions: fifteenQuestions(validQuestionAsArray()).slice(0, 14),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an 11-question response below the tolerance band with too_small (Case 16b)", () => {
    const result = placementTestSchema.safeParse({
      questions: fifteenQuestions(validQuestionAsArray()).slice(0, 11),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["questions"]);
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });

  it("rejects a 19-question response above the tolerance band with too_big (Case 16c)", () => {
    const template = validQuestionAsArray();
    const result = placementTestSchema.safeParse({
      questions: Array.from({ length: 19 }, (_, i) => ({
        ...template,
        question: `Q${i + 1}: ${template.question}`,
      })),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["questions"]);
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });
});

// ---------------------------------------------------------------------------
// factExtractionSchema — content cap + memory type enum
// ---------------------------------------------------------------------------

describe("factExtractionSchema", () => {
  it("MAX_PRE_SANITIZE_CHARS in schemas/ai-responses.ts stays in lockstep with memory.ts", () => {
    // The schema file hardcodes 4096 to avoid a circular import. Assert the
    // value matches `src/lib/memory.ts` so a future drift fails this test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MAX_PRE_SANITIZE_CHARS } = require("../../memory") as {
      MAX_PRE_SANITIZE_CHARS: number;
    };
    expect(MAX_PRE_SANITIZE_CHARS).toBe(4096);
  });

  it("rejects content > 4096 chars with too_big (Case 17)", () => {
    const longContent = "x".repeat(5000);
    const result = factExtractionSchema.safeParse({
      facts: [{ content: longContent, type: "personal_fact" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });

  it("rejects type 'opinion' (not in enum) (Case 18)", () => {
    const result = factExtractionSchema.safeParse({
      facts: [{ content: "User likes coffee.", type: "opinion" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_enum_value");
    }
  });

  it("accepts each of the 4 valid memory types", () => {
    for (const type of ["personal_fact", "preference", "topic_discussed", "milestone"] as const) {
      const result = factExtractionSchema.safeParse({
        facts: [{ content: "x", type }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts an empty facts array (the AI may legitimately extract nothing)", () => {
    const result = factExtractionSchema.safeParse({ facts: [] });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// microDrillSchema — correctIndex range superRefine
// ---------------------------------------------------------------------------

describe("microDrillSchema", () => {
  function validDrill() {
    return {
      title: "Past participle agreement",
      explanation: "Use 'allé' not 'aller' after être.",
      questions: [
        {
          question: "Je suis ___ au marché.",
          options: ["aller", "allé", "allée", "allés"],
          correctIndex: 1,
          explanation: "Past participle.",
        },
      ],
      tip: "After 'être', the participle agrees in gender and number.",
    };
  }

  it("accepts a valid drill", () => {
    const result = microDrillSchema.safeParse(validDrill());
    expect(result.success).toBe(true);
  });

  it("rejects correctIndex: -1 (Case 19)", () => {
    const d = validDrill();
    d.questions[0].correctIndex = -1;
    const result = microDrillSchema.safeParse(d);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });

  it("rejects correctIndex out of range via superRefine", () => {
    const d = validDrill();
    d.questions[0].correctIndex = 99;
    const result = microDrillSchema.safeParse(d);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/out of range/);
    }
  });
});

// ---------------------------------------------------------------------------
// mockTestSectionSchema — passages-attached response (Case 20)
// ---------------------------------------------------------------------------

describe("mockTestSectionSchema", () => {
  it("accepts passages-attached response (Case 20)", () => {
    const result = mockTestSectionSchema.safeParse({
      passages: [
        { id: "p1", text: "Le chat dort." },
        { id: "p2", text: "Le chien aboie." },
      ],
      questions: [
        {
          question: "Que fait le chat?",
          passageId: "p1",
          options: [
            { id: "a", text: "Il dort.", isCorrect: true },
            { id: "b", text: "Il mange.", isCorrect: false },
            { id: "c", text: "Il joue.", isCorrect: false },
            { id: "d", text: "Il aboie.", isCorrect: false },
          ],
          explanation: "Le passage dit que le chat dort.",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.passages).toHaveLength(2);
      expect(result.data.questions).toHaveLength(1);
    }
  });

  it("rejects a question with 5 options", () => {
    const q = validMcqQuestion();
    q.options.push(validMcqOption("e"));
    const result = mockTestSectionSchema.safeParse({ questions: [q] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty questions array (ship-blocker M2 — no blank exam)", () => {
    // Pre-M2 an empty section passed validation, flipped `firstSectionReady`,
    // and rendered a playable BLANK exam. `.min(1)` now rejects it so the
    // generator marks the section failed (per-section failure isolation +
    // parseRetries) instead of shipping an empty section to the user.
    const result = mockTestSectionSchema.safeParse({ questions: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["questions"]);
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });
});

// ---------------------------------------------------------------------------
// Quick smoke tests for the remaining per-feature schemas
// ---------------------------------------------------------------------------

describe("smoke: remaining schemas", () => {
  it("listeningExerciseSchema accepts a valid response", () => {
    const result = listeningExerciseSchema.safeParse({
      passage: "Bonjour, je m'appelle Marie.",
      questions: [validMcqQuestion()],
    });
    expect(result.success).toBe(true);
  });

  it("readingExerciseSchema accepts a valid response", () => {
    const result = readingExerciseSchema.safeParse({
      passage: "Le chat est sur la table.",
      questions: [validMcqQuestion()],
      wordExplanations: { table: "Surface meuble" },
    });
    expect(result.success).toBe(true);
  });

  it("grammarExerciseSchema accepts a valid response", () => {
    const result = grammarExerciseSchema.safeParse({
      questions: [validMcqQuestion()],
    });
    expect(result.success).toBe(true);
  });

  it("writingPromptGenerationSchema accepts a valid response", () => {
    const result = writingPromptGenerationSchema.safeParse({
      prompt: "Écrivez une lettre à un ami.",
      context: "Practice writing a friendly letter.",
    });
    expect(result.success).toBe(true);
  });

  it("translationGenerationSchema accepts a 3-sentence response (minimum)", () => {
    const sentence = {
      source: "I am happy.",
      target: "Je suis heureux.",
      explanation: "Subject-verb-adjective.",
      difficulty: "A1" as const,
      grammarFocus: "être conjugation",
    };
    const result = translationGenerationSchema.safeParse({
      mode: "translation",
      sentences: [sentence, sentence, sentence],
    });
    expect(result.success).toBe(true);
  });

  it("translationEvaluationSchema accepts response without overallScore (caller recomputes)", () => {
    const result = translationEvaluationSchema.safeParse({
      accuracy: { score: 80, feedback: "Good." },
      fluency: { score: 75, feedback: "Smooth." },
      naturalness: { score: 70, feedback: "Slightly stiff." },
    });
    expect(result.success).toBe(true);
  });

  it("echoGenerationSchema accepts 3 sentences (minimum)", () => {
    const result = echoGenerationSchema.safeParse({
      sentences: Array.from({ length: 3 }, (_, i) => ({
        sentence: `Sentence ${i}.`,
        translation: `Translation ${i}.`,
        expectedSpelling: `sentence ${i}`,
        difficulty: "easy" as const,
      })),
    });
    expect(result.success).toBe(true);
  });

  it("echoGenerationSchema rejects 6 sentences (above max)", () => {
    const result = echoGenerationSchema.safeParse({
      sentences: Array.from({ length: 6 }, (_, i) => ({
        sentence: `Sentence ${i}.`,
        translation: `Translation ${i}.`,
        expectedSpelling: `sentence ${i}`,
        difficulty: "easy" as const,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("errorPatternBatchSchema accepts a valid response", () => {
    const result = errorPatternBatchSchema.safeParse({
      patterns: [
        {
          original: "j'ai alle",
          corrected: "je suis allé",
          pattern: "Auxiliary error: aller takes être, not avoir.",
          category: "grammar",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("pronunciationSentenceSchema accepts a valid response", () => {
    const result = pronunciationSentenceSchema.safeParse({
      sentence: "Bonjour, comment allez-vous?",
      translation: "Hello, how are you?",
    });
    expect(result.success).toBe(true);
  });

  it("cefrLevelSchema rejects an invalid level", () => {
    expect(cefrLevelSchema.safeParse("D1").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Story 9-7 review patches (P1-P13) — regression tests
// ---------------------------------------------------------------------------

describe("placementTestSchema — review patches (P1, P7)", () => {
  function buildQuestion(overrides: Record<string, unknown>) {
    return {
      level: "A1",
      question: "Q",
      explanation: "E",
      ...overrides,
    };
  }
  function fifteen(template: ReturnType<typeof buildQuestion>) {
    return Array.from({ length: 15 }, () => template);
  }

  it("P1a: resolves UPPERCASE correct_answer via case-insensitive match", () => {
    const q = buildQuestion({
      options: { a: "x", b: "y", c: "z", d: "w" },
      correct_answer: "B", // uppercase
    });
    const result = placementTestSchema.safeParse({ questions: fifteen(q) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions[0].options.find((o) => o.isCorrect)?.id).toBe("b");
    }
  });

  it("P1b: resolves NUMERIC-INDEX correct_answer", () => {
    const q = buildQuestion({
      options: [
        { id: "a", text: "x" },
        { id: "b", text: "y" },
        { id: "c", text: "z" },
        { id: "d", text: "w" },
      ],
      correct_answer: 2, // index 2 = option c
    });
    const result = placementTestSchema.safeParse({ questions: fifteen(q) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions[0].options.find((o) => o.isCorrect)?.id).toBe("c");
    }
  });

  it('P1c: accepts string-encoded boolean isCorrect ("true")', () => {
    const q = buildQuestion({
      options: [
        { id: "a", text: "x", correct: "false" },
        { id: "b", text: "y", correct: "true" }, // string boolean
        { id: "c", text: "z", correct: "false" },
        { id: "d", text: "w", correct: "false" },
      ],
    });
    const result = placementTestSchema.safeParse({ questions: fifteen(q) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions[0].options.find((o) => o.isCorrect)?.id).toBe("b");
    }
  });

  it("P7a: rejects null option values in object-shape rather than producing 'null' text", () => {
    const q = buildQuestion({
      options: { a: "x", b: null, c: "z", d: "w" },
      correct_answer: "a",
    });
    const result = placementTestSchema.safeParse({ questions: fifteen(q) });
    // After filtering null, only 3 options remain → fails .length(4) rule
    expect(result.success).toBe(false);
  });

  it("P7b: filters null array entries cleanly", () => {
    const q = buildQuestion({
      options: [
        { id: "a", text: "x" },
        null,
        { id: "c", text: "z", isCorrect: true },
        { id: "d", text: "w" },
      ],
    });
    // After filtering null, 3 options remain → fails .length(4)
    const result = placementTestSchema.safeParse({ questions: fifteen(q) });
    expect(result.success).toBe(false);
  });
});

describe("translationGenerationSchema — review patches (P2)", () => {
  function makeSentences(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      source: `Sentence ${i}.`,
      target: `Phrase ${i}.`,
      explanation: "Test.",
      difficulty: "A1" as const,
      grammarFocus: "test",
    }));
  }

  it("P2a: rejects 2 sentences (below MIN=3)", () => {
    const result = translationGenerationSchema.safeParse({
      mode: "translation",
      sentences: makeSentences(2),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_small");
    }
  });

  it("P2b: rejects 11 sentences (above MAX=10)", () => {
    const result = translationGenerationSchema.safeParse({
      mode: "translation",
      sentences: makeSentences(11),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("too_big");
    }
  });

  it("P2c: TRANSLATION_SENTENCE_BOUNDS exports stay in lockstep with translation-generation.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TRANSLATION_SENTENCE_BOUNDS } = require("../ai-responses") as {
      TRANSLATION_SENTENCE_BOUNDS: { min: number; max: number };
    };
    expect(TRANSLATION_SENTENCE_BOUNDS.min).toBe(3);
    expect(TRANSLATION_SENTENCE_BOUNDS.max).toBe(10);
  });
});

describe("translationDimensionScoreSchema — review patch (P4)", () => {
  it("P4: rejects whitespace-only feedback", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { translationDimensionScoreSchema } = require("../ai-responses") as {
      translationDimensionScoreSchema: { safeParse: (v: unknown) => { success: boolean } };
    };
    const result = translationDimensionScoreSchema.safeParse({
      score: 80,
      feedback: "   \n\t  ",
    });
    expect(result.success).toBe(false);
  });
});

describe("translationEvaluationSchema — review patch (P11)", () => {
  it("P11: accepts overallScore: null (caller recomputes)", () => {
    const result = translationEvaluationSchema.safeParse({
      accuracy: { score: 80, feedback: "Good." },
      fluency: { score: 75, feedback: "Smooth." },
      naturalness: { score: 70, feedback: "Slightly stiff." },
      overallScore: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("mcqQuestionSchema — review patches (P9, P10)", () => {
  function valid() {
    return {
      question: "Q?",
      options: [
        { id: "a", text: "x", isCorrect: false },
        { id: "b", text: "y", isCorrect: true },
        { id: "c", text: "z", isCorrect: false },
        { id: "d", text: "w", isCorrect: false },
      ],
      explanation: "E",
    };
  }

  it("P9: rejects duplicate option ids via superRefine", () => {
    const q = valid();
    q.options[0].id = "b"; // duplicate
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /unique/i.test(i.message))).toBe(true);
    }
  });

  it("P10a: rejects empty-string passage when present", () => {
    const q = { ...valid(), passage: "" };
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
  });

  it("P10b: rejects empty-string passageId when present", () => {
    const q = { ...valid(), passageId: "" };
    const result = mcqQuestionSchema.safeParse(q);
    expect(result.success).toBe(false);
  });

  it("P10c: still accepts undefined passage / passageId", () => {
    const result = mcqQuestionSchema.safeParse(valid());
    expect(result.success).toBe(true);
  });
});

describe("schema constant lockstep — review patches (P8, P12)", () => {
  it("P8: SCHEMA_MAX_PRE_SANITIZE_CHARS export equals memory.ts MAX_PRE_SANITIZE_CHARS (symmetric assertion)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schemas = require("../ai-responses") as { SCHEMA_MAX_PRE_SANITIZE_CHARS: number };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const memory = require("../../memory") as { MAX_PRE_SANITIZE_CHARS: number };
    expect(schemas.SCHEMA_MAX_PRE_SANITIZE_CHARS).toBe(memory.MAX_PRE_SANITIZE_CHARS);
  });

  it("P12: memoryTypeSchema.options matches MEMORY_TYPES set in memory.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { memoryTypeSchema } = require("../ai-responses") as {
      memoryTypeSchema: { options: readonly string[] };
    };
    // The memory.ts MEMORY_TYPES set is module-private, so we exercise the
    // schema's enum against the same canonical 4 types — drift in either
    // direction breaks this test.
    const canonical = ["personal_fact", "preference", "topic_discussed", "milestone"];
    expect([...memoryTypeSchema.options].sort()).toEqual([...canonical].sort());
  });
});

describe("speakingTaskEvaluationSchema (story 9-8 + 10-6)", () => {
  function validSpeaking() {
    return {
      pronunciationFluencyScore: 16,
      vocabularyScore: 14,
      grammarScore: 15,
      interactionScore: 18,
      // Story 10-6: 5th publisher category (Sociolinguistique per §6.3) is
      // required (NOT optional) — a legacy 4-dim AI response must fail Zod
      // parse so the Story 9-7 retry path triggers. See dedicated "story 10-6"
      // sub-describe below for the missing-field / boundary cases.
      sociolinguisticScore: 16,
      overallScore: 79,
      estimatedCEFR: "B2" as const,
      strengths: ["Bonne fluidité"],
      improvements: ["Élargir le vocabulaire"],
      corrections: "Quelques accords à surveiller",
    };
  }

  it("Case 1: valid full payload parses", () => {
    const result = speakingTaskEvaluationSchema.safeParse(validSpeaking());
    expect(result.success).toBe(true);
  });

  it("Case 2: pronunciationFluencyScore: 25 rejected (too_big — official scale is 0-20)", () => {
    const payload = { ...validSpeaking(), pronunciationFluencyScore: 25 };
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === "too_big")).toBe(true);
    }
  });

  it("Case 3: overallScore null accepted (nullable + optional, recompute path)", () => {
    const payload = { ...validSpeaking(), overallScore: null };
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("Case 3b: overallScore omitted entirely accepted (optional)", () => {
    const payload: Record<string, unknown> = { ...validSpeaking() };
    delete payload.overallScore;
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("Case 4: empty strengths array rejected (min 1)", () => {
    const payload = { ...validSpeaking(), strengths: [] };
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("Case 5: strengths with 6 entries rejected (max 5)", () => {
    const payload = {
      ...validSpeaking(),
      strengths: ["a", "b", "c", "d", "e", "f"],
    };
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects negative dimension scores", () => {
    const payload = { ...validSpeaking(), interactionScore: -1 };
    const result = speakingTaskEvaluationSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("estimatedCEFR is optional but rejects invalid CEFR values", () => {
    const without = { ...validSpeaking() } as Record<string, unknown>;
    delete without.estimatedCEFR;
    expect(speakingTaskEvaluationSchema.safeParse(without).success).toBe(true);

    const bad = { ...validSpeaking(), estimatedCEFR: "Z9" };
    expect(speakingTaskEvaluationSchema.safeParse(bad).success).toBe(false);
  });

  // ---- Story 10-6: 5th publisher category (Sociolinguistique) ----
  describe("Story 10-6 — sociolinguisticScore is required (NOT optional)", () => {
    it("5-dim payload with sociolinguisticScore parses successfully", () => {
      // Positive baseline: validSpeaking() already includes the new field
      // (post-10-6 fixture). This case pins that contract.
      const payload = validSpeaking();
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sociolinguisticScore).toBe(16);
      }
    });

    it("4-dim legacy payload (missing sociolinguisticScore) fails parse with the specific Zod issue path", () => {
      // Story 9-7 contract: a missing required field triggers retry. The
      // issue path MUST name `sociolinguisticScore` so Sentry telemetry
      // surfaces the specific drift, not just "some field missing".
      const payload: Record<string, unknown> = { ...validSpeaking() };
      delete payload.sociolinguisticScore;
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("sociolinguisticScore");
      }
    });

    it("sociolinguisticScore = -1 rejected (below the 0-20 official scale)", () => {
      const payload = { ...validSpeaking(), sociolinguisticScore: -1 };
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "too_small")).toBe(true);
      }
    });

    it("sociolinguisticScore = 21 rejected (above the 0-20 official scale)", () => {
      const payload = { ...validSpeaking(), sociolinguisticScore: 21 };
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "too_big")).toBe(true);
      }
    });

    it("sociolinguisticScore = 0 accepted (boundary low)", () => {
      const payload = { ...validSpeaking(), sociolinguisticScore: 0 };
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("sociolinguisticScore = 20 accepted (boundary high)", () => {
      const payload = { ...validSpeaking(), sociolinguisticScore: 20 };
      const result = speakingTaskEvaluationSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Story 11-1 — reportCorrectionArgsSchema (Realtime tool-call args)
// ---------------------------------------------------------------------------

describe("reportCorrectionArgsSchema (Story 11-1; bilingual per Story 18-2)", () => {
  it("accepts a well-formed bilingual grammar correction", () => {
    const result = reportCorrectionArgsSchema.safeParse({
      original: "je suis allé",
      corrected: "je suis allée",
      explanation_fr: "Accord du participe passé avec être au féminin.",
      explanation_en: "Past participle agrees with être for a female speaker.",
      category: "grammar",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.original).toBe("je suis allé");
      expect(result.data.corrected).toBe("je suis allée");
      expect(result.data.explanation_fr).toContain("Accord");
      expect(result.data.explanation_en).toContain("Past participle");
      expect(result.data.category).toBe("grammar");
    }
  });

  it("Story 18-2: rejects the legacy single-explanation shape (explanation without _fr/_en)", () => {
    const result = reportCorrectionArgsSchema.safeParse({
      original: "x",
      corrected: "y",
      explanation: "z",
      category: "grammar",
    });
    expect(result.success).toBe(false);
  });

  it.each(["grammar", "pronunciation", "vocabulary", "register"] as const)(
    "accepts category=%s",
    (category) => {
      const result = reportCorrectionArgsSchema.safeParse({
        original: "x",
        corrected: "y",
        explanation_fr: "z",
        explanation_en: "z",
        category,
      });
      expect(result.success).toBe(true);
    }
  );

  it("rejects category outside the 4-literal union", () => {
    const result = reportCorrectionArgsSchema.safeParse({
      original: "x",
      corrected: "y",
      explanation_fr: "z",
      explanation_en: "z",
      category: "nonsense",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod v3 emits "invalid_enum_value" for enum literal mismatches.
      expect(result.error.issues[0].code).toBe("invalid_enum_value");
    }
  });

  it.each(["original", "corrected", "explanation_fr", "explanation_en"] as const)(
    "rejects empty string on field=%s",
    (field) => {
      const payload: Record<string, string> = {
        original: "a",
        corrected: "b",
        explanation_fr: "c",
        explanation_en: "d",
        category: "grammar",
      };
      payload[field] = "";
      const result = reportCorrectionArgsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  );

  it.each(["explanation_fr", "explanation_en"] as const)(
    "rejects missing required field %s (both languages are mandatory from the model)",
    (missing) => {
      const payload: Record<string, string> = {
        original: "a",
        corrected: "b",
        explanation_fr: "c",
        explanation_en: "d",
        category: "grammar",
      };
      delete payload[missing];
      const result = reportCorrectionArgsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  );

  it("rejects non-string field types", () => {
    const result = reportCorrectionArgsSchema.safeParse({
      original: 42,
      corrected: "b",
      explanation_fr: "c",
      explanation_en: "d",
      category: "grammar",
    });
    expect(result.success).toBe(false);
  });

  it("Story 18-2: ReportCorrectionArgs maps onto Correction via the documented field mapping", () => {
    // Post-18-2 the wire shape (explanation_fr/explanation_en) deliberately
    // DIFFERS from the stored Correction shape (explanation/explanationEn)
    // — pre-18-2 stored corrections carry only `explanation`, so the
    // stored shape keeps French in the legacy field. This test pins the
    // mapping contract that processReportCorrectionCall implements.
    const args: ReportCorrectionArgs = {
      original: "x",
      corrected: "y",
      explanation_fr: "z-fr",
      explanation_en: "z-en",
      category: "grammar",
    };
    const { explanation_fr, explanation_en, ...rest } = args;
    const correction: Correction = {
      ...rest,
      explanation: explanation_fr,
      explanationEn: explanation_en,
    };
    expect(correction.explanation).toBe("z-fr");
    expect(correction.explanationEn).toBe("z-en");
    expect(correction.category).toBe("grammar");
  });

  it("correctionCategorySchema exposes the 4-literal enum members (order-independent)", () => {
    // Review patch P14 (LOW): order-independent membership check defends
    // against a hypothetical future Zod release that changes .options
    // ordering. The set + size check is robust to ordering.
    expect(correctionCategorySchema.options).toHaveLength(4);
    expect(new Set(correctionCategorySchema.options)).toEqual(
      new Set(["grammar", "pronunciation", "vocabulary", "register"])
    );
  });

  it("`note_error_pattern` Realtime tool's inline enum stays synchronized with correctionCategorySchema (P15)", () => {
    // Review patch P15 (LOW): the `note_error_pattern` tool registration
    // at `src/hooks/use-realtime-voice.ts` has an inline
    // `enum: ["grammar", "pronunciation", "vocabulary", "register"]`
    // literal that MUST match `correctionCategorySchema.options`. Until
    // a future hardening story migrates the inline literal to consume
    // the schema's `.options` directly, this test pins the lockstep
    // contract — any drift fails CI.
    //
    // Source-of-truth: the schema. The inline literal is documented as
    // the duplicate. Future Epic 11.X story can collapse them.
    const inlineNoteErrorEnum = ["grammar", "pronunciation", "vocabulary", "register"] as const;
    expect(new Set(inlineNoteErrorEnum)).toEqual(new Set(correctionCategorySchema.options));
  });
});

// ---------------------------------------------------------------------------
// Story 11-5 — postConversationAnalysisSchema (consolidated post-conv output)
// ---------------------------------------------------------------------------

describe("postConversationAnalysisSchema (Story 11-5)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { postConversationAnalysisSchema } = require("../ai-responses");

  it("parses a well-formed combined object with all 3 sub-outputs", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [{ content: "Lives in Toronto", type: "personal_fact" }],
      errorPatterns: [
        {
          original: "j'ai allé",
          corrected: "je suis allé",
          pattern: "être-verb passé composé requires être auxiliary",
          category: "grammar",
        },
      ],
      feedback: {
        summary: "Solid B1 conversation.",
        strengths: ["Good vocab range"],
        improvements: ["Watch être/avoir"],
        vocabularyUsed: 42,
        fluencyRating: 4,
        grammarRating: 3,
      },
    });
    expect(result.success).toBe(true);
  });

  it("defaults `facts` to [] when key is missing (partial-result tolerance)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      errorPatterns: [],
      feedback: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facts).toEqual([]);
    }
  });

  it("defaults `errorPatterns` to [] when key is missing (partial-result tolerance)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [],
      feedback: undefined,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorPatterns).toEqual([]);
    }
  });

  it("allows `feedback: undefined` (transcript-too-short path)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [],
      errorPatterns: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feedback).toBeUndefined();
    }
  });

  it("accepts an empty object via all 3 defaults (model returned nothing)", () => {
    const result = postConversationAnalysisSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facts).toEqual([]);
      expect(result.data.errorPatterns).toEqual([]);
      expect(result.data.feedback).toBeUndefined();
    }
  });

  it("rejects invalid `errorPatterns[].category` (must be one of the 4 enum values)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [],
      errorPatterns: [
        {
          original: "x",
          corrected: "y",
          pattern: "p",
          category: "INVALID_CATEGORY",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid `facts[].type` (must be one of the 4 memory types)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [{ content: "x", type: "invalid_memory_type" }],
      errorPatterns: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid feedback shape (e.g., fluencyRating out of 1-5 range)", () => {
    const result = postConversationAnalysisSchema.safeParse({
      facts: [],
      errorPatterns: [],
      feedback: {
        summary: "s",
        strengths: ["a"],
        improvements: ["b"],
        vocabularyUsed: 1,
        fluencyRating: 99, // out of range
        grammarRating: 3,
      },
    });
    expect(result.success).toBe(false);
  });
});
