import { TCF } from "../constants";
import { buildMockTestPrompt } from "../prompts/mock-test";

/**
 * Difficulty-distribution buckets are computed in-prompt as
 * Math.floor(count * 0.2 / 0.45 / 0.7 / 0.85). At the verified TCF Canada
 * count of 39, drift in either the bucket math or TCF.*_QUESTIONS would
 * silently re-balance the sample of A1/A2/.../C2 questions GPT-4o produces.
 * Pin both the bucket math and the resulting boundaries.
 */
describe("buildMockTestPrompt — difficulty distribution", () => {
  it("emits correct bucket boundaries for the listening section size", () => {
    const prompt = buildMockTestPrompt({ section: "listening", targetLevel: "B1" });
    // 39 → 7, 17, 27, 33 (Math.floor(39 * 0.2/0.45/0.7/0.85))
    expect(prompt).toContain(`Number of questions: ${TCF.LISTENING_QUESTIONS}`);
    expect(prompt).toContain("Questions 1-7: A1-A2");
    expect(prompt).toContain("Questions 8-17: A2-B1");
    expect(prompt).toContain("Questions 18-27: B1-B2");
    expect(prompt).toContain("Questions 28-33: B2-C1");
    expect(prompt).toContain("Questions 34-39: C1-C2");
  });

  it("emits correct bucket boundaries for the reading section size", () => {
    const prompt = buildMockTestPrompt({ section: "reading", targetLevel: "B1" });
    expect(prompt).toContain(`Number of questions: ${TCF.READING_QUESTIONS}`);
    expect(prompt).toContain("Questions 1-7: A1-A2");
    expect(prompt).toContain("Questions 34-39: C1-C2");
  });

  it("respects an explicit questionCount override", () => {
    const prompt = buildMockTestPrompt({
      section: "listening",
      targetLevel: "B1",
      questionCount: 20,
    });
    // count=20 → buckets 4 / 9 / 14 / 17 (Math.floor(20 * 0.2/0.45/0.7/0.85))
    expect(prompt).toContain("Number of questions: 20");
    expect(prompt).toContain("Questions 1-4: A1-A2");
    expect(prompt).toContain("Questions 18-20: C1-C2");
  });

  it("instructs the model to vary passageId across multiple passages", () => {
    const prompt = buildMockTestPrompt({ section: "reading", targetLevel: "B2" });
    expect(prompt).toContain("Do NOT label every question");
    // Sample passages must show distinct ids, not "p1" repeated.
    expect(prompt).toMatch(/"id":\s*"p2"/);
  });

  it("does not embed JS-style line comments inside the prompt body", () => {
    const prompt = buildMockTestPrompt({ section: "listening", targetLevel: "B1" });
    // The Epic 10.2 fence comment must live in source, not in the prompt sent
    // to GPT-4o (regression: review found it inside the template literal).
    expect(prompt).not.toContain("// Note:");
    expect(prompt).not.toContain("Epic 10.2");
    expect(prompt).not.toContain("story 9-1");
  });

  it("does not have a grammar section config (TCF Canada has no Grammar)", () => {
    // TypeScript would catch this at compile time, but a runtime guard
    // documents the contract for the [testId] route which casts dynamic
    // params through `as Section`. A future regression that re-adds grammar
    // to MockTestQcmSection should make this test fail loudly.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildMockTestPrompt({ section: "grammar" as any, targetLevel: "B1" });
    }).toThrow();
  });
});
