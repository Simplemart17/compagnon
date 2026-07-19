/**
 * Remote feature flags + kill switches — Story 21-3 (v2-vision-roadmap
 * Epic 21). Rides the PostHog client from `analytics.ts` (flags come free
 * with the SDK — no second vendor).
 *
 * FAIL-OPEN CONTRACT (the load-bearing design rule): every flag has an
 * explicit LOCAL DEFAULT that applies whenever PostHog is unreachable,
 * unconfigured (no API key), still loading, or returns undefined. A kill
 * switch must never brick offline users — it only takes effect when
 * PostHog affirmatively answers. This mirrors the Story 11-4 fail-OPEN
 * precedent (rate-limit RPC errors never block users).
 *
 * Flags:
 *   - `ai-conversations-enabled` (default TRUE): emergency kill switch for
 *     the Realtime voice surface — the app's hard OpenAI dependency has no
 *     other remote off-switch. Flip OFF in PostHog during an OpenAI outage
 *     or a runaway-cost incident; users see a friendly maintenance message
 *     instead of a broken conversation screen.
 *   - `realtime-full-model` (default FALSE): Story 20.6 dogfood A/B — the
 *     operator's own account can run the full `gpt-realtime` model (via a
 *     PostHog per-user condition) to judge correction-quality delta vs the
 *     free-tier mini before deciding the paid-tier model.
 */

import { getAnalyticsClient } from "@/src/lib/analytics";

export const FEATURE_FLAGS = {
  AI_CONVERSATIONS_ENABLED: "ai-conversations-enabled",
  REALTIME_FULL_MODEL: "realtime-full-model",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Local fail-open defaults — the value used whenever PostHog cannot answer.
 * Kill-switch-class flags default TRUE (feature on); experiment-class flags
 * default FALSE (experiment off).
 */
export const FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  [FEATURE_FLAGS.AI_CONVERSATIONS_ENABLED]: true,
  [FEATURE_FLAGS.REALTIME_FULL_MODEL]: false,
};

/**
 * Synchronous flag read from the SDK's cached flag store (PostHog preloads
 * flags at init + after `identifyUser`). Falls back to the local default
 * when the client is absent or the flag is unknown/undefined.
 */
export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  const client = getAnalyticsClient();
  if (!client) return FLAG_DEFAULTS[flag];
  try {
    const value = client.isFeatureEnabled(flag);
    if (value === undefined || value === null) return FLAG_DEFAULTS[flag];
    return value === true;
  } catch {
    return FLAG_DEFAULTS[flag];
  }
}
