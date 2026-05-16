/**
 * Story 14-9 -- source-drift detector for the hero-pattern unification across
 * 5 tabs (home, conversation, practice, mock-test, profile).
 *
 * Pattern: Story 12-2 P12 comment-stripped readFile + targeted regex
 * assertions + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline +
 * Story 13-7 R1-P4 scoped-element extraction discipline.
 *
 * Pins:
 *  - Presets.heroHeader is DELETED from src/lib/design.ts (delete-dont-alias).
 *  - Each of 5 screens imports HeroHeader AND the legacy bespoke hero JSX
 *    (className substrings + skillTint overlay literals) are GONE.
 *  - Each of 5 screens contains at least one HeroHeader opening tag.
 *  - HeroHeader.tsx exports heroHeaderContainerStaticStyle and uses
 *    Shadows.hero canonically (the consistency fix applied to all surfaces).
 *  - scripts/check-design-tokens.sh radius_pattern includes the side-specific
 *    variants (b|t|l|r|tl|tr|bl|br) closing the Story 14-4 gate gap.
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

// Strip block + line + JSX comments. Story 14-2 R1-M7 lesson: the
// brace-exclusion regex prevents over-matching into TypeScript interface
// bodies that contain JSDoc tags.
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[^{}]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("Story 14-9 -- Hero pattern unification source drift", () => {
  describe("design.ts -- Presets.heroHeader DELETED", () => {
    const designRaw = readFile("src/lib/design.ts");
    const design = stripComments(designRaw);

    it("Case 1: Presets.heroHeader entry is removed (delete-dont-alias)", () => {
      // After Story 14-9: the new HeroHeader component owns the canonical
      // pattern; the unused preset was deleted from the Presets object.
      expect(design).not.toMatch(/heroHeader\s*:\s*\{/);
    });
  });

  describe("HeroHeader.tsx -- component contract", () => {
    const componentRaw = readFile("src/components/common/HeroHeader.tsx");
    const component = stripComments(componentRaw);

    it("Case 2a: exports HeroHeader (named) + default + memo wrapper", () => {
      expect(component).toMatch(/export\s+const\s+HeroHeader\s*=\s*React\.memo/);
      expect(component).toMatch(/export\s+default\s+HeroHeader/);
    });

    it("Case 2b: exports heroHeaderContainerStaticStyle for runtime test pinning", () => {
      expect(component).toMatch(/export\s+const\s+heroHeaderContainerStaticStyle/);
    });

    it("Case 2c: container static style is Object.freezed AND spreads Shadows.hero FIRST (Story 13-7 R1-P1 + R1-P2)", () => {
      // POSITIVE: Object.freeze wraps the literal
      expect(component).toMatch(
        /export\s+const\s+heroHeaderContainerStaticStyle[\s\S]*?Object\.freeze\(/
      );
      // POSITIVE: Shadows.hero spread appears INSIDE the frozen literal
      expect(component).toMatch(/Object\.freeze\(\{\s*\.\.\.Shadows\.hero\b/);
    });

    it("Case 2d: uses Radii.heroBottom for both bottom corners (canonical token)", () => {
      expect(component).toMatch(/borderBottomLeftRadius\s*:\s*Radii\.heroBottom/);
      expect(component).toMatch(/borderBottomRightRadius\s*:\s*Radii\.heroBottom/);
    });

    it("Case 2e: overlay variants both carry Story 14-3 R1-P1 3-prop decorative a11y + pointerEvents:none", () => {
      // Verify ALL three a11y props + pointerEvents appear in the file (the
      // runtime test pins per-overlay-branch specifics). R1-P1: pointerEvents
      // moved from JSX prop (deprecated in RN 0.74+) into the style field.
      expect(component).toMatch(/accessible=\{false\}/);
      expect(component).toMatch(/accessibilityElementsHidden=\{true\}/);
      expect(component).toMatch(/importantForAccessibility="no-hide-descendants"/);
      // pointerEvents now lives inside the frozen overlay style constants
      // as `pointerEvents: "none"` (style field) rather than the deprecated
      // JSX prop form `pointerEvents="none"`.
      expect(component).toMatch(/pointerEvents:\s*["']none["']/);
    });
  });

  describe("Screen migrations -- paired POSITIVE+NEGATIVE pins", () => {
    const HERO_TARGETS = [
      {
        name: "home",
        relPath: "app/(tabs)/home/index.tsx",
        // home skeleton + live both used the same legacy substring in some
        // order; assert it is GONE.
        legacy: [/bg-primary\s+pb-6\s+px-6\s+rounded-b-\[28px\]/],
      },
      {
        name: "conversation",
        relPath: "app/(tabs)/conversation/index.tsx",
        // conversation used a different className order + a bespoke depth
        // overlay literal that is now produced by overlay="depth-glow".
        legacy: [
          /bg-primary\s+rounded-b-\[28px\]\s+pb-6\s+px-6/,
          /skillTint\(Colors\.primaryDark,\s*0\.4\)/,
        ],
      },
      {
        name: "practice",
        relPath: "app/(tabs)/practice/index.tsx",
        legacy: [/bg-primary\s+pb-7\s+px-6\s+rounded-b-\[28px\]/],
      },
      {
        name: "mock-test",
        relPath: "app/(tabs)/mock-test/index.tsx",
        legacy: [/bg-primary\s+px-6\s+pb-8\s+rounded-b-\[28px\]\s+items-center/],
      },
      {
        name: "profile",
        relPath: "app/(tabs)/profile/index.tsx",
        // profile skeleton + live both used the same legacy substring in some
        // order; assert it is GONE. Also assert the inner-dim overlay literal
        // is gone (now produced by overlay="inner-dim").
        legacy: [
          /rounded-b-\[28px\]\s+bg-primary\s+px-6\s+pb-8/,
          /skillTint\(Colors\.bgDark,\s*0\.35\)/,
        ],
      },
    ] as const;

    for (const target of HERO_TARGETS) {
      describe(target.name + "/index.tsx", () => {
        const source = stripComments(readFile(target.relPath));

        it("Case 3a: imports HeroHeader", () => {
          expect(source).toMatch(
            /import\s+\{[^}]*HeroHeader[^}]*\}\s+from\s+["']@\/src\/components\/common\/HeroHeader["']/
          );
        });

        it("Case 3b: contains at least one <HeroHeader opening tag invocation", () => {
          // POSITIVE-pin: defends against half-migrations (Story 13-2 P11).
          const openTags = source.match(/<HeroHeader\b/g) ?? [];
          expect(openTags.length).toBeGreaterThan(0);
        });

        for (const [idx, legacyPattern] of target.legacy.entries()) {
          it(
            "Case 3c-" +
              (idx + 1) +
              ": legacy bespoke hero pattern is GONE: " +
              legacyPattern.source,
            () => {
              expect(source).not.toMatch(legacyPattern);
            }
          );
        }
      });
    }

    it("Case 3d: home + profile each contain TWO HeroHeader invocations (skeleton + live)", () => {
      const home = stripComments(readFile("app/(tabs)/home/index.tsx"));
      const profile = stripComments(readFile("app/(tabs)/profile/index.tsx"));
      const homeMatches = home.match(/<HeroHeader\b/g) ?? [];
      const profileMatches = profile.match(/<HeroHeader\b/g) ?? [];
      expect(homeMatches.length).toBe(2);
      expect(profileMatches.length).toBe(2);
    });
  });

  describe("Story 14-4 design-token gate -- radius_pattern extended", () => {
    const gateRaw = readFile("scripts/check-design-tokens.sh");

    it("Case 4: radius_pattern regex includes side-specific variants (b|t|l|r|tl|tr|bl|br)", () => {
      // Pre-14-9: only the un-prefixed rounded-[N] was caught; all 7 hero
      // sites used rounded-b-[28px] and silently bypassed the gate. Post-14-9
      // the regex covers the side-specific group.
      expect(gateRaw).toMatch(/radius_pattern\s*=\s*['"][^'"]*\(b\|t\|l\|r\|tl\|tr\|bl\|br\)/);
    });
  });
});
