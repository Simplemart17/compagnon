import {
  rawPercentToListeningReadingScore,
  rawPercentToWritingSpeakingScore,
  calculateSectionScore,
  calculateInternalCompositeForUI,
  formatTCFScore,
} from "../scoring";
import {
  IRCC_CLB_BANDS,
  clbLevelFromListeningScore,
  clbLevelFromReadingScore,
  clbLevelFromWritingSpeakingScore,
} from "../ircc-bands";

/**
 * Tests for the per-skill scoring pipeline (Story 10-2).
 *
 * The legacy 7-band linear `rawToTCFScore` was deleted; these tests pin
 * the new IRCC-anchored conversion functions to the publisher's CLB bands
 * in docs/tcf-spec-source.md §2.2 (transcribed into
 * src/lib/ircc-bands.ts).
 *
 * The contract being tested is:
 * - Each function clamps to [0, scale-max]
 * - Each function is monotonic non-decreasing in raw %
 * - For each CLB band B, raw % inside B's calibration range lands in B's
 *   score range (round-trip-band-preserving)
 */

describe("rawPercentToListeningReadingScore — boundary + clamp behavior", () => {
  it("maps 0% to score 0 (lowest end of CLB 1–3 raw band)", () => {
    expect(rawPercentToListeningReadingScore(0, "listening")).toBe(0);
    expect(rawPercentToListeningReadingScore(0, "reading")).toBe(0);
  });

  it("maps 100% to 699 (top of CLB 10–12)", () => {
    expect(rawPercentToListeningReadingScore(100, "listening")).toBe(699);
    expect(rawPercentToListeningReadingScore(100, "reading")).toBe(699);
  });

  it("clamps raw% above 100 to the ceiling", () => {
    expect(rawPercentToListeningReadingScore(150, "listening")).toBe(699);
  });

  it("clamps negative raw% to 0", () => {
    expect(rawPercentToListeningReadingScore(-10, "listening")).toBe(0);
  });

  it("non-finite raw% (NaN) becomes 0", () => {
    expect(rawPercentToListeningReadingScore(NaN, "listening")).toBe(0);
  });
});

describe("rawPercentToListeningReadingScore — CLB band round-trip", () => {
  // 12 anchor pairs (raw%, expected CLB level) sourced from
  // docs/tcf-spec-source.md §2.2 calibration in scoring.ts.
  // Each raw% MUST produce a score that lands in the expected CLB band.
  // Includes lower-bound / interior / upper-bound coverage of each CLB
  // band so off-by-one boundary regressions are caught.
  const listeningAnchors: {
    rawPercent: number;
    expectedCLB: keyof typeof IRCC_CLB_BANDS.listeningReading;
  }[] = [
    { rawPercent: 10, expectedCLB: "1-3" }, // well below CLB 4
    { rawPercent: 35, expectedCLB: "4" }, // CLB 4 lower boundary (exclusive-upper semantic)
    { rawPercent: 40, expectedCLB: "4" }, // CLB 4 interior
    { rawPercent: 50, expectedCLB: "5" }, // CLB 5 lower boundary
    { rawPercent: 55, expectedCLB: "5" }, // CLB 5 interior
    { rawPercent: 65, expectedCLB: "6" }, // CLB 6 interior
    { rawPercent: 75, expectedCLB: "7" }, // CLB 7 lower boundary — Express Entry threshold
    { rawPercent: 78, expectedCLB: "7" }, // CLB 7 interior
    { rawPercent: 85, expectedCLB: "8" }, // CLB 8 interior
    { rawPercent: 90, expectedCLB: "9" }, // CLB 9 interior
    { rawPercent: 93, expectedCLB: "10-12" }, // CLB 10-12 lower boundary
    { rawPercent: 96, expectedCLB: "10-12" }, // CLB 10-12 interior
  ];

  it.each(listeningAnchors)(
    "listening %i% lands in CLB $expectedCLB",
    ({ rawPercent, expectedCLB }) => {
      const score = rawPercentToListeningReadingScore(rawPercent, "listening");
      expect(clbLevelFromListeningScore(score)).toBe(expectedCLB);
    }
  );

  it.each(listeningAnchors)(
    "reading %i% lands in CLB $expectedCLB",
    ({ rawPercent, expectedCLB }) => {
      const score = rawPercentToListeningReadingScore(rawPercent, "reading");
      expect(clbLevelFromReadingScore(score)).toBe(expectedCLB);
    }
  );
});

describe("rawPercentToListeningReadingScore — monotonicity", () => {
  it("produces monotonic non-decreasing scores for ascending raw%", () => {
    const percentages = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const listeningScores = percentages.map((p) =>
      rawPercentToListeningReadingScore(p, "listening")
    );
    for (let i = 1; i < listeningScores.length; i++) {
      expect(listeningScores[i]).toBeGreaterThanOrEqual(listeningScores[i - 1]);
    }

    const readingScores = percentages.map((p) => rawPercentToListeningReadingScore(p, "reading"));
    for (let i = 1; i < readingScores.length; i++) {
      expect(readingScores[i]).toBeGreaterThanOrEqual(readingScores[i - 1]);
    }
  });
});

describe("rawPercentToWritingSpeakingScore — boundary + clamp behavior", () => {
  it("maps 0% to score 0 (lowest end of CLB 1–3 raw band)", () => {
    expect(rawPercentToWritingSpeakingScore(0)).toBe(0);
  });

  it("maps 100% to 20 (top of CLB 10–12)", () => {
    expect(rawPercentToWritingSpeakingScore(100)).toBe(20);
  });

  it("clamps raw% above 100 to ceiling 20", () => {
    expect(rawPercentToWritingSpeakingScore(120)).toBe(20);
  });

  it("clamps negative raw% to 0", () => {
    expect(rawPercentToWritingSpeakingScore(-5)).toBe(0);
  });

  it("non-finite raw% (NaN) becomes 0", () => {
    expect(rawPercentToWritingSpeakingScore(NaN)).toBe(0);
  });
});

describe("rawPercentToWritingSpeakingScore — CLB band round-trip", () => {
  // 9 anchor pairs covering each CLB band + boundary coverage.
  const wsAnchors: {
    rawPercent: number;
    expectedCLB: keyof typeof IRCC_CLB_BANDS.writingSpeaking;
  }[] = [
    { rawPercent: 10, expectedCLB: "1-3" },
    { rawPercent: 25, expectedCLB: "4" },
    { rawPercent: 32, expectedCLB: "5" },
    { rawPercent: 42, expectedCLB: "6" },
    { rawPercent: 50, expectedCLB: "7" }, // CLB 7 lower boundary — Express Entry threshold
    { rawPercent: 55, expectedCLB: "7" }, // CLB 7 interior
    { rawPercent: 65, expectedCLB: "8" },
    { rawPercent: 75, expectedCLB: "9" },
    { rawPercent: 90, expectedCLB: "10-12" },
  ];

  it.each(wsAnchors)(
    "writing/speaking %i% lands in CLB $expectedCLB",
    ({ rawPercent, expectedCLB }) => {
      const score = rawPercentToWritingSpeakingScore(rawPercent);
      expect(clbLevelFromWritingSpeakingScore(score)).toBe(expectedCLB);
    }
  );
});

describe("rawPercentToWritingSpeakingScore — monotonicity", () => {
  it("produces monotonic non-decreasing scores for ascending raw%", () => {
    const percentages = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const scores = percentages.map(rawPercentToWritingSpeakingScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

describe("calculateSectionScore", () => {
  it("derives correct percentage + lands in correct CLB band (TCF Canada 39q)", () => {
    // 27 / 39 ≈ 69.23% — mid B2 / CLB 6 territory.
    const result = calculateSectionScore(27, 39, "listening");
    expect(result.rawPercent).toBeCloseTo(69.23, 1);
    expect(clbLevelFromListeningScore(result.tcfScore)).toBe("6");
  });

  it("returns zero for zero total questions", () => {
    const result = calculateSectionScore(0, 0, "listening");
    expect(result.rawPercent).toBe(0);
    expect(result.tcfScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });

  it("returns perfect score (699) for all correct", () => {
    const result = calculateSectionScore(39, 39, "reading");
    expect(result.rawPercent).toBe(100);
    expect(result.tcfScore).toBe(699);
    expect(result.cefrLevel).toBe("C2");
  });

  it("listening and reading at the same raw% may produce different TCF scores (band differences)", () => {
    // 27/39 = 69.23% — within CLB 6 raw band but listening and reading
    // CLB 6 score ranges differ (listening 398-457, reading 406-452).
    const listening = calculateSectionScore(27, 39, "listening");
    const reading = calculateSectionScore(27, 39, "reading");
    expect(listening.tcfScore).toBeGreaterThanOrEqual(398);
    expect(listening.tcfScore).toBeLessThanOrEqual(457);
    expect(reading.tcfScore).toBeGreaterThanOrEqual(406);
    expect(reading.tcfScore).toBeLessThanOrEqual(452);
  });
});

describe("calculateInternalCompositeForUI", () => {
  it("averages listening + reading on the 0–699 scale (4-skill scope: L/R only)", () => {
    const result = calculateInternalCompositeForUI({
      listening: 400,
      reading: 400,
    });
    expect(result.compositeScore).toBe(400);
    expect(result.cefrLevel).toBe("B2");
    expect(result.distanceToC1).toBe(100);
  });

  it("silently drops writing/speaking (0–20 scale) — composite is L/R-only to avoid scale conflation", () => {
    const result = calculateInternalCompositeForUI({
      listening: 500,
      reading: 500,
      writing: 12,
      speaking: 14,
    });
    // Only listening + reading are averaged. writing=12 (0–20) and
    // speaking=14 (0–20) are silently dropped — they are on a different
    // scale and would produce meaningless math if mixed in.
    expect(result.compositeScore).toBe(500);
    expect(result.cefrLevel).toBe("C1");
    expect(result.distanceToC1).toBe(0);
  });

  it("silently drops grammar (not a TCF Canada skill)", () => {
    const result = calculateInternalCompositeForUI({
      listening: 400,
      reading: 400,
      grammar: 800, // dropped: not part of TCF Canada
    });
    expect(result.compositeScore).toBe(400);
  });

  it("handles partial skill scores (only listening present)", () => {
    const result = calculateInternalCompositeForUI({ listening: 500 });
    expect(result.compositeScore).toBe(500);
    expect(result.cefrLevel).toBe("C1");
    expect(result.distanceToC1).toBe(0);
  });

  it("returns zero for empty skills", () => {
    const result = calculateInternalCompositeForUI({});
    expect(result.compositeScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });

  it("returns zero for grammar-only input (dropped)", () => {
    const result = calculateInternalCompositeForUI({ grammar: 500 });
    expect(result.compositeScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });

  it("returns zero for writing-only input (dropped — scale conflict)", () => {
    const result = calculateInternalCompositeForUI({ writing: 15 });
    expect(result.compositeScore).toBe(0);
    expect(result.cefrLevel).toBeNull();
  });

  it("ignores non-finite scores", () => {
    const result = calculateInternalCompositeForUI({
      listening: 500,
      reading: NaN,
    });
    expect(result.compositeScore).toBe(500);
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
