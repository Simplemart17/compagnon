import { Stack } from "expo-router";

export default function ConversationLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#F5F5F0" },
        headerTintColor: "#1E3A5F",
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
