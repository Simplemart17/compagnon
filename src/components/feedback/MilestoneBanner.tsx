import React, { useEffect } from "react";
import { Text } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Colors, Typography, Radii, skillTint } from "@/src/lib/design";
import { hapticSuccess } from "@/src/lib/haptics";

export type MilestoneType = "personal_best" | "error_resolved" | "cefr_promotion";

export interface MilestoneBannerProps {
  icon: string;
  title: string;
  subtitle: string;
  type: MilestoneType;
}

function tintColor(type: MilestoneType): string {
  return type === "cefr_promotion" ? Colors.accent : Colors.success;
}

function MilestoneBannerInner({ icon, title, subtitle, type }: MilestoneBannerProps) {
  useEffect(() => {
    hapticSuccess();
  }, []);

  const color = tintColor(type);

  return (
    <Animated.View
      entering={FadeInDown.springify()}
      accessibilityRole="alert"
      accessibilityLabel={`Milestone: ${title}. ${subtitle}`}
      style={{
        backgroundColor: skillTint(color, 0.08),
        borderRadius: Radii.button,
        paddingVertical: 10,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Animated.View style={{ flex: 1 }}>
        <Text style={[Typography.label, { color }]}>{title}</Text>
        <Text style={[Typography.caption, { color, marginTop: 2 }]}>{subtitle}</Text>
      </Animated.View>
    </Animated.View>
  );
}

export const MilestoneBanner = React.memo(MilestoneBannerInner);
