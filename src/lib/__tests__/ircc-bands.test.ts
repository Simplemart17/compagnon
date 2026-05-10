import {
  IRCC_CLB_BANDS,
  clbLevelFromListeningScore,
  clbLevelFromReadingScore,
  clbLevelFromWritingSpeakingScore,
} from "../ircc-bands";

/**
 * Tests pinning the IRCC CLB ↔ TCF Canada per-skill equivalency bands.
 *
 * Source of truth: docs/tcf-spec-source.md §2.2 — values are transcribed
 * verbatim. If these tests fail, the runtime table has drifted from the
 * snapshot and the matrix is out of sync.
 *
 * Story 10-2.
 */

describe("IRCC_CLB_BANDS — band-boundary correctness", () => {
  describe("Listening (0–699 scale)", () => {
    it("CLB 1–3 ends at 330", () => {
      expect(IRCC_CLB_BANDS.listeningReading["1-3"].listening).toEqual([0, 330]);
    });
    it("CLB 4 is 331–368", () => {
      expect(IRCC_CLB_BANDS.listeningReading["4"].listening).toEqual([331, 368]);
    });
    it("CLB 5 is 369–397", () => {
      expect(IRCC_CLB_BANDS.listeningReading["5"].listening).toEqual([369, 397]);
    });
    it("CLB 6 is 398–457", () => {
      expect(IRCC_CLB_BANDS.listeningReading["6"].listening).toEqual([398, 457]);
    });
    it("CLB 7 (Express Entry threshold) is 458–502", () => {
      expect(IRCC_CLB_BANDS.listeningReading["7"].listening).toEqual([458, 502]);
    });
    it("CLB 8 is 503–522", () => {
      expect(IRCC_CLB_BANDS.listeningReading["8"].listening).toEqual([503, 522]);
    });
    it("CLB 9 is 523–548", () => {
      expect(IRCC_CLB_BANDS.listeningReading["9"].listening).toEqual([523, 548]);
    });
    it("CLB 10–12 is 549–699", () => {
      expect(IRCC_CLB_BANDS.listeningReading["10-12"].listening).toEqual([549, 699]);
    });
  });

  describe("Reading (0–699 scale)", () => {
    it("CLB 1–3 ends at 341", () => {
      expect(IRCC_CLB_BANDS.listeningReading["1-3"].reading).toEqual([0, 341]);
    });
    it("CLB 4 is 342–374", () => {
      expect(IRCC_CLB_BANDS.listeningReading["4"].reading).toEqual([342, 374]);
    });
    it("CLB 5 is 375–405", () => {
      expect(IRCC_CLB_BANDS.listeningReading["5"].reading).toEqual([375, 405]);
    });
    it("CLB 6 is 406–452", () => {
      expect(IRCC_CLB_BANDS.listeningReading["6"].reading).toEqual([406, 452]);
    });
    it("CLB 7 (Express Entry threshold) is 453–498", () => {
      expect(IRCC_CLB_BANDS.listeningReading["7"].reading).toEqual([453, 498]);
    });
    it("CLB 8 is 499–523", () => {
      expect(IRCC_CLB_BANDS.listeningReading["8"].reading).toEqual([499, 523]);
    });
    it("CLB 9 is 524–548", () => {
      expect(IRCC_CLB_BANDS.listeningReading["9"].reading).toEqual([524, 548]);
    });
    it("CLB 10–12 is 549–699", () => {
      expect(IRCC_CLB_BANDS.listeningReading["10-12"].reading).toEqual([549, 699]);
    });
  });

  describe("Writing/Speaking (0–20 scale)", () => {
    it("CLB 1–3 is 0–3", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["1-3"]).toEqual([0, 3]);
    });
    it("CLB 4 is 4–5", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["4"]).toEqual([4, 5]);
    });
    it("CLB 5 is exactly 6", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["5"]).toEqual([6, 6]);
    });
    it("CLB 6 is 7–9", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["6"]).toEqual([7, 9]);
    });
    it("CLB 7 (Express Entry threshold) is 10–11", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["7"]).toEqual([10, 11]);
    });
    it("CLB 8 is 12–13", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["8"]).toEqual([12, 13]);
    });
    it("CLB 9 is 14–15", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["9"]).toEqual([14, 15]);
    });
    it("CLB 10–12 is 16–20", () => {
      expect(IRCC_CLB_BANDS.writingSpeaking["10-12"]).toEqual([16, 20]);
    });
  });
});

describe("clbLevelFromListeningScore", () => {
  it("458 → CLB 7 (Express Entry threshold lower bound)", () => {
    expect(clbLevelFromListeningScore(458)).toBe("7");
  });
  it("457 → CLB 6 (one below the EE threshold)", () => {
    expect(clbLevelFromListeningScore(457)).toBe("6");
  });
  it("502 → CLB 7 (EE upper bound)", () => {
    expect(clbLevelFromListeningScore(502)).toBe("7");
  });
  it("503 → CLB 8 (one above EE)", () => {
    expect(clbLevelFromListeningScore(503)).toBe("8");
  });
  it("0 → CLB 1–3 (below floor still in lowest band)", () => {
    expect(clbLevelFromListeningScore(0)).toBe("1-3");
  });
  it("699 → CLB 10–12 (perfect score)", () => {
    expect(clbLevelFromListeningScore(699)).toBe("10-12");
  });
  it("549 → CLB 10–12 (band lower bound)", () => {
    expect(clbLevelFromListeningScore(549)).toBe("10-12");
  });
  it("548 → CLB 9 (one below 10–12)", () => {
    expect(clbLevelFromListeningScore(548)).toBe("9");
  });
  it("negative score → null", () => {
    expect(clbLevelFromListeningScore(-1)).toBeNull();
  });
  it("NaN → null", () => {
    expect(clbLevelFromListeningScore(NaN)).toBeNull();
  });
  it("above 699 → null (out of band)", () => {
    expect(clbLevelFromListeningScore(700)).toBeNull();
  });
});

describe("clbLevelFromReadingScore", () => {
  it("453 → CLB 7 (EE threshold lower bound)", () => {
    expect(clbLevelFromReadingScore(453)).toBe("7");
  });
  it("452 → CLB 6 (one below EE)", () => {
    expect(clbLevelFromReadingScore(452)).toBe("6");
  });
  it("498 → CLB 7 (EE upper bound)", () => {
    expect(clbLevelFromReadingScore(498)).toBe("7");
  });
  it("499 → CLB 8 (one above EE)", () => {
    expect(clbLevelFromReadingScore(499)).toBe("8");
  });
  it("523 → CLB 8 (band upper bound)", () => {
    expect(clbLevelFromReadingScore(523)).toBe("8");
  });
  it("524 → CLB 9 (band lower bound)", () => {
    expect(clbLevelFromReadingScore(524)).toBe("9");
  });
  it("0 → CLB 1–3", () => {
    expect(clbLevelFromReadingScore(0)).toBe("1-3");
  });
  it("699 → CLB 10–12", () => {
    expect(clbLevelFromReadingScore(699)).toBe("10-12");
  });
});

describe("clbLevelFromWritingSpeakingScore", () => {
  it("10 → CLB 7 (EE threshold lower bound)", () => {
    expect(clbLevelFromWritingSpeakingScore(10)).toBe("7");
  });
  it("9 → CLB 6 (one below EE)", () => {
    expect(clbLevelFromWritingSpeakingScore(9)).toBe("6");
  });
  it("11 → CLB 7 (EE upper bound)", () => {
    expect(clbLevelFromWritingSpeakingScore(11)).toBe("7");
  });
  it("12 → CLB 8 (one above EE)", () => {
    expect(clbLevelFromWritingSpeakingScore(12)).toBe("8");
  });
  it("6 → CLB 5 (single-value band)", () => {
    expect(clbLevelFromWritingSpeakingScore(6)).toBe("5");
  });
  it("0 → CLB 1–3", () => {
    expect(clbLevelFromWritingSpeakingScore(0)).toBe("1-3");
  });
  it("20 → CLB 10–12", () => {
    expect(clbLevelFromWritingSpeakingScore(20)).toBe("10-12");
  });
  it("16 → CLB 10–12 (band lower bound)", () => {
    expect(clbLevelFromWritingSpeakingScore(16)).toBe("10-12");
  });
  it("15 → CLB 9 (one below 10–12)", () => {
    expect(clbLevelFromWritingSpeakingScore(15)).toBe("9");
  });
  it("negative → null", () => {
    expect(clbLevelFromWritingSpeakingScore(-1)).toBeNull();
  });
  it("above 20 → null (out of band)", () => {
    expect(clbLevelFromWritingSpeakingScore(21)).toBeNull();
  });
});

describe("Round-trip — every band's [min, max] resolves back to that CLB level", () => {
  const clbLevels: ("1-3" | "4" | "5" | "6" | "7" | "8" | "9" | "10-12")[] = [
    "1-3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10-12",
  ];

  it.each(clbLevels)("listening: CLB %s band [min, max] both resolve to %s", (level) => {
    const [min, max] = IRCC_CLB_BANDS.listeningReading[level].listening;
    expect(clbLevelFromListeningScore(min)).toBe(level);
    expect(clbLevelFromListeningScore(max)).toBe(level);
  });

  it.each(clbLevels)("reading: CLB %s band [min, max] both resolve to %s", (level) => {
    const [min, max] = IRCC_CLB_BANDS.listeningReading[level].reading;
    expect(clbLevelFromReadingScore(min)).toBe(level);
    expect(clbLevelFromReadingScore(max)).toBe(level);
  });

  it.each(clbLevels)("writing/speaking: CLB %s band [min, max] both resolve to %s", (level) => {
    const [min, max] = IRCC_CLB_BANDS.writingSpeaking[level];
    expect(clbLevelFromWritingSpeakingScore(min)).toBe(level);
    expect(clbLevelFromWritingSpeakingScore(max)).toBe(level);
  });
});
