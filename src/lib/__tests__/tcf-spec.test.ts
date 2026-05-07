import { TCF } from "../constants";

/**
 * Regression tests pinning the TCF Canada specification.
 *
 * Source of truth: docs/tcf-spec-source.md
 * (verified 2026-05-07 against https://www.france-education-international.fr/test/tcf-canada).
 *
 * If any of these fail, the in-app spec has drifted from the publisher's
 * official structure. Either re-verify the source and update both
 * docs/tcf-spec-source.md and src/lib/constants.ts in lockstep, or revert.
 */
describe("TCF Canada spec contract — verified against docs/tcf-spec-source.md", () => {
  it("is configured for the Canada variant", () => {
    expect(TCF.VARIANT).toBe("canada");
  });

  it("matches authoritative listening (Compréhension orale) spec", () => {
    expect(TCF.LISTENING_QUESTIONS).toBe(39);
    expect(TCF.LISTENING_MINUTES).toBe(35);
  });

  it("matches authoritative reading (Compréhension écrite) spec", () => {
    expect(TCF.READING_QUESTIONS).toBe(39);
    expect(TCF.READING_MINUTES).toBe(60);
  });

  it("matches authoritative writing (Expression écrite) duration", () => {
    expect(TCF.WRITING_MINUTES).toBe(60);
  });

  it("matches authoritative speaking (Expression orale) duration including 2 min preparation", () => {
    expect(TCF.SPEAKING_MINUTES).toBe(12);
  });

  it("does not expose a Grammar / Maîtrise des Structures section (TCF Canada has none)", () => {
    expect(TCF).not.toHaveProperty("GRAMMAR_QUESTIONS");
    expect(TCF).not.toHaveProperty("GRAMMAR_MINUTES");
  });

  it("QCM mandatory total falls within the publisher's stated 95-minute combined block", () => {
    // 35 + 60 = 95. If this regresses, double-check the publisher page; the
    // mock-test landing UI ("~95 min" pill) is computed from this sum.
    expect(TCF.LISTENING_MINUTES + TCF.READING_MINUTES).toBe(95);
  });
});
