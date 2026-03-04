import { Stack } from "expo-router";

export default function PracticeLayout() {
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
      <Stack.Screen name="listening" options={{ title: "Listening" }} />
      <Stack.Screen name="reading" options={{ title: "Reading" }} />
      <Stack.Screen name="writing" options={{ title: "Writing" }} />
      <Stack.Screen name="grammar" options={{ title: "Grammar" }} />
      <Stack.Screen name="vocabulary" options={{ title: "Vocabulary" }} />
      <Stack.Screen name="pronunciation" options={{ title: "Pronunciation" }} />
      <Stack.Screen name="dictation" options={{ title: "Dictation" }} />
    </Stack>
  );
}
