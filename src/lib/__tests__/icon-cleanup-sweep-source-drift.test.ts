/**
 * App-wide icon-cleanup sweep — source-drift detector.
 *
 * Companion to Story 14-3's icon-system migration: this pins that the
 * follow-up sweep (which migrated the remaining raw Unicode-glyph and
 * emoji-as-icon CHROME affordances to the Feather `Icon` system) can't
 * regress. It scans the whole UI source tree (comment-stripped, per the
 * Story 12-2 P12 lesson) for a curated set of CHROME glyphs and asserts none
 * survive as source.
 *
 * The blocklist deliberately EXCLUDES learning-content emoji (Story 14-1
 * chrome/content rule): `TOPIC_EMOJIS`, the debate/tcf-sim mode emoji, the
 * onboarding goal emoji, milestone celebration emoji, and the correction /
 * CEFR-progression `→` (which shows "X → Y", not a nav affordance) are all
 * preserved and are NOT in the set below — so a legitimate content emoji
 * never trips this gate.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const ROOTS = ["app", "src/components", "src/hooks"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const FILES = ROOTS.flatMap((r) => walk(join(REPO_ROOT, r))).map((f) => ({
  path: f.slice(REPO_ROOT.length + 1),
  code: stripComments(readFileSync(f, "utf-8")),
}));

/**
 * Curated CHROME glyphs that were migrated to `<Icon />`. Each carries both
 * its literal form and its `\uXXXX` escape form (the codebase stores emoji as
 * escape sequences, but a regression could re-add either). NONE of these
 * overlap the preserved learning-content emoji.
 */
const FORBIDDEN: { label: string; literal: string; escape: RegExp }[] = [
  { label: "mic (record)", literal: "🎙", escape: /\\uD83C\\uDF99/i },
  { label: "stop (⏹)", literal: "⏹", escape: /\\u23F9/i },
  { label: "pause (⏸)", literal: "⏸", escape: /\\u23F8/i },
  { label: "play (▶)", literal: "▶", escape: /\\u25B6/i },
  { label: "turtle (slow)", literal: "🐢", escape: /\\uD83D\\uDC22/i },
  { label: "magnifier (search)", literal: "🔍", escape: /\\uD83D\\uDD0D/i },
  { label: "bell", literal: "🔔", escape: /\\uD83D\\uDD14/i },
  { label: "fire (streak)", literal: "🔥", escape: /\\uD83D\\uDD25/i },
  { label: "gear (settings)", literal: "⚙", escape: /\\u2699/i },
  { label: "left-arrow (back)", literal: "←", escape: /\\u2190/i },
  { label: "multiplication-x (close)", literal: "✕", escape: /\\u2715/i },
  { label: "up-arrowhead (⌃)", literal: "⌃", escape: /\\u2303/i },
  { label: "flexed-biceps", literal: "💪", escape: /\\uD83D\\uDCAA/i },
  { label: "memo (📝)", literal: "📝", escape: /\\uD83D\\uDCDD/i },
  { label: "globe (🌐)", literal: "🌐", escape: /\\uD83C\\uDF10/i },
  { label: "white-check (✅)", literal: "✅", escape: /\\u2705/i },
];

describe("icon-cleanup sweep — no raw chrome glyphs survive as source", () => {
  it.each(FORBIDDEN)("$label is fully migrated to <Icon /> app-wide", ({ literal, escape }) => {
    const hits = FILES.filter((f) => f.code.includes(literal) || escape.test(f.code)).map(
      (f) => f.path
    );
    expect(hits).toEqual([]);
  });

  it("the Icon union carries every chrome member the sweep introduced", () => {
    const union = readFileSync(join(REPO_ROOT, "src/components/common/Icon.tsx"), "utf-8");
    for (const name of [
      "chevron-left",
      "chevron-right",
      "chevron-up",
      "chevron-down",
      "arrow-left",
      "send",
      "type",
      "wifi-off",
      "x",
      "bell",
      "play",
      "pause",
      "search",
      "square",
      "star",
      "alert-triangle",
      "trending-up",
      "trending-down",
      "minus",
    ]) {
      expect(union).toContain(`"${name}"`);
    }
  });
});
