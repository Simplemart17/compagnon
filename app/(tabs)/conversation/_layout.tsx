import { Stack } from "expo-router";

import { Colors } from "@/src/lib/design";

export default function ConversationLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="history" options={{ title: "History" }} />
      <Stack.Screen name="[sessionId]" options={{ title: "Voice Session", headerShown: false }} />
    </Stack>
  );
}
