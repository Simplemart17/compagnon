/**
 * Story 14-5 — accent-color overload-resolution source-drift detector.
 *
 * Pins the 3-token split (CTA / streak / progress) introduced to resolve
 * audit P2-12. Verifies:
 *   - Token contracts: new Colors.streak* + Colors.progress* values stable.
 *   - WCAG-AA contrast: streakText + progressText satisfy ≥ 4.5:1 on
 *     Colors.surface (computed via WCAG 2.1 relative-luminance formula
 *     embedded in this test file — no external dependency).
 *   - Source-drift migrations: each migrated streak-cluster + progress-
 *     cluster site reads from the correct token, NOT Colors.accent.
 *
 * Pattern mirrors Story 14-4's `design-token-enforcement-source-drift.test.ts`
 * (Story 12-2 P12 comment-stripped readFile + targeted regex assertions).
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// WCAG 2.1 relative-luminance + contrast-ratio helpers.
// Specs: https://www.w3.org/WAI/WCAG21/Techniques/general/G18
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) {
    throw new Error(`Expected 6-digit hex, got "${hex}"`);
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const channelLum = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

function getContrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Strip `//` line comments AND block comments (slash-star ... star-slash) from
// source text so regex-based source-drift assertions don't false-positive on
// tokens that appear ONLY in JSDoc / inline comments (Story 14-2 R1-M7 +
// Story 12-2 P12 comment-strip discipline).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("Story 14-5 — accent-color overload resolution source drift", () => {
  describe("Token contracts in src/lib/design.ts", () => {
    const designSource = readFile("src/lib/design.ts");

    it("Case 1: Colors.streak* cluster is exported with the Story 14-5 hue choices (no streakDark per R1-P5 delete-don't-alias)", () => {
      expect(designSource).toMatch(/streak:\s*"#F59E0B"/); // Tailwind v3.4 amber-500
      expect(designSource).toMatch(/streakText:\s*"#92400E"/); // Tailwind v3.4 amber-800
      expect(designSource).toMatch(/streak10:\s*"rgba\(245,158,11,0\.1\)"/);
      expect(designSource).toMatch(/streak15:\s*"rgba\(245,158,11,0\.15\)"/);
      expect(designSource).toMatch(/streak20:\s*"rgba\(245,158,11,0\.2\)"/);
      expect(designSource).toMatch(/streak30:\s*"rgba\(245,158,11,0\.3\)"/);
      // R1-P5: streakDark was deleted as unused (zero consumers).
      // Story 10-2/11-3/14-2/14-4 "delete don't alias" pattern.
      expect(designSource).not.toMatch(/^\s*streakDark:/m);
    });

    it("Case 2: Colors.progress* cluster is exported with the Story 14-5 hue choices (no progressDark per R1-P5)", () => {
      expect(designSource).toMatch(/progress:\s*"#CA8A04"/); // Tailwind v3.4 yellow-600
      expect(designSource).toMatch(/progressText:\s*"#713F12"/); // Tailwind v3.4 yellow-900
      expect(designSource).toMatch(/progress10:\s*"rgba\(202,138,4,0\.1\)"/);
      expect(designSource).toMatch(/progress15:\s*"rgba\(202,138,4,0\.15\)"/);
      expect(designSource).toMatch(/progress20:\s*"rgba\(202,138,4,0\.2\)"/);
      expect(designSource).toMatch(/progress30:\s*"rgba\(202,138,4,0\.3\)"/);
      // R1-P5: progressDark was deleted as unused (zero consumers).
      expect(designSource).not.toMatch(/^\s*progressDark:/m);
    });

    it("Case 3: NEGATIVE — Colors.accent value is UNCHANGED (#F5A623; CTA-cluster preserved byte-identically)", () => {
      // The 3-token split decouples streak/progress from accent without changing
      // accent itself. A regression that drifts accent would silently shift all
      // 130-150 CTA surfaces.
      expect(designSource).toMatch(/^\s*accent:\s*"#F5A623",\s*$/m);
    });
  });

  describe("WCAG-AA contrast (computed via embedded WCAG 2.1 formula)", () => {
    // The `Colors.surface = "#F5F5F0"` is the canonical light background for
    // streak chips + progress badges on the home + profile screens.
    const SURFACE = "#F5F5F0";

    it("Case 4: Colors.streakText (#92400E) on Colors.surface (#F5F5F0) >= 4.5:1 WCAG AA (actual 6.48:1; below AAA's 7.0:1) — LIGHT-BG ONLY (R1-P19)", () => {
      const ratio = getContrastRatio("#92400E", SURFACE);
      // Empirical: 6.4829 — comfortably above AA's 4.5:1 floor, below AAA's 7.0:1.
      // The streak chrome is a 13px font-bold day-count + a 14px Feather icon, both
      // SHORT-FORM informational content where AA-only is the canonical floor.
      // R1-P10 tighter precision: toBeCloseTo(6.48, 2) means the difference must be
      // < 0.005 (precision counts digits AFTER the decimal in Jest). A drift like
      // 6.50 would now fail; pre-R1's precision=1 permitted ±0.05.
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeLessThan(7.0); // sanity-pin: not AAA, by design choice
      expect(ratio).toBeCloseTo(6.48, 2);
    });

    it("Case 4b (R1-P2): Colors.streak (#F59E0B) on Colors.bgDark (#0D2240) >= 4.5:1 WCAG AA — DARK-BG contract", () => {
      // Story 14-5 R1-P2: streak chips on home + profile render on dark composites
      // (bgDark / primary backgrounds with streak20/skillTint overlay). Using
      // Colors.streakText on those composites gave 1.23-1.59:1 (failed AA badly).
      // Using Colors.streak base hue itself gives ~8:1 on bgDark (passes AA).
      // This case pins the dark-bg AA contract that R1-P2 introduced.
      const ratio = getContrastRatio("#F59E0B", "#0D2240");
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThanOrEqual(7.0); // bonus: passes AAA on bgDark
    });

    it("Case 5: Colors.progressText (#713F12) on Colors.surface (#F5F5F0) >= 4.5:1 WCAG AA (actual 7.93:1; AAA)", () => {
      const ratio = getContrastRatio("#713F12", SURFACE);
      // Empirical: 7.93 — satisfies both AA and AAA. Consumed by the
      // cefr-progression-chart Y-axis current-level label (R1-P3) where the
      // chart bg is Colors.surfaceWhite. R1-P10 tighter precision=2.
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
      expect(ratio).toBeCloseTo(7.93, 2);
    });

    it("Case 6: contrast formula self-check — pure white on pure black returns 21:1 (WCAG canonical max)", () => {
      // R1-P10b: WCAG 2.1 defines the white-on-black contrast as EXACTLY 21:1
      // (relative luminance of #FFFFFF is 1.0, #000000 is 0.0, ratio is (1.0+0.05)/(0.0+0.05) = 21).
      // Pre-R1 used precision=0 which permitted ±0.5 — buggy formulas returning 20.6
      // or 21.4 would have passed. Tighter precision=4 means difference < 0.00005.
      const ratio = getContrastRatio("#FFFFFF", "#000000");
      expect(ratio).toBeCloseTo(21, 4);
    });
  });

  describe("Source-drift migrations (streak-cluster)", () => {
    it("Case 7: home/index.tsx streak chip uses Colors.streak20 bg + Colors.streak text (DARK-BG contract per R1-P2; NOT Colors.accent)", () => {
      const home = readFile("app/(tabs)/home/index.tsx");
      // POSITIVE pins on the streak chip block
      expect(home).toMatch(/backgroundColor:\s*Colors\.streak20/);
      // R1-P2: text uses Colors.streak base hue (NOT Colors.streakText) because
      // the chip renders on dark composite where streakText fails WCAG AA.
      expect(home).toMatch(/color:\s*Colors\.streak\b/);
      // R1-P12: bound the window to the chip's logical </View> close by scoping
      // from the streak-chip block's `progress.streakDays > 0 &&` anchor to the
      // very next bare `)}` line (the chip's own conditional terminator).
      const chipStart = home.search(/progress\.streakDays\s*>\s*0\s*&&/);
      expect(chipStart).toBeGreaterThan(-1);
      const afterChipStart = home.slice(chipStart);
      const chipEndIdx = afterChipStart.search(/\)}\n/);
      expect(chipEndIdx).toBeGreaterThan(-1);
      const chipBlock = stripComments(afterChipStart.slice(0, chipEndIdx));
      // NEGATIVE pins: legacy text-accent className AND Colors.accent both gone from the chip block
      expect(chipBlock).not.toMatch(/className=[^>]*text-accent\b/);
      expect(chipBlock).not.toMatch(/Colors\.accent\b/);
      // R1-P2 negative pin: streakText NOT used on the home chip (dark-bg → would fail AA)
      expect(chipBlock).not.toMatch(/Colors\.streakText\b/);
    });

    it("Case 8: profile/index.tsx streak chip uses skillTint(Colors.streak, ...) bg + Colors.streak text (DARK-BG contract per R1-P2)", () => {
      const profile = readFile("app/(tabs)/profile/index.tsx");
      // POSITIVE pins — background + border use skillTint over Colors.streak
      expect(profile).toMatch(/skillTint\(\s*Colors\.streak\s*,\s*0\.18\s*\)/);
      expect(profile).toMatch(/skillTint\(\s*Colors\.streak\s*,\s*0\.35\s*\)/);
      // R1-P12: bound the window to the chip's own ternary close `) : null}`.
      const chipStart = profile.search(/\/\* Streak chip[^*]*\*\//);
      expect(chipStart).toBeGreaterThan(-1);
      const afterChipStart = profile.slice(chipStart);
      const chipEndIdx = afterChipStart.search(/\)\s*:\s*null\}/);
      expect(chipEndIdx).toBeGreaterThan(-1);
      const chipBlock = stripComments(afterChipStart.slice(0, chipEndIdx));
      // R1-P2: Icon zap (JSX prop `color={Colors.streak}`) AND day-count Text
      // (object-property `color: Colors.streak`) BOTH use Colors.streak base hue.
      // Match BOTH JSX-prop and object-property forms via tolerant regex.
      const streakOccurrences = chipBlock.match(/color[=:]\s*\{?\s*Colors\.streak\b/g) ?? [];
      expect(streakOccurrences.length).toBeGreaterThanOrEqual(2);
      // NEGATIVE pins: legacy accent + accentText gone; streakText also NOT used
      // (R1-P2 — dark-bg composite, streakText would fail AA).
      expect(chipBlock).not.toMatch(/Colors\.accent\b/);
      expect(chipBlock).not.toMatch(/Colors\.accentText\b/);
      expect(chipBlock).not.toMatch(/Colors\.streakText\b/);
    });
  });

  describe("Source-drift migrations (progress-cluster)", () => {
    it("Case 9: conversation/[sessionId].tsx Grammar RatingBar uses fillColor=Colors.progress with label=Grammar (R1-P15 positive label pin)", () => {
      const session = readFile("app/(tabs)/conversation/[sessionId].tsx");
      // Anchor on the Grammar RatingBar block
      const grammarStart = session.search(/\/\* Grammar bar[^*]*\*\//);
      expect(grammarStart).toBeGreaterThan(-1);
      const grammarBlock = session.slice(grammarStart, grammarStart + 500);
      // POSITIVE pins: both fillColor=Colors.progress AND label="Grammar" must be
      // present in the same block. Pre-R1 only the fillColor was pinned — a future
      // refactor swapping label between Fluency/Grammar bars would pass vacuously.
      expect(grammarBlock).toMatch(/label="Grammar"/);
      expect(grammarBlock).toMatch(/fillColor=\{Colors\.progress\}/);
      expect(grammarBlock).not.toMatch(/fillColor=\{Colors\.accent\}/);
    });

    it("Case 10: practice/dictation.tsx defines local PROGRESS = Colors.progress AND the ProgressBar fill uses it (R1-P16 balanced-brace block extraction)", () => {
      const dictation = readFile("app/(tabs)/practice/dictation.tsx");
      // The local constant declaration
      expect(dictation).toMatch(/const\s+PROGRESS\s*=\s*Colors\.progress/);
      // R1-P16: balanced-brace walking — extract the ProgressBar function body
      // by counting `{` and `}` to find the function's closing brace, rather than
      // searching for the next `\nfunction\s+\w+` which is brittle to inner
      // function declarations (e.g., a nested `function clamp(...)` would close
      // the block prematurely, vacuously satisfying both positive and negative pins).
      // Find the FUNCTION BODY `{` (NOT the parameter-destructuring `{` which
      // would close at `}:` type annotation). Pattern: `function ProgressBar`
      // ... first `) {` sequence after that = end-of-params + body-open.
      const fnBodyMatch = dictation.match(/function\s+ProgressBar\b[\s\S]*?\)\s*\{/);
      expect(fnBodyMatch).not.toBeNull();
      const openIdx = fnBodyMatch!.index! + fnBodyMatch![0].length - 1;
      const afterStart = dictation;
      // Walk balanced braces forward to find the matching close
      let depth = 1;
      let closeIdx = openIdx;
      for (let i = openIdx + 1; i < afterStart.length; i++) {
        if (afterStart[i] === "{") depth++;
        else if (afterStart[i] === "}") {
          depth--;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }
      expect(depth).toBe(0); // ensure we found a balanced close
      const progressBarBlockRaw = afterStart.slice(openIdx, closeIdx + 1);
      // Strip comments so JSDoc / inline comments don't trip the negative pin
      const progressBarBlock = stripComments(progressBarBlockRaw);
      expect(progressBarBlock).toMatch(/backgroundColor:\s*PROGRESS\b/);
      expect(progressBarBlock).not.toMatch(/backgroundColor:\s*ACCENT\b/);
    });

    it("Case 11: cefr-progression-chart.tsx uses Colors.progress for chart-data fills + Colors.progressText for Y-axis text (R1-P9 chart-body-scoped)", () => {
      const chart = readFile("src/components/profile/cefr-progression-chart.tsx");
      // R1-P9: scope the negative-pin to the chart's render body (CEFRProgressionChartInner
      // function), NOT file-wide. A future CTA addition at the chart footer would have
      // failed the pre-R1 file-wide assertion vacuously while being completely legitimate.
      // R1-P16 + R1-P9: find function-body `{` (after `) {` close-paren-open-brace),
      // NOT the destructuring `{` in `function CEFRProgressionChartInner({...})`.
      const fnBodyMatch = chart.match(/function\s+CEFRProgressionChartInner\b[\s\S]*?\)\s*\{/);
      expect(fnBodyMatch).not.toBeNull();
      const openIdx = fnBodyMatch!.index! + fnBodyMatch![0].length - 1;
      const afterFn = chart;
      let depth = 1;
      let closeIdx = openIdx;
      for (let i = openIdx + 1; i < afterFn.length; i++) {
        if (afterFn[i] === "{") depth++;
        else if (afterFn[i] === "}") {
          depth--;
          if (depth === 0) {
            closeIdx = i;
            break;
          }
        }
      }
      expect(depth).toBe(0);
      // Strip comments so JSDoc / inline comments don't trip the negative pin
      const chartBody = stripComments(afterFn.slice(openIdx, closeIdx + 1));
      // POSITIVE pins: ≥ 4 Colors.progress fills (data-feedback markers) + ≥ 1 Colors.progressText (R1-P3 Y-axis label)
      const progressOccurrences = chartBody.match(/Colors\.progress\b/g) ?? [];
      expect(progressOccurrences.length).toBeGreaterThanOrEqual(4);
      const progressTextOccurrences = chartBody.match(/Colors\.progressText\b/g) ?? [];
      expect(progressTextOccurrences.length).toBeGreaterThanOrEqual(1);
      // NEGATIVE pin: zero Colors.accent INSIDE the chart-render body
      const accentInBody = chartBody.match(/Colors\.accent\b/g) ?? [];
      expect(accentInBody).toHaveLength(0);
    });

    it("Case 12: ProcessingIndicator.tsx 3-dot bg uses Colors.progress (NOT Colors.accent)", () => {
      const indicator = readFile("src/components/conversation/ProcessingIndicator.tsx");
      expect(indicator).toMatch(/backgroundColor:\s*Colors\.progress\b/);
      expect(indicator).not.toMatch(/backgroundColor:\s*Colors\.accent\b/);
    });

    it("Case 13: placement-test.tsx progress-bar fill uses Colors.progress (Q7 operator-decision)", () => {
      const placement = readFile("app/onboarding/placement-test.tsx");
      // The animated progress-bar component (anchor on the `h-1 bg-white/20` container)
      const barStart = placement.search(/h-1\s+bg-white\/20\s+rounded-full\s+overflow-hidden/);
      expect(barStart).toBeGreaterThan(-1);
      const barBlock = placement.slice(barStart, barStart + 400);
      expect(barBlock).toMatch(/backgroundColor:\s*Colors\.progress\b/);
      expect(barBlock).not.toMatch(/backgroundColor:\s*Colors\.accent\b/);
    });

    it("Case 14 (R1-P1): home/index.tsx daily-goal progress bar uses Colors.progress (NOT Colors.accent)", () => {
      // R1-P1: Blind Hunter caught that the daily-minutes progress bar at
      // home/index.tsx:313 was NOT in the original 14-5 AC inventory but is
      // canonically progress-feedback per the story's own taxonomy (non-tappable
      // data feedback). Migrated to Colors.progress; completed state stays on
      // Colors.success.
      const home = readFile("app/(tabs)/home/index.tsx");
      const barStart = home.search(/accessibilityRole="progressbar"/);
      expect(barStart).toBeGreaterThan(-1);
      // Strip comments so JSDoc / inline comments don't trip the negative pin
      const barBlock = stripComments(home.slice(barStart, barStart + 800));
      // POSITIVE pin: the incomplete-progress branch uses Colors.progress
      expect(barBlock).toMatch(/Colors\.success\s*:\s*Colors\.progress\b/);
      // NEGATIVE pin: legacy `Colors.accent` is gone from this progress-bar block
      expect(barBlock).not.toMatch(/Colors\.accent\b/);
    });
  });
});
