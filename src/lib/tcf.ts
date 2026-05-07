/**
 * Shared TCF Canada helpers used by the mock-test screens.
 *
 * The `TCF` constant in src/lib/constants.ts is the single source of truth
 * for question counts and minutes; this module exposes derived structures
 * and small math helpers built on top of it so that the mock-test runtime
 * does not need to maintain parallel lookup tables.
 */

import { TCF } from "./constants";

/** Sections of the TCF Canada exam that run as multiple-choice questionnaires. */
export type QcmSection = "listening" | "reading";

/** Ordered list of QCM sections that make up a "full" TCF Canada mock test. */
export const ALL_QCM_SECTIONS: readonly QcmSection[] = ["listening", "reading"] as const;

/**
 * Per-section runtime metadata, derived directly from `TCF.*`. The
 * mock-test runner reads question counts and time limits from this map
 * instead of redeclaring them, so a future spec update only needs to edit
 * `src/lib/constants.ts`.
 */
export const TCF_QCM_SECTIONS: Record<
  QcmSection,
  { questions: number; minutes: number; nameEn: string; nameFr: string }
> = {
  listening: {
    questions: TCF.LISTENING_QUESTIONS,
    minutes: TCF.LISTENING_MINUTES,
    nameEn: "Listening",
    nameFr: "Compréhension Orale",
  },
  reading: {
    questions: TCF.READING_QUESTIONS,
    minutes: TCF.READING_MINUTES,
    nameEn: "Reading",
    nameFr: "Compréhension Écrite",
  },
};

/**
 * Round to the nearest multiple of 5 for human-friendly time pills.
 * 95 → 95, 87 → 85, 113 → 115.
 *
 * Returns 0 for non-finite inputs (NaN, Infinity) so the UI never renders
 * "~NaN min" if a TCF constant ever fails to load (e.g. a stub mock or a
 * broken import).
 */
export function roundToNearestFive(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.round(minutes / 5) * 5);
}
