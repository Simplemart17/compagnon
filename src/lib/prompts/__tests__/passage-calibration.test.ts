/**
 * Story 10-3 — per-CEFR passage / per-task word range calibration tests.
 *
 * Pin the prompt-builder outputs against the source-of-truth at
 * docs/tcf-spec-source.md §3.1 (listening, operator-derived heuristics),
 * §4.1 (reading, operator-derived heuristics), and §5.1 (writing,
 * publisher-verbatim) + §5.3 (writing, enforcement-grade disqualification
 * rule).
 *
 * The contract is "the AI receives this range string in the prompt." We
 * assert positive substring matches for the new ranges AND negative
 * substring assertions for the legacy wrong values so a future drift that
 * re-introduces (e.g.) `"50-80 words"` for Task 1 fails loudly.
 *
 * Each per-CEFR / per-task assertion lives in its own `it()` block so a
 * single failure pinpoints the exact regression.
 */

import type { CEFRLevel } from "@/src/types/cefr";

import { buildListeningExercisePrompt } from "../listening";
import { buildReadingExercisePrompt } from "../reading";
import { buildWritingEvaluatorPrompt, writingTaskWordRange } from "../writing";

describe("buildListeningExercisePrompt — per-CEFR passage word ranges (Story 10-3, §3.1)", () => {
  it("A1: prompt declares the 30–80 word range", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "A1" });
    expect(prompt).toContain("30-80 words");
  });

  it("A2: prompt declares the 60–150 word range", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "A2" });
    expect(prompt).toContain("60-150 words");
  });

  it("B1: prompt declares the 100–200 word range", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B1" });
    expect(prompt).toContain("100-200 words");
  });

  it("B2: prompt declares the 150–300 word range (was 150-200, P1-3 fix)", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B2" });
    expect(prompt).toContain("150-300 words");
  });

  it("C1: prompt declares the 250–500 word range (was 200-300, P1-3 fix)", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "C1" });
    expect(prompt).toContain("250-500 words");
  });

  it("C2: prompt declares the 350–600 word range (was 250-350)", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "C2" });
    expect(prompt).toContain("350-600 words");
  });

  it("passage JSON-schema description spans the widened 30–600 range", () => {
    // The "<the French text to be spoken aloud — N-M words depending on level>"
    // descriptor is consumed by the AI; if it stays at the legacy 50-300 cap
    // the model under-shoots widened C1/C2 ranges. The "30-600" floor/ceiling
    // matches the union of all per-CEFR ranges above.
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B1" });
    expect(prompt).toContain("30-600 words depending on level");
  });

  describe("negative assertions — legacy wrong ranges must NOT appear", () => {
    it("A1 must not contain the legacy 30-50 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "A1" });
      expect(prompt).not.toContain("30-50 words");
    });

    it("A2 must not contain the legacy 50-80 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "A2" });
      expect(prompt).not.toContain("50-80 words");
    });

    it("B2 must not contain the legacy 150-200 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "B2" });
      expect(prompt).not.toContain("150-200 words");
    });

    it("C1 must not contain the legacy 200-300 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "C1" });
      expect(prompt).not.toContain("200-300 words");
    });

    it("C2 must not contain the legacy 250-350 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "C2" });
      expect(prompt).not.toContain("250-350 words");
    });

    it("JSON-schema description must not retain the legacy 50-300 cap", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "B1" });
      expect(prompt).not.toContain("50-300 words depending on level");
    });
  });
});

describe("buildReadingExercisePrompt — per-CEFR passage word ranges (Story 10-3, §4.1)", () => {
  it("A1: prompt declares the 30–60 word range (unchanged)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "A1" });
    expect(prompt).toContain("30-60 words");
  });

  it("A2: prompt declares the 60–120 word range (unchanged)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "A2" });
    expect(prompt).toContain("60-120 words");
  });

  it("B1: prompt declares the 120–250 word range (was 120-200)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "B1" });
    expect(prompt).toContain("120-250 words");
  });

  it("B2: prompt declares the 250–450 word range (was 200-300, P1-3 fix)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "B2" });
    expect(prompt).toContain("250-450 words");
  });

  it("C1: prompt declares the 450–700 word range (was 300-400, P1-3 fix)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "C1" });
    expect(prompt).toContain("450-700 words");
  });

  it("C2: prompt declares the 600–900+ word range (was 350-500)", () => {
    const prompt = buildReadingExercisePrompt({ cefrLevel: "C2" });
    expect(prompt).toContain("600-900");
  });

  describe("negative assertions — legacy wrong ranges must NOT appear", () => {
    it("B1 must not contain the legacy 120-200 cap", () => {
      const prompt = buildReadingExercisePrompt({ cefrLevel: "B1" });
      expect(prompt).not.toContain("120-200 words");
    });

    it("B2 must not contain the legacy 200-300 cap", () => {
      const prompt = buildReadingExercisePrompt({ cefrLevel: "B2" });
      expect(prompt).not.toContain("200-300 words");
    });

    it("C1 must not contain the legacy 300-400 cap", () => {
      const prompt = buildReadingExercisePrompt({ cefrLevel: "C1" });
      expect(prompt).not.toContain("300-400 words");
    });

    it("C2 must not contain the legacy 350-500 cap", () => {
      const prompt = buildReadingExercisePrompt({ cefrLevel: "C2" });
      expect(prompt).not.toContain("350-500 words");
    });
  });
});

describe("buildWritingEvaluatorPrompt — publisher-verbatim per-task ranges (Story 10-3, §5.1)", () => {
  // The user's CEFR level does not change the per-task word range — the
  // publisher's §5.1 ranges are uniform across CEFR levels. We sweep one
  // representative level per task to confirm.
  const sampleLevel: CEFRLevel = "B1";
  const samplePrompt = "Décrivez votre routine quotidienne.";

  it("Task 1: prompt declares the 60–120 word range (publisher-verbatim §5.1; was 50-80)", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: sampleLevel,
      taskNumber: 1,
      prompt: samplePrompt,
    });
    expect(prompt).toContain("60-120 words");
  });

  it("Task 2: prompt declares the 120–150 word range (publisher-verbatim §5.1; unchanged)", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: sampleLevel,
      taskNumber: 2,
      prompt: samplePrompt,
    });
    expect(prompt).toContain("120-150 words");
  });

  it("Task 3: prompt declares the 120–180 word range (publisher-verbatim §5.1; was 250-300, P1-3 HIGH)", () => {
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: sampleLevel,
      taskNumber: 3,
      prompt: samplePrompt,
    });
    expect(prompt).toContain("120-180 words");
  });

  it("Task 3 at C1: still uses the publisher-uniform 120–180 range (no C1-tier 250-300 carve-out)", () => {
    // The legacy code framed Task 3 as "200+ words (250-300 for C1 target)".
    // Per §5.1 the range is publisher-uniform across all CEFR levels — no
    // per-level carve-out exists.
    const prompt = buildWritingEvaluatorPrompt({
      cefrLevel: "C1",
      taskNumber: 3,
      prompt: samplePrompt,
    });
    expect(prompt).toContain("120-180 words");
    expect(prompt).not.toContain("250-300 words");
    expect(prompt).not.toContain("200+ words");
  });

  // Run the §5.3 surfacing check across all three task numbers so a future
  // refactor that accidentally scopes the enforcement block to Task 1 only
  // (e.g. `if (taskNumber === 1) ...`) fails loudly.
  it.each([1, 2, 3] as const)(
    "Task %i: surfaces the §5.3 disqualification rule ('A1 non atteint')",
    (taskNumber) => {
      // Per §5.3 a Writing submission outside the per-task word range is
      // automatically evaluated as "A1 non atteint" regardless of content
      // quality. The system prompt MUST tell the AI this so it never
      // generates a writing prompt that demands more text than the
      // publisher allows. The enforcement block also lists ALL three task
      // ranges (helper-templated) so any single-task prompt carries the
      // publisher-uniform contract.
      const prompt = buildWritingEvaluatorPrompt({
        cefrLevel: sampleLevel,
        taskNumber,
        prompt: samplePrompt,
      });
      expect(prompt).toMatch(/A1 non atteint/);
      expect(prompt).toMatch(/Publisher Word Count Enforcement/);
      // §5.3 block must enumerate the publisher-uniform ranges helper-driven.
      expect(prompt).toContain("Task 1: 60-120 words");
      expect(prompt).toContain("Task 2: 120-150 words");
      expect(prompt).toContain("Task 3: 120-180 words");
    }
  );

  describe("negative assertions — legacy wrong ranges must NOT appear", () => {
    it("Task 1 must not contain the legacy 50-80 range", () => {
      const prompt = buildWritingEvaluatorPrompt({
        cefrLevel: sampleLevel,
        taskNumber: 1,
        prompt: samplePrompt,
      });
      expect(prompt).not.toContain("50-80 words");
    });

    it("Task 3 must not contain the legacy 250-300 words range", () => {
      // Tightened to the literal-with-suffix to avoid spurious failures if a
      // future Task 3 prompt mentions an unrelated numeric range (e.g. years
      // 250-300 BCE in a passage citation).
      const prompt = buildWritingEvaluatorPrompt({
        cefrLevel: sampleLevel,
        taskNumber: 3,
        prompt: samplePrompt,
      });
      expect(prompt).not.toContain("250-300 words");
    });

    it("Task 3 must not contain the legacy '200+ words' framing", () => {
      const prompt = buildWritingEvaluatorPrompt({
        cefrLevel: sampleLevel,
        taskNumber: 3,
        prompt: samplePrompt,
      });
      expect(prompt).not.toContain("200+ words");
    });
  });
});

describe("use-exercise.ts writing flow — single-source-of-truth import guard (Story 10-3)", () => {
  // Lockstep-update risk mitigation: ensure `src/hooks/use-exercise.ts`
  // continues to import `writingTaskWordRange` from `writing.ts`. A future
  // refactor that re-hardcodes a `minWords`/`maxWords` ladder inline would
  // silently re-introduce the pre-10-3 three-site drift risk; this guard
  // fails the build before that lands.
  it("imports writingTaskWordRange from src/lib/prompts/writing", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const hookFilePath = path.join(__dirname, "..", "..", "..", "hooks", "use-exercise.ts");
    const hookSource = fs.readFileSync(hookFilePath, "utf8");
    expect(hookSource).toMatch(
      /import\s*\{[^}]*\bwritingTaskWordRange\b[^}]*\}\s*from\s*["']@\/src\/lib\/prompts\/writing["']/
    );
    // Ensure the helper is actually consumed (not just imported and unused).
    expect(hookSource).toMatch(/writingTaskWordRange\s*\(\s*taskNumber\s*\)/);
  });

  it("does not hardcode a per-task minWords/maxWords ladder", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const hookFilePath = path.join(__dirname, "..", "..", "..", "hooks", "use-exercise.ts");
    const hookSource = fs.readFileSync(hookFilePath, "utf8");
    // Catches any future regression that re-introduces the pre-10-3
    // `taskNumber === 1 ? 50 : taskNumber === 2 ? 120 : 200` shape OR the
    // §5.1-compliant `60 : 120 : 120` shape. Both are wrong because they
    // bypass the single-source-of-truth helper.
    expect(hookSource).not.toMatch(
      /taskNumber\s*===\s*1\s*\?\s*\d+\s*:\s*taskNumber\s*===\s*2\s*\?\s*\d+\s*:\s*\d+/
    );
  });
});

describe("writingTaskWordRange helper (Story 10-3) — single source of truth for §5.1 ranges", () => {
  // Lockstep-update risk mitigation: the helper exported from writing.ts
  // is the authoritative source for every site that needs to know the
  // per-task word range (writing.ts TASK_EXPECTATIONS, use-exercise.ts
  // ladder + AI prompt body). Pinning the helper's output here means a
  // future drift in any one site fails this test before it can ship.

  it("Task 1: returns { min: 60, max: 120 } per §5.1", () => {
    expect(writingTaskWordRange(1)).toEqual({ min: 60, max: 120 });
  });

  it("Task 2: returns { min: 120, max: 150 } per §5.1", () => {
    expect(writingTaskWordRange(2)).toEqual({ min: 120, max: 150 });
  });

  it("Task 3: returns { min: 120, max: 180 } per §5.1", () => {
    expect(writingTaskWordRange(3)).toEqual({ min: 120, max: 180 });
  });

  it("throws (does not silently return undefined) for non-{1,2,3} input at runtime", () => {
    // TypeScript narrows the param to `1 | 2 | 3`, but at runtime a
    // deserialised DB row or deep-link param can escape narrowing. Guard
    // against the no-default-switch silent-undefined-return footgun.
    expect(() => writingTaskWordRange(0 as unknown as 1)).toThrow(/unsupported taskNumber/);
    expect(() => writingTaskWordRange(4 as unknown as 1)).toThrow(/unsupported taskNumber/);
    expect(() => writingTaskWordRange(undefined as unknown as 1)).toThrow(/unsupported taskNumber/);
  });
});
