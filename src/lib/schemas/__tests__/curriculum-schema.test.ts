/**
 * Story 19-1 — curriculum schema contract (rejection matrix).
 *
 * The content-integrity test proves shipped files PASS; this suite proves
 * the schema REJECTS the malformed shapes a future authoring pass could
 * produce — the superRefine invariants are the load-bearing part.
 */

import { curriculumUnitFileSchema } from "@/src/lib/schemas/curriculum";

function validLesson(n: number) {
  return {
    id: `a1-u1-l${n}`,
    order: n,
    canDoEn: "I can greet someone and introduce myself.",
    canDoFr: "Je peux saluer quelqu'un et me présenter.",
    grammarTarget: "The verb être with je/tu + subject pronouns",
    teachEn:
      "In French, être means to be. With je it becomes je suis (I am), and with tu it becomes tu es (you are). You use it to introduce yourself: Je suis Marie.",
    teachFr: "Le verbe être : je suis, tu es. Exemple : Je suis Marie.",
    vocab: Array.from({ length: 6 }, (_, i) => ({
      fr: `mot-${n}-${i}`,
      en: `word-${n}-${i}`,
    })),
    conversationScenario: {
      titleFr: "Premières salutations",
      goalEn: "Greet someone and introduce yourself",
      promptSeed:
        "Role-play meeting the learner for the first time. Greet them, ask their name, and keep every utterance under eight words.",
    },
  };
}

function validFile(lessonCount = 3) {
  return {
    curriculumVersion: 1,
    unit: {
      id: "a1-u1",
      level: "A1",
      order: 1,
      titleEn: "First Contact",
      titleFr: "Premiers contacts",
      lessons: Array.from({ length: lessonCount }, (_, i) => validLesson(i + 1)),
    },
  };
}

describe("Story 19-1 — curriculumUnitFileSchema", () => {
  it("accepts a well-formed unit file", () => {
    expect(curriculumUnitFileSchema.safeParse(validFile()).success).toBe(true);
  });

  it("rejects an unknown curriculumVersion (the 19.2 engine gates on versions it knows)", () => {
    const file = { ...validFile(), curriculumVersion: 2 };
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects non-contiguous lesson orders", () => {
    const file = validFile();
    file.unit.lessons[2].order = 5;
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects a lesson id that does not extend the unit id", () => {
    const file = validFile();
    file.unit.lessons[1].id = "a1-u2-l2";
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects duplicate lesson ids", () => {
    const file = validFile();
    file.unit.lessons[1].id = file.unit.lessons[0].id;
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects a vocab item introduced twice in the unit (case/whitespace-insensitive)", () => {
    const file = validFile();
    file.unit.lessons[1].vocab[0] = {
      fr: `  ${file.unit.lessons[0].vocab[0].fr.toUpperCase()} `,
      en: "dup",
    };
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects an over-budget promptSeed (Story 11-7 prompt-budget discipline)", () => {
    const file = validFile();
    file.unit.lessons[0].conversationScenario.promptSeed = "x".repeat(601);
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("R1: rejects a unit id whose level prefix contradicts the level field", () => {
    const file = validFile();
    file.unit.level = "B2";
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("R2: rejects a curly-apostrophe duplicate (U+2019 survives NFKC — the fold is explicit)", () => {
    const file = validFile();
    file.unit.lessons[0].vocab[0] = { fr: "aujourd'hui", en: "today" };
    file.unit.lessons[1].vocab[0] = { fr: "aujourd\u2019hui", en: "dup" };
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("R1: rejects an NFD-accented duplicate vocab item (Unicode-normalized dedup)", () => {
    const file = validFile();
    file.unit.lessons[0].vocab[0] = { fr: "enchant\u00e9", en: "nice to meet you" };
    // NFD form: e + combining acute accent.
    file.unit.lessons[1].vocab[0] = { fr: "enchante\u0301", en: "dup" };
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });

  it("R1: chrome-split enforced at the SCHEMA (authoring fails at parse, not just CI)", () => {
    const bad = validFile();
    bad.unit.lessons[0].canDoFr = "Je sais compter de un \u00e0 dix maintenant.";
    expect(curriculumUnitFileSchema.safeParse(bad).success).toBe(false);
    const bad2 = validFile();
    bad2.unit.lessons[0].canDoEn = "You can greet someone and introduce yourself.";
    expect(curriculumUnitFileSchema.safeParse(bad2).success).toBe(false);
  });

  it("R1: accepts an enumeration-dense 26-item vocab lesson; rejects 31", () => {
    const ok = validFile();
    ok.unit.lessons[0].vocab = Array.from({ length: 26 }, (_, i) => ({
      fr: `nombre-${i}`,
      en: `number-${i}`,
    }));
    expect(curriculumUnitFileSchema.safeParse(ok).success).toBe(true);
    const over = validFile();
    over.unit.lessons[0].vocab = Array.from({ length: 31 }, (_, i) => ({
      fr: `nombre-${i}`,
      en: `number-${i}`,
    }));
    expect(curriculumUnitFileSchema.safeParse(over).success).toBe(false);
  });

  it("rejects malformed ids at both levels", () => {
    expect(
      curriculumUnitFileSchema.safeParse({
        ...validFile(),
        unit: { ...validFile().unit, id: "A1-U1" },
      }).success
    ).toBe(false);
    const file = validFile();
    file.unit.lessons[0].id = "a1u1l1";
    expect(curriculumUnitFileSchema.safeParse(file).success).toBe(false);
  });
});
