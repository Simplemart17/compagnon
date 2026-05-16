/**
 * Story 14-8 — source-drift detector for the Alert.alert → ThemedDialog
 * migration of high-traffic flows.
 *
 * Pattern: Story 12-2 P12 comment-stripped readFile + targeted regex
 * assertions + Story 13-2 P11 paired POSITIVE+NEGATIVE pin discipline.
 *
 * Pins:
 *  - `ThemedDialog` + `useThemedDialog` are imported in profile/index.tsx + profile/settings.tsx
 *  - The 5 migrated handler bodies do NOT contain `Alert.alert(`
 *  - `themedDialogCardStaticStyle` is frozen (Object.freeze)
 *  - `THEMED_DIALOG_ANIM_DURATION_MS` exported as 180
 *  - Backdrop a11y uses the 3-prop decorative pattern (Story 14-3 R1-P1)
 *  - Typography.ctaLabel added to design.ts (used by action buttons)
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Extract a top-level function body — balanced-brace walker (Story 13-1 P3
 * / 13-4 H1 / 13-5 H1 / 13-7 R1-P4 / 14-7 R1-P9 lesson — scope assertions
 * to a SPECIFIC function so siblings can't false-positive).
 */
function extractFunctionBody(source: string, name: string): string {
  const fnPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = fnPattern.exec(source);
  if (!match) return "";
  let depth = 0;
  let bodyStart = -1;
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0 && bodyStart !== -1) {
        return source.slice(bodyStart, i + 1);
      }
    }
  }
  return "";
}

describe("Story 14-8 — Alert.alert → ThemedDialog migration source drift", () => {
  describe("ThemedDialog.tsx contract", () => {
    const componentRaw = readFile("src/components/common/ThemedDialog.tsx");
    const component = stripComments(componentRaw);

    it("Case 1: ThemedDialog + ThemedDialogProps + ThemedDialogButton + THEMED_DIALOG_ANIM_DURATION_MS + themedDialogCardStaticStyle exported", () => {
      expect(component).toMatch(/export\s+const\s+ThemedDialog\s*=\s*React\.memo/);
      expect(component).toMatch(/export\s+interface\s+ThemedDialogProps\b/);
      expect(component).toMatch(/export\s+interface\s+ThemedDialogButton\b/);
      expect(component).toMatch(/export\s+const\s+THEMED_DIALOG_ANIM_DURATION_MS\s*=\s*180/);
      expect(component).toMatch(/export\s+const\s+themedDialogCardStaticStyle/);
    });

    it("Case 2: themedDialogCardStaticStyle uses Object.freeze + spreads Shadows.hero FIRST (Story 13-7 R1-P1)", () => {
      // POSITIVE: Object.freeze wraps the literal
      expect(component).toMatch(
        /export\s+const\s+themedDialogCardStaticStyle[\s\S]*?Object\.freeze\(/
      );
      // POSITIVE: Shadows.hero spread appears INSIDE the frozen literal
      expect(component).toMatch(/Object\.freeze\(\{\s*\.\.\.Shadows\.hero\b/);
    });

    it("Case 3: Backdrop uses Story 14-3 R1-P1 3-prop decorative a11y pattern", () => {
      // The backdrop Animated.View must set ALL THREE props.
      expect(component).toMatch(/accessible=\{false\}/);
      expect(component).toMatch(/accessibilityElementsHidden=\{true\}/);
      // importantForAccessibility="no-hide-descendants" OR "no" — both
      // are valid Android-canonical strings; ThemedDialog uses
      // "no-hide-descendants" for the backdrop (hides descendants too).
      expect(component).toMatch(/importantForAccessibility="(no-hide-descendants|no)"/);
    });

    it("Case 4: button-press handler uses synchronous useRef re-entrancy guard (Story 12-9 / 14-7 R1-P6 pattern)", () => {
      // POSITIVE: a `tappedRef` (or similar useRef-based gate) exists
      expect(component).toMatch(/useRef\b/);
      // POSITIVE: synchronous gate pattern — `if (X.current) return; X.current = true;`
      expect(component).toMatch(/if\s*\(\s*\w+\.current\s*\)\s*return/);
    });
  });

  describe("design.ts Typography.ctaLabel (added by Story 14-8)", () => {
    const designRaw = readFile("src/lib/design.ts");
    const design = stripComments(designRaw);

    it("Case 5: Typography.ctaLabel preset exists with 17pt 700-weight color:Colors.textOnDark", () => {
      // The preset is a property of the Typography object
      expect(design).toMatch(/ctaLabel:\s*\{[\s\S]*?fontSize:\s*17/);
      expect(design).toMatch(/ctaLabel:\s*\{[\s\S]*?fontWeight:\s*"700"/);
      expect(design).toMatch(/ctaLabel:\s*\{[\s\S]*?color:\s*Colors\.textOnDark/);
    });
  });

  describe("profile/index.tsx migration (sign-out flow)", () => {
    const profileRaw = readFile("app/(tabs)/profile/index.tsx");
    const profile = stripComments(profileRaw);

    it("Case 6: imports useThemedDialog + ThemedDialog (positive pins)", () => {
      expect(profile).toMatch(
        /import\s+\{[^}]*useThemedDialog[^}]*\}\s+from\s+["']@\/src\/hooks\/use-themed-dialog["']/
      );
      expect(profile).toMatch(
        /import\s+\{[^}]*ThemedDialog[^}]*\}\s+from\s+["']@\/src\/components\/common\/ThemedDialog["']/
      );
    });

    it("Case 7: handleSignOut body uses dialog.show, NOT Alert.alert (NEGATIVE pin)", () => {
      const handleSignOut = extractFunctionBody(profile, "handleSignOut");
      expect(handleSignOut.length).toBeGreaterThan(0);
      // POSITIVE: dialog.show invoked
      expect(handleSignOut).toMatch(/dialog\.show\s*\(/);
      // NEGATIVE: no Alert.alert
      expect(handleSignOut).not.toMatch(/Alert\.alert\(/);
    });

    it("Case 8: file does NOT import Alert from react-native (delete-don't-alias)", () => {
      // Match the react-native import line (may span multiple lines).
      // Find the exact `import { ... } from "react-native"` block.
      const rnImport = profile.match(/import\s+\{[^}]+\}\s+from\s+["']react-native["']/);
      expect(rnImport).not.toBeNull();
      expect(rnImport![0]).not.toMatch(/\bAlert\b/);
    });
  });

  describe("profile/settings.tsx migration (5 confirmation flows)", () => {
    const settingsRaw = readFile("app/(tabs)/profile/settings.tsx");
    const settings = stripComments(settingsRaw);

    it("Case 9: imports useThemedDialog + ThemedDialog", () => {
      expect(settings).toMatch(
        /import\s+\{[^}]*useThemedDialog[^}]*\}\s+from\s+["']@\/src\/hooks\/use-themed-dialog["']/
      );
      expect(settings).toMatch(
        /import\s+\{[^}]*ThemedDialog[^}]*\}\s+from\s+["']@\/src\/components\/common\/ThemedDialog["']/
      );
    });

    it("Case 10: 5 migrated handler bodies use dialog.show, NOT Alert.alert", () => {
      const handlers = [
        "handleUpdateLevel",
        "handleUpdateTarget",
        "handleUpdateDailyGoal",
        "handleDeleteAccount",
        "handleSignOut",
      ];
      for (const fnName of handlers) {
        const body = extractFunctionBody(settings, fnName);
        expect(body.length).toBeGreaterThan(0);
        // POSITIVE: dialog.show invoked
        expect(body).toMatch(/dialog\.show\s*\(/);
        // NEGATIVE: no Alert.alert
        expect(body).not.toMatch(/Alert\.alert\(/);
      }
    });

    it("Case 11: file does NOT import Alert from react-native", () => {
      const rnImport = settings.match(/import\s+\{[^}]+\}\s+from\s+["']react-native["']/);
      expect(rnImport).not.toBeNull();
      expect(rnImport![0]).not.toMatch(/\bAlert\b/);
    });

    it("Case 12: confirmDeleteAccount still uses showToast (stage-2 inline confirmation NOT migrated — multi-step deferred)", () => {
      const confirmBody = extractFunctionBody(settings, "confirmDeleteAccount");
      expect(confirmBody.length).toBeGreaterThan(0);
      // POSITIVE: showToast still in place (this is the existing inline
      // "type DELETE" flow's success/error feedback — out of scope for 14-8)
      expect(confirmBody).toMatch(/showToast/);
    });
  });
});
