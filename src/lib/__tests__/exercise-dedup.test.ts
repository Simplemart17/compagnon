/**
 * Story 10-8 — pure-helper tests for exercise question-stem dedup.
 *
 * No mocks; no I/O. Pins the contract of `normalizeQuestionStem`,
 * `hashQuestionStem`, `extractExerciseHashes`, `filterUnseenQuestions`,
 * `isWritingPromptSeen`, and `MIN_FRESH_QUESTIONS_PER_SKILL`.
 */

import {
  MIN_FRESH_QUESTIONS_PER_SKILL,
  extractExerciseHashes,
  filterUnseenQuestions,
  hashQuestionStem,
  isWritingPromptSeen,
  normalizeQuestionStem,
  runMcqDedupPipeline,
  runWritingDedupPipeline,
} from "../exercise-dedup";

describe("normalizeQuestionStem", () => {
  it("lowercases per French locale", () => {
    expect(normalizeQuestionStem("BONJOUR")).toBe("bonjour");
    expect(normalizeQuestionStem("Étoile")).toBe("étoile");
  });

  it("NFC-normalizes combining-diacritic vs precomposed forms to the same canonical output", () => {
    // U+0065 + U+0301 (e + combining acute) → U+00E9 (precomposed é)
    const decomposed = "café"; // "café" with combining accent
    const precomposed = "café"; // "café" precomposed
    expect(normalizeQuestionStem(decomposed)).toBe(normalizeQuestionStem(precomposed));
  });

  it("trims leading + trailing whitespace", () => {
    expect(normalizeQuestionStem("  bonjour  ")).toBe("bonjour");
    expect(normalizeQuestionStem("\n\tbonjour\t\n")).toBe("bonjour");
  });

  it("collapses interior whitespace (multiple spaces, tabs, newlines, NBSP) to a single ASCII space", () => {
    expect(normalizeQuestionStem("bonjour    monde")).toBe("bonjour monde");
    expect(normalizeQuestionStem("bonjour\t\tmonde")).toBe("bonjour monde");
    expect(normalizeQuestionStem("bonjour\nmonde")).toBe("bonjour monde");
    expect(normalizeQuestionStem("bonjour monde")).toBe("bonjour monde"); // NBSP
  });

  it("is idempotent — normalize(normalize(x)) === normalize(x)", () => {
    const samples = ["  BONJOUR\nMONDE  ", "Café  au  lait", "SELON le TEXTE,  pourquoi ?"];
    for (const s of samples) {
      const once = normalizeQuestionStem(s);
      const twice = normalizeQuestionStem(once);
      expect(twice).toBe(once);
    }
  });
});

describe("hashQuestionStem", () => {
  it("is case-insensitive (via normalization)", () => {
    expect(hashQuestionStem("Bonjour")).toBe(hashQuestionStem("bonjour"));
    expect(hashQuestionStem("BONJOUR")).toBe(hashQuestionStem("bonjour"));
  });

  it("is whitespace-insensitive (via normalization)", () => {
    expect(hashQuestionStem("  bonjour  ")).toBe(hashQuestionStem("bonjour"));
    expect(hashQuestionStem("bonjour    monde")).toBe(hashQuestionStem("bonjour monde"));
  });

  it("is NFC-invariant (decomposed and precomposed accents hash identically)", () => {
    expect(hashQuestionStem("café")).toBe(hashQuestionStem("café"));
  });

  it("distinct stems produce distinct hashes", () => {
    expect(hashQuestionStem("Question A")).not.toBe(hashQuestionStem("Question B"));
  });

  it("returns a short opaque base-36 string", () => {
    const result = hashQuestionStem("Selon le texte, pourquoi le personnage est triste ?");
    expect(result).toMatch(/^[0-9a-z]+$/);
    expect(result.length).toBeLessThan(20);
  });

  it("is deterministic across calls", () => {
    const s = "Quelle est la capitale de la France ?";
    expect(hashQuestionStem(s)).toBe(hashQuestionStem(s));
  });
});

describe("extractExerciseHashes", () => {
  it("listening MCQ: returns one hash per question (5-question case)", () => {
    const exercise = {
      skill: "listening" as const,
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q3" },
        { question: "Q4" },
        { question: "Q5" },
      ],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(5);
  });

  it("reading MCQ: same shape as listening", () => {
    const exercise = {
      skill: "reading" as const,
      questions: [{ question: "Q1" }, { question: "Q2" }],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(2);
  });

  it("grammar MCQ: same shape", () => {
    const exercise = {
      skill: "grammar" as const,
      questions: [{ question: "Q1" }],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(1);
  });

  it("writing: returns one hash from writingPrompt.prompt", () => {
    const exercise = {
      skill: "writing" as const,
      writingPrompt: { prompt: "Décrivez votre journée idéale en 100 mots." },
    };
    const result = extractExerciseHashes(exercise);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(hashQuestionStem("Décrivez votre journée idéale en 100 mots."));
  });

  it("writing with empty / missing writingPrompt returns empty array (defensive)", () => {
    expect(extractExerciseHashes({ skill: "writing" })).toEqual([]);
    expect(extractExerciseHashes({ skill: "writing", writingPrompt: { prompt: "" } })).toEqual([]);
    expect(extractExerciseHashes({ skill: "writing", writingPrompt: {} })).toEqual([]);
  });

  it("MCQ with empty question stems filters them out", () => {
    const exercise = {
      skill: "listening" as const,
      questions: [{ question: "Q1" }, { question: "" }, { question: "Q2" }],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(2);
  });

  it("MCQ with null/undefined question fields filters them out (defensive)", () => {
    const exercise = {
      skill: "reading" as const,
      questions: [{ question: "Q1" }, { question: null }, { question: undefined }],
    };
    expect(extractExerciseHashes(exercise)).toHaveLength(1);
  });

  it("missing questions array (defensive): returns empty array", () => {
    expect(extractExerciseHashes({ skill: "listening" })).toEqual([]);
  });

  it("collisions are deterministic — same input always produces the same hash set", () => {
    const exercise = {
      skill: "listening" as const,
      questions: [{ question: "Q1" }, { question: "Q2" }],
    };
    const first = extractExerciseHashes(exercise);
    const second = extractExerciseHashes(exercise);
    expect(first).toEqual(second);
  });
});

describe("filterUnseenQuestions", () => {
  it("empty seen set returns input unchanged (identity)", () => {
    const generated = [{ question: "Q1" }, { question: "Q2" }];
    const result = filterUnseenQuestions(generated, new Set());
    expect(result).toBe(generated); // strict identity reference
  });

  it("seen set with 2 of 5 hashes returns 3 unseen", () => {
    const seen = new Set([hashQuestionStem("Q1"), hashQuestionStem("Q3")]);
    const generated = [
      { question: "Q1" },
      { question: "Q2" },
      { question: "Q3" },
      { question: "Q4" },
      { question: "Q5" },
    ];
    const result = filterUnseenQuestions(generated, seen);
    expect(result).toHaveLength(3);
    expect(result.map((q) => q.question)).toEqual(["Q2", "Q4", "Q5"]);
  });

  it("seen set with ALL hashes returns empty array", () => {
    const seen = new Set([hashQuestionStem("Q1"), hashQuestionStem("Q2")]);
    const generated = [{ question: "Q1" }, { question: "Q2" }];
    expect(filterUnseenQuestions(generated, seen)).toEqual([]);
  });

  it("filter is case-insensitive (via normalization)", () => {
    const seen = new Set([hashQuestionStem("bonjour")]);
    const generated = [{ question: "BONJOUR" }];
    expect(filterUnseenQuestions(generated, seen)).toEqual([]);
  });

  it("does not mutate the input array (purity)", () => {
    const generated = [{ question: "Q1" }, { question: "Q2" }];
    const before = [...generated];
    const seen = new Set([hashQuestionStem("Q1")]);
    filterUnseenQuestions(generated, seen);
    expect(generated).toEqual(before);
  });
});

describe("isWritingPromptSeen", () => {
  it("returns true when the prompt's hash is in the seen set", () => {
    const seen = new Set([hashQuestionStem("Décrivez votre journée.")]);
    expect(isWritingPromptSeen("Décrivez votre journée.", seen)).toBe(true);
  });

  it("returns false when the prompt is not in the seen set", () => {
    const seen = new Set([hashQuestionStem("Décrivez votre journée.")]);
    expect(isWritingPromptSeen("Décrivez votre rêve.", seen)).toBe(false);
  });

  it("returns false for empty seen set", () => {
    expect(isWritingPromptSeen("Anything", new Set())).toBe(false);
  });

  it("returns false for empty / whitespace-only prompt", () => {
    const seen = new Set(["anything"]);
    expect(isWritingPromptSeen("", seen)).toBe(false);
    expect(isWritingPromptSeen("   \n\t  ", seen)).toBe(false);
  });

  it("is case-insensitive (via normalization)", () => {
    const seen = new Set([hashQuestionStem("Décrivez votre journée.")]);
    expect(isWritingPromptSeen("décrivez votre journée.", seen)).toBe(true);
    expect(isWritingPromptSeen("  DÉCRIVEZ VOTRE JOURNÉE.  ", seen)).toBe(true);
  });
});

describe("MIN_FRESH_QUESTIONS_PER_SKILL", () => {
  it("defines a threshold for MCQ skills (listening / reading / grammar)", () => {
    expect(MIN_FRESH_QUESTIONS_PER_SKILL.listening).toBe(4);
    expect(MIN_FRESH_QUESTIONS_PER_SKILL.reading).toBe(4);
    expect(MIN_FRESH_QUESTIONS_PER_SKILL.grammar).toBe(4);
  });

  it("does NOT include writing or speaking — review-patch P8 (BH12+ECH7) removed dead values", () => {
    // Writing dedup is single-prompt regenerate-once (no minFresh).
    // Speaking dedup is Story 9-8's 3-day-bucket (different contract,
    // different module). Including these in the threshold map was
    // misleading and is now corrected. The Record key type is
    // narrowed to the MCQ skills so TypeScript catches a future
    // re-introduction of writing/speaking access at compile time.
    expect(Object.keys(MIN_FRESH_QUESTIONS_PER_SKILL).sort()).toEqual([
      "grammar",
      "listening",
      "reading",
    ]);
  });
});

// ===========================================================================
// runMcqDedupPipeline — generation orchestration contract (Story 10-8 AC #5)
// ===========================================================================

describe("runMcqDedupPipeline — empty seen set (first-time user)", () => {
  it("runs ONCE, NO filtering applied, returns AI's first response unchanged", async () => {
    const result = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q3" },
        { question: "Q4" },
        { question: "Q5" },
      ],
      passage: "P1",
    };
    const generateFn = jest.fn(async () => result);
    const out = await runMcqDedupPipeline(generateFn, new Set(), 4);
    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(generateFn).toHaveBeenCalledWith({ temperature: 0.4, isRetry: false });
    expect(out.result).toBe(result);
    expect(out.filtered).toEqual(result.questions);
    expect(out.retries).toBe(0);
    expect(out.exhausted).toBe(false);
  });
});

describe("runMcqDedupPipeline — partial overlap (3 of 5 seen) triggers retry", () => {
  it("retry produces 5 fresh → retry result is used", async () => {
    const seen = new Set([hashQuestionStem("Q1"), hashQuestionStem("Q2"), hashQuestionStem("Q3")]);
    const firstResult = {
      questions: [
        { question: "Q1" }, // seen
        { question: "Q2" }, // seen
        { question: "Q3" }, // seen
        { question: "Q4" },
        { question: "Q5" },
      ],
      passage: "first-passage",
    };
    const retryResult = {
      questions: [
        { question: "FRESH-A" },
        { question: "FRESH-B" },
        { question: "FRESH-C" },
        { question: "FRESH-D" },
        { question: "FRESH-E" },
      ],
      passage: "retry-passage",
    };
    const generateFn = jest
      .fn<Promise<typeof firstResult>, [{ temperature: number; isRetry: boolean }]>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(retryResult);
    const out = await runMcqDedupPipeline(generateFn, seen, 4);
    expect(generateFn).toHaveBeenCalledTimes(2);
    expect(generateFn).toHaveBeenNthCalledWith(1, { temperature: 0.4, isRetry: false });
    expect(generateFn).toHaveBeenNthCalledWith(2, { temperature: 0.6, isRetry: true });
    expect(out.result).toBe(retryResult);
    expect(out.filtered).toHaveLength(5);
    expect(out.retries).toBe(1);
    expect(out.exhausted).toBe(false);
  });

  it("retry produces fewer fresh than initial → initial result is kept", async () => {
    const seen = new Set([hashQuestionStem("Q1"), hashQuestionStem("Q2")]);
    const firstResult = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "FRESH-1" },
        { question: "FRESH-2" },
        { question: "FRESH-3" },
      ],
    };
    const retryResult = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q1" },
      ],
    };
    const generateFn = jest
      .fn<Promise<typeof firstResult>, [{ temperature: number; isRetry: boolean }]>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(retryResult);
    const out = await runMcqDedupPipeline(generateFn, seen, 4);
    expect(out.result).toBe(firstResult);
    expect(out.retries).toBe(1);
    // 3 < 4 minFresh → exhausted; pipeline falls back to unfiltered
    // (firstResult.questions, all 5).
    expect(out.exhausted).toBe(true);
    expect(out.filtered).toEqual(firstResult.questions); // 5 items
    expect(out.filtered).toHaveLength(5);
  });
});

describe("runMcqDedupPipeline — full overlap on BOTH attempts triggers exhaustion", () => {
  it("returns unfiltered result + exhausted=true", async () => {
    const seen = new Set([
      hashQuestionStem("Q1"),
      hashQuestionStem("Q2"),
      hashQuestionStem("Q3"),
      hashQuestionStem("Q4"),
      hashQuestionStem("Q5"),
    ]);
    const firstResult = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q3" },
        { question: "Q4" },
        { question: "Q5" },
      ],
    };
    const retryResult = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q3" },
        { question: "Q4" },
        { question: "Q5" },
      ],
    };
    const generateFn = jest
      .fn<Promise<typeof firstResult>, [{ temperature: number; isRetry: boolean }]>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(retryResult);
    const out = await runMcqDedupPipeline(generateFn, seen, 4);
    expect(generateFn).toHaveBeenCalledTimes(2);
    expect(out.exhausted).toBe(true);
    expect(out.filtered).toEqual(firstResult.questions); // unfiltered fallback
    expect(out.retries).toBe(1);
  });
});

describe("runMcqDedupPipeline — partial overlap below threshold but retry not needed", () => {
  it("when seenHashes is non-empty but the initial filter already meets the threshold, no retry", async () => {
    const seen = new Set([hashQuestionStem("Q1")]); // 1 seen of 5
    const firstResult = {
      questions: [
        { question: "Q1" },
        { question: "Q2" },
        { question: "Q3" },
        { question: "Q4" },
        { question: "Q5" },
      ],
    };
    const generateFn = jest.fn(async () => firstResult);
    const out = await runMcqDedupPipeline(generateFn, seen, 4);
    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(out.filtered).toHaveLength(4); // 5 - 1 seen
    expect(out.retries).toBe(0);
    expect(out.exhausted).toBe(false);
  });
});

// ===========================================================================
// runWritingDedupPipeline — single-prompt regenerate-once contract
// ===========================================================================

describe("runWritingDedupPipeline — fresh prompt on first try", () => {
  it("runs ONCE, returns the first result, retries=0, exhausted=false", async () => {
    const result = { prompt: "Décrivez votre journée idéale.", context: "Daily routine" };
    const generateFn = jest.fn(async () => result);
    const out = await runWritingDedupPipeline(generateFn, new Set());
    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(out.result).toBe(result);
    expect(out.retries).toBe(0);
    expect(out.exhausted).toBe(false);
  });
});

describe("runWritingDedupPipeline — seen prompt triggers retry; retry fresh", () => {
  it("returns the retry result, retries=1, exhausted=false", async () => {
    const seen = new Set([hashQuestionStem("Décrivez votre journée idéale.")]);
    const firstResult = { prompt: "Décrivez votre journée idéale.", context: "Daily" };
    const retryResult = { prompt: "Décrivez votre rêve professionnel.", context: "Career" };
    const generateFn = jest
      .fn<Promise<typeof firstResult>, [{ temperature: number; isRetry: boolean }]>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(retryResult);
    const out = await runWritingDedupPipeline(generateFn, seen);
    expect(generateFn).toHaveBeenCalledTimes(2);
    expect(generateFn).toHaveBeenNthCalledWith(1, { temperature: 0.4, isRetry: false });
    expect(generateFn).toHaveBeenNthCalledWith(2, { temperature: 0.6, isRetry: true });
    expect(out.result).toBe(retryResult);
    expect(out.retries).toBe(1);
    expect(out.exhausted).toBe(false);
  });
});

describe("runWritingDedupPipeline — seen prompt on BOTH attempts triggers exhaustion", () => {
  it("returns the retry result + exhausted=true", async () => {
    const seen = new Set([
      hashQuestionStem("Décrivez votre journée idéale."),
      hashQuestionStem("Décrivez votre rêve."),
    ]);
    const firstResult = { prompt: "Décrivez votre journée idéale.", context: "Daily" };
    const retryResult = { prompt: "Décrivez votre rêve.", context: "Dream" };
    const generateFn = jest
      .fn<Promise<typeof firstResult>, [{ temperature: number; isRetry: boolean }]>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(retryResult);
    const out = await runWritingDedupPipeline(generateFn, seen);
    expect(out.exhausted).toBe(true);
    expect(out.result).toBe(retryResult); // accept the newer (still-dup)
    expect(out.retries).toBe(1);
  });
});
