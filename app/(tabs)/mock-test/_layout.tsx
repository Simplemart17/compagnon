import { Stack } from "expo-router";

import { Colors } from "@/src/lib/design";

export default function MockTestLayout() {
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
      <Stack.Screen name="speaking" options={{ title: "Speaking Test", headerShown: false }} />
      <Stack.Screen name="[testId]" options={{ title: "Test in Progress", headerShown: false }} />
      <Stack.Screen name="results" options={{ title: "Results" }} />
    </Stack>
  );
}
