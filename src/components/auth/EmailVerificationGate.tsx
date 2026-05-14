/**
 * Email Verification Gate (Story 12-9).
 *
 * Render-branch component shown by `app/_layout.tsx` when a session exists
 * but `user.email_confirmed_at` is unset. Closes audit P1-15.
 *
 * Renders a French recovery surface with three buttons:
 *   - "Renvoyer l'e-mail" — calls `onResendVerification(email)`; cooldown
 *     locked for 60s after a successful send (mirrors Supabase's
 *     server-side rate-limit; pure helpers in
 *     `src/lib/email-verification.ts`).
 *   - "J'ai vérifié — actualiser" — calls `onRefreshSession()` to pull a
 *     fresh `user` shape from Supabase after the user clicks the email
 *     link. The auth listener (Story 9-6 / 12-2) re-renders the gate
 *     against the post-refresh `user.email_confirmed_at`; on success the
 *     auth-guard falls through to the routing arms.
 *   - "Se déconnecter" — sign-out escape hatch so the user can switch
 *     accounts without being trapped on the gate.
 *
 * Render-branch ordering inside `RootLayoutNav`:
 *   isLoading → EmailVerificationGate (12-9) → ProfileRetryScreen (9-10) → main
 *
 * Cross-story invariants preserved by construction:
 *   - Story 9-3 Sentry: ONE new feature tag string
 *     `"email-verification-resend"` (resend error) + ONE new feature tag
 *     `"email-verification-refresh"` (refresh error — review-round-1 H1)
 *     + ONE new feature tag `"email-verification-signout"` (sign-out
 *     error — review-round-1 L1) + ONE info-level breadcrumb
 *     `feature: "email-verification-gate"` (gate-shown, fires once per
 *     SESSION — module-level guard, review-round-1 M2). The email is
 *     NEVER passed to `captureError` extras (drift-pinned in
 *     `email-verification-source-drift.test.ts` against BOTH `_layout.tsx`
 *     AND this file — review-round-1 M5).
 *   - Story 9-10 ProfileRetryScreen: the synchronous double-tap guard
 *     pattern (`useRef`-mutated-inside-handler + reset-in-finally) is
 *     applied to ALL THREE buttons (resend, refresh, signout) post-
 *     review-round-1 (H1 + L1).
 *
 * Note on Sentry breadcrumb `data`: per Story 9-3 contract, breadcrumb
 * `data` payloads are NOT scrubbed by `scrubEvent` (the scrubber operates
 * on event `extras`, not breadcrumb `data`). Only categorical short
 * strings may appear in `data` — NEVER user-derived content (emails,
 * names, transcripts, etc.). (Review-round-1 L10.)
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { useAuthStore } from "@/src/store/auth-store";
import { Colors, Radii, Spacing, Typography } from "@/src/lib/design";
import {
  canResendNow,
  formatVerificationEmailMask,
  isEmailVerified,
  secondsUntilResend,
} from "@/src/lib/email-verification";
import { addBreadcrumb, captureError } from "@/src/lib/sentry";

/**
 * Module-level guard so the gate-shown breadcrumb fires at most once per
 * SESSION (keyed by `user.id`), not once per gate-mount.
 *
 * Review-round-1 M2 patch: pre-patch the guard was an instance-scoped
 * `useRef` which resets on every remount (HMR / error-boundary recovery /
 * route changes / session re-evaluation). Operators measuring "unique
 * users hitting the gate" via raw breadcrumb count would overcount 2-10×.
 * Post-patch the Set keyed by `user.id` survives remounts within the
 * same session — matches the Story 12-3 `lastSkippedBreadcrumb` precedent
 * (also a module-level Map).
 *
 * Cleared on sign-out via `__resetGateBreadcrumbForTests` (test-only) so
 * tests don't leak state across cases; production callers rely on the
 * natural cold-start reset.
 */
const breadcrumbFiredForUsers = new Set<string>();

/** @internal — test-only escape hatch (Story 12-2 P11 pattern). */
export function __resetGateBreadcrumbForTests(): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
    throw new Error(
      "__resetGateBreadcrumbForTests must only be called from tests (NODE_ENV must be 'test')"
    );
  }
  breadcrumbFiredForUsers.clear();
}

interface EmailVerificationGateProps {
  userEmail: string | undefined;
  onResendVerification: (email: string) => Promise<{ error: unknown }>;
  onSignOut: () => Promise<{ error: unknown } | void>;
  onRefreshSession: () => Promise<{ error: unknown }>;
}

function EmailVerificationGateImpl({
  userEmail,
  onResendVerification,
  onSignOut,
  onRefreshSession,
}: EmailVerificationGateProps) {
  const [lastResendAtMs, setLastResendAtMs] = useState<number | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const resendingRef = useRef(false);
  const refreshingRef = useRef(false); // review-round-1 H1 patch
  const signingOutRef = useRef(false); // review-round-1 L1 patch
  const mountedRef = useRef(true);

  // Tick once per second while the cooldown is active so the countdown UI
  // updates. Review-round-1 L2 patch: dep array is now `[lastResendAtMs]`
  // (NOT `[lastResendAtMs, now]`) so the interval is created ONCE per
  // cooldown engagement instead of recreated every tick (60 alloc/free
  // cycles per cooldown). The interval's callback reads `Date.now()`
  // directly + writes to `setNow`; the next render reads the updated
  // `now`, but the interval handle persists.
  useEffect(() => {
    if (lastResendAtMs === null) return;
    if (canResendNow(lastResendAtMs, Date.now())) return;
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const nowMs = Date.now();
      setNow(nowMs);
      // Self-stop when the cooldown has elapsed — the next render won't
      // engage a new interval (the effect short-circuits above), and the
      // cleanup below clears this one.
      if (canResendNow(lastResendAtMs, nowMs)) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastResendAtMs]);

  // Mounted-ref lifecycle tracking — defends against any async callback
  // that resolves after unmount (resend, refresh, signout) attempting to
  // call setState. The interval cleanup above is the primary defense;
  // this is the belt-and-suspenders layer for the button handlers.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset the resend cooldown when the user identity changes (e.g., sign
  // out + sign in as different user on the same device). The component
  // typically remounts in that case, but if it doesn't (depending on
  // React reconciler keys), this ensures user B doesn't inherit user A's
  // cooldown timer.
  useEffect(() => {
    setLastResendAtMs(null);
    setIsResending(false);
    setIsRefreshing(false);
    setIsSigningOut(false);
    resendingRef.current = false;
    refreshingRef.current = false;
    signingOutRef.current = false;
  }, [userEmail]);

  // Fire the gate-shown breadcrumb exactly once per SESSION (review-round-1
  // M2: module-level guard keyed by user.id, NOT instance-scoped useRef).
  useEffect(() => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    if (breadcrumbFiredForUsers.has(userId)) return;
    breadcrumbFiredForUsers.add(userId);
    addBreadcrumb({
      category: "auth",
      level: "info",
      message: "Email verification gate shown",
      data: { feature: "email-verification-gate" },
    });
  }, []);

  const handleResend = useCallback(async () => {
    // Synchronous double-tap guard (Story 9-10 ProfileRetryScreen pattern):
    // setState batches, but useRef mutates synchronously.
    if (resendingRef.current) return;
    if (!canResendNow(lastResendAtMs, Date.now())) return;
    if (!userEmail) return;
    resendingRef.current = true;
    setIsResending(true);
    try {
      const { error } = await onResendVerification(userEmail);
      if (!mountedRef.current) return;
      if (error) {
        // Story 9-3: feature tag is allowlisted; the email is NEVER passed
        // as an extra. Sentry's view of the failure is the error object +
        // the categorical `feature` tag — nothing else.
        captureError(error, "email-verification-resend");
        Alert.alert(
          "Erreur",
          "Impossible d'envoyer l'e-mail de vérification. Veuillez réessayer dans une minute."
        );
        return;
      }
      const nowMs = Date.now();
      setLastResendAtMs(nowMs);
      setNow(nowMs);
    } finally {
      resendingRef.current = false;
      if (mountedRef.current) setIsResending(false);
    }
  }, [lastResendAtMs, onResendVerification, userEmail]);

  /**
   * Review-round-1 H1 patch — three intersecting defects on this handler:
   *   (a) Pre-patch `disabled={isRefreshing}` relied on batched setState
   *       so two synchronous taps both dispatched `refreshSession`.
   *       Server-side rate-limit (10/hr default) could lock the user out.
   *   (b) Pre-patch `onRefreshSession` had no try/catch and was typed
   *       `Promise<void>` — a rejection became unhandled and the user
   *       got zero feedback.
   *   (c) Pre-patch a successful refresh that returned a session WITH
   *       `email_confirmed_at` still unset was treated as success — the
   *       spinner toggled, nothing changed, and the user had no signal
   *       that they hadn't actually verified yet.
   *
   * Post-patch:
   *   (a) `refreshingRef` synchronous guard mirrors `resendingRef`.
   *   (b) `onRefreshSession` returns `{error}` (auth-bootstrap.ts H1
   *       patch); error → captureError + French Alert.
   *   (c) After success, re-read `useAuthStore.getState().user?.email_confirmed_at`;
   *       if still unset, show a French Alert ("not yet confirmed —
   *       check the link in your inbox").
   */
  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const { error } = await onRefreshSession();
      if (!mountedRef.current) return;
      if (error) {
        captureError(error, "email-verification-refresh");
        Alert.alert(
          "Erreur",
          "Impossible d'actualiser votre session. Vérifiez votre connexion et réessayez."
        );
        return;
      }
      // Post-refresh re-check: did `email_confirmed_at` actually flip?
      // If not, the user tapped "I've verified" before clicking the email
      // link (or before propagation). Surface the gap explicitly.
      const refreshedUser = useAuthStore.getState().user;
      if (!isEmailVerified(refreshedUser)) {
        Alert.alert(
          "Vérification non confirmée",
          "Assurez-vous d'avoir cliqué sur le lien dans votre e-mail, puis réessayez."
        );
      }
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [onRefreshSession]);

  /**
   * Review-round-1 L1 patch — pre-patch handleSignOut had no in-flight
   * guard and no error handling. Multiple taps dispatched concurrent
   * `supabase.auth.signOut()` calls; failures left the user stranded
   * with no feedback.
   */
  const handleSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setIsSigningOut(true);
    try {
      const result = await onSignOut();
      if (!mountedRef.current) return;
      // `onSignOut` is typed `Promise<{error: unknown} | void>` — when it
      // resolves with an `{error}` object AND `error` is truthy, surface.
      if (result && typeof result === "object" && "error" in result && result.error) {
        captureError(result.error, "email-verification-signout");
        Alert.alert(
          "Erreur",
          "Impossible de vous déconnecter. Vérifiez votre connexion et réessayez."
        );
      }
    } finally {
      signingOutRef.current = false;
      if (mountedRef.current) setIsSigningOut(false);
    }
  }, [onSignOut]);

  // Review-round-1 M3 patch: when `userEmail` is undefined the resend
  // button must show a distinct label (not "Renvoyer dans 0s"-forever).
  const hasEmail = !!userEmail;
  const canResend = canResendNow(lastResendAtMs, now) && !isResending && hasEmail;
  const remainingSeconds = secondsUntilResend(lastResendAtMs, now);
  const maskedEmail = formatVerificationEmailMask(userEmail);

  const resendLabel = !hasEmail
    ? "Adresse e-mail manquante"
    : isResending
      ? "Envoi en cours…"
      : canResendNow(lastResendAtMs, now)
        ? "Renvoyer l'e-mail"
        : `Renvoyer dans ${remainingSeconds}s`;

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
          backgroundColor: Colors.surfaceWhite,
          borderRadius: Radii.card,
          padding: Spacing.cardPadding,
          maxWidth: 360,
          width: "100%",
        }}
      >
        <Text
          style={[
            Typography.cardTitle,
            { color: Colors.textPrimary, textAlign: "center", marginBottom: Spacing.sectionGap },
          ]}
        >
          Vérifiez votre adresse e-mail
        </Text>

        <Text
          style={[
            Typography.body,
            {
              color: Colors.textSecondary,
              textAlign: "center",
              marginBottom: Spacing.sectionGapLarge,
            },
          ]}
        >
          Nous avons envoyé un lien de vérification à {maskedEmail}. Cliquez sur le lien dans
          l&apos;e-mail pour activer votre compte.
        </Text>

        <Pressable
          onPress={handleRefresh}
          disabled={isRefreshing}
          accessibilityRole="button"
          accessibilityLabel="I've verified my email — refresh"
          accessibilityHint="Checks if you've verified your email. Tap after clicking the link in your inbox."
          accessibilityState={{ disabled: isRefreshing, busy: isRefreshing }}
          style={{
            minWidth: 120,
            minHeight: 44,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: Radii.button,
            backgroundColor: Colors.accent,
            alignItems: "center",
            justifyContent: "center",
            opacity: isRefreshing ? 0.6 : 1,
            marginBottom: Spacing.sectionGap,
          }}
        >
          <Text style={[Typography.label, { color: Colors.textPrimary }]}>
            {isRefreshing ? "Actualisation…" : "J'ai vérifié — actualiser"}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleResend}
          disabled={!canResend}
          accessibilityRole="button"
          accessibilityLabel="Resend verification email"
          accessibilityHint="Sends a fresh verification email to your address. Disabled for 60s after each send."
          accessibilityState={{ disabled: !canResend, busy: isResending }}
          style={{
            minWidth: 120,
            minHeight: 44,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: Radii.button,
            borderWidth: 1.5,
            borderColor: Colors.accent,
            backgroundColor: Colors.surfaceWhite,
            alignItems: "center",
            justifyContent: "center",
            opacity: canResend ? 1 : 0.5,
            marginBottom: Spacing.sectionGap,
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={[Typography.label, { color: Colors.textPrimary }]}
          >
            {resendLabel}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityHint="Signs you out and returns to the login screen so you can use a different account."
          accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
          style={{
            minWidth: 120,
            minHeight: 44,
            paddingHorizontal: 24,
            paddingVertical: 12,
            alignItems: "center",
            justifyContent: "center",
            opacity: isSigningOut ? 0.6 : 1,
          }}
        >
          <Text style={[Typography.caption, { color: Colors.textSecondary }]}>
            {isSigningOut ? "Déconnexion…" : "Se déconnecter"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export const EmailVerificationGate = memo(EmailVerificationGateImpl);
