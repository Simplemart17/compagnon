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
 * Accessibility (review-round-1 P9 + review-round-2 R2-P4):
 * - The progress bar uses `accessibilityRole="progressbar"` +
 *   `accessibilityValue={{min: 0, max: 3, now: segmentCount}}` so screen
 *   readers can describe the strength level numerically.
 * - Each checklist row is wrapped in a parent `accessible` View with
 *   `accessibilityRole="checkbox"` + `accessibilityState={{checked: met}}`
 *   + `accessibilityLabel` set to the French requirement string. Child
 *   `<Text>` elements have `importantForAccessibility="no"` (Android —
 *   suppresses TalkBack from descending into the leaf — review-round-2
 *   R2-P4 fix; pre-R2 used `"no-hide-descendants"` which means "this
 *   view IS important, descendants NOT hidden" — the OPPOSITE of the
 *   intent for a leaf, leaving TalkBack to triple-announce
 *   "·, Au moins une minuscule, checkbox, unchecked, Au moins une
 *   minuscule") AND `accessibilityElementsHidden={true}` (iOS) so the
 *   parent's label is read once.
 * - The strength label uses `accessibilityLiveRegion="polite"` (Android)
 *   so screen-reader users hear the strength change as they type without
 *   spam-firing per keystroke (Android batches polite-region updates).
 *
 * `React.memo` because the parent re-renders on every keystroke; the
 * indicator's only dep is `password`. A single combined `useMemo`
 * keyed off `password` provides STRUCTURAL memoization — every
 * downstream consumer in the same render shares one stable `derived`
 * object reference. **Note (review-round-2 R2-P10):** the memo is NOT
 * a perf optimization for the validators themselves —
 * `validatePasswordStrength` and `computePasswordStrengthLabel` are
 * O(n) on small strings (microsecond-cheap) and the memo never has a
 * cache hit during typing because every keystroke changes `password`.
 * The benefit is purely API hygiene: one derived object, one
 * dep-array, one place to extend. (Pre-R1 the indicator had two
 * `useMemo` calls with the second's dep-array vacuously invalidating
 * because `reasons` was a fresh array each call.)
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
  // failing reasons) are computed once per password change. The
  // `computePasswordStrengthLabel` 2-arg signature (R2-P5) eliminates
  // the prior desync hazard between `passwordLength` and `password`.
  const derived = useMemo(() => {
    const { reasons } = validatePasswordStrength(password);
    const label = computePasswordStrengthLabel(reasons, password);
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
                importantForAccessibility="no"
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
                importantForAccessibility="no"
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
