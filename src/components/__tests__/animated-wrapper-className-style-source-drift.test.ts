/**
 * Story 13-7 — source-drift detector for the 3 hot-animated wrappers that
 * Story 13-7 converted from mixed `className`+`style` to pure `style` arrays
 * (`ConversationCard` in `app/(tabs)/home/index.tsx`, `StatTile` in
 * `src/components/common/StatTile.tsx`, and the inner `<Pressable>` in
 * `src/components/common/SkillCard.tsx`).
 *
 * NativeWind v4 + Reanimated v4 cost model: every `className="..."` is
 * resolved at Babel-compile time into a style-object lookup; when the same
 * element also carries a `style` prop, the runtime merges both. On animated
 * wrappers the merge runs alongside the worklet output on every frame —
 * compounding per-frame work during press-scale cycles + entry-fade cascades.
 *
 * This file pins the converted shape and the 2 already-canonical controls
 * (`TodayPlanItem` in `src/components/home/TodayPlanItem.tsx` and the
 * `AnimatedMessage` `<Reanimated.View>` in
 * `src/components/conversation/TranscriptView.tsx`) so a future PR that
 * re-introduces `className` on these animated wrappers fails CI immediately.
 *
 * Pattern: comment-stripped source (Story 12-2 P12) + scoped JSX-block
 * extraction (Story 12-5 P12 / 13-1 P3 / 13-4 H1 lessons — anchor regexes to
 * the specific JSX element or function body, NOT file-wide; file-wide false
 * positives are the #1 drift-detector regression mode per Story 13-2 P11).
 *
 * Closes audit P2-x performance.
 */

import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..");

const HOME_INDEX_PATH = join(REPO_ROOT, "app", "(tabs)", "home", "index.tsx");
const STAT_TILE_PATH = join(REPO_ROOT, "src", "components", "common", "StatTile.tsx");
const SKILL_CARD_PATH = join(REPO_ROOT, "src", "components", "common", "SkillCard.tsx");
const TODAY_PLAN_ITEM_PATH = join(REPO_ROOT, "src", "components", "home", "TodayPlanItem.tsx");
const TRANSCRIPT_VIEW_PATH = join(
  REPO_ROOT,
  "src",
  "components",
  "conversation",
  "TranscriptView.tsx"
);

/**
 * Strip block + line comments before regex pinning so JSDoc / inline comments
 * that mention pre-13-7 patterns don't trip negative guards. Story 12-2 P12
 * lesson — applied identically here.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const HOME_INDEX_CODE = stripComments(readFileSync(HOME_INDEX_PATH, "utf-8"));
const STAT_TILE_CODE = stripComments(readFileSync(STAT_TILE_PATH, "utf-8"));
const SKILL_CARD_CODE = stripComments(readFileSync(SKILL_CARD_PATH, "utf-8"));
const TODAY_PLAN_ITEM_CODE = stripComments(readFileSync(TODAY_PLAN_ITEM_PATH, "utf-8"));
const TRANSCRIPT_VIEW_CODE = stripComments(readFileSync(TRANSCRIPT_VIEW_PATH, "utf-8"));

/**
 * Extract a single JSX-element body by walking balanced angle brackets after
 * the opening `<TagName` token. Returns the substring from the opening `<`
 * through the matching `>` of the opening tag (NOT including the children or
 * closing tag) — sufficient for asserting props on the opening tag.
 *
 * Story 13-4 H1 / 13-5 H1 lesson — scoped extraction defeats file-wide false
 * positives. The walker tolerates nested `{}` JSX expressions and string
 * literals (single, double, template) so a `style={{ foo: ">" }}` literal
 * does not prematurely terminate the tag.
 */
function extractOpeningTag(source: string, tagName: string): string | null {
  const openRegex = new RegExp(`<${tagName}\\b`, "g");
  const match = openRegex.exec(source);
  if (!match) return null;

  let i = match.index + match[0].length;
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let escaped = false;

  while (i < source.length) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (ch === ">" && depth === 0) {
      // End of opening tag.
      return source.substring(match.index, i + 1);
    }

    i++;
  }

  return null;
}

describe("Story 13-7 — animated-wrapper className+style source-drift detector", () => {
  describe("ConversationCard (app/(tabs)/home/index.tsx)", () => {
    it("Case 1: POSITIVE — declares `conversationCardStaticStyle` module-level ViewStyle constant", () => {
      // Module-level (not useMemo) — render-invariant; zero allocations per
      // render. Story 12-5 / 12-7 module-level constant precedent.
      expect(HOME_INDEX_CODE).toMatch(
        /const\s+conversationCardStaticStyle\s*:\s*ViewStyle\s*=\s*(?:Object\.freeze\(\s*)?\{/
      );
    });

    it("Case 2: NEGATIVE — `<AnimatedPressable>` opening tag does NOT carry a `className` prop", () => {
      // Scoped to the AnimatedPressable element so a future <View
      // className="..."> elsewhere in the file doesn't false-positive.
      const tag = extractOpeningTag(HOME_INDEX_CODE, "AnimatedPressable");
      expect(tag).not.toBeNull();
      expect(tag).not.toMatch(/\bclassName\s*=/);
      // POSITIVE: the AnimatedPressable carries a single style prop = array
      // [conversationCardStaticStyle, animStyle] (Story 13-7 canonical
      // shape).
      expect(tag).toMatch(
        /style\s*=\s*\{\s*\[\s*conversationCardStaticStyle\s*,\s*animStyle\s*\]\s*\}/
      );
    });
  });

  describe("StatTile (src/components/common/StatTile.tsx)", () => {
    it("Case 3: POSITIVE — declares `statTileStaticStyle` module-level ViewStyle constant", () => {
      expect(STAT_TILE_CODE).toMatch(
        /const\s+statTileStaticStyle\s*:\s*ViewStyle\s*=\s*(?:Object\.freeze\(\s*)?\{/
      );
    });

    it("Case 4: NEGATIVE — `<Animated.View>` opening tag does NOT carry a `className` prop", () => {
      const tag = extractOpeningTag(STAT_TILE_CODE, "Animated\\.View");
      expect(tag).not.toBeNull();
      expect(tag).not.toMatch(/\bclassName\s*=/);
      // POSITIVE: the Animated.View carries [statTileStaticStyle, animStyle].
      expect(tag).toMatch(/style\s*=\s*\{\s*\[\s*statTileStaticStyle\s*,\s*animStyle\s*\]\s*\}/);
    });
  });

  describe("SkillCard inner Pressable (src/components/common/SkillCard.tsx)", () => {
    it("Case 5: POSITIVE — declares `skillCardPressableStaticStyle` module-level ViewStyle constant", () => {
      expect(SKILL_CARD_CODE).toMatch(
        /const\s+skillCardPressableStaticStyle\s*:\s*ViewStyle\s*=\s*(?:Object\.freeze\(\s*)?\{/
      );
    });

    it("Case 6: NEGATIVE — inner `<Pressable>` opening tag does NOT carry a `className` prop", () => {
      // The outer <Animated.View style={entryStyle}> was already canonical
      // pre-13-7; this story converts only the inner Pressable.
      const tag = extractOpeningTag(SKILL_CARD_CODE, "Pressable");
      expect(tag).not.toBeNull();
      expect(tag).not.toMatch(/\bclassName\s*=/);
      // POSITIVE: the inner Pressable carries a style prop driven by a
      // frozen-static-style constant. Story 14-2 update: SkillCard now
      // routes to one of `skillCardPressableStaticStyle` (default) or
      // `skillCardFeaturedStaticStyle` (featured variant) via a local
      // `containerStyle` ternary. Accept either the pre-14-2 literal
      // constant form OR the post-14-2 `[containerStyle, ...]` array form
      // (which spreads a frozen constant + optional disabled-opacity).
      expect(tag).toMatch(
        /style\s*=\s*\{\s*(skillCardPressableStaticStyle|\[\s*containerStyle\s*,)/
      );
      // Story 14-2 review-round-1 M11 / Story 13-7 R1-EC-17: hybrid-form
      // negative guard. A future regression that writes
      // `style={[skillCardPressableStaticStyle, animStyle]}` would bypass
      // the `containerStyle` indirection and the new conditional
      // `disabled ? { opacity: 0.6 } : null`. Pin against it explicitly so
      // the variant-routing-via-containerStyle contract stays load-bearing.
      expect(tag).not.toMatch(/style\s*=\s*\{\s*\[\s*skillCardPressableStaticStyle\b/);
      expect(tag).not.toMatch(/style\s*=\s*\{\s*\[\s*skillCardFeaturedStaticStyle\b/);
    });

    it("Case 6b: review-round-1 P4 — exactly ONE `<Pressable>` element in SkillCard.tsx", () => {
      // `extractOpeningTag` returns the FIRST match. If a future refactor
      // adds a SECOND <Pressable> inside SkillCard (e.g., a nested wrapper
      // around the icon circle), a `className` regression on the SECOND
      // Pressable would silently pass Case 6. This case asserts uniqueness
      // so any future second Pressable trips CI and forces the test author
      // to update the scope (e.g., switch to extractOpeningTag-by-line or
      // add an explicit Case 6c for the new wrapper).
      //
      // Regex anchors on `<Pressable` followed by a word-boundary so it
      // doesn't match `<AnimatedPressable` (created via
      // `Animated.createAnimatedComponent(Pressable)` in other files, none
      // in SkillCard today).
      const matches = SKILL_CARD_CODE.match(/<Pressable\b/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });
  });

  describe("Already-canonical controls (positive — must remain className-free)", () => {
    it("Case 7: POSITIVE control — `TodayPlanItem`'s `<Animated.View>` stays className-free", () => {
      // Pre-13-7 this wrapper was already canonical (single style prop
      // array). The drift detector pins the pattern so a future PR that
      // re-introduces className on this canonical wrapper fails CI.
      const tag = extractOpeningTag(TODAY_PLAN_ITEM_CODE, "Animated\\.View");
      expect(tag).not.toBeNull();
      expect(tag).not.toMatch(/\bclassName\s*=/);
    });

    it("Case 8: POSITIVE control — `AnimatedMessage`'s `<Reanimated.View>` stays className-free", () => {
      // The transcript bubble wrapper in TranscriptView.tsx was already
      // canonical pre-13-7 (Story 13-1 review preserved it). This control
      // case pins it so a future PR (e.g., a Story 14-X bubble redesign)
      // doesn't silently regress the per-frame merge cost on the highest-
      // volume animated wrapper in the app.
      const tag = extractOpeningTag(TRANSCRIPT_VIEW_CODE, "Reanimated\\.View");
      expect(tag).not.toBeNull();
      expect(tag).not.toMatch(/\bclassName\s*=/);
    });
  });

  describe("Design-token invariants (Z. Polish Requirements)", () => {
    it("Case 9: POSITIVE invariant — all 3 new *StaticStyle constants source colors from `Colors.*` (no raw hex)", () => {
      // Forbid raw hex literals INSIDE the 3 new static-style constants.
      // Project convention: all colors flow through `Colors.*` design tokens
      // (Story 14-4 token-enforcement precedent). The check extracts each
      // constant body and scans for `#` followed by hex chars.
      const extractConstantBody = (source: string, constName: string): string | null => {
        // Review-round-1 P2: tolerate optional `Object.freeze(` wrap so the
        // post-freeze declarations still parse. Regex matches either:
        //   - `const X: ViewStyle = {` (pre-P2 unwrapped form)
        //   - `const X: ViewStyle = Object.freeze({` (post-P2 wrapped form)
        const re = new RegExp(
          `const\\s+${constName}\\s*:\\s*ViewStyle\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\{`
        );
        const match = re.exec(source);
        if (!match) return null;
        // Walk balanced braces from the first `{` after the match.
        let i = match.index + match[0].length;
        let depth = 1;
        const start = i;
        while (i < source.length && depth > 0) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") depth--;
          i++;
        }
        return source.substring(start, i - 1);
      };

      const conversationCardBody = extractConstantBody(
        HOME_INDEX_CODE,
        "conversationCardStaticStyle"
      );
      const statTileBody = extractConstantBody(STAT_TILE_CODE, "statTileStaticStyle");
      const skillCardBody = extractConstantBody(SKILL_CARD_CODE, "skillCardPressableStaticStyle");

      expect(conversationCardBody).not.toBeNull();
      expect(statTileBody).not.toBeNull();
      expect(skillCardBody).not.toBeNull();

      // 3-or-6-digit hex literal regex: `#` followed by 3 or 6 hex chars,
      // word-boundary anchored to avoid false-matching shadow numerics like
      // `#FFFFFF` inside a string elsewhere. (Strings are already in the
      // comment-stripped source but the design-token tokens like Colors.X
      // do NOT contain `#`.)
      const hexLiteralRegex = /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b/;
      expect(conversationCardBody).not.toMatch(hexLiteralRegex);
      expect(statTileBody).not.toMatch(hexLiteralRegex);
      expect(skillCardBody).not.toMatch(hexLiteralRegex);
    });

    it("Case 10: POSITIVE invariant — all 3 new *StaticStyle constants use `Radii.*` for `borderRadius` (no raw numeric magic)", () => {
      const extractConstantBody = (source: string, constName: string): string | null => {
        // Review-round-1 P2: tolerate optional `Object.freeze(` wrap (matches
        // the Case 9 walker — kept consistent so a future change to either
        // copy must touch both).
        const re = new RegExp(
          `const\\s+${constName}\\s*:\\s*ViewStyle\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\{`
        );
        const match = re.exec(source);
        if (!match) return null;
        let i = match.index + match[0].length;
        let depth = 1;
        const start = i;
        while (i < source.length && depth > 0) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") depth--;
          i++;
        }
        return source.substring(start, i - 1);
      };

      const conversationCardBody = extractConstantBody(
        HOME_INDEX_CODE,
        "conversationCardStaticStyle"
      );
      const statTileBody = extractConstantBody(STAT_TILE_CODE, "statTileStaticStyle");
      const skillCardBody = extractConstantBody(SKILL_CARD_CODE, "skillCardPressableStaticStyle");

      // POSITIVE: each body MUST contain a borderRadius set via Radii.*
      // (e.g., `borderRadius: Radii.card`). The skill card uses a spread of
      // Shadows.card which itself was authored against the token system —
      // skillCardBody contains `borderRadius: Radii.card`.
      expect(conversationCardBody).toMatch(/borderRadius\s*:\s*Radii\.\w+/);
      expect(statTileBody).toMatch(/borderRadius\s*:\s*Radii\.\w+/);
      expect(skillCardBody).toMatch(/borderRadius\s*:\s*Radii\.\w+/);

      // NEGATIVE: forbid a raw-numeric `borderRadius: 16` style assignment
      // (Story 14-4 lint-rule precedent applied early; magic numbers are
      // the #1 drift vector for design-token discipline).
      const rawBorderRadiusRegex = /borderRadius\s*:\s*\d+\s*[,}]/;
      expect(conversationCardBody).not.toMatch(rawBorderRadiusRegex);
      expect(statTileBody).not.toMatch(rawBorderRadiusRegex);
      expect(skillCardBody).not.toMatch(rawBorderRadiusRegex);
    });
  });
});
