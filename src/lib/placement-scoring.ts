import type { CEFRLevel } from "@/src/types/cefr";

/**
 * Pure placement-test level decision. Extracted from the placement screen so
 * the onboarding-critical scoring can be unit-tested in isolation.
 *
 * Two inputs per level: `wrongs` (wrong answers) and `corrects` (correct
 * answers). A level counts as ATTEMPTED when it received ≥1 question
 * (`corrects + wrongs > 0`).
 *
 * The attempted-gate is load-bearing: the placement schema tolerates a
 * 12–18-question response (`.min(12).max(18)`), and question distribution is
 * front-loaded by level (A1:3 / A2:3 / B1:3 / B2:3 / C1:2 / C2:1), so a short
 * response drops the TRAILING levels (C2 first, then C1, …). Those absent
 * levels have 0 wrongs; without the attempted-gate the pass-loop would treat
 * them as "passed" and silently over-place the user (e.g. a B2 user → C2).
 * We only advance to a level the user actually attempted.
 */

const CEFR_ORDER: readonly CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Previous CEFR level (used when the user fails out at a level). */
export function previousLevel(level: CEFRLevel): CEFRLevel {
  const idx = CEFR_ORDER.indexOf(level);
  return idx > 0 ? CEFR_ORDER[idx - 1] : "A1";
}

export function determinePlacementLevel(
  wrongs: Record<CEFRLevel, number>,
  corrects: Record<CEFRLevel, number>,
  stopped: boolean,
  stoppedAtLevel?: CEFRLevel
): CEFRLevel {
  // Stopped early (2+ wrong at a level) → placed one level below that level.
  if (stopped && stoppedAtLevel) {
    return previousLevel(stoppedAtLevel);
  }

  // Reached the end without failing out: highest level the user ATTEMPTED and
  // did not fail (< 2 wrong). Break on the first level that was unattempted OR
  // failed — because distribution is front-loaded, an unattempted level marks
  // the tail, so breaking there places the user at the highest attempted pass.
  let highestPassed: CEFRLevel = "A1";
  for (const level of CEFR_ORDER) {
    const attempted = (corrects[level] ?? 0) + (wrongs[level] ?? 0) > 0;
    if (attempted && (wrongs[level] ?? 0) < 2) {
      highestPassed = level;
    } else {
      break;
    }
  }
  return highestPassed;
}
