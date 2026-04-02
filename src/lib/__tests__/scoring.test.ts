import {
  rawToTCFScore,
  calculateSectionScore,
  calculateCompositeScore,
  formatTCFScore,
} from "../scoring";

describe("rawToTCFScore", () => {
  it("maps 0% to 0", () => {
    expect(rawToTCFScore(0)).toBe(0);
  });

  it("maps 100% to 699", () => {
    expect(rawToTCFScore(100)).toBe(699);
  });

  it("clamps values above 100", () => {
    expect(rawToTCFScore(150)).toBe(rawToTCFScore(100));
  });

  it("clamps negative values to 0", () => {
    expect(rawToTCFScore(-10)).toBe(0);
  });

  it("maps 20% to boundary of below-A1 (99)", () => {
    expect(rawToTCFScore(20)).toBe(99);
  });

  it("maps 35% to A1 range upper boundary (199)", () => {
    expect(rawToTCFScore(35)).toBe(199);
  });

  it("maps 50% to A2 range upper boundary (299)", () => {
    expect(rawToTCFScore(50)).toBe(299);
  });

  it("maps 65% to B1 range upper boundary (399)", () => {
    expect(rawToTCFScore(65)).toBe(399);
  });

  it("maps 80% to B2 range upper boundary (499)", () => {
    expect(rawToTCFScore(80)).toBe(499);
  });

  it("maps 90% to C2 range start (600) — boundary falls into C2 branch", () => {
    expect(rawToTCFScore(90)).toBe(600);
  });

  it("produces scores in ascending order for ascending percentages", () => {
    const percentages = [0, 10, 25, 40, 55, 70, 85, 95, 100];
    const scores = percentages.map(rawToTCFScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });
});

describe("calculateSectionScore", () => {
  it("calculates correct percentage and TCF score", () => {
    const result = calculateSectionScore(20, 29);
    expect(result.rawPercent).toBeCloseTo(68.97, 1);
    expect(result.tcfScore).toBeGreaterThanOrEqual(400);
    expect(result.tcfScore).toBeLessThan(500);
    expect(result.cefrLevel).toBe("B2");
  });

  it("returns zero for zero total questions", () => {
    const result = calculateSectionScore(0, 0);
    expect(result.rawPercent).toBe(0);
    expect(result.tcfScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });

  it("returns perfect score for all correct", () => {
    const result = calculateSectionScore(29, 29);
    expect(result.rawPercent).toBe(100);
    expect(result.tcfScore).toBe(699);
    expect(result.cefrLevel).toBe("C2");
  });
});

describe("calculateCompositeScore", () => {
  it("calculates equal-weighted composite for all skills", () => {
    const result = calculateCompositeScore({
      listening: 400,
      reading: 400,
      grammar: 400,
      speaking: 400,
      writing: 400,
    });
    expect(result.compositeScore).toBe(400);
    expect(result.cefrLevel).toBe("B2");
    expect(result.distanceToC1).toBe(100);
  });

  it("handles partial skill scores", () => {
    const result = calculateCompositeScore({
      listening: 500,
      reading: 500,
    });
    expect(result.compositeScore).toBe(500);
    expect(result.cefrLevel).toBe("C1");
    expect(result.distanceToC1).toBe(0);
  });

  it("returns zero for empty skills", () => {
    const result = calculateCompositeScore({});
    expect(result.compositeScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });
});

describe("formatTCFScore", () => {
  it("formats score with CEFR level", () => {
    expect(formatTCFScore(450)).toBe("450/699 (B2)");
  });

  it("formats score without level for below A1", () => {
    expect(formatTCFScore(50)).toBe("50/699");
  });
});
