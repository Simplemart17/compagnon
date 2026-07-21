/**
 * Conversation-screen chrome cleanup — `[sessionId].tsx` source-drift detector.
 *
 * Two axes of the "screen looks ugly / connecting icons" cleanup:
 *   A. Raw Unicode glyph icons (❮ ↑ ▶ ⌨) + the bare `!` disconnected status
 *      migrated to the Story 14-3 Feather `Icon` system.
 *   B. The triple "Connecting…" (header status + AvatarStatusLabel + bottom
 *      pill) collapsed to one canonical treatment: header owns the status
 *      TEXT, the bottom control shows a clean spinner (ActivityIndicator),
 *      and `AvatarStatusLabel` is gated to `connected` (so it only surfaces
 *      the turn-state — listening / thinking / speaking — never a duplicate
 *      "Connecting…").
 *
 * Follows the repo drift-detector convention (Story 12-2 P12 comment-strip so
 * JSDoc mentioning the old patterns can't trip the negative guards; Story 13-2
 * P11 paired POSITIVE + NEGATIVE pins so a guard can't pass vacuously).
 */

import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_PATH = join(__dirname, "..", "[sessionId].tsx");
const SCREEN_SOURCE = readFileSync(SCREEN_PATH, "utf-8");
const SCREEN_CODE_ONLY = SCREEN_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("[sessionId].tsx — chrome cleanup source-drift", () => {
  it("Case 1: imports the Feather `Icon` wrapper", () => {
    expect(SCREEN_CODE_ONLY).toMatch(
      /import\s*\{\s*Icon\s*\}\s*from\s*["']@\/src\/components\/common\/Icon["']/
    );
  });

  it("Case 2: POSITIVE — the 5 chrome affordances render via <Icon name=...>", () => {
    // back-nav, send-typed-message, start-voice, disconnected. `type` is
    // multi-line in source, so pin its name= attribute separately.
    for (const name of ["chevron-left", "send", "mic", "wifi-off"]) {
      expect(SCREEN_CODE_ONLY).toMatch(new RegExp(`<Icon\\s+name="${name}"`));
    }
    expect(SCREEN_CODE_ONLY).toMatch(/<Icon\s+name="type"/);
  });

  it("Case 3: NEGATIVE — the removed raw glyph icons (❮ ↑ ▶ ⌨) are GONE", () => {
    // Scoped to the exact glyphs migrated — the content arrow → (U+2192) in
    // the strengths/improvements row is deliberately NOT in this set. Guard
    // BOTH representations: the literal glyph AND the `\uXXXX` escape-text
    // form the source actually used (`{"❮"}`), so a regression in either
    // shape trips this.
    expect(SCREEN_CODE_ONLY).not.toMatch(/[❮↑▶⌨]/);
    expect(SCREEN_CODE_ONLY).not.toMatch(/\\u(276E|2191|25B6|2328)/i);
  });

  it("Case 4: NEGATIVE — the bare `!` disconnected status glyph (Typography.bigNumber) is GONE", () => {
    // It was the screen's only bigNumber usage; wifi-off (Case 2) replaces it.
    expect(SCREEN_CODE_ONLY).not.toMatch(/Typography\.bigNumber/);
  });

  it("Case 5: connecting/reconnecting use a spinner, not a colored word-block", () => {
    // POSITIVE: ActivityIndicator is imported + used for both states.
    expect(SCREEN_CODE_ONLY).toMatch(/ActivityIndicator/);
    // NEGATIVE: the pre-cleanup `bg-accent/30` connecting/reconnecting pill is GONE.
    expect(SCREEN_CODE_ONLY).not.toMatch(/bg-accent\/30/);
  });

  it("Case 6: AvatarStatusLabel is gated to `connected` (kills the triple Connecting…)", () => {
    // The label only surfaces the turn-state once connected; during
    // connect/reconnect the header status + bottom spinner own the message.
    expect(SCREEN_CODE_ONLY).toMatch(
      /conversation\.status\s*===\s*["']connected["']\s*&&\s*\(\s*<AvatarStatusLabel/
    );
  });
});
