/**
 * Story 14-3 source-drift detector for the icon-system replacement.
 *
 * Pins (per Story 12-2 P12 comment-stripped + Story 13-2 P11 paired-pin +
 * Story 13-7 R1-P4 scoped-element-extraction + Story 14-2 R1-M7 JSX-brace-
 * exclusion comment-strip lessons):
 *
 *   POSITIVE pins:
 *     - `Icon.tsx` exports `Icon` (React.memo'd) + `IconProps` + `IconName`
 *       union with ≥ 20 members (compile-time gate against icon-name
 *       typos).
 *     - Each migrated chrome screen imports `Icon` from
 *       `@/src/components/common/Icon` and contains at least one
 *       `<Icon name="..." />` invocation.
 *     - `app/(tabs)/conversation/index.tsx` `TOPIC_EMOJIS` constant
 *       declaration is unchanged (12 content emoji preserved per Story
 *       14-1 chrome/content rule).
 *     - `SkillCard.tsx` exposes `iconNode?: React.ReactNode` prop.
 *     - `ListItemCard.tsx` exposes `iconNode?: React.ReactNode` prop.
 *
 *   NEGATIVE pins:
 *     - Each chrome screen no longer carries the legacy emoji literal in
 *       chrome context (e.g., `<Text ...>{"✉️"}</Text>` is GONE from
 *       login/signup/forgot-password).
 *     - `🔥` flame emoji is GONE from `profile/index.tsx` chrome (Q3
 *       converted to `Icon name="zap"`).
 *     - `🔑` key emoji is GONE from `forgot-password.tsx` hero (Q4
 *       converted to `Icon name="key"`).
 *
 * Onboarding goal emoji (`🎯 🏆 ✈️ 💼 🎓 🗣️` in
 * `app/onboarding/index.tsx`) is INTENTIONALLY preserved per Q2 (learning
 * content). Milestone-banner celebration emoji (`🏆 🎯` in
 * `src/hooks/use-session-feedback-aggregate.ts`) is also preserved (not in
 * inventory; decorative celebration glyphs, not chrome affordances).
 */

import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "..", "..", "..", "..");

// Story 14-2 R1-M7: brace-exclusion JSX-comment regex; safe across
// `interface { /** doc */ field }` bodies.
const COMMENT_STRIP_RE = /\{\s*\/\*[^{}]*?\*\/\s*\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm;

function readScreen(relPath: string): string {
  const absPath = join(PROJECT_ROOT, relPath);
  const raw = readFileSync(absPath, "utf8");
  return raw.replace(COMMENT_STRIP_RE, "");
}

describe("Story 14-3 — icon-system replacement source-drift", () => {
  // ----- Icon.tsx structural pins -----

  test("Icon.tsx exports Icon component, IconProps, and IconName union with >= 20 members", () => {
    const src = readScreen("src/components/common/Icon.tsx");

    // Positive: exports
    expect(src).toMatch(/export\s+const\s+Icon\s*=\s*React\.memo/);
    expect(src).toMatch(/export\s+interface\s+IconProps/);
    expect(src).toMatch(/export\s+type\s+IconName\s*=/);

    // Count IconName union members. Each member is on its own line:
    //   | "name"
    // Plus the first one which is `= | "name"` or just `= "name"`.
    // Conservatively match string literals between `IconName = ` and the next `;`.
    const unionMatch = src.match(/export\s+type\s+IconName\s*=([\s\S]*?);/);
    expect(unionMatch).not.toBeNull();
    const memberCount = (unionMatch![1].match(/"[a-z][a-z-]+\d?"/g) ?? []).length;
    expect(memberCount).toBeGreaterThanOrEqual(20);
  });

  test("Icon.tsx wraps @expo/vector-icons.Feather (centralised icon-set choice)", () => {
    const src = readScreen("src/components/common/Icon.tsx");
    expect(src).toMatch(/from\s+"@expo\/vector-icons"/);
    expect(src).toMatch(/<Feather\b/);
  });

  test("Icon.tsx decorative default sets all 3 cross-platform a11y flags", () => {
    // Story 14-3 review-round-1 P1 (HIGH): the omitted-label branch MUST
    // set 3 flags so screen-readers skip the icon on BOTH iOS and Android:
    //   - `accessible={false}` (iOS canonical decorative flag)
    //   - `accessibilityElementsHidden={true}` (iOS-strong hide; VoiceOver
    //     tree-walker skips this node + descendants)
    //   - `importantForAccessibility="no"` (Android canonical)
    // Pre-R1 only the Android flag was set; iOS VoiceOver still focused
    // the icon beside labeled TextInputs (auth-surface mail/lock/user).
    // Mirrors the same defensive pattern Story 14-2 used in
    // PasswordStrengthIndicator.tsx:152-156.
    const src = readScreen("src/components/common/Icon.tsx");
    expect(src).toMatch(/accessible=\{false\}/);
    expect(src).toMatch(/accessibilityElementsHidden=\{true\}/);
    expect(src).toMatch(/importantForAccessibility\s*=\s*"no"/);
  });

  // ----- SkillCard + ListItemCard iconNode prop pins -----

  test("SkillCard.tsx exposes optional `iconNode?: React.ReactNode` prop", () => {
    const src = readScreen("src/components/common/SkillCard.tsx");
    // Match the prop declaration; tolerate Prettier reformat.
    expect(src).toMatch(/iconNode\?\s*:\s*React\.ReactNode/);
    // And the destructured arg in the component body.
    expect(src).toMatch(/\biconNode\b/);
  });

  test("ListItemCard.tsx exposes optional `iconNode?: React.ReactNode` prop", () => {
    const src = readScreen("src/components/common/ListItemCard.tsx");
    expect(src).toMatch(/iconNode\?\s*:\s*React\.ReactNode/);
    // And renders `iconNode` in the icon-circle slot.
    expect(src).toMatch(/iconNode\s*!==\s*undefined/);
  });

  // ----- Per-chrome-screen POSITIVE + NEGATIVE paired pins -----

  test("login.tsx imports Icon + renders mail + lock icons (chrome rewrite)", () => {
    const src = readScreen("app/(auth)/login.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: both chrome icons present.
    expect(src).toMatch(/<Icon\s+name="mail"/);
    expect(src).toMatch(/<Icon\s+name="lock"/);
    // NEGATIVE: legacy chrome emoji gone from this file.
    expect(src).not.toMatch(/<Text[^>]*>\s*✉️\s*<\/Text>/);
    expect(src).not.toMatch(/<Text[^>]*>\s*🔒\s*<\/Text>/);
  });

  test("signup.tsx imports Icon + renders user + mail + lock icons", () => {
    const src = readScreen("app/(auth)/signup.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    expect(src).toMatch(/<Icon\s+name="user"/);
    expect(src).toMatch(/<Icon\s+name="mail"/);
    expect(src).toMatch(/<Icon\s+name="lock"/);
    // R1-P3 (drift completeness): signup pre-14-3 had ALL 3 chrome emoji
    // — `👤` user + `✉️` mail + `🔒` lock. Pre-R1 only `👤` was
    // negative-pinned; `✉️` and `🔒` could be silently re-introduced.
    // Paired NEGATIVE+POSITIVE pin discipline (Story 13-2 P11 lesson).
    expect(src).not.toMatch(/<Text[^>]*>\s*👤\s*<\/Text>/);
    expect(src).not.toMatch(/<Text[^>]*>\s*✉️\s*<\/Text>/);
    expect(src).not.toMatch(/<Text[^>]*>\s*🔒\s*<\/Text>/);
  });

  test("forgot-password.tsx imports Icon + renders key hero + mail input (Q4 + chrome rewrite)", () => {
    const src = readScreen("app/(auth)/forgot-password.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: Q4 hero key + chrome mail.
    expect(src).toMatch(/<Icon\s+name="key"\s+size=\{52\}/);
    expect(src).toMatch(/<Icon\s+name="mail"/);
    // NEGATIVE: legacy hero key emoji gone.
    expect(src).not.toMatch(/<Text[^>]*text-\[52px\][^>]*>\s*🔑\s*<\/Text>/);
  });

  test("home/index.tsx ConversationCard renders mic Icon (chrome rewrite)", () => {
    const src = readScreen("app/(tabs)/home/index.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    expect(src).toMatch(/<Icon\s+name="mic"/);
    // R1-P4 (drift completeness): pre-14-3 source used the JS escape
    // sequence form `🎙️` for the studio-mic glyph. A
    // regression could re-introduce the SAME glyph in the raw-character
    // form `🎙️` (4-byte UTF-8) AND still keep the Icon — passing the
    // escape-form-only negative pin. Pin both forms.
    expect(src).not.toMatch(/\\uD83C\\uDF99\\uFE0F/);
    expect(src).not.toMatch(/🎙️/);
  });

  test("conversation/index.tsx CONVERSATION_MODES uses typed IconName for companion mode (Q1)", () => {
    const src = readScreen("app/(tabs)/conversation/index.tsx");
    // POSITIVE: imports Icon + IconName.
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: companion mode uses typed icon kind.
    expect(src).toMatch(/kind:\s*"icon",\s*name:\s*"message-circle"/);
    // POSITIVE: TOPIC_EMOJIS preserved (content boundary defense).
    expect(src).toMatch(/const\s+TOPIC_EMOJIS\s*:\s*Record<string,\s*string>/);
  });

  test("practice/index.tsx PRACTICE_SKILLS uses typed IconName values + SkillCard iconNode", () => {
    const src = readScreen("app/(tabs)/practice/index.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: at least 6 typed IconName entries on PRACTICE_SKILLS.
    const iconNameMatches = src.match(/iconName:\s*"[a-z][a-z-]+"/g) ?? [];
    expect(iconNameMatches.length).toBeGreaterThanOrEqual(6);
    // POSITIVE: SkillCard rendered with iconNode prop.
    expect(src).toMatch(/iconNode=\{<Icon\s+name=/);
    // NEGATIVE: pre-14-3 emoji-string keys gone from PRACTICE_SKILLS.
    expect(src).not.toMatch(/emoji:\s*"\\uD83C\\uDFA7"/);
  });

  test("mock-test/index.tsx SECTIONS + production SkillCards use typed IconName + iconNode", () => {
    const src = readScreen("app/(tabs)/mock-test/index.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: SECTIONS iconName entries.
    expect(src).toMatch(/iconName:\s*"headphones"/);
    expect(src).toMatch(/iconName:\s*"book-open"/);
    // POSITIVE: Writing + Speaking use iconNode prop.
    const iconNodeMatches = src.match(/iconNode=\{<Icon/g) ?? [];
    expect(iconNodeMatches.length).toBeGreaterThanOrEqual(3);
  });

  test("mock-test/results.tsx SECTION_LABELS uses typed iconName + renders <Icon />", () => {
    const src = readScreen("app/(tabs)/mock-test/results.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: typed IconName on SECTION_LABELS shape.
    expect(src).toMatch(/iconName:\s*"headphones"/);
    expect(src).toMatch(/iconName:\s*"book-open"/);
    expect(src).toMatch(/iconName:\s*"activity"/);
    // POSITIVE: <Icon /> renders the section-card icon.
    expect(src).toMatch(/<Icon\s+name=\{meta\.iconName\}/);
  });

  test("vocabulary.tsx hero + status emoji → Icon (empty/celebration/caught-up)", () => {
    const src = readScreen("app/(tabs)/practice/vocabulary.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    // POSITIVE: at least 3 <Icon /> renders (hero book + award + check-circle).
    expect(src).toMatch(/<Icon\s+name="book"\s+size=\{64\}/);
    expect(src).toMatch(/<Icon\s+name="award"\s+size=\{64\}/);
    expect(src).toMatch(/<Icon\s+name="check-circle"\s+size=\{64\}/);
    // NEGATIVE: pre-14-3 64px emoji wrappers gone.
    expect(src).not.toMatch(/text-\[64px\][^>]*>\s*\{?\s*"📚"/);
    expect(src).not.toMatch(/text-\[64px\][^>]*>\s*\{?\s*"🎉"/);
    expect(src).not.toMatch(/text-\[64px\][^>]*>\s*\{?\s*"✅"/);
  });

  test("use-daily-briefing.ts emits typed IconName via TodayPlanItem.iconName (no iconEmoji)", () => {
    const src = readScreen("src/hooks/use-daily-briefing.ts");
    expect(src).toMatch(/import\s+type\s+\{\s*IconName\s*\}/);
    // POSITIVE: at least 3 `iconName:` slot writes (srs / error / weakest /
    // fallback paths). Tolerates Prettier wrap.
    const iconNameAssigns = src.match(/iconName:\s*"[a-z][a-z-]+"/g) ?? [];
    expect(iconNameAssigns.length).toBeGreaterThanOrEqual(3);
    // R1-P3 (drift completeness): pre-14-3 file had iconEmoji assignments
    // for ALL 5 emoji-map entries (📚 🎯 + the per-skill 🎧 📖 ✍️ 💬 📝
    // map). Pre-R1 only the FIRST 2 were negative-pinned. A regression
    // re-introducing any of the other 5 would silently pass. TypeScript
    // catches it via `iconName: IconName` on TodayPlanItem interface but
    // belt-and-suspenders pins all 7 here.
    expect(src).not.toMatch(/iconEmoji:\s*"📚"/);
    expect(src).not.toMatch(/iconEmoji:\s*"🎯"/);
    expect(src).not.toMatch(/iconEmoji:\s*"🎧"/);
    expect(src).not.toMatch(/iconEmoji:\s*"📖"/);
    expect(src).not.toMatch(/iconEmoji:\s*"✍️"/);
    expect(src).not.toMatch(/iconEmoji:\s*"💬"/);
    expect(src).not.toMatch(/iconEmoji:\s*"📝"/);
  });

  test('profile/index.tsx streak chrome 🔥 → Icon name="zap" (Q3)', () => {
    const src = readScreen("app/(tabs)/profile/index.tsx");
    expect(src).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    expect(src).toMatch(/<Icon\s+name="zap"/);
    // NEGATIVE: pre-14-3 chrome render `<Text className="text-[15px]">{"🔥"}</Text>` gone.
    expect(src).not.toMatch(/<Text[^>]*text-\[15px\][^>]*>\s*\{?\s*"🔥"/);
  });

  test('sessionId.tsx + PasswordStrengthIndicator.tsx STATUS ✓ → Icon name="check"', () => {
    const sessionSrc = readScreen("app/(tabs)/conversation/[sessionId].tsx");
    expect(sessionSrc).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    expect(sessionSrc).toMatch(/<Icon\s+name="check"/);
    // NEGATIVE: pre-14-3 inline `<Text style={{ color: Colors.success, marginRight: 6 }}>✓</Text>` gone.
    expect(sessionSrc).not.toMatch(/<Text[^>]*Colors\.success[^>]*marginRight[^>]*>\s*✓/);

    const pwdSrc = readScreen("src/components/auth/PasswordStrengthIndicator.tsx");
    expect(pwdSrc).toMatch(/from\s+"@\/src\/components\/common\/Icon"/);
    expect(pwdSrc).toMatch(/<Icon\s+name="check"/);
  });

  test("TOPIC_EMOJIS constant (content emoji boundary) — zero-diff guard", () => {
    // The 12 conversation topic emoji are LEARNING CONTENT per the Story
    // 14-1 chrome/content rule. This test pins the constant declaration
    // is unchanged so a future "clean up all emoji" pass that touched
    // conversation/index.tsx without reading the rule fails CI.
    const src = readScreen("app/(tabs)/conversation/index.tsx");
    expect(src).toMatch(/const\s+TOPIC_EMOJIS\s*:\s*Record<string,\s*string>\s*=\s*\{/);
    // R1-P6 (regex robustness): pin 5 specific topic keys whose FR names
    // contain accented chars. The pre-R1 regex used ONLY the JS escape
    // form (`\\u00e9` matches `é` in source). Today's source uses
    // escape sequences but a future Prettier / format-pass could convert
    // to literal `é` at any time — the regex now accepts EITHER form.
    expect(src).toMatch(/"Se pr(?:\\u00e9|é)senter"\s*:/);
    expect(src).toMatch(/"Commander au caf(?:\\u00e9|é)"\s*:/);
    expect(src).toMatch(/"Plans du week-end"\s*:/);
    expect(src).toMatch(/"Au travail"\s*:/);
    expect(src).toMatch(/"Cin(?:\\u00e9|é)ma et culture"\s*:/);
  });
});
