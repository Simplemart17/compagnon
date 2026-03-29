/**
 * Standardized score framing utilities.
 *
 * Provides consistent score labels, colors, and haptic feedback
 * across all exercise screens. Labels are always encouraging —
 * never punitive ("Failed", "Wrong", "Poor").
 */

import { Colors } from "@/src/lib/design";
import { hapticLight, hapticSuccess } from "@/src/lib/haptics";

/** Returns a design-token color based on score percentage. */
export function getScoreColor(score: number): string {
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.accent;
  return Colors.primary;
}

/** Returns an encouraging feedback label based on score percentage. */
export function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent!";
  if (score >= 80) return "Great job!";
  if (score >= 70) return "Good work!";
  if (score >= 60) return "Keep going!";
  if (score >= 50) return "Almost there!";
  return "Keep practicing!";
}

/** Fires score-appropriate haptic: success for 80%+, light for below. */
export function fireScoreHaptic(score: number): void {
  if (score >= 80) {
    hapticSuccess();
  } else {
    hapticLight();
  }
}
