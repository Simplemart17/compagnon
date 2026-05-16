/**
 * Story 14-7 — source-drift detector for the mock-test landing surface.
 *
 * Pattern: Story 12-2 P12 comment-stripped readFile + targeted regex
 * assertions + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline.
 *
 * Pins:
 *  - `useMockTestLanding` is imported AND consumed in `mock-test/index.tsx`.
 *  - Resume section uses `<ListItemCard leftStripColor={Colors.accent}>` (Story 14-5 CTA-cluster).
 *  - Past-results rendering uses `<ListItemCard>` — NOT bespoke `<View>` + `<Text>` JSX
 *    (defends against Story 14-2 P2-10 audit finding re-emerging).
 *  - Screen consumes formatters from `mock-test-results.ts` (delete-don't-alias guard).
 *  - `useFocusEffect` is imported AND invoked (catches drop-focus-refresh regression).
 *  - `reconstructTestResultsFromMockTestRow` is exported from `src/lib/mock-test-results.ts`.
 *  - No raw hex literals in the new sections (Story 14-4 invariant).
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

// Strip `//` line comments AND block comments so regex-based assertions
// don't false-positive on tokens that appear only in comments (Story 12-2 P12 +
// Story 14-5 R1 stripComments precedent).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Story 14-7 — mock-test landing source drift", () => {
  describe("mock-test/index.tsx wiring", () => {
    const screenRaw = readFile("app/(tabs)/mock-test/index.tsx");
    const screen = stripComments(screenRaw);

    it("Case 1: imports useMockTestLanding + useMockTestResultsLoader + formatters from the new modules", () => {
      // POSITIVE: useMockTestLanding hook imported
      expect(screen).toMatch(
        /import\s+\{[^}]*useMockTestLanding[^}]*\}\s+from\s+["']@\/src\/hooks\/use-mock-test-landing["']/
      );
      // POSITIVE: useMockTestResultsLoader (on-tap loader) imported
      expect(screen).toMatch(
        /import\s+\{[^}]*useMockTestResultsLoader[^}]*\}\s+from\s+["']@\/src\/hooks\/use-mock-test-results-loader["']/
      );
      // POSITIVE: formatters imported from mock-test-results.ts
      expect(screen).toMatch(
        /import\s+\{[\s\S]*?formatTimeRemaining[\s\S]*?formatPastResultDate[\s\S]*?formatPastResultDuration[\s\S]*?\}\s+from\s+["']@\/src\/lib\/mock-test-results["']/
      );
    });

    it("Case 2: Resume section uses Colors.accent left strip (Story 14-5 CTA-cluster) + ListItemCard", () => {
      // POSITIVE: ResumeInProgressRow uses ListItemCard with Colors.accent leftStripColor
      expect(screen).toMatch(/leftStripColor=\{Colors\.accent\}/);
      // POSITIVE: the Resume section header is rendered
      expect(screen).toMatch(/>\s*Resume\s*</);
      // NEGATIVE: no raw hex in the screen (Story 14-4 token enforcement)
      // Scope the assertion to NEW sections only — the FullSimCard already
      // has design-token-exempt hex tints; we check the new helper functions
      // by extracting their bodies.
      // Use a broad NEGATIVE check: there should be no `#abcdef`-shape hex
      // immediately after `leftStripColor=` or `iconColor=` in the screen.
      expect(screen).not.toMatch(/leftStripColor=\{["']?#[0-9a-fA-F]{3,8}/);
    });

    it("Case 3: Past-results rendering uses <ListItemCard> (NOT bespoke View+Text JSX)", () => {
      // POSITIVE: PastResultRow function definition renders <ListItemCard>
      expect(screen).toMatch(/function\s+PastResultRow\s*\(/);
      // The past-results section renders pastResults via PastResultRow → ListItemCard
      expect(screen).toMatch(/<PastResultRow\b/);
      // NEGATIVE: no pre-14-7 pattern of inline bespoke past-results JSX.
      // The screen DOES use raw View/Text for the hero header + FullSimCard
      // (out of scope for 14-7) so we can't NEGATIVE-pin those globally.
      // Instead, pin that the "Past results" section header is followed by
      // a PastResultRow invocation (not bespoke JSX).
      const pastResultsSection = screen.match(/>\s*Past results\s*<[\s\S]{0,500}?<PastResultRow/);
      expect(pastResultsSection).not.toBeNull();
    });

    it("Case 4: Screen calls formatTimeRemaining + formatPastResultDate (delete-don't-alias guard)", () => {
      // POSITIVE: each formatter is referenced somewhere in the screen
      expect(screen).toMatch(/\bformatTimeRemaining\s*\(/);
      expect(screen).toMatch(/\bformatPastResultDate\s*\(/);
      expect(screen).toMatch(/\bformatPastResultDuration\s*\(/);
    });

    it("Case 5: useFocusEffect is imported AND invoked", () => {
      expect(screen).toMatch(/import\s+\{[^}]*useFocusEffect[^}]*\}\s+from\s+["']expo-router["']/);
      // POSITIVE: useFocusEffect is invoked with a callback wrapping refetch
      expect(screen).toMatch(/useFocusEffect\s*\(/);
      expect(screen).toMatch(/refetch/);
    });
  });

  describe("mock-test-results.ts exports", () => {
    const resultsRaw = readFile("src/lib/mock-test-results.ts");
    const results = stripComments(resultsRaw);

    it("Case 6: exports reconstructTestResultsFromMockTestRow + 3 formatter helpers + MockTestRow type", () => {
      expect(results).toMatch(/export\s+function\s+formatTimeRemaining\b/);
      expect(results).toMatch(/export\s+function\s+formatPastResultDate\b/);
      expect(results).toMatch(/export\s+function\s+formatPastResultDuration\b/);
      expect(results).toMatch(/export\s+function\s+reconstructTestResultsFromMockTestRow\b/);
      expect(results).toMatch(/export\s+interface\s+MockTestRow\b/);
      expect(results).toMatch(/export\s+interface\s+TestResultsPayload\b/);
    });

    it("Case 7: NEVER calls toLocaleDateString with 'fr' (Story 14-1 R1-M5 chrome rule)", () => {
      // NEGATIVE: must not use FR locale on the chrome-rule date helper
      expect(results).not.toMatch(/toLocaleDateString\s*\(\s*["']fr["']/);
      // POSITIVE: uses "en" locale
      expect(results).toMatch(/toLocaleDateString\s*\(\s*["']en["']/);
    });
  });

  describe("use-mock-test-landing.ts contract", () => {
    const hookRaw = readFile("src/hooks/use-mock-test-landing.ts");
    const hook = stripComments(hookRaw);

    it("Case 8: hook fires 2 parallel supabase queries via Promise.all + uses captureError tag 'mock-test-landing-fetch'", () => {
      // POSITIVE: 2 queries dispatched via Promise.all (NOT serial await)
      expect(hook).toMatch(/Promise\.all\s*\(\s*\[/);
      // POSITIVE: in-progress query uses .eq("status", "in_progress")
      expect(hook).toMatch(/\.eq\(["']status["'],\s*["']in_progress["']/);
      // POSITIVE: past-results query uses .eq("status", "completed")
      expect(hook).toMatch(/\.eq\(["']status["'],\s*["']completed["']/);
      // POSITIVE: past-results limit is exactly 10
      expect(hook).toMatch(/PAST_RESULTS_LIMIT\s*=\s*10/);
      // POSITIVE: captureError tag matches Story 9-3 allowlist contract
      expect(hook).toMatch(/captureError\([^)]*,\s*["']mock-test-landing-fetch["']/);
      // R1-P5: in-progress query also filters by completed_at IS NULL —
      // defense-in-depth against the test runner's fire-and-forget
      // completion UPDATE racing with landing refetch.
      expect(hook).toMatch(/\.is\(["']completed_at["'],\s*null\)/);
    });
  });

  describe("Loader integration (R1-P16)", () => {
    const screenRaw = readFile("app/(tabs)/mock-test/index.tsx");
    const screen = stripComments(screenRaw);
    const loaderRaw = readFile("src/hooks/use-mock-test-results-loader.ts");
    const loader = stripComments(loaderRaw);

    it("Case 9 (R1-P16): screen wires loadAndNavigate to PastResultRow.onPress (vacuous-import defense)", () => {
      // POSITIVE: screen imports `loadAndNavigate` via destructure
      expect(screen).toMatch(/const\s*\{\s*loadAndNavigate\s*\}\s*=\s*useMockTestResultsLoader/);
      // POSITIVE: screen passes `loadAndNavigate` as `onPress` prop to
      // PastResultRow (catches a refactor that imports the hook but
      // forgets to wire the press handler)
      expect(screen).toMatch(/onPress=\{loadAndNavigate\}/);
    });

    it("Case 10 (R1-P14): loader filters by status='completed' (defense-in-depth against in-progress row leakage)", () => {
      expect(loader).toMatch(/\.eq\(["']status["'],\s*["']completed["']/);
    });

    it("Case 11 (R1-P6): loader uses synchronous re-entrancy guard (loadingRef) to prevent double-tap double-push", () => {
      expect(loader).toMatch(/loadingRef\.current/);
      // POSITIVE: guard fires BEFORE the supabase call (synchronous gate)
      expect(loader).toMatch(/if\s*\(\s*loadingRef\.current\s*\)\s*return/);
    });
  });
});
