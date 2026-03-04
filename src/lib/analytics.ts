/**
 * Lightweight analytics event tracking.
 *
 * Events are stored locally and flushed to Supabase daily_activity
 * and optionally to an external analytics provider (Sentry, PostHog, etc.)
 * when integrated.
 *
 * Usage:
 *   trackEvent("exercise_completed", { skill: "grammar", score: 85 });
 *   trackEvent("conversation_started", { topic: "Au restaurant" });
 */

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

interface AnalyticsEvent {
  name: EventName;
  properties?: Record<string, string | number | boolean>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// In-memory buffer (flushes are non-blocking, fire-and-forget)
// ---------------------------------------------------------------------------

const eventBuffer: AnalyticsEvent[] = [];
const MAX_BUFFER_SIZE = 50;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function trackEvent(
  name: EventName,
  properties?: Record<string, string | number | boolean>
): void {
  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };

  eventBuffer.push(event);

  // Prevent unbounded memory growth
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
  }

  // Log in dev for debugging
  if (__DEV__) {
    console.warn(`[Analytics] ${name}`, properties ?? "");
  }
}

/**
 * Get a snapshot of buffered events (for debugging or export).
 */
export function getBufferedEvents(): readonly AnalyticsEvent[] {
  return [...eventBuffer];
}

/**
 * Clear the event buffer.
 */
export function clearEventBuffer(): void {
  eventBuffer.length = 0;
}

/**
 * Screen view tracker — call from screen focus effects.
 */
export function trackScreenView(screenName: string): void {
  if (__DEV__) {
    console.warn(`[Analytics] screen_view: ${screenName}`);
  }
}
