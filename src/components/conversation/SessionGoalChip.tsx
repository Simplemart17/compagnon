/**
 * SessionGoalChip — Story 18-6 (conversation screen redesign).
 *
 * A compact pill under the Talk-screen header answering "what am I
 * practicing right now?": target icon + goal text + CEFR level badge.
 *
 * Epic 19 hook: `goalOverride` — the lesson engine passes the lesson
 * scenario's can-do goal here ("Order a meal politely"); without it the
 * chip falls back to the mode/topic-derived `deriveSessionGoal` text.
 */

import React from "react";
import { Text, View } from "react-native";

import { Icon } from "@/src/components/common/Icon";
import { deriveSessionGoal } from "@/src/lib/session-goal";
import { Colors } from "@/src/lib/design";
import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationMode } from "@/src/types/conversation";

export interface SessionGoalChipProps {
  mode: ConversationMode;
  topic: string;
  /**
   * Review R1: optional + UNCOERCED (Story 18-2 R1-P3 pattern) — pass the
   * raw profile level, not the `?? "A1"` fallback, so a B2 user's badge
   * doesn't read "A1" during the hydration window. Undefined hides the
   * badge and drops the level clause from the accessibility label.
   */
  cefrLevel?: CEFRLevel;
  /** Epic 19 lesson-scenario goal — takes precedence over the derived text. */
  goalOverride?: string;
}

export const SessionGoalChip = React.memo(function SessionGoalChip({
  mode,
  topic,
  cefrLevel,
  goalOverride,
}: SessionGoalChipProps) {
  const goal =
    goalOverride !== undefined && goalOverride.trim().length > 0
      ? goalOverride.trim()
      : deriveSessionGoal(mode, topic);

  return (
    <View
      className="flex-row items-center self-center bg-white/[0.08] border border-white/15 rounded-full px-3 py-1.5 mx-4 mt-2 max-w-[92%]"
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        cefrLevel !== undefined
          ? `Session goal: ${goal}. Level ${cefrLevel}.`
          : `Session goal: ${goal}.`
      }
    >
      <Icon name="target" size={12} color={Colors.accent} />
      <Text
        className="text-[12px] text-white/[0.75] ml-1.5 flex-shrink"
        numberOfLines={1}
        // The parent announces the full label; children are decorative.
        // Review R1: leaf Text nodes need accessible={false} + "no" — the
        // "no-hide-descendants" value is a TalkBack no-op on leaves (the
        // exact Story 12-8 R2-P4 anti-pattern).
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {goal}
      </Text>
      {cefrLevel !== undefined && (
        <View className="bg-accent/25 rounded-full px-2 py-0.5 ml-2">
          <Text
            className="text-[10px] font-bold"
            style={{ color: Colors.accent }}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {cefrLevel}
          </Text>
        </View>
      )}
    </View>
  );
});
SessionGoalChip.displayName = "SessionGoalChip";
