/**
 * Password strength indicator (Story 12-8).
 *
 * Live UI feedback for the signup screen's password input. Renders:
 * (a) a 3-segment progress bar colored by `computePasswordStrengthLabel`,
 * (b) a French strength label (Faible / Moyen / Fort) right-aligned,
 * (c) an itemized 4-line requirements checklist with met/unmet states.
 *
 * Hides itself when `password.length === 0` to avoid a flash of the
 * indicator on first focus before the user types anything.
 *
 * Accessibility (review-round-1 P9):
 * - The progress bar uses `accessibilityRole="progressbar"` +
 *   `accessibilityValue={{min: 0, max: 3, now: segmentCount}}` so screen
 *   readers can describe the strength level numerically.
 * - Each checklist row is wrapped in a parent `accessible` View with
 *   `accessibilityRole="checkbox"` + `accessibilityState={{checked: met}}`
 *   + `accessibilityLabel` set to the French requirement string. Child
 *   `<Text>` elements have `importantForAccessibility="no-hide-descendants"`
 *   (Android) AND `accessibilityElementsHidden={true}` (iOS) so screen
 *   readers don't double-announce the icon `"·"` / `"✓"` glyph alongside
 *   the parent's label.
 * - The strength label uses `accessibilityLiveRegion="polite"` (Android)
 *   so screen-reader users hear the strength change as they type without
 *   spam-firing per keystroke (Android batches polite-region updates).
 *
 * `React.memo` because the parent re-renders on every keystroke; the
 * indicator's only dep is `password`. The expensive parts
 * (`validatePasswordStrength` + `computePasswordStrengthLabel`) run
 * inside a single combined `useMemo` keyed off `password`
 * (review-round-1 P19 — pre-patch two `useMemo` calls created a
 * vacuous-memoization pattern because `reasons` was a fresh array on
 * every keystroke, so the second `useMemo`'s dep-array always
 * invalidated).
 */

import React, { useMemo } from "react";
import { View, Text } from "react-native";

import { Colors, Typography } from "@/src/lib/design";
import {
  computePasswordStrengthLabel,
  passwordPolicyReasonToFrenchMessage,
  validatePasswordStrength,
  type PasswordPolicyReason,
} from "@/src/lib/password-policy";

const STRENGTH_LABELS: Record<"weak" | "medium" | "strong", string> = {
  weak: "Faible",
  medium: "Moyen",
  strong: "Fort",
};

const STRENGTH_COLORS: Record<"weak" | "medium" | "strong", string> = {
  weak: Colors.error,
  medium: Colors.warning,
  strong: Colors.success,
};

const STRENGTH_SEGMENT_COUNT: Record<"weak" | "medium" | "strong", number> = {
  weak: 1,
  medium: 2,
  strong: 3,
};

const ALL_REASONS: PasswordPolicyReason[] = ["length", "lowercase", "uppercase", "digit"];

export interface PasswordStrengthIndicatorProps {
  password: string;
}

function PasswordStrengthIndicatorImpl({ password }: PasswordStrengthIndicatorProps) {
  // Single memoized derivation keyed only on `password` (review-round-1
  // P19). All downstream values (label, segment count, color, set of
  // failing reasons) are computed once per password change.
  const derived = useMemo(() => {
    const { reasons } = validatePasswordStrength(password);
    const label = computePasswordStrengthLabel(reasons, password.length, password);
    return {
      reasons,
      label,
      segmentCount: STRENGTH_SEGMENT_COUNT[label],
      color: STRENGTH_COLORS[label],
      failingReasons: new Set<PasswordPolicyReason>(reasons),
    };
  }, [password]);

  if (password.length === 0) return null;

  const { label, segmentCount, color, failingReasons } = derived;

  return (
    <View style={{ marginTop: 8, marginBottom: 16 }}>
      {/* Progress bar + strength label row */}
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        accessibilityRole="progressbar"
        accessibilityLabel="Password strength"
        accessibilityValue={{ min: 0, max: 3, now: segmentCount }}
      >
        <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
          {[1, 2, 3].map((idx) => (
            <View
              key={idx}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: idx <= segmentCount ? color : Colors.gray200,
              }}
            />
          ))}
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            Typography.caption,
            { color, fontWeight: "700", minWidth: 50, textAlign: "right" },
          ]}
        >
          {STRENGTH_LABELS[label]}
        </Text>
      </View>

      {/* Itemized requirements checklist */}
      <View style={{ marginTop: 10, gap: 4 }}>
        {ALL_REASONS.map((reason) => {
          const met = !failingReasons.has(reason);
          return (
            <View
              key={reason}
              accessible={true}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: met }}
              accessibilityLabel={passwordPolicyReasonToFrenchMessage(reason)}
              importantForAccessibility="yes"
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Text
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden={true}
                style={[
                  Typography.caption,
                  {
                    color: met ? Colors.success : Colors.textTertiary,
                    fontWeight: "700",
                    width: 14,
                  },
                ]}
              >
                {met ? "✓" : "·"}
              </Text>
              <Text
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden={true}
                style={[Typography.caption, { color: met ? Colors.success : Colors.textTertiary }]}
              >
                {passwordPolicyReasonToFrenchMessage(reason)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export const PasswordStrengthIndicator = React.memo(PasswordStrengthIndicatorImpl);
