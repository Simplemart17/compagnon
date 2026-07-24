// @ts-check
/**
 * Play Store (and reusable) marketing-asset generator.
 *
 * Renders every graphic the Google Play Console store listing requires,
 * built from the same brand tokens as the app (src/lib/design.ts) so the
 * store page and the product look like one system.
 *
 * Run via `npm run generate-store-assets`.
 *
 * Outputs (under store/play/):
 *   icon-512.png                 — Play Store hi-res icon (512×512, opaque PNG)
 *   feature-graphic.png          — Feature graphic (1024×500)
 *   screenshots/01-home.png      — Phone screenshots (1080×1920, 9:16)
 *   screenshots/02-conversation.png
 *   screenshots/03-lessons.png
 *   screenshots/04-pronunciation.png
 *   screenshots/05-results.png
 *
 * The screenshots are marketing compositions: a caption band over a
 * device-framed rendering of each key screen, drawn faithfully from the
 * app's real colors, copy, and layout (NOT live device captures — those
 * require a running build; regenerate from a real device before launch if
 * you want pixel-exact captures, but these are Play-Store-ready as-is).
 *
 * Text rendering: sharp's librsvg renders <text> using the system font
 * stack (Helvetica Neue on macOS). Feather-style icons are drawn as inline
 * SVG stroke paths so no icon font is required.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "assets/source");
const OUT = resolve(ROOT, "store/play");
const SHOTS = resolve(OUT, "screenshots");

// ---------------------------------------------------------------------------
// Brand tokens (mirrors src/lib/design.ts)
// ---------------------------------------------------------------------------
const NAVY = "#1E3A5F";
const NAVY_DK = "#0D1B31";
const NAVY_2 = "#16304F";
const BG_DARK = "#0D2240";
const BG_DARK_CARD = "#152B48";
const AMBER = "#F5A623";
const AMBER_LT = "#FFD180";
const SURFACE = "#F5F5F0";
const WHITE = "#FFFFFF";
const INK = "#1E3A5F";
const INK_2 = "#5A6B82";
const INK_3 = "#637085";
const SUCCESS = "#34C759";
const ERROR = "#E5533D";
const BORDER = "#E6E6DA";
const C_LISTEN = "#3B82F6";
const C_READ = "#10B981";
const C_SPEAK = "#EC4899";
const C_WRITE = "#F59E0B";
const C_GRAMMAR = "#8B5CF6";

const SANS = "'Helvetica Neue','Helvetica','Arial',sans-serif";

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function T(x, y, str, o = {}) {
  const {
    size = 28,
    weight = 400,
    fill = INK,
    anchor = "start",
    ls = 0,
    family = SANS,
    opacity = 1,
  } = o;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${ls}" opacity="${opacity}">${esc(str)}</text>`;
}

function rr(x, y, w, h, r, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" ${extra}/>`;
}

/** Rectangle with only the bottom two corners rounded (hero header). */
function bottomRounded(x, y, w, h, r, fill) {
  return `<path fill="${fill}" d="M${x},${y} h${w} v${h - r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - 2 * r)} a${r},${r} 0 0 1 ${-r},${-r} z"/>`;
}

function circle(cx, cy, r, fill, extra = "") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
}

/** Progress ring: track + value arc starting at 12 o'clock, clockwise. */
function ring(cx, cy, r, frac, color, sw, track = "rgba(30,58,95,0.10)") {
  const a0 = -Math.PI / 2;
  const a1 = a0 + Math.PI * 2 * Math.max(0, Math.min(1, frac));
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = frac > 0.5 ? 1 : 0;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>` +
    `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`
  );
}

/** Horizontal progress bar. */
function bar(x, y, w, h, frac, color, track = "rgba(30,58,95,0.08)") {
  const fw = Math.max(h, w * Math.max(0, Math.min(1, frac)));
  return rr(x, y, w, h, h / 2, track) + rr(x, y, fw, h, h / 2, color);
}

// ---------------------------------------------------------------------------
// Feather icon paths (24×24 grid, stroke, round caps)
// ---------------------------------------------------------------------------
const FEATHER = {
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  "book-open":
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  target:
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  award:
    '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-left": '<polyline points="15 18 9 12 15 6"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  headphones:
    '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  "message-circle":
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  "edit-3":
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  "volume-2":
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  "trending-up":
    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
};

/** Icon top-left at (x,y), rendered in a `size`×`size` box. */
function icon(name, x, y, size, color, sw = 2) {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${FEATHER[name]}</g>`;
}
/** Icon centered at (cx,cy). */
function iconC(name, cx, cy, size, color, sw = 2) {
  return icon(name, cx - size / 2, cy - size / 2, size, color, sw);
}

// ---------------------------------------------------------------------------
// Phone-frame geometry (within a 1080×1920 canvas)
// ---------------------------------------------------------------------------
const W = 1080;
const H = 1920;
const BX = 140;
const BY = 352;
const BW = 800;
const BH = 1528; // bezel
const SX = BX + 24;
const SY = BY + 24;
const SW = BW - 48; // 752
const SH = BH - 48; // 1476
const PAD = 30;
const CL = SX + PAD; // content-left
const CR = SX + SW - PAD; // content-right
const CW = SW - 2 * PAD; // content-width (692)

/** iOS-ish status bar drawn in the given ink color. */
function statusBar(ink) {
  const y = SY + 46;
  return (
    T(CL, y, "9:41", { size: 24, weight: 700, fill: ink }) +
    // battery
    rr(CR - 46, y - 17, 40, 20, 5, "none", `stroke="${ink}" stroke-width="2" opacity="0.9"`) +
    rr(CR - 42, y - 13, 28, 12, 2, ink) +
    // wifi + signal dots
    circle(CR - 66, y - 7, 4, ink) +
    circle(CR - 84, y - 7, 4, ink, 'opacity="0.6"')
  );
}

/** Compose one 1080×1920 screenshot: caption band + framed screen. */
function screenshot({ lines, sub, screenBg, content, defs = "" }) {
  const clip = "scr";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY_2}"/>
      <stop offset="1" stop-color="${NAVY_DK}"/>
    </linearGradient>
    <clipPath id="${clip}"><rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="56" ry="56"/></clipPath>
    ${defs}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${W - 60}" cy="120" r="220" fill="${AMBER}" opacity="0.06"/>
  <circle cx="40" cy="${H - 80}" r="180" fill="${AMBER}" opacity="0.05"/>
  ${lines.map((l, i) => T(72, 120 + i * 62, l, { size: 54, weight: 800, fill: WHITE })).join("")}
  <rect x="72" y="${120 + lines.length * 62 + 2}" width="88" height="7" rx="3.5" fill="${AMBER}"/>
  ${T(72, 120 + lines.length * 62 + 46, sub, { size: 28, weight: 600, fill: AMBER_LT })}
  <!-- device bezel -->
  ${rr(BX, BY, BW, BH, 78, "#05060B")}
  ${rr(BX + 6, BY + 6, BW - 12, BH - 12, 72, "#0B1A2E", 'opacity="0.9"')}
  ${rr(SX, SY, SW, SH, 56, screenBg)}
  <g clip-path="url(#${clip})">
    ${rr(SX, SY, SW, SH, 56, screenBg)}
    ${content}
  </g>
  <!-- dynamic island + home indicator -->
  ${rr(SX + SW / 2 - 62, SY + 20, 124, 34, 17, "#05060B")}
  ${rr(SX + SW / 2 - 70, SY + SH - 26, 140, 7, 3.5, "rgba(255,255,255,0.35)")}
</svg>`;
}

// ---------------------------------------------------------------------------
// Reusable in-screen widgets
// ---------------------------------------------------------------------------
function tintCircleIcon(cx, cy, r, tint, name, iconColor, isize) {
  return circle(cx, cy, r, tint) + iconC(name, cx, cy, isize, iconColor, 2.2);
}

/** A white content card with a left color strip. */
function listCard(x, y, w, h, strip) {
  return (
    rr(x, y, w, h, 18, WHITE, 'stroke="rgba(0,0,0,0.04)" stroke-width="1"') +
    rr(x, y, 8, h, 4, strip)
  );
}

function cefrBadge(x, y, level, color) {
  const w = 58;
  return (
    rr(x, y, w, 34, 10, color === WHITE ? "rgba(255,255,255,0.18)" : `${hexA(color, 0.14)}`) +
    T(x + w / 2, y + 24, level, { size: 20, weight: 800, fill: color, anchor: "middle" })
  );
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// Screen 1 — Home
// ---------------------------------------------------------------------------
function homeScreen() {
  const HH = 268;
  let s = "";
  s += bottomRounded(SX, SY, SW, HH, 28, NAVY);
  s += statusBar(WHITE);
  // greeting
  s += T(CL, SY + 132, "Good morning", { size: 26, weight: 600, fill: AMBER_LT });
  s += T(CL, SY + 178, "Ready for some", { size: 34, weight: 800, fill: WHITE });
  s += T(CL, SY + 220, "practice today?", { size: 34, weight: 800, fill: WHITE });
  // streak chip
  s += rr(CR - 150, SY + 108, 150, 50, 25, "rgba(245,158,11,0.2)");
  s += iconC("zap", CR - 118, SY + 133, 26, AMBER, 2.4);
  s += T(CR - 96, SY + 141, "12 days", { size: 22, weight: 700, fill: AMBER_LT });

  // Talk with Companion card (navy, prominent)
  let y = SY + HH + 28;
  s += rr(CL, y, CW, 128, 20, NAVY);
  s += circle(CL + 62, y + 64, 42, "rgba(245,166,35,0.18)");
  s += iconC("mic", CL + 62, y + 64, 40, AMBER, 2.2);
  s += T(CL + 126, y + 54, "Talk with Companion", { size: 27, weight: 700, fill: WHITE });
  s += T(CL + 126, y + 90, "Start a real-time AI voice chat", {
    size: 20,
    weight: 400,
    fill: "rgba(255,255,255,0.72)",
  });
  s += iconC("arrow-right", CR - 40, y + 64, 30, AMBER, 2.4);

  // Today's Plan
  y += 128 + 40;
  s += T(CL, y, "Today's plan", { size: 26, weight: 800, fill: INK });
  y += 24;
  const planItem = (yy, tint, ic, icColor, title, subtitle, right) => {
    let p = rr(CL, yy, CW, 108, 18, WHITE, 'stroke="rgba(0,0,0,0.04)" stroke-width="1"');
    p += tintCircleIcon(CL + 56, yy + 54, 34, tint, ic, icColor, 32);
    p += T(CL + 110, yy + 48, title, { size: 23, weight: 700, fill: INK });
    p += T(CL + 110, yy + 80, subtitle, { size: 19, weight: 400, fill: INK_2 });
    p += right(yy);
    return p;
  };
  s += planItem(
    y,
    hexA(C_LISTEN, 0.12),
    "book-open",
    C_LISTEN,
    "Continue your lessons",
    "Se présenter · Lesson 3",
    (yy) =>
      rr(CR - 96, yy + 36, 78, 34, 17, hexA(AMBER, 0.16)) +
      T(CR - 57, yy + 59, "NEXT", { size: 17, weight: 800, fill: "#8B6914", anchor: "middle" })
  );
  y += 108 + 18;
  s += planItem(
    y,
    hexA(C_SPEAK, 0.12),
    "message-circle",
    C_SPEAK,
    "Speaking practice",
    "Your weakest skill this week",
    (yy) => iconC("chevron-right", CR - 34, yy + 54, 26, INK_3, 2.4)
  );

  // Your skills row
  y += 108 + 40;
  s += T(CL, y, "Your skills", { size: 26, weight: 800, fill: INK });
  y += 40;
  const skills = [
    ["Listen", 0.74, C_LISTEN],
    ["Read", 0.68, C_READ],
    ["Speak", 0.55, C_SPEAK],
    ["Write", 0.61, C_WRITE],
    ["Gram.", 0.7, C_GRAMMAR],
  ];
  const cellW = CW / 5;
  skills.forEach(([label, frac, color], i) => {
    const cx = CL + cellW * i + cellW / 2;
    s += ring(cx, y + 44, 38, frac, color, 8);
    s += T(cx, y + 52, String(Math.round(frac * 100)), {
      size: 24,
      weight: 800,
      fill: INK,
      anchor: "middle",
    });
    s += T(cx, y + 116, label, { size: 18, weight: 600, fill: INK_2, anchor: "middle" });
  });

  return s;
}

// ---------------------------------------------------------------------------
// Screen 2 — Voice conversation (dark)
// ---------------------------------------------------------------------------
function conversationScreen() {
  let s = "";
  s += statusBar(WHITE);
  // header
  s += iconC("chevron-left", CL + 14, SY + 108, 30, "rgba(255,255,255,0.85)", 2.4);
  s += T(SX + SW / 2, SY + 118, "Companion", {
    size: 26,
    weight: 700,
    fill: WHITE,
    anchor: "middle",
  });
  s += iconC("x", CR - 14, SY + 108, 28, "rgba(255,255,255,0.85)", 2.4);

  // goal chip
  const chipW = 468;
  const chipX = SX + SW / 2 - chipW / 2;
  s += rr(chipX, SY + 156, chipW, 54, 27, "rgba(245,166,35,0.16)");
  s += iconC("target", chipX + 34, SY + 183, 26, AMBER, 2.2);
  s += T(chipX + 58, SY + 191, "Talk about your weekend", {
    size: 21,
    weight: 600,
    fill: AMBER_LT,
  });

  // avatar
  const cx = SX + SW / 2;
  const cy = SY + 520;
  s += circle(cx, cy, 190, "rgba(245,166,35,0.10)");
  s += circle(cx, cy, 158, "rgba(245,166,35,0.16)");
  s += circle(cx, cy, 126, "#FBEBD0");
  s += circle(cx, cy, 126, "none", `stroke="${AMBER}" stroke-width="5" opacity="0.9"`);
  // face
  s += circle(cx - 44, cy - 18, 15, NAVY);
  s += circle(cx + 44, cy - 18, 15, NAVY);
  s += `<path d="M${cx - 50} ${cy + 44} Q ${cx} ${cy + 92} ${cx + 50} ${cy + 44}" fill="none" stroke="${NAVY}" stroke-width="9" stroke-linecap="round"/>`;
  s += circle(cx - 82, cy + 34, 14, "rgba(245,120,110,0.35)");
  s += circle(cx + 82, cy + 34, 14, "rgba(245,120,110,0.35)");
  // status label
  s += T(cx, cy + 244, "Listening…", { size: 26, weight: 700, fill: AMBER_LT, anchor: "middle" });

  // live caption
  s += T(cx, cy + 322, "« Ce week-end, je suis allé", {
    size: 24,
    weight: 400,
    fill: "rgba(255,255,255,0.9)",
    anchor: "middle",
  });
  s += T(cx, cy + 356, "au marché avec ma sœur. »", {
    size: 24,
    weight: 400,
    fill: "rgba(255,255,255,0.9)",
    anchor: "middle",
  });

  // correction side-note card
  const cardY = SY + SH - 236;
  s += rr(CL, cardY, CW, 128, 18, BG_DARK_CARD, 'stroke="rgba(255,255,255,0.08)" stroke-width="1"');
  s += rr(CL, cardY, 8, 128, 4, AMBER);
  s += T(CL + 30, cardY + 40, "GENTLE CORRECTION", {
    size: 16,
    weight: 800,
    fill: AMBER,
    ls: 1,
  });
  s += T(CL + 30, cardY + 78, "je suis allé → je suis allée", {
    size: 23,
    weight: 700,
    fill: WHITE,
  });
  s += T(CL + 30, cardY + 108, "past participle agrees with a female speaker", {
    size: 18,
    weight: 400,
    fill: "rgba(255,255,255,0.6)",
  });

  // mic control
  const my = SY + SH - 74;
  s += circle(cx, my, 40, AMBER);
  s += iconC("mic", cx, my, 34, NAVY, 2.4);
  return s;
}

// ---------------------------------------------------------------------------
// Screen 3 — Lessons (guided path)
// ---------------------------------------------------------------------------
function lessonsScreen() {
  const HH = 210;
  let s = "";
  s += bottomRounded(SX, SY, SW, HH, 28, NAVY);
  s += statusBar(WHITE);
  s += T(CL, SY + 150, "Practice", { size: 34, weight: 800, fill: WHITE });
  s += T(CL, SY + 188, "Le parcours guidé · guided lessons", {
    size: 22,
    weight: 600,
    fill: AMBER_LT,
  });

  let y = SY + HH + 28;
  // Featured Lessons card
  s += rr(CL, y, CW, 122, 20, hexA(AMBER, 0.1), `stroke="${hexA(AMBER, 0.35)}" stroke-width="1.5"`);
  s += tintCircleIcon(CL + 60, y + 61, 40, hexA(AMBER, 0.18), "book-open", "#8B6914", 38);
  s += T(CL + 122, y + 52, "Lessons", { size: 26, weight: 800, fill: INK });
  s += T(CL + 122, y + 86, "Learn it, then use it in conversation", {
    size: 19,
    weight: 400,
    fill: INK_2,
  });

  y += 122 + 34;
  s += T(CL, y, "A1 · Se présenter", { size: 22, weight: 800, fill: INK_2, ls: 0.5 });
  y += 26;

  const lesson = (yy, strip, title, cando, right) => {
    let p = listCard(CL, yy, CW, 116, strip);
    p += tintCircleIcon(CL + 60, yy + 58, 34, hexA(strip, 0.14), "book-open", strip, 30);
    p += T(CL + 112, yy + 52, title, { size: 23, weight: 700, fill: INK });
    p += T(CL + 112, yy + 84, cando, { size: 18, weight: 400, fill: INK_2 });
    p += right(yy);
    return p;
  };
  const doneCheck = (yy) =>
    circle(CR - 46, yy + 58, 22, hexA(SUCCESS, 0.15)) +
    iconC("check", CR - 46, yy + 58, 24, SUCCESS, 3);

  s += lesson(
    y,
    C_LISTEN,
    "Greetings & introductions",
    "I can greet and introduce myself",
    doneCheck
  );
  y += 116 + 16;
  s += lesson(y, C_READ, "Nationalities & languages", "I can say where I'm from", doneCheck);
  y += 116 + 16;
  s += lesson(
    y,
    AMBER,
    "Numbers & age",
    "I can say how old I am",
    (yy) =>
      rr(CR - 96, yy + 41, 78, 34, 17, hexA(AMBER, 0.18)) +
      T(CR - 57, yy + 64, "NEXT", { size: 17, weight: 800, fill: "#8B6914", anchor: "middle" })
  );
  y += 116 + 16;
  s += lesson(y, C_GRAMMAR, "Jobs & professions", "I can say what I do", (yy) =>
    cefrBadge(CR - 74, yy + 41, "A1", C_GRAMMAR)
  );

  return s;
}

// ---------------------------------------------------------------------------
// Screen 4 — Pronunciation feedback
// ---------------------------------------------------------------------------
function pronunciationScreen() {
  const HH = 200;
  let s = "";
  s += bottomRounded(SX, SY, SW, HH, 28, NAVY);
  s += statusBar(WHITE);
  s += T(CL, SY + 148, "Pronunciation", { size: 34, weight: 800, fill: WHITE });
  s += T(CL, SY + 186, "Phoneme-level feedback", { size: 22, weight: 600, fill: AMBER_LT });

  let y = SY + HH + 28;
  // word + overall score card
  s += rr(CL, y, CW, 200, 20, WHITE, 'stroke="rgba(0,0,0,0.04)" stroke-width="1"');
  s += T(CL + 34, y + 74, "bonjour", { size: 44, weight: 800, fill: INK });
  s += T(CL + 34, y + 118, "/bɔ̃.ʒuʁ/", { size: 24, weight: 400, fill: INK_3 });
  s += T(CL + 34, y + 168, "Good — keep going", { size: 21, weight: 600, fill: "#2E9E4F" });
  const rx = CR - 92;
  const ryc = y + 100;
  s += ring(rx, ryc, 66, 0.82, SUCCESS, 12);
  s += T(rx, ryc + 4, "82", { size: 46, weight: 800, fill: INK, anchor: "middle" });
  s += T(rx, ryc + 40, "/ 100", { size: 18, weight: 400, fill: INK_3, anchor: "middle" });

  y += 200 + 34;
  s += T(CL, y, "Sound by sound", { size: 26, weight: 800, fill: INK });
  y += 20;
  const rows = [
    ["/b/", 0.95, SUCCESS],
    ["/ɔ̃/", 0.64, C_WRITE],
    ["/ʒ/", 0.91, SUCCESS],
    ["/u/", 0.88, SUCCESS],
    ["/ʁ/", 0.56, ERROR],
  ];
  rows.forEach(([ipa, frac, color]) => {
    y += 20;
    s += rr(CL, y, 66, 66, 14, hexA(color, 0.12));
    s += T(CL + 33, y + 43, ipa, { size: 26, weight: 700, fill: color, anchor: "middle" });
    s += bar(CL + 90, y + 24, CW - 90 - 70, 18, frac, color);
    s += T(CR, y + 46, String(Math.round(frac * 100)), {
      size: 24,
      weight: 800,
      fill: INK,
      anchor: "end",
    });
    y += 66 + 6;
  });

  // focus card
  y += 24;
  s += rr(CL, y, CW, 96, 18, hexA(AMBER, 0.1));
  s += iconC("trending-up", CL + 52, y + 48, 32, "#8B6914", 2.4);
  s += T(CL + 92, y + 42, "Focus next on", { size: 19, weight: 600, fill: INK_2 });
  s += T(CL + 92, y + 72, "Nasal /ɔ̃/ · the French r /ʁ/", { size: 23, weight: 700, fill: INK });

  return s;
}

// ---------------------------------------------------------------------------
// Screen 5 — Mock TCF results
// ---------------------------------------------------------------------------
function resultsScreen() {
  const HH = 200;
  let s = "";
  s += bottomRounded(SX, SY, SW, HH, 28, NAVY);
  s += statusBar(WHITE);
  s += T(CL, SY + 148, "Your results", { size: 34, weight: 800, fill: WHITE });
  s += T(CL, SY + 186, "TCF blanc · full mock test", { size: 22, weight: 600, fill: AMBER_LT });

  let y = SY + HH + 28;
  // big score card
  s += rr(CL, y, CW, 236, 20, WHITE, 'stroke="rgba(0,0,0,0.04)" stroke-width="1"');
  s += T(SX + SW / 2, y + 118, "487", {
    size: 108,
    weight: 800,
    fill: AMBER,
    anchor: "middle",
  });
  s += T(SX + SW / 2, y + 158, "out of 699", {
    size: 24,
    weight: 400,
    fill: INK_3,
    anchor: "middle",
  });
  // CEFR pill
  s += rr(SX + SW / 2 - 116, y + 178, 232, 42, 21, hexA(C_GRAMMAR, 0.14));
  s += T(SX + SW / 2, y + 206, "B2 · Upper intermediate", {
    size: 21,
    weight: 800,
    fill: C_GRAMMAR,
    anchor: "middle",
  });

  y += 236 + 30;
  s += T(CL, y, "By skill", { size: 26, weight: 800, fill: INK });
  y += 26;
  const skills = [
    ["Listening", 502, 0.72, C_LISTEN, "B2"],
    ["Reading", 471, 0.67, C_READ, "B2"],
    ["Writing", 458, 0.65, C_WRITE, "B1"],
    ["Speaking", 495, 0.71, C_SPEAK, "B2"],
  ];
  skills.forEach(([label, score, frac, color, lvl]) => {
    y += 18;
    s += T(CL, y + 22, label, { size: 22, weight: 700, fill: INK });
    s += T(CR, y + 22, `${score}`, { size: 22, weight: 800, fill: INK, anchor: "end" });
    s += bar(CL, y + 38, CW, 16, frac, color);
    y += 66;
  });

  // disclaimer
  y += 10;
  s += T(CL, y + 20, "Estimated score — not an official TCF result.", {
    size: 18,
    weight: 400,
    fill: INK_3,
  });

  // CTA
  y += 46;
  s += rr(CL, y, CW, 62, 14, AMBER);
  s += T(SX + SW / 2, y + 40, "Take another test", {
    size: 24,
    weight: 700,
    fill: NAVY,
    anchor: "middle",
  });

  return s;
}

// ---------------------------------------------------------------------------
// Feature graphic (1024×500)
// ---------------------------------------------------------------------------
async function buildFeatureGraphic() {
  const FW = 1024;
  const FH = 500;
  // glyph: reuse the icon "Ç" geometry (from icon-color.svg), placed left.
  const gx = 250;
  const gy = 250;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FW}" height="${FH}" viewBox="0 0 ${FW} ${FH}">
    <defs>
      <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#22456F"/>
        <stop offset="0.55" stop-color="${NAVY}"/>
        <stop offset="1" stop-color="${NAVY_DK}"/>
      </linearGradient>
      <radialGradient id="glow" cx="24%" cy="42%" r="55%">
        <stop offset="0" stop-color="#2B4F7F" stop-opacity="0.6"/>
        <stop offset="1" stop-color="${NAVY}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${FW}" height="${FH}" fill="url(#fg)"/>
    <rect width="${FW}" height="${FH}" fill="url(#glow)"/>
    <circle cx="900" cy="90" r="240" fill="${AMBER}" opacity="0.07"/>
    <circle cx="960" cy="470" r="150" fill="${AMBER}" opacity="0.06"/>
    <!-- Ç glyph ring (scaled from the 1024-grid icon) -->
    <g transform="translate(${gx - 512 * 0.34},${gy - 480 * 0.34}) scale(0.34)">
      <path d="M 712 340 A 240 240 0 1 0 712 620" fill="none" stroke="${AMBER}" stroke-width="88" stroke-linecap="round"/>
      <path d="M 512 720 Q 512 800 472 822 Q 442 836 416 822" fill="none" stroke="${AMBER}" stroke-width="52" stroke-linecap="round"/>
    </g>
    <text x="440" y="222" font-family="${SANS}" font-size="96" font-weight="800" fill="${WHITE}">Companion</text>
    <text x="442" y="286" font-family="${SANS}" font-size="38" font-weight="600" fill="${AMBER_LT}">Speak French with an AI tutor</text>
    <rect x="444" y="322" width="70" height="6" rx="3" fill="${AMBER}"/>
    <text x="442" y="380" font-family="${SANS}" font-size="29" font-weight="500" fill="rgba(255,255,255,0.72)">Voice practice · pronunciation · TCF prep</text>
  </svg>`;
  return sharp(Buffer.from(svg), { density: 240 })
    .resize(FW, FH)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function renderTo(name, svg) {
  const buf = await sharp(Buffer.from(svg), { density: 200 })
    .resize(W, H)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(SHOTS, name), buf);
  const meta = await sharp(buf).metadata();
  console.log(
    `  ✓ screenshots/${name.padEnd(24)} ${meta.width}×${meta.height}  ${(buf.length / 1024).toFixed(0)} KB`
  );
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  console.log(`Generating Play Store assets → ${OUT}/\n`);

  // 1) Hi-res icon 512×512 (opaque) from brand source
  const iconSvg = await readFile(resolve(SRC, "icon-color.svg"));
  const iconBuf = await sharp(iconSvg, { density: 384 })
    .resize(512, 512)
    .flatten({ background: NAVY })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(OUT, "icon-512.png"), iconBuf);
  console.log(`  ✓ icon-512.png            512×512  ${(iconBuf.length / 1024).toFixed(0)} KB`);

  // 2) Feature graphic 1024×500
  const fg = await buildFeatureGraphic();
  await writeFile(resolve(OUT, "feature-graphic.png"), fg);
  const fgMeta = await sharp(fg).metadata();
  console.log(
    `  ✓ feature-graphic.png    ${fgMeta.width}×${fgMeta.height}  ${(fg.length / 1024).toFixed(0)} KB`
  );

  // 3) Screenshots
  await renderTo(
    "01-home.png",
    screenshot({
      lines: ["Your French tutor,", "in your pocket"],
      sub: "A daily plan that adapts to you",
      screenBg: SURFACE,
      content: homeScreen(),
    })
  );
  await renderTo(
    "02-conversation.png",
    screenshot({
      lines: ["Real voice", "conversations"],
      sub: "Speak freely — corrections come after",
      screenBg: BG_DARK,
      content: conversationScreen(),
    })
  );
  await renderTo(
    "03-lessons.png",
    screenshot({
      lines: ["Guided lessons,", "A1 to B2"],
      sub: "Learn it, then use it out loud",
      screenBg: SURFACE,
      content: lessonsScreen(),
    })
  );
  await renderTo(
    "04-pronunciation.png",
    screenshot({
      lines: ["Fix your accent,", "sound by sound"],
      sub: "Phoneme-level pronunciation feedback",
      screenBg: SURFACE,
      content: pronunciationScreen(),
    })
  );
  await renderTo(
    "05-results.png",
    screenshot({
      lines: ["Full TCF", "mock tests"],
      sub: "Real timing · estimated scores",
      screenBg: SURFACE,
      content: resultsScreen(),
    })
  );

  console.log("\nDone. Assets are Play-Store-ready under store/play/.");
}

main().catch((err) => {
  console.error("[generate-store-assets] failed:", err);
  process.exitCode = 1;
});
