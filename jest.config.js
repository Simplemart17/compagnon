/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|@unimodules/.*|unimodules-.*|sentry-expo|native-base|react-native-svg|nativewind|react-native-reanimated)",
  ],
  // Story 11-3: Edge Function tests live under supabase/functions/ and use
  // Deno-style `https://deno.land/...` imports + the Deno test runner.
  // Excluding the project's supabase/ directory from Jest's test discovery
  // so it doesn't try to resolve those URL imports. Epic 15.3 owns the
  // Deno test CI integration.
  //
  // Anchored to <rootDir> (Story 11-3 review patch P4) so the pattern only
  // matches the project's supabase/ directory and doesn't accidentally
  // exclude future test files whose path happens to contain "supabase"
  // (e.g., `src/lib/supabase-helpers/__tests__/x.test.ts`).
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/supabase/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Force Jest worker exit after the suite completes. Several React Native
  // 3rd-party native modules (e.g. `@sentry/react-native`'s
  // `AsyncExpiringMap` cleanup `setInterval`, `expo-modules-core` runtime
  // bindings) install unref-less timers / handles at module-load time and
  // never tear them down — causing "A worker process has failed to exit
  // gracefully" warnings + 5-10s teardown stalls. The structural Sentry
  // mock in `jest.setup.js` catches the largest offender; `forceExit`
  // covers the remaining 3rd-party residue without masking real test
  // leaks (per-test cleanup via `afterEach` + `jest.clearAllMocks` is
  // unchanged). Matches jest-expo's recommended config for projects that
  // import native-module-backed packages at the test boundary.
  forceExit: true,

  // Story 15-6: coverage gate scoped to src/lib/ + src/hooks/ per Epic 15.6
  // deliverable. Test files + .d.ts excluded from collection. Measured
  // baseline at gate-introduction (2026-05-17):
  //   Statements 53.42% / Branches 55.80% / Functions 51.49% / Lines 54.12%
  // Threshold floor pinned at 40% per spec — gives ~11 points of headroom
  // against the lowest metric (Functions 51.49%). Ratchet up in future PRs
  // as coverage grows (see 15-6-followup-coverage-ratchet-cadence).
  collectCoverageFrom: [
    "src/lib/**/*.{ts,tsx}",
    "src/hooks/**/*.{ts,tsx}",
    "!**/__tests__/**",
    "!**/*.d.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 40,
      functions: 40,
      lines: 40,
    },
  },
  coverageReporters: ["text-summary", "lcov"],
};
