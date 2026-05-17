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
  //
  // R1 EH-10: Exclude sibling `.test.ts` / `.test.tsx` / `.spec.ts` files
  // so a future contributor adopting the sibling-test convention doesn't
  // artificially inflate coverage (test files execute themselves end-to-
  // end at ~100% during the suite run).
  //
  // R1 BH-6: scope deliberately excludes `src/components/` + `app/` per
  // spec. Filed `15-6-followup-extend-coverage-scope-to-components-and-app`
  // to broaden once the per-directory floor here is well-understood.
  collectCoverageFrom: [
    "src/lib/**/*.{ts,tsx}",
    "src/hooks/**/*.{ts,tsx}",
    "!**/__tests__/**",
    "!**/*.test.{ts,tsx}",
    "!**/*.spec.{ts,tsx}",
    "!**/*.d.ts",
  ],
  // R1 BH-2 / EH-4 (load-bearing): per-directory floors so a regression in
  // ONE directory can't be masked by averaging against the OTHER. The spec
  // deliverable reads "≥ 40% on `src/lib/` AND `src/hooks/`" — `global`
  // alone enforces the average, not the conjunction. Jest's per-path keys
  // (string keys in `coverageThreshold` that are NOT `global`) enforce
  // per-directory floors. `global` is retained as belt-and-suspenders so
  // an overall regression that doesn't trip either per-dir floor still
  // surfaces.
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 40,
      functions: 40,
      lines: 40,
    },
    "./src/lib/": {
      statements: 40,
      branches: 40,
      functions: 40,
      lines: 40,
    },
    "./src/hooks/": {
      // R1 measured baseline (2026-05-17): Statements 23.02% / Branches 27.12%
      // / Functions 25.92% / Lines 23.36%. Per spec AC-E: "if actual is below
      // 40% on ANY metric, lower the threshold to FLOOR-MINUS-3% of actual."
      // Documents reality — the global 40% floor was MASKING this gap because
      // src/lib/ is much higher and averages dragged src/hooks/ above the
      // global gate. Future operator-action: lift hook coverage (filed
      // `15-6-followup-lift-hooks-coverage-to-40`).
      statements: 20,
      branches: 24,
      functions: 22,
      lines: 20,
    },
  },
  coverageReporters: ["text-summary", "lcov"],
};
