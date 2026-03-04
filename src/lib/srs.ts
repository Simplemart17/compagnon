/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Based on the SuperMemo SM-2 algorithm for optimal vocabulary retention.
 * Calculates the next review interval based on user performance.
 */

/** Quality rating for a review (0-5 scale) */
export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Current SRS state of a vocabulary item */
export interface SRSState {
  easeFactor: number; // Starts at 2.5
  intervalDays: number; // Days until next review
  repetitions: number; // Consecutive correct reviews
}

/** Result of processing a review */
export interface SRSUpdate {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextReview: Date;
}

/**
 * Map a simple correct/incorrect + confidence to SM-2 quality rating:
 * - 5: Perfect response with no hesitation
 * - 4: Correct response after brief hesitation
 * - 3: Correct response with serious difficulty
 * - 2: Incorrect, but close / remembered after seeing answer
 * - 1: Incorrect, vaguely remembered the answer
 * - 0: Complete blackout, no recollection
 */
export function mapToQuality(
  correct: boolean,
  confidence: "high" | "medium" | "low"
): ReviewQuality {
  if (correct) {
    switch (confidence) {
      case "high":
        return 5;
      case "medium":
        return 4;
      case "low":
        return 3;
    }
  } else {
    switch (confidence) {
      case "high":
        return 2; // Almost had it
      case "medium":
        return 1;
      case "low":
        return 0;
    }
  }
}

/**
 * Calculate the next review interval using the SM-2 algorithm.
 *
 * @param current - Current SRS state of the item
 * @param quality - Quality of the user's response (0-5)
 * @returns Updated SRS state with next review date
 */
export function calculateNextReview(current: SRSState, quality: ReviewQuality): SRSUpdate {
  let { easeFactor, intervalDays, repetitions } = current;

  if (quality >= 3) {
    // Correct response — increase interval
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;
  } else {
    // Incorrect response — reset to beginning
    repetitions = 0;
    intervalDays = 1;
  }

  // Update ease factor (never below 1.3)
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  easeFactor = Math.max(1.3, easeFactor);

  // Cap maximum interval at 365 days
  intervalDays = Math.min(intervalDays, 365);

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + intervalDays);

  return {
    easeFactor,
    intervalDays,
    repetitions,
    nextReview,
  };
}

/** Default SRS state for a new vocabulary item */
export const DEFAULT_SRS_STATE: SRSState = {
  easeFactor: 2.5,
  intervalDays: 1,
  repetitions: 0,
};

/** Get items due for review from a list */
export function getDueItems<T extends { nextReview: string | Date }>(items: T[]): T[] {
  const now = new Date();
  return items.filter((item) => new Date(item.nextReview) <= now);
}
