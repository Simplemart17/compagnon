import { Stack } from "expo-router";

import { Colors } from "@/src/lib/design";

export default function PracticeLayout() {
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
      <Stack.Screen name="listening" options={{ title: "Listening" }} />
      <Stack.Screen name="reading" options={{ title: "Reading" }} />
      <Stack.Screen name="writing" options={{ title: "Writing" }} />
      <Stack.Screen name="grammar" options={{ title: "Grammar" }} />
      <Stack.Screen name="vocabulary" options={{ title: "Vocabulary" }} />
      <Stack.Screen name="pronunciation" options={{ title: "Pronunciation" }} />
      <Stack.Screen name="dictation" options={{ title: "Dictation" }} />
      <Stack.Screen name="echo" options={{ title: "Echo Practice" }} />
    </Stack>
  );
}
