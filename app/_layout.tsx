import { useEffect, useRef } from "react";
import { LogBox, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import * as Notifications from "expo-notifications";
import "react-native-reanimated";

import "@/src/styles/global.css";
import { useAuth } from "@/src/hooks/use-auth";
import {
  registerForPushNotifications,
  setupNotificationResponseListener,
} from "@/src/hooks/use-notifications";
import { captureError, getSentryInitConfig } from "@/src/lib/sentry";
import { NetworkBanner } from "@/src/components/common/NetworkBanner";
import { ErrorBoundary as AppErrorBoundary } from "@/src/components/common/ErrorBoundary";
import { ToastProvider } from "@/src/components/common/Toast/ToastContext";
import { ToastContainer } from "@/src/components/common/Toast/ToastContainer";

// Suppress deprecation warning from third-party dependencies using RN's built-in SafeAreaView
LogBox.ignoreLogs(["SafeAreaView has been deprecated"]);

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();

// Configure foreground notification display behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Initialize Sentry as early as possible — before any component renders.
// DSN is read from EXPO_PUBLIC_SENTRY_DSN; if absent, Sentry is a no-op.
// Config is owned by src/lib/sentry.ts and snapshot-tested for privacy posture.
Sentry.init(getSentryInitConfig());

function RootLayoutNav() {
  const { session, user, isLoading, isOnboarded } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const hasRegisteredNotifications = useRef(false);

  useEffect(() => {
    if (!isLoading) {
      void SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Register for push notifications once per app launch when authenticated.
  // Reset the guard on sign-out so a new user can register their token.
  useEffect(() => {
    if (session && !hasRegisteredNotifications.current) {
      hasRegisteredNotifications.current = true;
      registerForPushNotifications().catch((err) => {
        captureError(err, "notification-registration");
      });
    }
    if (!session) {
      hasRegisteredNotifications.current = false;
    }
  }, [session]);

  // Deep link handler for notification taps — single listener at root level
  useEffect(() => {
    const subscription = setupNotificationResponseListener((path) => {
      // Only navigate if user has an active session
      if (session) {
        router.replace(path as never);
      }
    });
    return () => subscription.remove();
  }, [session, router]);

  // Identify user in Sentry for error attribution
  useEffect(() => {
    if (user) {
      // GDPR: user.id is opaque (auth.uid()); never send email — it's a direct identifier.
      Sentry.setUser({ id: user.id });
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
      <ToastProvider>
        <View className="flex-1">
          <NetworkBanner />
          <ToastContainer />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </ToastProvider>
    </AppErrorBoundary>
  );
}

// Sentry.wrap() is required for React Native to capture unhandled JS errors,
// native crashes, and enable performance monitoring.
export default Sentry.wrap(RootLayoutNav);
