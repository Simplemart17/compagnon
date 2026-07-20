/**
 * Sentry error reporting utility.
 *
 * Wraps Sentry.captureException so that every catch block in the app
 * reports errors consistently — with context tags and without needing
 * to import @sentry/react-native directly.
 *
 * Also owns the GDPR scrubber (scrubEvent) wired into Sentry.init.beforeSend
 * AND beforeSendTransaction from app/_layout.tsx; the same allowlist + length
 * rule is applied to breadcrumbs at emission time so they never leak free-text
 * content.
 */

import * as Sentry from "@sentry/react-native";

/**
 * Allowlist of keys permitted in Sentry event.extra and breadcrumb.data.
 * Anything not in this set is dropped by scrubEvent / addBreadcrumb.
 *
 * Notably excluded: description, pattern, transcript, messageContent, prompt,
 * aiResponse, email, name — anything that could carry French text or PII.
 * If you find yourself wanting to add one of those, capture an event without
 * the payload instead.
 */
export const SENTRY_EXTRAS_ALLOWLIST: ReadonlySet<string> = new Set([
  "errorType",
  "category",
  "errorId",
  "skill",
  "cefrLevel",
  "componentStack",
  "feature",
  "context",
  "statusCode",
  "code",
  "phase",
  "rawBytes",
  // 9-2 promotion telemetry — short categorical/numeric values; safe under length rule.
  "currentLevel",
  "fromLevel",
  "toLevel",
  "score",
  "missingSkills",
  // Diagnostic counters / cache identifiers — short primitives.
  "key",
  "attempt",
  // 10-8 exercise dedup telemetry — small bounded integers; safe under length rule.
  "generatedCount",
  "filteredCount",
  "seenCount",
  "retries",
  // Story 19-2: curriculum lesson id (short categorical, e.g. "a1-u1-l3").
  "lessonId",
  // 12-6 transcript-cap telemetry — small bounded integers; safe under length rule.
  "evictedCount",
  "totalEntries",
]);

/**
 * Default redaction threshold for allowlisted string values. Anything longer is
 * replaced with "[redacted:long-string]" — a blunt-but-effective safety net
 * for keys that may incidentally include user-facing content.
 */
export const REDACT_LONG_STRING_THRESHOLD = 80;

/**
 * Per-key threshold overrides. componentStack is a React component hierarchy
 * trace that is reliably 200–800 chars in real use; redacting it at 80 chars
 * destroys the field's primary diagnostic value. The longer threshold still
 * caps catastrophically large values (e.g., entire HTML payloads).
 */
const PER_KEY_THRESHOLDS: Readonly<Record<string, number>> = {
  componentStack: 800,
};

const REDACTED_LONG_STRING = "[redacted:long-string]";

type ScrubData = Record<string, unknown>;

function thresholdFor(key: string): number {
  return PER_KEY_THRESHOLDS[key] ?? REDACT_LONG_STRING_THRESHOLD;
}

function isAllowedPrimitive(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

/**
 * Filter a Record through the allowlist + primitive-only + length rules.
 * - Drops keys not in SENTRY_EXTRAS_ALLOWLIST.
 * - Drops values that are not string|number|boolean|null (defends against
 *   nested objects, arrays, buffers slipping through breadcrumb auto-instrumentation).
 * - Replaces strings over the per-key threshold with REDACTED_LONG_STRING.
 */
function scrubData(data: ScrubData): ScrubData {
  const out: ScrubData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SENTRY_EXTRAS_ALLOWLIST.has(key)) continue;
    if (!isAllowedPrimitive(value)) continue;
    if (typeof value === "string" && value.length > thresholdFor(key)) {
      out[key] = REDACTED_LONG_STRING;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function scrubLongString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > REDACT_LONG_STRING_THRESHOLD) return REDACTED_LONG_STRING;
  return value;
}

/**
 * GDPR scrubber for Sentry events. Wired into Sentry.init.beforeSend AND
 * beforeSendTransaction (the same scrubber works for both event types — it
 * only touches fields common to ErrorEvent and TransactionEvent).
 *
 * - Strips email, username, ip_address from event.user (preserves opaque id).
 * - Drops event.request entirely (may contain OpenAI prompt bodies).
 * - Redacts event.message and event.exception.values[].value when long
 *   (upstream API errors often serialize prompts/transcripts into the message).
 * - Filters event.extra and event.breadcrumbs[].data through the allowlist
 *   + 80-char length rule (componentStack uses an 800-char threshold).
 * - Returns a shallow clone — never mutates the input event.
 *
 * Never returns null — the goal is sanitized telemetry, not no telemetry.
 */
export function scrubEvent<T extends Sentry.ErrorEvent | Sentry.TransactionEvent>(event: T): T {
  const scrubbed = { ...event } as T;

  if (scrubbed.user) {
    scrubbed.user = {
      ...scrubbed.user,
      email: undefined,
      username: undefined,
      ip_address: undefined,
    };
  }

  if (scrubbed.request !== undefined) {
    scrubbed.request = undefined;
  }

  if (typeof scrubbed.message === "string") {
    scrubbed.message = scrubLongString(scrubbed.message);
  }

  // Sentry serializes error.message into event.exception.values[i].value —
  // upstream API errors (OpenAI/Edge Function) often embed prompts here.
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((v) => ({
        ...v,
        value: scrubLongString(v.value),
      })),
    };
  }

  if (scrubbed.extra) {
    scrubbed.extra = scrubData(scrubbed.extra as ScrubData);
  }

  if (scrubbed.breadcrumbs && scrubbed.breadcrumbs.length > 0) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => {
      const next = { ...crumb };
      if (typeof next.message === "string") {
        next.message = scrubLongString(next.message);
      }
      if (next.data) {
        next.data = scrubData(next.data as ScrubData);
      }
      return next;
    });
  }

  return scrubbed;
}

/**
 * Sentry.init configuration object. Exported so the test suite can assert the
 * privacy-safe shape (snapshot of the GDPR posture). Any future PR that flips
 * a privacy flag here breaks the snapshot test in __tests__/sentry-init.test.ts.
 */
export function getSentryInitConfig(): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
    // Capture 100% of transactions in dev, 5% in production to control volume.
    tracesSampleRate: __DEV__ ? 1.0 : 0.05,
    enableAutoSessionTracking: true,
    // GDPR: never auto-attach screenshots — they contain transcript text and companion memory output.
    attachScreenshot: false,
    // Story 13-6 (Epic 13 P2-x performance) — perf-conservative SDK flags.
    //
    // Story 13-6 review-round-1 P1 + P3 correction: pre-patch the inline
    // comments + spec claimed "all 3 default to ENABLED" + "JS work runs
    // BEFORE sample-out decision." Verified against
    // node_modules/@sentry/react-native@7.11.0/dist/js/options.d.ts:
    //   - enableAutoPerformanceTracing: docs say "Enable auto performance
    //     tracking by default" → defaults to true ✓
    //   - enableNativeFramesTracking: `@default true` ✓
    //   - enableUserInteractionTracing: `@default false` — defensive no-op
    //     for SDK 7.11.0, kept as a forward-compat pin against a future
    //     SDK that flips the default (P6)
    //   - enableStallTracking: `@default true` (sibling — P2 addition)
    //   - enableAppStartTracking: `@default true` (sibling — P2 addition)
    //   - profilesSampleRate: undocumented default; when > 0 activates the
    //     profiler with CPU + battery overhead (P2 addition; pin at 0)
    //
    // Accurate perf model (P3): setting these flags to `false` skips the
    // auto-instrumentation INSTALLATION at SDK init time (the SDK doesn't
    // wrap fetch/HTTP/touch-handlers/native-frames-tracking at all);
    // tracesSampleRate filters out 95% of MANUALLY-created transactions at
    // emit time. Disabling the auto-instrumentation moves the overhead from
    // linear-in-activity to zero — explicit captureError() calls remain the
    // telemetry surface (Story 9-3 feature-tag pattern).
    enableAutoPerformanceTracing: false,
    // Slow/frozen-frame measurements emit native-bridge round-trips per
    // transaction. We don't dashboard mobile FPS via Sentry — Stories
    // 13-1 / 13-2 / 13-3 / 13-4 / 13-5 measure perf architecturally.
    enableNativeFramesTracking: false,
    // JS event-loop stall measurements are added to ALL transactions
    // (Story 13-6 review-round-1 P2 — sibling flag missed in the initial
    // story scope). Sibling of enableNativeFramesTracking; same cost model
    // (native-bridge measurement per transaction). Default ENABLED.
    enableStallTracking: false,
    // App-start auto-transaction is created on every cold launch (Story
    // 13-6 P2 sibling addition). The cold-start window is exactly when
    // every other JS module is initializing — Sentry's app-start tracking
    // adds bridge work on the critical path. Default ENABLED.
    enableAppStartTracking: false,
    // SDK 7.11.0 default for enableUserInteractionTracing is already
    // `false` (verified at node_modules path above). The explicit pin is
    // defensive against a future SDK upgrade that flips the default —
    // matches the "explicit-over-implicit" discipline at every other
    // privacy flag in this config (sendDefaultPii, attachScreenshot, etc.).
    enableUserInteractionTracing: false,
    // Profiling activation knob — `profilesSampleRate > 0` enables CPU
    // profiling on sampled transactions (battery + CPU overhead even if a
    // subset). Pin at 0 to disable explicitly; combined with the auto-
    // performance-tracing/stall/app-start disables above, no automatic
    // perf surface remains active in production.
    profilesSampleRate: 0,
    // GDPR: failed-request capture serializes URL/headers/body and may include OpenAI prompts.
    // We capture upstream errors via captureError() with statusCode/code only.
    enableCaptureFailedRequests: false,
    // GDPR: explicitly disable PII auto-collection (IP, etc.). The SDK default
    // varies between versions; we pin the privacy-safe value rather than rely on it.
    sendDefaultPii: false,
    // GDPR scrubber: strip PII and free-text bodies from every event before send.
    beforeSend: scrubEvent,
    // Same scrubber for sampled transactions/profiles — they can carry span URLs
    // and breadcrumb chains that the error-event scrubber would otherwise miss.
    beforeSendTransaction: scrubEvent,
  };
}

/**
 * Normalize an unknown thrown/passed value into an `Error` instance so that
 * Sentry's deduplication + stack-extraction work correctly.
 *
 * The pre-Story 13-4 implementation used `new Error(String(value))` which
 * coerces plain objects (the shape Supabase's PostgrestError comes back as)
 * to the literal string `"[object Object]"`, producing useless Sentry events.
 *
 * Resolution order:
 *   1. Already an `Error` → pass through unchanged.
 *   2. Object with a string `.message` (PostgrestError, FunctionsHttpError,
 *      Supabase response errors, fetch errors that escaped their wrappers) →
 *      `new Error(value.message)`.
 *   3. JSON-serializable value → `new Error(JSON.stringify(value))`.
 *   4. Fallback → `new Error(String(value))`.
 */
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === "object" && "message" in value) {
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === "string") return new Error(msg);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

/**
 * Report a caught error to Sentry with an optional context tag.
 *
 * The extras parameter is intentionally typed to primitives only — nested
 * objects and arrays would risk leaking transcript / prompt payloads into
 * Sentry. If you need to capture multiple structured fields, pass each as
 * its own primitive entry.
 *
 * Non-`Error` inputs (notably Supabase PostgrestError shapes returned via
 * destructured `{ data, error }` — they carry a `.message` but are not
 * `Error` subclasses) are normalized through `toError()` so call sites
 * never need to wrap before passing.
 *
 * Usage:
 *   try { ... } catch (err) { captureError(err, "placement-test"); }
 */
export function captureError(
  error: unknown,
  context?: string,
  extras?: Record<string, string | number | boolean | null>
): void {
  const err = toError(error);

  Sentry.withScope((scope) => {
    if (context) scope.setTag("feature", context);
    if (extras) scope.setExtras(extras);
    Sentry.captureException(err);
  });
}

export interface Breadcrumb {
  category: string;
  message: string;
  level?: "info" | "warning" | "error" | "debug";
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Emit a Sentry breadcrumb. Non-blocking; swallows any SDK error so
 * a transient Sentry issue can't break the surrounding flow.
 *
 * crumb.data is filtered through the same allowlist + length rule that
 * scrubEvent applies — so a permissive caller can't leak free-text content.
 */
export function addBreadcrumb(crumb: Breadcrumb): void {
  try {
    Sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level ?? "info",
      data: crumb.data ? scrubData(crumb.data) : undefined,
    });
  } catch {
    // Breadcrumbs must never throw into application code.
  }
}
