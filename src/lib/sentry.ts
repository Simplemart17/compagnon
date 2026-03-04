/**
 * Sentry error reporting utility.
 *
 * Wraps Sentry.captureException so that every catch block in the app
 * reports errors consistently — with context tags and without needing
 * to import @sentry/react-native directly.
 */

import * as Sentry from "@sentry/react-native";

/**
 * Report a caught error to Sentry with an optional context tag.
 *
 * Usage:
 *   try { ... } catch (err) { captureError(err, "placement-test"); }
 */
export function captureError(
  error: unknown,
  context?: string,
  extras?: Record<string, unknown>
): void {
  const err = error instanceof Error ? error : new Error(String(error));

  Sentry.withScope((scope) => {
    if (context) scope.setTag("feature", context);
    if (extras) scope.setExtras(extras);
    Sentry.captureException(err);
  });
}
