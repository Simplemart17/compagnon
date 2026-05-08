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

  it("rejects 14-question response with too_small on questions (Case 16)", () => {
    const result = placementTestSchema.safeParse({
      questions: fifteenQuestions(validQuestionAsArray()).slice(0, 14),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["questions"]);
      expect(result.error.issues[0].code).toBe("too_small");
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

  it("accepts an empty questions array (the section may have failed AI generation)", () => {
    // The schema doesn't enforce min length; the call site emits a separate
    // `mock-test-undercount` Sentry signal if the count is too low.
    const result = mockTestSectionSchema.safeParse({ questions: [] });
    expect(result.success).toBe(true);
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

  it("translationGenerationSchema accepts a valid response", () => {
    const result = translationGenerationSchema.safeParse({
      mode: "translation",
      sentences: [
        {
          source: "I am happy.",
          target: "Je suis heureux.",
          explanation: "Subject-verb-adjective.",
          difficulty: "A1",
          grammarFocus: "être conjugation",
        },
      ],
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
