/* global jest */
// Provide stub env vars so modules that instantiate clients at import time
// (e.g., src/lib/supabase.ts → createClient) load cleanly under Jest.
// We unconditionally overwrite to a known test value so a CI environment that
// happens to have a real production URL set (e.g., reused build secret) cannot
// leak into the test runner.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

// Globally mock @sentry/react-native so its `AsyncExpiringMap` constructor
// does NOT call `setInterval` at module load time (the unref-less timer
// keeps Jest workers alive past test completion → "worker process has
// failed to exit gracefully" warning + spurious 5-10s teardown waits in CI).
// Tests that mock the project's `src/lib/sentry.ts` wrapper continue working
// unchanged because their `jest.mock("../sentry", ...)` short-circuits the
// `@sentry/react-native` import; this mock catches transitive imports from
// modules that pull `src/lib/sentry.ts` without mocking it (e.g.
// `src/lib/activity.ts → src/lib/sentry.ts → @sentry/react-native`).
jest.mock("@sentry/react-native", () => {
  const noop = () => {};
  const withScope = (cb) => cb({ setExtras: noop, setExtra: noop, setTag: noop, setLevel: noop });
  return {
    __esModule: true,
    init: noop,
    captureException: noop,
    captureMessage: noop,
    addBreadcrumb: noop,
    setUser: noop,
    setTag: noop,
    setTags: noop,
    setExtra: noop,
    setExtras: noop,
    withScope,
    getCurrentScope: () => ({ setExtras: noop, setExtra: noop, setTag: noop, setLevel: noop }),
    reactNavigationIntegration: () => ({}),
    reactNativeTracingIntegration: () => ({}),
    httpIntegration: () => ({}),
    Native: { initNativeSdk: noop },
  };
});
