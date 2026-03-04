import { Link, Stack } from "expo-router";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Page Not Found" }} />
      <SafeAreaView className="flex-1 items-center justify-center bg-surface p-5">
        <Text className="text-xl font-bold text-primary">This screen doesn&apos;t exist.</Text>
        <Link
          href="/"
          className="mt-4 py-4"
          accessibilityRole="link"
          accessibilityLabel="Go to home screen"
        >
          <Text className="text-sm text-primary">Go to home screen</Text>
        </Link>
      </SafeAreaView>
    </>
  );
}
