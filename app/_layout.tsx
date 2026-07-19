import { useEffect, useRef, useState } from "react";
import { LogBox, Pressable, Text, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import * as Notifications from "expo-notifications";
import "react-native-reanimated";

import "@/src/styles/global.css";
import { useAuth } from "@/src/hooks/use-auth";
import { bootstrapAuth } from "@/src/lib/auth-bootstrap";
import {
  registerForPushNotifications,
  setupNotificationResponseListener,
} from "@/src/hooks/use-notifications";
import { Colors, Radii, Spacing, Typography } from "@/src/lib/design";
import { isEmailVerified } from "@/src/lib/email-verification";
import { ANALYTICS_EVENTS, identifyUser, resetAnalytics, trackEvent } from "@/src/lib/analytics";
import { captureError, getSentryInitConfig } from "@/src/lib/sentry";
import { EmailVerificationGate } from "@/src/components/auth/EmailVerificationGate";
import { AnimatedSplash } from "@/src/components/common/AnimatedSplash";
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
//
// **Load-bearing ordering (Story 12-2 review-round-1 P15):** `Sentry.init`
// MUST precede `bootstrapAuth()` because the bootstrap routes errors
// through `captureError(_, "auth-initial-session")` etc. — calling it
// before Sentry is initialized would no-op those captures.
Sentry.init(getSentryInitConfig());

// Story 12-2: install the auth listener + cold-start getSession ONCE per app
// lifetime at JS-bundle parse time, before any React render. Idempotent —
// the bootstrap module's `bootstrapState` one-call guard ensures only one
// `onAuthStateChange` subscription exists regardless of how many `useAuth()`
// consumers mount. Pre-12-2 each consumer installed its own listener inside
// `useEffect`. See `src/lib/auth-bootstrap.ts`.
//
// **Jest guard (review-round-1 P3):** skip the module-load call when running
// under Jest. Tests that import this module transitively would otherwise
// execute the real supabase client's `onAuthStateChange` at module-parse
// time, before any per-test `jest.mock` factories install. Production
// builds (where `JEST_WORKER_ID` is unset) call `bootstrapAuth()` normally.
if (typeof process === "undefined" || !process.env.JEST_WORKER_ID) {
  bootstrapAuth();
}

function RootLayoutNav() {
  const {
    session,
    user,
    profile,
    isLoading,
    isOnboarded,
    profileFetchFailed,
    refreshSessionAfterVerification,
    resendVerificationEmail,
    retryProfileFetch,
    signOut,
  } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const hasRegisteredNotifications = useRef(false);
  // When `false`, `AnimatedSplash` is overlaid on top of the route Stack
  // playing its entry → settle → exit animation. It calls `onDismiss` after
  // ~1.4s, at which point this flips to true and the splash unmounts so
  // the user can interact with the route below.
  //
  // The native `expo-splash-screen` is dismissed from INSIDE `AnimatedSplash`
  // (on its first paint) so the static→animated handoff is frame-perfect.
  const [animatedSplashDone, setAnimatedSplashDone] = useState(false);

  // Register for push notifications once per app launch when authenticated
  // AND email-verified. Reset the guard on sign-out OR when verification
  // is revoked so a re-verified session re-registers cleanly.
  //
  // Story 12-9 — verification guard: an unverified session must NOT
  // pre-register a push token. Otherwise an attacker who signs up + abandons
  // leaves a token attached to the abandoned UID, polluting the
  // `device_tokens` table with rows that will never receive notifications.
  // The dep array includes `user` so the effect re-fires when
  // `email_confirmed_at` flips from undefined → ISO timestamp after the
  // user clicks the verification link and the listener propagates the
  // refreshed session to the store.
  //
  // Review-round-1 H2 patch: the reset branch now ALSO fires when the
  // session is present but `!isEmailVerified(user)` (admin-driven revoke
  // OR `USER_UPDATED` that flips email_confirmed_at set → unset). Without
  // this, a subsequent re-verify cycle would leave `hasRegisteredNotifications.current`
  // stuck at `true` and the push token would never re-register after the
  // device-token rotation.
  // Story 21-2: analytics identity lifecycle — opaque UUID only (privacy
  // contract in src/lib/analytics.ts). Reset on sign-out so a next user on
  // the same device never inherits the identity.
  const hasTrackedAppOpen = useRef(false);
  useEffect(() => {
    if (!hasTrackedAppOpen.current) {
      hasTrackedAppOpen.current = true;
      trackEvent(ANALYTICS_EVENTS.APP_OPENED);
    }
  }, []);
  useEffect(() => {
    if (user?.id) {
      identifyUser(user.id);
    } else {
      resetAnalytics();
    }
  }, [user?.id]);

  useEffect(() => {
    if (session && !hasRegisteredNotifications.current && isEmailVerified(user)) {
      hasRegisteredNotifications.current = true;
      registerForPushNotifications().catch((err) => {
        captureError(err, "notification-registration");
      });
    }
    // H2: reset on sign-out OR on verification revocation.
    if (!session || !isEmailVerified(user)) {
      hasRegisteredNotifications.current = false;
    }
  }, [session, user]);

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
    // Story 14-6: post-onboarding tour route — onboarded users can navigate
    // here from the onboarding-finish handlers without being bounced back to
    // home by the `isOnboarded && inOnboarding → home` redirect below.
    // `segments[1]` is typed as `"placement-test" | undefined` by Expo Router's
    // typed-routes generator — the `tour` literal isn't in the union until typed
    // routes regenerate. Widening via `String(...)` keeps the comparison
    // type-safe + survives the next typed-routes regeneration cleanly.
    const inTour = inOnboarding && String((segments as readonly string[])[1]) === "tour";

    // Story 12-9: unverified-but-session-bearing users must NOT be routed
    // into onboarding or the tabs. The render-branch below shows the gate.
    // This guard runs UPSTREAM of the 9-10 ProfileRetryScreen guard by
    // deliberate placement — an unverified user shouldn't have reached
    // profile-load. Reading `user.email_confirmed_at` directly keeps
    // Supabase as the single source of truth (server-authoritative; no
    // client-cached flag that could be tampered with).
    //
    // Review-round-1 M7 patch: moved ABOVE the 9-10 ProfileRetryScreen
    // guard so the routing-effect order matches the render-branch order
    // (verification fires UPSTREAM in BOTH dimensions). Pre-patch, both
    // guards `return;`-early so the functional outcome was identical, but
    // a future refactor that adds logic between them would silently break
    // the "verification UPSTREAM" claim.
    if (session && !isEmailVerified(user) && !inAuthGroup) return;

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
    } else if (session && isOnboarded && (inAuthGroup || (inOnboarding && !inTour))) {
      // Story 14-6 carve-out: `!inTour` lets the post-onboarding tour render
      // for onboarded users (route accessed via `router.replace("/onboarding/tour")`
      // from onboarding/index.tsx + placement-test.tsx handlers).
      router.replace("/(tabs)/home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, user, isLoading, isOnboarded, profile, profileFetchFailed, segments]);

  if (isLoading) {
    return null;
  }

  // Render-branch ordering (Story 12-9):
  //   isLoading (returns null above) →
  //   EmailVerificationGate (Story 12-9) →
  //   ProfileRetryScreen (Story 9-10) →
  //   main app
  //
  // The verification gate fires UPSTREAM of profile-retry by deliberate
  // placement — an unverified user shouldn't have reached profile-load.
  const inAuthGroupRender = segments[0] === "(auth)";

  // Story 12-9: render the email-verification gate when the session exists
  // but `user.email_confirmed_at` is unset. Wrapped in `AppErrorBoundary`
  // so a render error inside the gate cannot crash the app uncaught
  // (Story 9-10 P7 pattern, applied here as well).
  if (session && !isEmailVerified(user) && !inAuthGroupRender) {
    return (
      <AppErrorBoundary>
        <EmailVerificationGate
          userEmail={user?.email}
          onResendVerification={resendVerificationEmail}
          onSignOut={signOut}
          onRefreshSession={refreshSessionAfterVerification}
        />
      </AppErrorBoundary>
    );
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
          {/* Animated splash overlay — hides the native splash on first
              paint, plays entry → settle → exit, then unmounts. Sits above
              every route at zIndex 9999 (defined inside the component). */}
          {!animatedSplashDone && <AnimatedSplash onDismiss={() => setAnimatedSplashDone(true)} />}
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
