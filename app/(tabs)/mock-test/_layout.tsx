import { Stack } from "expo-router";

export default function MockTestLayout() {
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
      <Stack.Screen name="[testId]" options={{ title: "Test in Progress", headerShown: false }} />
      <Stack.Screen name="results" options={{ title: "Results" }} />
    </Stack>
  );
}
