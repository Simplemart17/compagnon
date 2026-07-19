/**
 * Product analytics — PostHog wrapper (Story 21-2, v2-vision-roadmap Epic 21).
 *
 * The dogfood-first strategy needs retention/funnel data (D1/D7/D30) that
 * Sentry breadcrumbs cannot provide. This module wraps `posthog-react-native`
 * behind a typed, allowlisted event taxonomy.
 *
 * KEY-AGNOSTIC BY DESIGN: reads `EXPO_PUBLIC_POSTHOG_API_KEY` (+ optional
 * `EXPO_PUBLIC_POSTHOG_HOST`, default US cloud). When the key is absent
 * (local dev, CI, a build before the operator creates the PostHog project)
 * every call is a silent no-op — the app never depends on analytics being
 * configured.
 *
 * PRIVACY CONTRACT (Story 9-3 discipline extended to a second sink):
 *   - `identifyUser` sends the OPAQUE Supabase UUID only — never email,
 *     name, or any profile field.
 *   - Event properties are typed `AnalyticsProperties` (string | number |
 *     boolean) and every event's properties are enumerated below — no free
 *     text, no conversation content, no memory content, no error-pattern
 *     descriptions.
 *   - Autocapture and session replay are OFF; only the explicit taxonomy
 *     below is ever sent.
 *   - PostHog is a disclosed processor in the in-app privacy policy
 *     (Section 4) — added in the same story that added the sink (the
 *     Story 18-3 R1 lesson: the policy lags the pipeline otherwise).
 */

import PostHog from "posthog-react-native";

import { captureError } from "@/src/lib/sentry";

/**
 * The complete event taxonomy. Adding an event = adding it here (typed) so
 * the compiler enumerates every emission point. Keep names snake_case
 * (PostHog convention) and STABLE — renaming an event orphans its history.
 */
export const ANALYTICS_EVENTS = {
  /** Fired once per cold start from the root layout. */
  APP_OPENED: "app_opened",
  /** Realtime conversation began (after connect succeeded). */
  CONVERSATION_STARTED: "conversation_started",
  /** Conversation ended; the core engagement event. */
  CONVERSATION_COMPLETED: "conversation_completed",
  /** Any practice exercise finished (listening/reading/grammar/writing…). */
  EXERCISE_COMPLETED: "exercise_completed",
  /** Mock test finished. Emission points: the QCM runner ([testId].tsx,
   * banded from the 0-699 TCF composite) AND the speaking flow
   * (speaking.tsx, banded from the 0-20 publisher-scale composite —
   * different scale, same band semantics). */
  MOCK_TEST_COMPLETED: "mock_test_completed",
  /** User arrived via a daily-nudge push tap (Story 18-3 deep-link). */
  NUDGE_OPENED: "nudge_opened",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Allowlisted property value types — no objects, no free text blobs. */
export type AnalyticsProperties = Record<string, string | number | boolean>;

/**
 * Coarse score banding for funnel analysis — raw scores stay out of the
 * analytics sink (band granularity is all retention analysis needs).
 */
export function scoreBand(score: number): "0-25" | "26-50" | "51-75" | "76-100" {
  if (score <= 25) return "0-25";
  if (score <= 50) return "26-50";
  if (score <= 75) return "51-75";
  return "76-100";
}

const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
// R1: `||` not `??` — CI injects an EMPTY STRING when the GitHub secret is
// unset, and an empty host would ship analytics-dead builds silently.
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

/** True when analytics is configured AND we're not in a test runtime. */
export function isAnalyticsEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.JEST_WORKER_ID !== undefined) return false;
  return typeof API_KEY === "string" && API_KEY.length > 0;
}

let client: PostHog | null = null;

/**
 * Lazy singleton — construction is deferred so a missing key never costs a
 * native-module touch, and tests never instantiate the SDK.
 */
export function getAnalyticsClient(): PostHog | null {
  if (!isAnalyticsEnabled()) return null;
  if (client === null) {
    try {
      client = new PostHog(API_KEY as string, {
        host: HOST,
        // Explicit taxonomy only — no autocapture, no lifecycle events,
        // no session replay (privacy contract above).
        captureAppLifecycleEvents: false,
        // R1: without this the SDK auto-captures $feature_flag_called on
        // every flag read — events OUTSIDE the taxonomy below, violating
        // the privacy contract (verified real v4 option).
        sendFeatureFlagEvent: false,
        disabled: false,
      });
    } catch (err) {
      captureError(err, "analytics-init");
      return null;
    }
  }
  return client;
}

/** Capture a taxonomy event. Silent no-op when analytics is not configured. */
export function trackEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
  const c = getAnalyticsClient();
  if (!c) return;
  try {
    c.capture(event, properties);
  } catch (err) {
    captureError(err, "analytics-capture");
  }
}

/** Identify by opaque Supabase UUID ONLY (privacy contract above). */
export function identifyUser(userId: string): void {
  const c = getAnalyticsClient();
  if (!c) return;
  try {
    c.identify(userId);
    // Refresh feature flags for the identified user (Story 21-3).
    void c.reloadFeatureFlagsAsync().catch(() => undefined);
  } catch (err) {
    captureError(err, "analytics-identify");
  }
}

/** Reset the analytics identity on sign-out. */
export function resetAnalytics(): void {
  const c = getAnalyticsClient();
  if (!c) return;
  try {
    c.reset();
  } catch (err) {
    captureError(err, "analytics-reset");
  }
}

/** @internal test-only — clears the lazy singleton. */
export function __resetAnalyticsClientForTests(): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    throw new Error("__resetAnalyticsClientForTests is test-only");
  }
  client = null;
}
