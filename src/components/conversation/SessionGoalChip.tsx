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
  cefrLevel: CEFRLevel;
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
      accessibilityLabel={`Session goal: ${goal}. Level ${cefrLevel}.`}
    >
      <Icon name="target" size={12} color={Colors.accent} />
      <Text
        className="text-[12px] text-white/[0.75] ml-1.5 flex-shrink"
        numberOfLines={1}
        // The parent announces the full label; children are decorative.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {goal}
      </Text>
      <View className="bg-accent/25 rounded-full px-2 py-0.5 ml-2">
        <Text
          className="text-[10px] font-bold"
          style={{ color: Colors.accent }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {cefrLevel}
        </Text>
      </View>
    </View>
  );
});
SessionGoalChip.displayName = "SessionGoalChip";
