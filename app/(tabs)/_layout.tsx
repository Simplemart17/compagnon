import React from "react";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

const TAB_ACTIVE_COLOR = "#1E3A5F";
const TAB_INACTIVE_COLOR = "#999999";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: TAB_ACTIVE_COLOR,
        tabBarInactiveTintColor: TAB_INACTIVE_COLOR,
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E0E0CE",
          paddingBottom: 4,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: "#1E3A5F",
        },
        headerTintColor: "#FFFFFF",
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
