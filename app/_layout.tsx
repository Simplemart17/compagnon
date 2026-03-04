import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";

import "react-native-reanimated";
import { useAuth } from "@/src/hooks/use-auth";
import { NetworkBanner } from "@/src/components/common/NetworkBanner";
import { ErrorBoundary as AppErrorBoundary } from "@/src/components/common/ErrorBoundary";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();

// Initialize Sentry as early as possible — before any component renders.
// DSN is read from EXPO_PUBLIC_SENTRY_DSN; if absent, Sentry is a no-op.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  // Capture 100% of transactions in dev, 10% in production to control volume
  tracesSampleRate: __DEV__ ? 1.0 : 0.1,
  // Enable all auto-instrumentation
  enableAutoSessionTracking: true,
  attachScreenshot: true,
  enableCaptureFailedRequests: true,
});

function RootLayoutNav() {
  const { session, user, isLoading, isOnboarded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      void SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Identify user in Sentry for error attribution
  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.email });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "onboarding";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && !isOnboarded && !inOnboarding) {
      router.replace("/onboarding");
    } else if (session && isOnboarded && (inAuthGroup || inOnboarding)) {
      router.replace("/(tabs)/home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isLoading, isOnboarded, segments]);

  if (isLoading) {
    return null;
  }

  return (
    <AppErrorBoundary>
      <View style={{ flex: 1 }}>
        <NetworkBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </View>
    </AppErrorBoundary>
  );
}

// Sentry.wrap() is required for React Native to capture unhandled JS errors,
// native crashes, and enable performance monitoring.
export default Sentry.wrap(RootLayoutNav);
