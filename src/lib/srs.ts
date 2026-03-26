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

  // Set next review to the start of the target day (midnight local time)
  // to ensure consistent calendar-day intervals regardless of review time
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + intervalDays);
  nextReview.setHours(0, 0, 0, 0);

  return {
    easeFactor,
    intervalDays,
    repetitions,
    nextReview,
  };
}
