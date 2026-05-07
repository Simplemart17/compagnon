import { TCF } from "../constants";
import { ALL_QCM_SECTIONS, TCF_QCM_SECTIONS, roundToNearestFive } from "../tcf";

describe("roundToNearestFive", () => {
  it("returns the input when already a multiple of 5", () => {
    expect(roundToNearestFive(95)).toBe(95);
    expect(roundToNearestFive(0)).toBe(0);
    expect(roundToNearestFive(5)).toBe(5);
  });

  it("rounds down when closer to the lower multiple", () => {
    expect(roundToNearestFive(87)).toBe(85);
    expect(roundToNearestFive(2)).toBe(0);
  });

  it("rounds up when closer to the higher multiple", () => {
    expect(roundToNearestFive(113)).toBe(115);
    expect(roundToNearestFive(3)).toBe(5);
  });

  it("rounds half-values consistently (banker-style not required, just deterministic)", () => {
    // Math.round rounds half-up for positives, so 2.5 → 3 → 5 after *5.
    expect(roundToNearestFive(2.5)).toBe(5);
    expect(roundToNearestFive(7.5)).toBe(10);
  });

  it("clamps negative results to 0 to keep time pills non-negative", () => {
    expect(roundToNearestFive(-5)).toBe(0);
    expect(roundToNearestFive(-2)).toBe(0);
  });

  it("returns 0 for non-finite inputs (NaN/Infinity) — never renders ~NaN min", () => {
    expect(roundToNearestFive(NaN)).toBe(0);
    expect(roundToNearestFive(Infinity)).toBe(0);
    expect(roundToNearestFive(-Infinity)).toBe(0);
  });
});

describe("TCF_QCM_SECTIONS — derived from TCF source of truth", () => {
  it("exposes only listening and reading (TCF Canada has no Grammar QCM)", () => {
    expect(Object.keys(TCF_QCM_SECTIONS).sort()).toEqual(["listening", "reading"]);
    expect(ALL_QCM_SECTIONS).toEqual(["listening", "reading"]);
  });

  it("each section's minutes and questions equal TCF.* (no parallel hard-coding)", () => {
    expect(TCF_QCM_SECTIONS.listening.questions).toBe(TCF.LISTENING_QUESTIONS);
    expect(TCF_QCM_SECTIONS.listening.minutes).toBe(TCF.LISTENING_MINUTES);
    expect(TCF_QCM_SECTIONS.reading.questions).toBe(TCF.READING_QUESTIONS);
    expect(TCF_QCM_SECTIONS.reading.minutes).toBe(TCF.READING_MINUTES);
  });

  it("preserves French and English display labels for the runtime", () => {
    expect(TCF_QCM_SECTIONS.listening.nameEn).toBe("Listening");
    expect(TCF_QCM_SECTIONS.listening.nameFr).toBe("Compréhension Orale");
    expect(TCF_QCM_SECTIONS.reading.nameEn).toBe("Reading");
    expect(TCF_QCM_SECTIONS.reading.nameFr).toBe("Compréhension Écrite");
  });
});
