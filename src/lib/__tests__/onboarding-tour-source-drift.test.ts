/**
 * Story 14-6 — post-onboarding tour source-drift detector.
 *
 * Pins:
 *  - `app/onboarding/tour.tsx` exists + exports `TOUR_CARDS` with 3 entries
 *    + uses Story 14-3 Icon component (not raw `@expo/vector-icons`)
 *  - `app/onboarding/placement-test.tsx` post-completion route goes to
 *    `/onboarding/tour` (NOT direct to `/(tabs)/home`)
 *  - `app/onboarding/index.tsx` no-placement-test branch goes to
 *    `/onboarding/tour`
 *  - `app/_layout.tsx` routing-guard has `inTour` carve-out
 *  - `app/onboarding/_layout.tsx` registers the `tour` screen
 *
 * Pattern mirrors Story 14-4 / 14-5 drift detectors: Story 12-2 P12
 * comment-stripped readFile + targeted regex assertions + paired POSITIVE +
 * NEGATIVE pins per Story 13-2 P11 vacuous-pass defense.
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

// Strip `//` line comments AND block comments from source text so regex-based
// assertions don't false-positive on tokens that appear only in comments
// (Story 14-5 R1 stripComments precedent).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 14-6 — post-onboarding tour source drift", () => {
  describe("tour.tsx contract", () => {
    const tourRaw = readFile("app/onboarding/tour.tsx");
    const tour = stripComments(tourRaw);

    it("Case 1: app/onboarding/tour.tsx exports TOUR_CARDS array with 3 entries", () => {
      expect(tour).toMatch(/export\s+const\s+TOUR_CARDS\s*:\s*readonly\s+TourCard\[\]/);
      // Count opening braces of card object literals inside the TOUR_CARDS body.
      // Each card is `{ headline: ..., body: ..., iconName: ..., iconBackgroundColor: ... }`.
      const cardObjects = tour.match(/headline:\s*["']/g) ?? [];
      expect(cardObjects.length).toBe(3);
    });

    it("Case 2: tour.tsx imports Icon via @/src/components/common/Icon (Story 14-3 invariant — no raw @expo/vector-icons)", () => {
      expect(tour).toMatch(
        /import\s+\{[^}]*Icon[^}]*\}\s+from\s+["']@\/src\/components\/common\/Icon["']/
      );
      // NEGATIVE: no direct @expo/vector-icons import in tour.tsx
      expect(tour).not.toMatch(/from\s+["']@expo\/vector-icons/);
    });

    it("Case 3: tour.tsx default export routes to /(tabs)/home on completion (Get-started) AND skip", () => {
      // Both finishTour + skipTour call router.replace("/(tabs)/home")
      // Match the literal route in any `router.replace("...")` call shape.
      const replaceCalls = tour.match(/router\.replace\(\s*["']\/\(tabs\)\/home["']/g) ?? [];
      // At least 2 occurrences (one in finishTour, one in skipTour).
      expect(replaceCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("Case 4: tour.tsx uses Story 14-5 streak-cluster + success-cluster + primary tints (NOT raw hex)", () => {
      // POSITIVE: the 3 iconBackgroundColor values reference Colors.* tokens
      expect(tour).toMatch(/iconBackgroundColor:\s*Colors\.primary15/);
      expect(tour).toMatch(/iconBackgroundColor:\s*Colors\.success15/);
      expect(tour).toMatch(/iconBackgroundColor:\s*Colors\.streak15/);
      // NEGATIVE: no raw hex colors in tour.tsx (Story 1B-1 + 14-4 invariants)
      expect(tour).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  });

  describe("Onboarding-finish routes updated to go via tour", () => {
    it("Case 5: placement-test.tsx routes to /onboarding/tour (NOT direct /(tabs)/home) after onboarding-complete save", () => {
      const placement = stripComments(readFile("app/onboarding/placement-test.tsx"));
      // POSITIVE: route to /onboarding/tour exists in the handleFinish flow
      expect(placement).toMatch(/router\.replace\(\s*["']\/onboarding\/tour["']/);
      // NEGATIVE: no remaining direct route to /(tabs)/home in placement-test.tsx
      expect(placement).not.toMatch(/router\.replace\(\s*["']\/\(tabs\)\/home["']/);
    });

    it("Case 6: onboarding/index.tsx no-placement-test branch routes to /onboarding/tour", () => {
      const onboardingIndex = stripComments(readFile("app/onboarding/index.tsx"));
      // POSITIVE: route to /onboarding/tour
      expect(onboardingIndex).toMatch(/router\.replace\(\s*["']\/onboarding\/tour["']/);
      // NEGATIVE: no remaining direct route to /(tabs)/home (the no-placement-test branch
      // previously routed there directly)
      expect(onboardingIndex).not.toMatch(/router\.replace\(\s*["']\/\(tabs\)\/home["']/);
    });
  });

  describe("Routing-guard inTour carve-out", () => {
    it("Case 7: app/_layout.tsx defines `inTour` segment check + uses it in the isOnboarded redirect carve-out", () => {
      const layout = stripComments(readFile("app/_layout.tsx"));
      // POSITIVE 1: inTour const declaration
      expect(layout).toMatch(/const\s+inTour\s*=\s*inOnboarding\s*&&/);
      // POSITIVE 2: redirect-to-home condition includes `!inTour` somewhere in its expression
      // The pre-14-6 condition was `(inAuthGroup || inOnboarding)`. Post-14-6 is
      // `(inAuthGroup || (inOnboarding && !inTour))`. Look for the latter shape.
      expect(layout).toMatch(/inOnboarding\s*&&\s*!inTour/);
    });
  });

  describe("Onboarding _layout registers the tour screen", () => {
    it("Case 8: app/onboarding/_layout.tsx enumerates the `tour` Stack.Screen alongside index + placement-test", () => {
      const onboardingLayout = stripComments(readFile("app/onboarding/_layout.tsx"));
      // POSITIVE: all 3 screens enumerated
      expect(onboardingLayout).toMatch(/<Stack\.Screen\s+name=["']index["']/);
      expect(onboardingLayout).toMatch(/<Stack\.Screen\s+name=["']placement-test["']/);
      expect(onboardingLayout).toMatch(/<Stack\.Screen\s+name=["']tour["']/);
    });
  });
});
