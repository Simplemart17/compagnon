import React from "react";
import { Feather } from "@expo/vector-icons";

import { Colors } from "@/src/lib/design";

/**
 * Story 14-3: centralised icon-set wrapper.
 *
 * Closes audit roadmap line 272 (icon system replacement). Wraps
 * `@expo/vector-icons.Feather` (already transitive via Expo SDK 55 — zero
 * install cost) so the icon-set choice is centralised in 1 file. Future
 * swap (e.g., to `lucide-react-native`) is 1-file change, not 33-site.
 *
 * Mirrors the consolidation discipline from Story 14-2 (SkillCard +
 * ListItemCard single source-of-truth) and the chrome/content split from
 * Story 14-1 (chrome icons get real icons; learning-content emoji stay
 * verbatim per `TOPIC_EMOJIS` + onboarding goal emoji).
 *
 * **Why a typed `IconName` union?** `<Feather name="mial" />` (typo) would
 * silently render a missing-glyph placeholder at runtime; the union catches
 * the typo at `tsc` time. Adding a new icon usage requires extending the
 * union FIRST — drift detector pins ≥ 20 members so a careless removal
 * breaks CI.
 *
 * **Why `React.memo`?** Consistent with `SkillCard` / `ListItemCard` /
 * `Bubble` precedents — Icon is rendered in lists / cards / chrome
 * affordances that re-render on parent state changes; the wrapper memo
 * defends against unnecessary re-renders.
 *
 * **Accessibility default**: when `accessibilityLabel` is omitted, the icon
 * is treated as decorative-of-text so screen-readers don't announce
 * "envelope, U+2709" beside an "Email" TextInput that already has its own
 * label.
 *
 * **Story 14-3 review-round-1 P1 (HIGH) — cross-platform a11y**:
 * `importantForAccessibility` is an Android-only prop in React Native; on
 * iOS it's a no-op. VoiceOver would still discover the icon as a focusable
 * element. The pre-R1 implementation only set `importantForAccessibility="no"`
 * which silently regressed iOS a11y (auth-surface mail/lock/user icons
 * announced beside the labeled TextInput). Post-R1 the decorative branch
 * sets THREE props: `accessible={false}` (iOS canonical decorative flag),
 * `accessibilityElementsHidden={true}` (iOS-strong hide; tree-walked by
 * VoiceOver), `importantForAccessibility="no"` (Android canonical). Mirrors
 * the same pattern Story 14-2 used in `PasswordStrengthIndicator.tsx:152-156`.
 *
 * Consumers that need the icon announced as its own element pass
 * `accessibilityLabel` explicitly.
 */
export type IconName =
  | "mail"
  | "lock"
  | "user"
  | "mic"
  | "headphones"
  | "book-open"
  | "edit-3"
  | "activity" // grammar chrome — Feather lacks Brain (Q5 in story AC #11)
  | "volume-2"
  | "file-text"
  | "repeat"
  | "globe"
  | "book"
  | "check"
  | "check-circle"
  | "key"
  | "zap" // streak chrome — Feather Flame is FontAwesome only (Q3)
  | "target"
  | "message-circle"
  | "award"
  | "smile"
  | "settings"
  | "play-circle" // resume CTA chrome (Story 14-7 — mock-test landing "Resume in-progress")
  | "chevron-left" // back-nav chrome (conversation screen)
  | "send" // send-typed-message chrome (conversation text input)
  | "type" // voice↔text toggle chrome (conversation screen)
  | "wifi-off" // connection-lost chrome (conversation disconnected state)
  | "arrow-left" // back-nav chrome (terms / privacy-policy)
  | "chevron-right" // row/nav "go" affordance (cards, settings rows)
  | "chevron-up" // previous-match chrome (history search)
  | "chevron-down" // next-match chrome (history search)
  | "x" // close/clear chrome (history search + modals)
  | "bell" // notification chrome (home header)
  | "play" // audio-playback chrome (dictation / translation / echo)
  | "alert-triangle" // error-state chrome (ErrorBoundary)
  | "search" // search-input + no-results chrome (history)
  | "square" // stop-recording chrome (pronunciation / echo / translation record toggles)
  | "star" // level stat-chip chrome (conversation landing hero)
  | "pause" // audio pause chrome (mock-test / listening playback toggles)
  | "trending-up" // improved-trend indicator (session comparison)
  | "trending-down" // declined-trend indicator (session comparison)
  | "minus"; // no-change indicator (session comparison)

export interface IconProps {
  name: IconName;
  /** Defaults to 24. */
  size?: number;
  /** Defaults to `Colors.textPrimary`. */
  color?: string;
  /**
   * When provided, the icon is announced to screen-readers under this
   * label. When omitted, the icon is treated as decorative-of-text via
   * `importantForAccessibility="no"`.
   */
  accessibilityLabel?: string;
}

export const Icon = React.memo(function Icon({
  name,
  size = 24,
  color = Colors.textPrimary,
  accessibilityLabel,
}: IconProps) {
  if (accessibilityLabel === undefined) {
    return (
      <Feather
        name={name}
        size={size}
        color={color}
        accessible={false}
        accessibilityElementsHidden={true}
        importantForAccessibility="no"
      />
    );
  }
  return <Feather name={name} size={size} color={color} accessibilityLabel={accessibilityLabel} />;
});
