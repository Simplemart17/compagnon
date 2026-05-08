import { useEffect, useRef, useState } from "react";
import { LogBox, Pressable, Text, View } from "react-native";
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
import { Colors, Radii, Spacing, Typography } from "@/src/lib/design";
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
  const { session, user, profile, isLoading, isOnboarded, profileFetchFailed, retryProfileFetch } =
    useAuth();
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

    // Story 9-10 AC #3: hold the splash on the retry surface — do NOT route
    // to onboarding when the profile failed to load (offline + corrupted
    // cache). `isOnboarded` defaults to false when `profile` is null, which
    // would otherwise misroute an already-onboarded user into the wizard.
    // P9 (9-10 review): include `!inAuthGroup` per spec — a user on
    // `(auth)/login` with a session and a stale failure flag should still be
    // redirected to home by the routing logic below, not pinned on the
    // retry surface.
    if (session && !profile && profileFetchFailed && !inAuthGroup) return;

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && !isOnboarded && !inOnboarding) {
      router.replace("/onboarding");
    } else if (session && isOnboarded && (inAuthGroup || inOnboarding)) {
      router.replace("/(tabs)/home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isLoading, isOnboarded, profile, profileFetchFailed, segments]);

  if (isLoading) {
    return null;
  }

  // Story 9-10 AC #3: profile fetch failed (offline + corrupted cache).
  // Render a retry surface instead of letting the auth guard misroute the
  // user to onboarding. The CTA wraps `retryProfileFetch` (a flush-skipping
  // re-invocation of `loadProfile`).
  // P9 (9-10 review): exclude the `(auth)` group so a user on login/signup
  // with a stale flag is not pinned here — the routing useEffect lets them
  // proceed to home as soon as the auth group hands them off.
  // P7 (9-10 review): wrap in `AppErrorBoundary` so a render error in the
  // retry surface cannot crash the app uncaught.
  const inAuthGroupRender = segments[0] === "(auth)";
  if (session && !profile && profileFetchFailed && !inAuthGroupRender) {
    return (
      <AppErrorBoundary>
        <ProfileRetryScreen onRetry={retryProfileFetch} />
      </AppErrorBoundary>
    );
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

/**
 * Retry surface shown when both network and cache reads fail during profile
 * load (story 9-10, AC #3). Holds the user on a recovery screen with an
 * explicit retry CTA instead of allowing the auth guard to misroute an
 * already-onboarded user into the onboarding wizard.
 *
 * The button is disabled while a retry is in flight to avoid spamming
 * `loadProfile`. Successful retries clear `profileFetchFailed` upstream and
 * the auth guard takes over.
 */
function ProfileRetryScreen({ onRetry }: { onRetry: () => Promise<void> }) {
  const [isRetrying, setIsRetrying] = useState(false);
  // P6 (9-10 review): synchronous gate against double-tap. `isRetrying`
  // state is async-batched by React, so two synchronous taps before the
  // next commit can both pass an `if (isRetrying) return` check that reads
  // the closure's pre-set value. The ref is mutated synchronously inside
  // `handleRetry` and reset in `finally` so a second tap during the retry
  // is dropped.
  const retryingRef = useRef(false);

  async function handleRetry() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: Colors.bgDark,
        alignItems: "center",
        justifyContent: "center",
        padding: Spacing.screenPaddingLarge,
      }}
    >
      <View
        style={{
          backgroundColor: Colors.error,
          borderRadius: Radii.card,
          padding: Spacing.cardPadding,
          marginBottom: Spacing.sectionGapLarge,
          maxWidth: 360,
        }}
      >
        <Text style={[Typography.body, { color: Colors.textOnDark, textAlign: "center" }]}>
          Profile unavailable. Check your connection and try again.
        </Text>
      </View>
      <Pressable
        onPress={handleRetry}
        disabled={isRetrying}
        accessibilityRole="button"
        accessibilityLabel="Retry profile load"
        accessibilityHint="Tries to load your profile again. Requires network connection."
        accessibilityState={{ disabled: isRetrying }}
        style={{
          minWidth: 120,
          minHeight: 44,
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: Radii.button,
          backgroundColor: Colors.accent,
          alignItems: "center",
          justifyContent: "center",
          opacity: isRetrying ? 0.6 : 1,
        }}
      >
        <Text style={[Typography.label, { color: Colors.textPrimary }]}>
          {isRetrying ? "Retrying…" : "Retry"}
        </Text>
      </Pressable>
    </View>
  );
}

// Sentry.wrap() is required for React Native to capture unhandled JS errors,
// native crashes, and enable performance monitoring.
export default Sentry.wrap(RootLayoutNav);
