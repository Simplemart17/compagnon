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

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("Story 14-5 — accent-color overload resolution source drift", () => {
  describe("Token contracts in src/lib/design.ts", () => {
    const designSource = readFile("src/lib/design.ts");

    it("Case 1: Colors.streak* cluster is exported with the Story 14-5 hue choices", () => {
      expect(designSource).toMatch(/streak:\s*"#F59E0B"/); // Tailwind amber-500
      expect(designSource).toMatch(/streakDark:\s*"#D97706"/);
      expect(designSource).toMatch(/streakText:\s*"#92400E"/); // Tailwind amber-800
      expect(designSource).toMatch(/streak10:\s*"rgba\(245,158,11,0\.1\)"/);
      expect(designSource).toMatch(/streak15:\s*"rgba\(245,158,11,0\.15\)"/);
      expect(designSource).toMatch(/streak20:\s*"rgba\(245,158,11,0\.2\)"/);
      expect(designSource).toMatch(/streak30:\s*"rgba\(245,158,11,0\.3\)"/);
    });

    it("Case 2: Colors.progress* cluster is exported with the Story 14-5 hue choices", () => {
      expect(designSource).toMatch(/progress:\s*"#CA8A04"/); // Tailwind yellow-600
      expect(designSource).toMatch(/progressDark:\s*"#A16207"/);
      expect(designSource).toMatch(/progressText:\s*"#713F12"/); // Tailwind yellow-900
      expect(designSource).toMatch(/progress10:\s*"rgba\(202,138,4,0\.1\)"/);
      expect(designSource).toMatch(/progress15:\s*"rgba\(202,138,4,0\.15\)"/);
      expect(designSource).toMatch(/progress20:\s*"rgba\(202,138,4,0\.2\)"/);
      expect(designSource).toMatch(/progress30:\s*"rgba\(202,138,4,0\.3\)"/);
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

    it("Case 4: Colors.streakText (#92400E) on Colors.surface (#F5F5F0) >= 4.5:1 WCAG AA (actual 6.48:1; below AAA's 7.0:1)", () => {
      const ratio = getContrastRatio("#92400E", SURFACE);
      // Empirical: 6.48 — comfortably above AA's 4.5:1 floor, below AAA's 7.0:1.
      // The streak chrome is a 13px font-bold day-count + a 14px Feather icon, both
      // SHORT-FORM informational content where AA-only is the canonical floor.
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeLessThan(7.0); // sanity-pin: not AAA, by design choice
      expect(ratio).toBeCloseTo(6.48, 1);
    });

    it("Case 5: Colors.progressText (#713F12) on Colors.surface (#F5F5F0) >= 4.5:1 WCAG AA (actual 7.93:1; AAA)", () => {
      const ratio = getContrastRatio("#713F12", SURFACE);
      // Empirical: 7.93 — satisfies both AA and AAA. Progress text is a
      // potential future-use token (no consumer in v1 — only the bg fill +
      // bar fill use Colors.progress), so we pin AAA for headroom.
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
      expect(ratio).toBeCloseTo(7.93, 1);
    });

    it("Case 6: contrast formula self-check — pure white on pure black returns 21:1 (WCAG canonical max)", () => {
      const ratio = getContrastRatio("#FFFFFF", "#000000");
      expect(ratio).toBeCloseTo(21, 0);
    });
  });

  describe("Source-drift migrations (streak-cluster)", () => {
    it("Case 7: home/index.tsx streak chip uses Colors.streak20 + Colors.streakText (NOT Colors.accent)", () => {
      const home = readFile("app/(tabs)/home/index.tsx");
      // POSITIVE pins on the streak chip block
      expect(home).toMatch(/backgroundColor:\s*Colors\.streak20/);
      expect(home).toMatch(/color:\s*Colors\.streakText/);
      // NEGATIVE pin: the original `text-accent` Tailwind className is gone from the streak chip row
      // (the streak chip block spans roughly lines 276-291; we anchor on its `progress.streakDays > 0`
      // condition then forward-search for `text-accent` within that block).
      const chipStart = home.search(/progress\.streakDays\s*>\s*0\s*&&/);
      expect(chipStart).toBeGreaterThan(-1);
      const chipBlock = home.slice(chipStart, chipStart + 600);
      expect(chipBlock).not.toMatch(/className=[^>]*text-accent\b/);
      expect(chipBlock).not.toMatch(/Colors\.accent\b/);
    });

    it("Case 8: profile/index.tsx streak chip uses Colors.streak* + skillTint(Colors.streak, ...) (NOT Colors.accent)", () => {
      const profile = readFile("app/(tabs)/profile/index.tsx");
      // POSITIVE pins
      expect(profile).toMatch(/skillTint\(\s*Colors\.streak\s*,\s*0\.18\s*\)/);
      expect(profile).toMatch(/skillTint\(\s*Colors\.streak\s*,\s*0\.35\s*\)/);
      // The Icon zap (JSX prop syntax `color={Colors.streakText}`) AND the
      // day-count Text (object-property syntax `color: Colors.streakText`)
      // both use Colors.streakText. Match BOTH forms via a tolerant regex.
      const occurrences = profile.match(/color[=:]\s*\{?\s*Colors\.streakText\b/g) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
      // NEGATIVE pin: the streak chip block (anchor: `Streak chip` comment) has no `Colors.accent` references
      const chipStart = profile.search(/\/\* Streak chip[^*]*\*\//);
      expect(chipStart).toBeGreaterThan(-1);
      const chipBlock = profile.slice(chipStart, chipStart + 800);
      expect(chipBlock).not.toMatch(/Colors\.accent\b/);
      expect(chipBlock).not.toMatch(/Colors\.accentText\b/);
    });
  });

  describe("Source-drift migrations (progress-cluster)", () => {
    it("Case 9: conversation/[sessionId].tsx Grammar RatingBar uses Colors.progress (NOT Colors.accent)", () => {
      const session = readFile("app/(tabs)/conversation/[sessionId].tsx");
      // Anchor on the Grammar RatingBar block + verify fillColor maps to Colors.progress
      const grammarStart = session.search(/\/\* Grammar bar[^*]*\*\//);
      expect(grammarStart).toBeGreaterThan(-1);
      const grammarBlock = session.slice(grammarStart, grammarStart + 500);
      expect(grammarBlock).toMatch(/fillColor=\{Colors\.progress\}/);
      expect(grammarBlock).not.toMatch(/fillColor=\{Colors\.accent\}/);
    });

    it("Case 10: practice/dictation.tsx defines local PROGRESS = Colors.progress AND the ProgressBar fill uses it", () => {
      const dictation = readFile("app/(tabs)/practice/dictation.tsx");
      // The local constant declaration
      expect(dictation).toMatch(/const\s+PROGRESS\s*=\s*Colors\.progress/);
      // The ProgressBar component uses PROGRESS, not ACCENT
      const progressBarStart = dictation.search(/function\s+ProgressBar\b/);
      expect(progressBarStart).toBeGreaterThan(-1);
      // Slice from ProgressBar to the next function declaration (close of the ProgressBar body)
      const afterProgressBar = dictation.slice(progressBarStart);
      const nextFn = afterProgressBar.slice(50).search(/\nfunction\s+\w+/);
      const progressBarBlock =
        nextFn === -1 ? afterProgressBar : afterProgressBar.slice(0, nextFn + 50);
      expect(progressBarBlock).toMatch(/backgroundColor:\s*PROGRESS\b/);
      expect(progressBarBlock).not.toMatch(/backgroundColor:\s*ACCENT\b/);
    });

    it("Case 11: cefr-progression-chart.tsx uses Colors.progress for chart markers (4+ sites; NOT Colors.accent)", () => {
      const chart = readFile("src/components/profile/cefr-progression-chart.tsx");
      // Should have multiple Colors.progress references (line-segments × 2, marker border + shadow, badge bg, Y-axis label)
      const progressOccurrences = chart.match(/Colors\.progress\b/g) ?? [];
      expect(progressOccurrences.length).toBeGreaterThanOrEqual(4);
      // And ZERO remaining Colors.accent references in the file
      const accentOccurrences = chart.match(/Colors\.accent\b/g) ?? [];
      expect(accentOccurrences).toHaveLength(0);
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
  });
});
