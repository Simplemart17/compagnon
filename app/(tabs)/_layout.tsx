import React from "react";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

import { Colors, Typography } from "@/src/lib/design";
import { useTabBadges } from "@/src/hooks/use-tab-badges";

const TAB_ACTIVE_COLOR = Colors.primary;
const TAB_INACTIVE_COLOR = Colors.textTertiary;

const badgeStyle = {
  backgroundColor: Colors.accent,
  fontSize: Typography.tiny.fontSize,
  fontWeight: "700" as const,
};

export default function TabLayout() {
  const { practiceBadge, talkBadge } = useTabBadges();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: TAB_ACTIVE_COLOR,
        tabBarInactiveTintColor: TAB_INACTIVE_COLOR,
        tabBarStyle: {
          backgroundColor: Colors.surfaceWhite,
          borderTopColor: Colors.border,
          paddingBottom: 4,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: Typography.label.fontSize,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: Colors.primary,
        },
        headerTintColor: Colors.textOnDark,
        headerTitleStyle: {
          fontWeight: "700",
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerTitle: "Companion",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "house.fill", android: "home", web: "home" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="conversation"
        options={{
          title: "Talk",
          headerTitle: "Conversation",
          tabBarBadge: talkBadge ? "" : undefined,
          tabBarBadgeStyle: talkBadge ? badgeStyle : undefined,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "bubble.left.and.bubble.right.fill",
                android: "chat",
                web: "chat",
              }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{
          title: "Practice",
          headerShown: false,
          tabBarBadge: practiceBadge ?? undefined,
          tabBarBadgeStyle: practiceBadge ? badgeStyle : undefined,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "book.fill", android: "book", web: "book" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="mock-test"
        options={{
          title: "TCF Test",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "checkmark.seal.fill",
                android: "verified",
                web: "verified",
              }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "person.fill", android: "person", web: "person" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
