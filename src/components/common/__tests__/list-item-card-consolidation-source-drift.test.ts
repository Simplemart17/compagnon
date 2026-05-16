/**
 * Story 14-2 source-drift detector for the card consolidation.
 *
 * Pins (per Story 12-2 P12 comment-stripped + Story 13-2 P11 paired-pin +
 * Story 13-7 R1-P4 scoped-element-extraction lessons):
 *
 *   POSITIVE pins:
 *     - Each migrated screen imports `ListItemCard` or `SkillCard` (already
 *       imported), and invokes the consolidated component at least once.
 *     - `listItemCardStaticStyle` is exported `@internal` + frozen via
 *       `Object.freeze({...})` (Story 13-7 R1-P2 pattern).
 *     - `Shadows.card` spread is FIRST inside `listItemCardStaticStyle`
 *       body (Story 13-7 R1-P1 pattern).
 *     - `SkillCard.tsx` exposes the 3 new props: `featured?: boolean`,
 *       `disabled?: boolean`, `accent?: string`.
 *     - `skillCardFeaturedStaticStyle` is exported `@internal` + frozen.
 *
 *   NEGATIVE pins:
 *     - Each migrated screen no longer defines the legacy inline card
 *       component (`function VocabularyCard(`, `function SectionCard(`,
 *       `function ComingSoonCard(`, `function ProfileSkillCard(`).
 *     - The `CardItem` function in `conversation/index.tsx` no longer
 *       contains the legacy inline `<TouchableOpacity>...<View ... rounded-2xl...>`
 *       block (verified via the `<ListItemCard` invocation being present
 *       in the function body and the legacy `flex-row items-center mr-3`
 *       icon-circle block absent).
 *
 * `TodayPlanItem` is INTENTIONALLY NOT consolidated in Story 14-2: it uses
 * a compact-pill layout (button-radius 12px vs card-radius 16px; tinted
 * background vs white; smaller icon circle) that's incompatible with the
 * full-card `ListItemCard` shape. The defer is documented in CLAUDE.md +
 * the story's Completion Notes; no drift assertion here.
 */

import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "..", "..", "..", "..");

// Review-round-1 M7: extended comment-strip to also remove JSX
// comments `{/* ... */}` INCLUDING the braces. The earlier
// `/\*[\s\S]*?\*\//g` left the empty `{}` braces behind, so a
// developer who commented-out a legacy declaration like
// `{/* function VocabularyCard(...) */}` could leave the source
// intact while the drift detector's NEGATIVE pin against `function
// VocabularyCard(` would silently pass.
//
// Pin via `[^{}]*?` (NOT `[\s\S]*?`) so the JSX-comment regex
// can't over-match across TypeScript `interface { ... }` bodies that
// contain inline JSDoc fields like `/** Field doc */`. Without the
// brace-exclusion, `interface Foo { /** doc */ field: T; }` would
// erroneously match as a single JSX comment, eating most of the
// file body.
const COMMENT_STRIP_RE = /\{\s*\/\*[^{}]*?\*\/\s*\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm;

function readScreen(relPath: string): string {
  const absPath = join(PROJECT_ROOT, relPath);
  const raw = readFileSync(absPath, "utf8");
  return raw.replace(COMMENT_STRIP_RE, "");
}

// Review-round-1 M3 note: per-element scoping is achieved via the
// non-greedy regex `/<Element\b[^>]*?\bprop\b/g` (the `[^>]*?` window
// constrains to a single opening tag because JSX tags don't contain
// `>` until they close). For deeper extraction needs (parsing prop
// VALUES across nested `{...}` expressions), import `extractOpeningTag`
// from `src/components/__tests__/animated-wrapper-className-style-source-drift.test.ts`
// which provides the Story 13-7 R1-P4 string-literal-aware walker.

describe("Story 14-2 — card consolidation source-drift", () => {
  // ============================================================
  // ListItemCard module structure
  // ============================================================
  it("src/components/common/ListItemCard.tsx: exports listItemCardStaticStyle as frozen", () => {
    const src = readScreen("src/components/common/ListItemCard.tsx");
    expect(src).toMatch(
      /export\s+const\s+listItemCardStaticStyle\s*:\s*ViewStyle\s*=\s*Object\.freeze\s*\(\s*\{/
    );
    expect(src).toMatch(/export\s+const\s+ListItemCard\s*=\s*React\.memo\(/);
  });

  it("src/components/common/ListItemCard.tsx: Shadows.card spread is FIRST (Story 13-7 R1-P1)", () => {
    const src = readScreen("src/components/common/ListItemCard.tsx");
    // The frozen-style object body should start with `...Shadows.card` before
    // any explicit key like `backgroundColor`, `padding`, etc.
    const match = src.match(
      /listItemCardStaticStyle[\s\S]*?Object\.freeze\s*\(\s*\{\s*([\s\S]*?)\}\s*\)/
    );
    expect(match).not.toBeNull();
    if (!match) return;
    const body = match[1];
    const shadowsIdx = body.indexOf("...Shadows.card");
    const bgIdx = body.indexOf("backgroundColor");
    const paddingIdx = body.indexOf("padding:");
    expect(shadowsIdx).toBeGreaterThanOrEqual(0);
    expect(shadowsIdx).toBeLessThan(bgIdx);
    expect(shadowsIdx).toBeLessThan(paddingIdx);
  });

  it("src/components/common/ListItemCard.tsx: @internal annotation on the exported style constant", () => {
    const raw = readFileSync(join(PROJECT_ROOT, "src/components/common/ListItemCard.tsx"), "utf8");
    // The @internal annotation lives in the JSDoc block, which the comment
    // stripper removes. Read RAW (no comment-strip) for this assertion.
    expect(raw).toMatch(/@internal[\s\S]*?listItemCardStaticStyle/);
  });

  // ============================================================
  // SkillCard new props + featured variant
  // ============================================================
  it("src/components/common/SkillCard.tsx: SkillCardProps adds featured? + disabled? + accent?", () => {
    const src = readScreen("src/components/common/SkillCard.tsx");
    expect(src).toMatch(/featured\?\s*:\s*boolean/);
    expect(src).toMatch(/disabled\?\s*:\s*boolean/);
    expect(src).toMatch(/accent\?\s*:\s*string/);
  });

  it("src/components/common/SkillCard.tsx: exports skillCardFeaturedStaticStyle as frozen", () => {
    const src = readScreen("src/components/common/SkillCard.tsx");
    expect(src).toMatch(
      /export\s+const\s+skillCardFeaturedStaticStyle\s*:\s*ViewStyle\s*=\s*Object\.freeze\s*\(\s*\{/
    );
  });

  it("src/components/common/SkillCard.tsx: featured variant uses Colors.accent10 background + Shadows.card spread-FIRST (R1-M4)", () => {
    const src = readScreen("src/components/common/SkillCard.tsx");
    const match = src.match(
      /skillCardFeaturedStaticStyle[\s\S]*?Object\.freeze\s*\(\s*\{\s*([\s\S]*?)\}\s*\)/
    );
    expect(match).not.toBeNull();
    if (!match) return;
    const body = match[1];
    expect(body).toContain("Colors.accent10");
    // R1-M4: pin Shadows.card spread is FIRST (Story 13-7 R1-P1) on the
    // new constant too, not just on `listItemCardStaticStyle`.
    const shadowsIdx = body.indexOf("...Shadows.card");
    const bgIdx = body.indexOf("backgroundColor");
    expect(shadowsIdx).toBeGreaterThanOrEqual(0);
    expect(shadowsIdx).toBeLessThan(bgIdx);
  });

  it("src/components/common/SkillCard.tsx: skillCardFeaturedStaticStyle is @internal annotated (R1-M5)", () => {
    const raw = readFileSync(join(PROJECT_ROOT, "src/components/common/SkillCard.tsx"), "utf8");
    expect(raw).toMatch(/@internal[\s\S]*?skillCardFeaturedStaticStyle/);
  });

  // ============================================================
  // Practice — VocabularyCard migration
  // ============================================================
  it("app/(tabs)/practice/index.tsx: VocabularyCard inline component deleted; SkillCard featured invocation present", () => {
    const src = readScreen("app/(tabs)/practice/index.tsx");
    expect(src).not.toMatch(/function\s+VocabularyCard\s*\(/);
    expect(src).toMatch(/<SkillCard[\s\S]*?featured/);
  });

  // ============================================================
  // Mock-test — SectionCard + ComingSoonCard migrations
  // ============================================================
  it("app/(tabs)/mock-test/index.tsx: SectionCard + ComingSoonCard inline components deleted; SkillCard invocations present (incl. ≥1 disabled — R1-M3 count-based sibling defense)", () => {
    const src = readScreen("app/(tabs)/mock-test/index.tsx");
    expect(src).not.toMatch(/function\s+SectionCard\s*\(/);
    expect(src).not.toMatch(/function\s+ComingSoonCard\s*\(/);
    // R1-M3: scope-leakage defense via counting. Pre-R1 the regex
    // `/<SkillCard[\s\S]*?disabled/` could false-pass on a sibling
    // element pair. A `[^>]`-anchored regex would break against JSX
    // arrow-function expression `>` chars (`onPress={() => undefined}`).
    // Defense via element COUNT + at-least-one disabled marker: catches
    // the canonical regression of removing the `disabled` prop entirely
    // (allSkillCards stays ≥ 2 but disabled count drops to 0).
    const allSkillCards = src.match(/<SkillCard\b/g) ?? [];
    expect(allSkillCards.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/<SkillCard[\s\S]*?\bdisabled\b/);
  });

  // ============================================================
  // Profile — ProfileSkillCard + error-pattern migrations
  // ============================================================
  it("app/(tabs)/profile/index.tsx: ProfileSkillCard inline component deleted; ListItemCard import + invocation present", () => {
    const src = readScreen("app/(tabs)/profile/index.tsx");
    expect(src).not.toMatch(/function\s+ProfileSkillCard\s*\(/);
    expect(src).toMatch(/from\s+["']@\/src\/components\/common\/ListItemCard["']/);
    expect(src).toMatch(/<ListItemCard\b/);
  });

  it("app/(tabs)/profile/index.tsx: error-pattern card uses ListItemCard with leftStripColor + Colors.accent", () => {
    const src = readScreen("app/(tabs)/profile/index.tsx");
    // Match the error-pattern card invocation by anchoring on leftStripColor
    // followed by Colors.accent within ~500 chars.
    expect(src).toMatch(/<ListItemCard[\s\S]{0,500}?leftStripColor=\{\s*Colors\.accent\s*\}/);
  });

  // ============================================================
  // Conversation — topic card (CardItem) migration
  // ============================================================
  it("app/(tabs)/conversation/index.tsx: CardItem renders ListItemCard (not a bespoke TouchableOpacity-with-icon-circle block)", () => {
    const src = readScreen("app/(tabs)/conversation/index.tsx");
    expect(src).toMatch(/from\s+["']@\/src\/components\/common\/ListItemCard["']/);
    expect(src).toMatch(/<ListItemCard\b/);
    // The legacy bespoke inline JSX block had a `mr-3` icon-circle margin.
    // CardItem's body should no longer contain that pattern (rendered via
    // ListItemCard's internal slot).
    const cardItemBodyMatch = src.match(/function\s+CardItem\s*\([\s\S]*?\n\}\s*\n/);
    expect(cardItemBodyMatch).not.toBeNull();
    if (!cardItemBodyMatch) return;
    expect(cardItemBodyMatch[0]).not.toMatch(/justify-center items-center mr-3/);
    expect(cardItemBodyMatch[0]).toMatch(/<ListItemCard/);
  });

  // ============================================================
  // Defer documentation: TodayPlanItem is intentionally NOT migrated.
  // The compact-pill layout (button-radius, tinted bg, smaller icon)
  // is incompatible with ListItemCard's full-card shape. Verify the
  // legacy implementation is still present (no half-migration).
  // ============================================================
  it("src/components/home/TodayPlanItem.tsx: intentionally NOT migrated to ListItemCard (compact-pill defer; R1-M6 hardened against relative-path + barrel imports)", () => {
    const src = readScreen("src/components/home/TodayPlanItem.tsx");
    // The legacy implementation should still be present
    expect(src).toMatch(/export\s+const\s+TodayPlanItem\s*=\s*React\.memo/);
    // R1-M6: defer is intentional — catch ANY import shape that pulls in
    // ListItemCard, not just the `@/`-alias path. A future half-migration
    // using `import { ListItemCard } from "../common/ListItemCard"`
    // (relative path) OR `from "@/src/components/common"` (barrel-export)
    // would have slipped past the pre-R1 alias-only regex.
    expect(src).not.toMatch(/\bListItemCard\b/);
  });
});
