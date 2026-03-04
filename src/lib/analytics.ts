/**
 * Lightweight analytics event tracking.
 *
 * Events are recorded as Sentry breadcrumbs so they appear in error reports.
 * When a dedicated analytics backend is added (e.g. PostHog), the trackEvent
 * function should forward events there as well.
 *
 * Usage:
 *   trackEvent("exercise_completed", { skill: "grammar", score: 85 });
 *   trackEvent("conversation_started", { topic: "Au restaurant" });
 */

import * as Sentry from "@sentry/react-native";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventName =
  | "app_opened"
  | "exercise_started"
  | "exercise_completed"
  | "conversation_started"
  | "conversation_ended"
  | "mock_test_started"
  | "mock_test_completed"
  | "vocabulary_reviewed"
  | "pronunciation_assessed"
  | "onboarding_completed"
  | "level_changed"
  | "streak_continued"
  | "data_exported"
  | "account_deleted";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Track an analytics event.
 *
 * Currently records as a Sentry breadcrumb so events appear alongside error
 * reports. Replace or extend with a dedicated analytics provider when ready.
 */
export function trackEvent(
  name: EventName,
  properties?: Record<string, string | number | boolean>
): void {
  // Record as Sentry breadcrumb for error-report context
  Sentry.addBreadcrumb({
    category: "analytics",
    message: name,
    data: properties,
    level: "info",
  });

  // Log in dev for debugging
  if (__DEV__) {
    console.warn(`[Analytics] ${name}`, properties ?? "");
  }
}

/**
 * Screen view tracker -- call from screen focus effects.
 */
export function trackScreenView(screenName: string): void {
  Sentry.addBreadcrumb({
    category: "navigation",
    message: `screen_view: ${screenName}`,
    level: "info",
  });

  if (__DEV__) {
    console.warn(`[Analytics] screen_view: ${screenName}`);
  }
}
