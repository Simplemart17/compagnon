/**
 * Design System Constants
 *
 * Single source of truth for all visual tokens used in inline styles.
 * Derived from the Tailwind config in tailwind.config.js.
 */

import { TextStyle, ViewStyle } from "react-native";

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
  accent30: "rgba(245,166,35,0.3)",

  // Success tints
  success10: "rgba(52,199,89,0.1)",
  success15: "rgba(52,199,89,0.15)",

  // Error tints
  error10: "rgba(255,59,48,0.1)",
  error15: "rgba(255,59,48,0.15)",

  // Dark backgrounds (auth, conversation)
  bgDark: "#0D2240",
  bgDarkCard: "#152B48",

  // Text colors
  textPrimary: "#1E3A5F",
  textSecondary: "#6B7C93",
  textTertiary: "#94A3B8",
  textOnDark: "#FFFFFF",
  textOnDarkSecondary: "rgba(255,255,255,0.7)",
  textOnDarkTertiary: "rgba(255,255,255,0.5)",

  // Neutral grays
  gray100: "#F5F5F0",
  gray200: "#EBEBDF",
  gray300: "#E0E0CE",
  gray400: "#C4C4B8",
  gray500: "#94A3B8",
  gray600: "#6B7C93",
  gray700: "#4A5568",

  // Borders
  border: "#E0E0CE",
  borderLight: "rgba(0,0,0,0.06)",
  borderOnDark: "rgba(255,255,255,0.12)",

  // Skill accent colors (used on practice cards, home, etc.)
  skillListening: "#3B82F6",
  skillReading: "#10B981",
  skillWriting: "#F59E0B",
  skillGrammar: "#8B5CF6",
  skillPronunciation: "#EC4899",
  skillDictation: "#06B6D4",
  skillVocabulary: "#F5A623",
  skillMockTest: "#8B5CF6",
  skillConversation: "#3B82F6",

  // Conversation UI (dark theme)
  bubbleUser: "rgba(245,166,35,0.22)",
  bubbleUserBorder: "rgba(245,166,35,0.35)",
  bubbleAi: "rgba(255,255,255,0.1)",
  bubbleAiBorder: "rgba(255,255,255,0.12)",
} as const;

/** Generate a tinted background from a skill color */
export function skillTint(color: string, opacity: number = 0.1): string {
  // Parse hex color and return rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
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
    shadowColor: "#000",
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

  /** Dark hero header */
  heroHeader: {
    backgroundColor: Colors.primary,
    paddingBottom: 28,
    paddingHorizontal: Spacing.screenPaddingLarge,
    borderBottomLeftRadius: Radii.heroBottom,
    borderBottomRightRadius: Radii.heroBottom,
    ...Shadows.hero,
  } as ViewStyle,

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
