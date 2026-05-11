/**
 * Story 10-7 — listening prompt builder tests.
 *
 * Covers:
 *   - AC #4: Québécois arm dropped from `dialect?` union + `DIALECT_GUIDANCE`
 *     map per audit decision D5 (`shippable-roadmap.md §6`) and
 *     `docs/tcf-spec-source.md §8.3`. v2 reintroduction requires
 *     native-speaker review.
 *
 * Type-narrowing is enforced via `@ts-expect-error` — a future widening
 * of the `dialect?` union back to admit `"quebecois"` would silently
 * remove the expected error and fail this test.
 */

import { buildListeningExercisePrompt } from "../listening";

describe("buildListeningExercisePrompt — Québécois drop (Story 10-7 / audit D5)", () => {
  it("renders metropolitan guidance without Québécois leakage in the prompt body", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "metropolitan" });
    expect(prompt).toContain("Standard Parisian/metropolitan French");
    for (const forbidden of ["Québécois", "quebecois", "icitte", "pantoute", "chez nous", "tsu"]) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("renders African dialect arm without Québécois leakage", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "african" });
    expect(prompt).toContain("West African French");
    for (const forbidden of ["Québécois", "quebecois", "icitte", "pantoute"]) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("defaults to metropolitan when dialect is omitted", () => {
    const prompt = buildListeningExercisePrompt({ cefrLevel: "B1" });
    expect(prompt).toContain("Standard Parisian/metropolitan French");
  });

  it("type union no longer admits 'quebecois' (compile-time guard)", () => {
    // If a future patch widens the union back to admit "quebecois",
    // the @ts-expect-error directive becomes a real error and this
    // test fails — same Story 9-7 pattern as the ZodIssueCode lock.
    type Params = Parameters<typeof buildListeningExercisePrompt>[0];
    const _bad: Params = {
      cefrLevel: "B1",
      // @ts-expect-error — Story 10-7 / audit D5: "quebecois" deferred to v2
      dialect: "quebecois",
    };
    expect(_bad).toBeDefined();
  });

  it("throws at runtime if dialect bypasses TS narrowing (review-patch P6)", () => {
    // ECH2 defense: a deserialised DB row, a deep-link param, or a
    // future cross-builder call could pass a non-literal string that
    // escapes TS narrowing. The function must throw rather than
    // emit `(undefined)` into the system prompt.
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "quebecois" as any })
    ).toThrow(/unsupported dialect "quebecois"/);
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "garbage-string" as any })
    ).toThrow(/unsupported dialect/);
  });
});
