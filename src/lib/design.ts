/**
 * Design System Constants
 *
 * Single source of truth for all visual tokens used in inline styles.
 * Derived from the Tailwind config in tailwind.config.js.
 */

import { TextStyle, ViewStyle } from "react-native";

import type { TCFSkill } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const Colors = {
  // Core palette
  primary: "#1E3A5F",
  primaryDark: "#0D1B31",
  primaryLight: "#4D78AC",
  accent: "#F5A623",
  accentDark: "#DC951F",
  surface: "#F5F5F0",
  surfaceWhite: "#FFFFFF",
  success: "#34C759",
  error: "#FF3B30",

  // Primary tints (for backgrounds)
  primary5: "rgba(30,58,95,0.05)",
  primary8: "rgba(30,58,95,0.08)",
  primary10: "rgba(30,58,95,0.1)",
  primary15: "rgba(30,58,95,0.15)",
  primary50: "#E8EFF6",

  // Accent tints
  accent10: "rgba(245,166,35,0.1)",
  accent15: "rgba(245,166,35,0.15)",
  accent20: "rgba(245,166,35,0.2)",
  accent25: "rgba(245,166,35,0.25)",
  accent30: "rgba(245,166,35,0.3)",
  accent50: "rgba(245,166,35,0.5)",
  accentLight: "#FFD180",
  warning: "#9A6400", // darkened from #FF9500 — 4.6:1 on surface (WCAG AA)

  /**
   * Streak warmth — warmer amber for informational chrome (streak chip,
   * day-count badge, "zap" icon color).
   *
   * **Semantic:** non-interactive warmth indicator. The user reads this
   * color as "personal energy / progress over time", NOT as "tap me".
   *
   * **Do NOT use for:** primary CTAs, tappable buttons, active-state markers
   * on Pressable / TouchableOpacity — those stay on `Colors.accent` (the
   * cooler amber that means "interact with me"). The whole point of the
   * Story 14-5 split is to keep the streak warmth distinguishable from
   * CTA-amber on the same screen.
   *
   * **Surface contract (Story 14-5 R1-P2 + R1-P19):**
   *
   * - Light backgrounds (`Colors.surface` / `surfaceWhite`): use
   *   `Colors.streakText` (#92400E, 6.48:1 AA-compliant) for text.
   * - **Dark composites** (home / profile hero on `Colors.bgDark` /
   *   `Colors.primary` + streak20/skillTint backgrounds): use
   *   `Colors.streak` base hue itself (~8:1 on `Colors.bgDark`); the dark
   *   `streakText` variant fails WCAG AA on dark composites (~1.23-1.59:1).
   *
   * Hue: Tailwind v3.4 amber-500. The diff from `Colors.accent` is primarily
   * a saturation/brightness shift (both hover around HSL hue 38°); the
   * empirically-distinguishable difference comes from the brighter amber tone.
   * Story 14-5 + P2-12.
   */
  streak: "#F59E0B",
  /**
   * WCAG-AA-compliant text variant for streak chrome ON LIGHT BACKGROUNDS ONLY
   * (`Colors.surface = #F5F5F0` → 6.48:1; `Colors.surfaceWhite = #FFFFFF` → 6.95:1).
   *
   * **Do NOT use on dark composites** (home/profile hero, conversation bg, etc.) —
   * the dark-brown gives ~1.2-1.6:1 contrast against those backgrounds and fails
   * WCAG AA badly. For text on dark composites, use `Colors.streak` (the base
   * lighter amber) which gives ~8:1 on `Colors.bgDark`.
   *
   * Tailwind v3.4 amber-800. Story 14-5 R1-P2 + R1-P19.
   */
  streakText: "#92400E",
  streak10: "rgba(245,158,11,0.1)",
  streak15: "rgba(245,158,11,0.15)",
  streak20: "rgba(245,158,11,0.2)",
  streak30: "rgba(245,158,11,0.3)",

  /**
   * Progress feedback — cooler gold for non-interactive visual feedback
   * (rating-bar fills, progress-bar fills, chart-marker dots, fillPercent
   * indicators).
   *
   * **Semantic:** data-feedback indicator. The user reads this color as
   * "this is the value/level being shown", NOT as "tap me" and NOT as
   * "streak warmth".
   *
   * **Do NOT use for:** primary CTAs (use `Colors.accent`); streak chrome
   * (use `Colors.streak`); success/correct-answer states (use `Colors.success`);
   * **text on light backgrounds** (use `Colors.progressText` — `Colors.progress`
   * itself gives ~2.94:1 on white, fails WCAG AA).
   *
   * The 3-token split (accent/streak/progress) decouples Story 14-5 / P2-12's
   * 3 conflated semantic roles so each can render distinctly on the same screen.
   *
   * Tailwind v3.4 yellow-600. Modest hue shift toward yellow + lower saturation
   * vs `Colors.accent`. Story 14-5 + P2-12.
   */
  progress: "#CA8A04",
  /**
   * WCAG-AAA-compliant text variant for progress chrome on light backgrounds
   * (`Colors.surface` 7.93:1; `Colors.surfaceWhite` 8.59:1). Used by the
   * cefr-progression-chart Y-axis current-level label (white chart bg).
   *
   * Tailwind v3.4 yellow-900. Story 14-5 R1-P3.
   */
  progressText: "#713F12",
  progress10: "rgba(202,138,4,0.1)",
  progress15: "rgba(202,138,4,0.15)",
  progress20: "rgba(202,138,4,0.2)",
  progress30: "rgba(202,138,4,0.3)",

  // Success tints
  success10: "rgba(52,199,89,0.1)",
  success12: "rgba(52,199,89,0.12)",
  success15: "rgba(52,199,89,0.15)",
  success30: "rgba(52,199,89,0.3)",
  success35: "rgba(52,199,89,0.35)",

  // Error tints
  error10: "rgba(255,59,48,0.1)",
  error15: "rgba(255,59,48,0.15)",
  error25: "rgba(255,59,48,0.25)",

  // Dark backgrounds (auth, conversation)
  bgDark: "#0D2240",
  bgDarkCard: "#152B48",
  bgDarkOverlay: "rgba(8,18,35,0.92)",

  // Text colors
  textPrimary: "#1E3A5F",
  textSecondary: "#5A6B82", // darkened from #6B7C93 — 5.0:1 on surface (WCAG AA)
  textTertiary: "#637085", // darkened from #94A3B8 — 4.6:1 on surface (WCAG AA)
  /** Accent color darkened for use as text on light backgrounds (4.7:1 on surface) */
  accentText: "#8B6914",
  textOnDark: "#FFFFFF",
  textOnDarkSecondary: "rgba(255,255,255,0.7)",
  textOnDarkTertiary: "rgba(255,255,255,0.5)",
  textOnDarkQuaternary: "rgba(255,255,255,0.55)",
  textOnDarkMuted: "rgba(255,255,255,0.65)",
  textOnDarkBright: "rgba(255,255,255,0.75)",

  // Neutral grays
  gray100: "#F5F5F0",
  gray200: "#EBEBDF",
  gray300: "#E0E0CE",
  gray400: "#C4C4B8",
  gray500: "#637085", // darkened from #94A3B8 — matches textTertiary (4.6:1 on surface)
  gray600: "#5A6B82", // darkened from #6B7C93 — matches textSecondary (5.0:1 on surface)
  gray700: "#4A5568",

  // Shadows
  shadow: "#000000",

  // Borders
  border: "#E0E0CE",
  borderLight: "rgba(0,0,0,0.06)",
  borderOnDark: "rgba(255,255,255,0.12)",

  // White alpha (dark-theme UI elements)
  whiteAlpha06: "rgba(255,255,255,0.06)",
  whiteAlpha08: "rgba(255,255,255,0.08)",
  whiteAlpha10: "rgba(255,255,255,0.1)",
  whiteAlpha12: "rgba(255,255,255,0.12)",
  whiteAlpha15: "rgba(255,255,255,0.15)",
  whiteAlpha20: "rgba(255,255,255,0.2)",
  whiteAlpha25: "rgba(255,255,255,0.25)",
  whiteAlpha30: "rgba(255,255,255,0.3)",
  whiteAlpha35: "rgba(255,255,255,0.35)",
  whiteAlpha65: "rgba(255,255,255,0.65)",
  whiteAlpha07: "rgba(255,255,255,0.07)",
  whiteAlpha85: "rgba(255,255,255,0.85)",

  // Overlays
  overlayDark: "rgba(0,0,0,0.5)",

  // Skill accent colors (used on practice cards, home, etc.)
  skillListening: "#3B82F6",
  skillReading: "#10B981",
  skillWriting: "#F59E0B",
  skillGrammar: "#8B5CF6",
  skillPronunciation: "#EC4899",
  skillDictation: "#06B6D4",
  skillTranslation: "#F97316",
  skillVocabulary: "#F5A623",
  skillMockTest: "#8B5CF6",
  skillConversation: "#3B82F6",

  // Correction colors
  correctionOriginal: "rgba(255,107,107,0.85)",
  correctionPronunciation: "#5AA4CF",
  correctionPronunciationText: "#7DBFE8",

  // Conversation UI (dark theme)
  bubbleUser: "rgba(245,166,35,0.22)",
  bubbleUserBorder: "rgba(245,166,35,0.35)",
  bubbleAi: "rgba(255,255,255,0.1)",
  bubbleAiBorder: "rgba(255,255,255,0.12)",
} as const;

/** TCF skill → accent color mapping */
export const SKILL_COLORS: Record<TCFSkill, string> = {
  listening: Colors.skillListening,
  reading: Colors.skillReading,
  speaking: Colors.skillPronunciation,
  writing: Colors.skillWriting,
  grammar: Colors.skillGrammar,
};

/** Generate a tinted background from a hex color (e.g. "#1E3A5F") */
export function skillTint(color: string, opacity: number = 0.1): string {
  if (!color || color[0] !== "#" || color.length < 7) {
    if (__DEV__) console.warn(`skillTint: expected hex color, got "${color}"`);
    return `rgba(0,0,0,${opacity})`;
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(0,0,0,${opacity})`;
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const Typography = {
  /** Screen titles (e.g., "Entraînement", "Profil") */
  screenTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.textOnDark,
  } as TextStyle,

  /** Section headers within screens */
  sectionHeader: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
  } as TextStyle,

  /** Card titles */
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  } as TextStyle,

  /**
   * Primary CTA button label (Story 14-8 — themed dialog action buttons +
   * any other prominent action button needing a 17pt 700-weight white
   * label on a filled colored background).
   */
  ctaLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.textOnDark,
  } as TextStyle,

  /** Body text */
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textPrimary,
  } as TextStyle,

  /** Secondary body text */
  bodySecondary: {
    fontSize: 14,
    color: Colors.textSecondary,
  } as TextStyle,

  /** Small captions and labels */
  caption: {
    fontSize: 13,
    color: Colors.textTertiary,
  } as TextStyle,

  /** Very small labels (badges, tags) */
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  } as TextStyle,

  /** Tiny meta text (timestamps, bubble metadata) */
  tiny: {
    fontSize: 10,
    color: Colors.textTertiary,
  } as TextStyle,

  /** Small UI text (badges, minor labels) */
  small: {
    fontSize: 12,
    color: Colors.textSecondary,
  } as TextStyle,

  /** Subsection headers (e.g., score breakdowns) */
  subsectionHeader: {
    fontSize: 22,
    fontWeight: "800",
  } as TextStyle,

  /** Large score/accuracy display */
  scoreDisplay: {
    fontSize: 40,
    fontWeight: "800",
  } as TextStyle,

  /** Decorative display text (e.g., placeholder icons) */
  display: {
    fontSize: 36,
  } as TextStyle,

  /** Big numbers (scores, stats) */
  bigNumber: {
    fontSize: 48,
    fontWeight: "800",
    color: Colors.textPrimary,
  } as TextStyle,

  /** Medium stat numbers */
  statNumber: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.textPrimary,
  } as TextStyle,
} as const;

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export const Spacing = {
  /** Screen horizontal padding for content screens */
  screenPadding: 20,
  /** Screen horizontal padding for auth/onboarding screens */
  screenPaddingLarge: 24,
  /** Default gap between cards/sections */
  sectionGap: 16,
  /** Large gap between major sections */
  sectionGapLarge: 24,
  /** Card internal padding */
  cardPadding: 16,
  /** Small internal padding */
  cardPaddingSmall: 12,
} as const;

// ---------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------

export const Radii = {
  /** Cards, sheets, containers */
  card: 16,
  /** Buttons, inputs */
  button: 12,
  /** Small elements (badges, chips) */
  chip: 8,
  /** Hero header bottom corners */
  heroBottom: 28,
  /** Fully round (pills, circles) */
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

export const Shadows = {
  /** Default card shadow */
  card: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  } as ViewStyle,

  /** Hero/header shadow */
  hero: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  } as ViewStyle,

  /** Subtle shadow for flat cards */
  subtle: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  } as ViewStyle,

  /**
   * Inverted shadow for bottom-sheet surfaces that rise from below the
   * viewport (auth + forgot-password rounded-top cards). The negative
   * `height` casts the soft glow UPWARD above the sheet edge — the
   * load-bearing semantic that distinguishes this token from
   * `.card` / `.hero` / `.subtle` (all positive-height).
   *
   * Uses `Colors.shadow` (neutral black) rather than `Colors.primary`
   * because the shadow falls onto the dark auth-screen hero gradient
   * where a navy-tinted shadow would visually disappear. Pre-14-4 the
   * 3 auth screens all anchored on `Colors.shadow`; this token preserves
   * that color invariant verbatim. Story 14-4 + R1-P21.
   */
  bottomSheet: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  } as ViewStyle,
} as const;

// ---------------------------------------------------------------------------
// Common style presets
// ---------------------------------------------------------------------------

export const Presets = {
  /** Standard card container */
  card: {
    backgroundColor: Colors.surfaceWhite,
    borderRadius: Radii.card,
    padding: Spacing.cardPadding,
    ...Shadows.card,
  } as ViewStyle,

  /** Primary CTA button */
  buttonPrimary: {
    backgroundColor: Colors.accent,
    height: 52,
    borderRadius: Radii.button,
    justifyContent: "center",
    alignItems: "center",
  } as ViewStyle,

  /** Secondary/outline button */
  buttonSecondary: {
    backgroundColor: "transparent",
    height: 48,
    borderRadius: Radii.button,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    justifyContent: "center",
    alignItems: "center",
  } as ViewStyle,

  /**
   * Story 14-9: `Presets.heroHeader` DELETED ("delete don't alias" pattern).
   * The canonical hero now lives in `src/components/common/HeroHeader.tsx`,
   * which exports `heroHeaderContainerStaticStyle` (frozen) and consumes
   * `Colors.primary` + `Radii.heroBottom` + `Shadows.hero` directly. The
   * preset was unused across the app (0 consumers verified at deletion
   * time); aliasing would create 2 sources of truth.
   */

  /** Screen container with surface background */
  screen: {
    flex: 1,
    backgroundColor: Colors.surface,
  } as ViewStyle,

  /** Dark screen container */
  screenDark: {
    flex: 1,
    backgroundColor: Colors.bgDark,
  } as ViewStyle,
} as const;
