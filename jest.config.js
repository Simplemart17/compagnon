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
};
