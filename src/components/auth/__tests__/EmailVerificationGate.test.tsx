/**
 * Story 12-9 — `EmailVerificationGate` runtime contract tests.
 *
 * Uses `react-test-renderer` + `jest.useFakeTimers()` (Story 12-1 P8
 * pattern) to verify the gate's button-dispatch, cooldown countdown,
 * accessibility-state, and Sentry-routing behavior without a native
 * runtime.
 *
 * Load-bearing assertions:
 *   (a) Masked email renders for `userEmail="alice@example.com"`.
 *   (b) French fallback `"votre adresse e-mail"` renders for undefined email.
 *   (c) Resend button dispatches `onResendVerification(email)` exactly
 *       once per tap; tap during cooldown is dropped (synchronous
 *       double-tap guard).
 *   (d) Post-resend cooldown: button is disabled + label shows
 *       `"Renvoyer dans Xs"` countdown.
 *   (e) After 60s (`jest.advanceTimersByTime`), button re-enables.
 *   (f) Resend error path: `captureError` is called with the
 *       `"email-verification-resend"` feature tag AND a French Alert
 *       fires AND the email is NOT in extras.
 *   (g) Refresh button dispatches `onRefreshSession` once.
 *   (h) Sign-out button dispatches `onSignOut` once.
 *   (i) Gate-shown breadcrumb (`feature: "email-verification-gate"`)
 *       fires exactly once per mount (not per render).
 *   (j) Unmount during cooldown does not crash (interval is cleared).
 */

import { Alert } from "react-native";
import { act, create } from "react-test-renderer";

import { useAuthStore } from "@/src/store/auth-store";
// Shared `MinimalTestInstance` from `@/src/test-utils/react-test-renderer`
// (Epic 13 retro AI #7). Pre-AI-#7 this file declared the type locally.
import type { MinimalTestInstance } from "@/src/test-utils/react-test-renderer";

import { EmailVerificationGate, __resetGateBreadcrumbForTests } from "../EmailVerificationGate";

// Spy on Alert.alert + Sentry helpers. The component imports these from
// `@/src/lib/sentry`, so jest.mock catches the actual call site.
const mockCaptureError = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock("@/src/lib/sentry", () => ({
  captureError: (...args: unknown[]) =>
    (mockCaptureError as unknown as (...a: unknown[]) => unknown)(...args),
  addBreadcrumb: (...args: unknown[]) =>
    (mockAddBreadcrumb as unknown as (...a: unknown[]) => unknown)(...args),
}));

const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

// Review-round-1 M2 patch: breadcrumb-fired-once is now keyed by user.id
// at module-level (not instance-scoped useRef). Tests need to seed the
// store with a user.id AND reset the module-level guard between cases.
function seedAuthStoreUser(userId: string, emailConfirmedAt: string | null = null): void {
  useAuthStore.setState({
    session: null,
    user: {
      id: userId,
      email: "alice@example.com",
      email_confirmed_at: emailConfirmedAt ?? undefined,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-05-14T00:00:00Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    profile: null,
    isLoading: false,
    isOnboarded: false,
    profileFetchFailed: false,
  });
}

// Helper: render the gate with default mock props (override per-test).
// Post-round-1: `onRefreshSession` now returns `{error}` (H1 patch); the
// auth store is seeded with a user.id so the M2 module-level breadcrumb
// guard has a key to record against.
function renderGate(overrides: Partial<Parameters<typeof EmailVerificationGate>[0]> = {}) {
  const onResendVerification = jest.fn(async () => ({ error: null as unknown }));
  const onSignOut = jest.fn(async () => ({ error: null as unknown }));
  const onRefreshSession = jest.fn(async () => ({ error: null as unknown }));
  const props = {
    userEmail: "alice@example.com",
    onResendVerification,
    onSignOut,
    onRefreshSession,
    ...overrides,
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<EmailVerificationGate {...props} />);
  });
  return { renderer, onResendVerification, onSignOut, onRefreshSession };
}

// Find the pressable React node by its accessibilityLabel + accessibilityRole.
// We anchor on `accessibilityRole === "button"` (rendered by Pressable's
// accessibility props) AND the unique `accessibilityLabel` so a future
// refactor that adds a non-button surface with the same label doesn't
// false-match.
function findPressableByLabel(
  renderer: ReturnType<typeof create>,
  label: string
): MinimalTestInstance {
  const root = renderer.root as {
    findAll: (pred: (node: MinimalTestInstance) => boolean) => MinimalTestInstance[];
  };
  const matches = root.findAll(
    (node: MinimalTestInstance) =>
      (node.props as { accessibilityLabel?: string }).accessibilityLabel === label &&
      (node.props as { accessibilityRole?: string }).accessibilityRole === "button" &&
      typeof node.props.onPress === "function"
  );
  if (matches.length === 0) {
    throw new Error(`No pressable found with accessibilityLabel="${label}"`);
  }
  // If react-test-renderer reports both the outer React.memo / Pressable
  // wrapper AND the inner host node with the same props, take the first
  // — `onPress` reaches the same handler either way.
  return matches[0];
}

// Find all text content rendered in the tree (for masked-email + label assertions).
function getAllTextContent(renderer: ReturnType<typeof create>): string[] {
  const out: string[] = [];
  function walk(node: unknown) {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as MinimalTestInstance;
    if (typeof n.children === "string") {
      out.push(n.children);
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    for (const k of kids) {
      if (typeof k === "string") out.push(k);
      else if (k && typeof k === "object") walk(k);
    }
  }
  walk(renderer.root);
  return out;
}

describe("EmailVerificationGate — Story 12-9 runtime contract", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCaptureError.mockClear();
    mockAddBreadcrumb.mockClear();
    alertSpy.mockClear();
    // Review-round-1 M2 patch: reset the module-level breadcrumb guard
    // so per-session firing semantics are exercised per-test. Each test
    // also seeds a unique user.id via `seedAuthStoreUser` to avoid
    // cross-test breadcrumb pollution.
    __resetGateBreadcrumbForTests();
    seedAuthStoreUser("user-default");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Case 1: renders the masked email for `userEmail="alice@example.com"`', () => {
    const { renderer } = renderGate({ userEmail: "alice@example.com" });
    const text = getAllTextContent(renderer).join(" ");
    expect(text).toContain("a***@example.com");
  });

  it('Case 2: renders the French fallback "votre adresse e-mail" for undefined email', () => {
    const { renderer } = renderGate({ userEmail: undefined });
    const text = getAllTextContent(renderer).join(" ");
    expect(text).toContain("votre adresse e-mail");
  });

  it("Case 3: tapping Resend dispatches onResendVerification exactly once with the email arg", async () => {
    const { renderer, onResendVerification } = renderGate();
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    await act(async () => {
      await resendBtn.props.onPress?.();
    });
    expect(onResendVerification).toHaveBeenCalledTimes(1);
    expect(onResendVerification).toHaveBeenCalledWith("alice@example.com");
  });

  it("Case 4: after a successful resend, the button is disabled + shows `Renvoyer dans Xs`", async () => {
    const { renderer } = renderGate();
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    await act(async () => {
      await resendBtn.props.onPress?.();
    });
    // After dispatch, query the button again (re-render).
    const resendBtnAfter = findPressableByLabel(renderer, "Resend verification email");
    expect(resendBtnAfter.props.accessibilityState).toMatchObject({ disabled: true });
    const text = getAllTextContent(renderer).join(" ");
    expect(text).toMatch(/Renvoyer dans \d+s/);
  });

  it("Case 5: after 60s elapse, the resend button re-enables", async () => {
    const { renderer } = renderGate();
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    await act(async () => {
      await resendBtn.props.onPress?.();
    });
    // Advance 61 seconds — past the cooldown.
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    const resendBtnAfter = findPressableByLabel(renderer, "Resend verification email");
    expect(resendBtnAfter.props.accessibilityState).toMatchObject({ disabled: false });
    const text = getAllTextContent(renderer).join(" ");
    expect(text).toContain("Renvoyer l'e-mail");
  });

  it("Case 6: resend error path — captureError fires with `email-verification-resend` tag AND Alert AND email NOT in extras", async () => {
    const fakeError = { name: "AuthApiError", code: "over_email_send_rate_limit" };
    const { renderer } = renderGate({
      onResendVerification: jest.fn(async () => ({ error: fakeError })),
    });
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    await act(async () => {
      await resendBtn.props.onPress?.();
    });
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [errorArg, contextArg, ...rest] = mockCaptureError.mock.calls[0];
    expect(errorArg).toBe(fakeError);
    expect(contextArg).toBe("email-verification-resend");
    // The email is NEVER passed as an extras key — Story 9-3 contract.
    for (const arg of rest) {
      const serialized = JSON.stringify(arg ?? {});
      expect(serialized).not.toContain("alice@example.com");
    }
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [alertTitle, alertBody] = alertSpy.mock.calls[0];
    expect(alertTitle).toBe("Erreur");
    expect(alertBody).toMatch(/Veuillez réessayer/);
  });

  it("Case 7: tapping Refresh dispatches onRefreshSession exactly once", async () => {
    const { renderer, onRefreshSession } = renderGate();
    const refreshBtn = findPressableByLabel(renderer, "I've verified my email — refresh");
    await act(async () => {
      await refreshBtn.props.onPress?.();
    });
    expect(onRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("Case 8: tapping Sign-out dispatches onSignOut exactly once", async () => {
    const { renderer, onSignOut } = renderGate();
    const signOutBtn = findPressableByLabel(renderer, "Sign out");
    await act(async () => {
      await signOutBtn.props.onPress?.();
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("Case 9: gate-shown breadcrumb fires exactly once per render (instance-level)", () => {
    const { renderer } = renderGate();
    // Force a re-render by updating props (same component instance).
    act(() => {
      renderer.update(
        <EmailVerificationGate
          userEmail="alice@example.com"
          onResendVerification={jest.fn(async () => ({ error: null }))}
          onSignOut={jest.fn(async () => ({ error: null }))}
          onRefreshSession={jest.fn(async () => ({ error: null }))}
        />
      );
    });
    // Still ONE breadcrumb — the module-level Set keyed by user.id guards
    // against per-render double-fire.
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    const [arg] = mockAddBreadcrumb.mock.calls[0];
    expect(arg).toMatchObject({
      category: "auth",
      level: "info",
      message: "Email verification gate shown",
      data: { feature: "email-verification-gate" },
    });
  });

  // Review-round-1 M2 patch: pre-patch the breadcrumb-fired-once invariant
  // was an instance-scoped useRef which resets on every remount (HMR /
  // error-boundary recovery / route changes). Operator analytics measuring
  // "unique users hitting the gate" would overcount 2-10×. Post-patch the
  // module-level Set keyed by `user.id` survives remounts within the same
  // session.
  it("Case 9b (M2): breadcrumb survives remount — fires ONCE across mount→unmount→remount cycle", () => {
    // First mount fires the breadcrumb.
    const { renderer: r1 } = renderGate();
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    // Unmount + remount the SAME user.
    act(() => {
      r1.unmount();
    });
    renderGate(); // same default user-default seeded
    // STILL ONE breadcrumb — the module-level Set remembers user.id.
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it("Case 9c (M2): breadcrumb fires for a DIFFERENT user.id on the same device", () => {
    renderGate(); // user-default
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    // Sign-out → sign-in as a different user.
    act(() => {
      seedAuthStoreUser("user-other");
    });
    renderGate();
    // TWO breadcrumbs — one per distinct user.id.
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(2);
  });

  // Review-round-1 H1 patches — handleRefresh trio.

  it("Case 11 (H1): refresh error → captureError fires with `email-verification-refresh` tag + French Alert", async () => {
    const fakeError = { name: "AuthApiError", message: "network blip" };
    const { renderer } = renderGate({
      onRefreshSession: jest.fn(async () => ({ error: fakeError })),
    });
    const refreshBtn = findPressableByLabel(renderer, "I've verified my email — refresh");
    await act(async () => {
      await refreshBtn.props.onPress?.();
    });
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [errorArg, contextArg, ...rest] = mockCaptureError.mock.calls[0];
    expect(errorArg).toBe(fakeError);
    expect(contextArg).toBe("email-verification-refresh");
    // PII guard: email not in extras.
    for (const arg of rest) {
      expect(JSON.stringify(arg ?? {})).not.toContain("alice@example.com");
    }
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [alertTitle] = alertSpy.mock.calls[0];
    expect(alertTitle).toBe("Erreur");
  });

  it('Case 12 (H1): refresh success BUT email still unverified → "not yet confirmed" French Alert', async () => {
    // User taps Refresh BEFORE clicking the email link. refreshSession()
    // resolves successfully but the user object still has
    // `email_confirmed_at: undefined`. Post-patch: we surface this.
    // Store is seeded with email_confirmed_at = null by default.
    const { renderer } = renderGate();
    const refreshBtn = findPressableByLabel(renderer, "I've verified my email — refresh");
    await act(async () => {
      await refreshBtn.props.onPress?.();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [alertTitle, alertBody] = alertSpy.mock.calls[0];
    expect(alertTitle).toBe("Vérification non confirmée");
    expect(alertBody).toMatch(/cliqué sur le lien/i);
    // captureError did NOT fire — this isn't an error, it's a UX-explicable
    // mismatch the user can recover from.
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("Case 13 (H1): refresh success AND email IS verified → no Alert (the gate would unmount via parent)", async () => {
    // Seed the store with email_confirmed_at populated — the refresh
    // resolves with a verified user. No Alert, no captureError.
    seedAuthStoreUser("user-default", "2026-05-14T00:00:00Z");
    const { renderer } = renderGate();
    const refreshBtn = findPressableByLabel(renderer, "I've verified my email — refresh");
    await act(async () => {
      await refreshBtn.props.onPress?.();
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("Case 14 (H1): concurrent refresh taps → onRefreshSession dispatched only ONCE", async () => {
    // Synchronous double-tap guard via `refreshingRef`. Two synchronous
    // taps before React commits the disabled state must NOT both dispatch.
    // Use a deferred promise (no setTimeout) so the test works under
    // `jest.useFakeTimers()`.
    let resolveRefresh: (v: { error: null }) => void = () => undefined;
    const onRefreshSession = jest.fn(
      () => new Promise<{ error: null }>((r) => (resolveRefresh = r))
    );
    const { renderer } = renderGate({
      onRefreshSession: onRefreshSession as unknown as () => Promise<{ error: unknown }>,
    });
    const refreshBtn = findPressableByLabel(renderer, "I've verified my email — refresh");
    let p1: Promise<unknown> | undefined;
    let p2: Promise<unknown> | undefined;
    // Fire both taps synchronously — second must hit the `refreshingRef`
    // guard before the first lands its await.
    await act(async () => {
      p1 = refreshBtn.props.onPress?.() as Promise<unknown>;
      p2 = refreshBtn.props.onPress?.() as Promise<unknown>;
      // Drain microtasks so the inner state-update commits.
      await Promise.resolve();
    });
    expect(onRefreshSession).toHaveBeenCalledTimes(1);
    // Cleanup: resolve and drain.
    await act(async () => {
      resolveRefresh({ error: null });
      await Promise.all([p1, p2]);
    });
  });

  // Review-round-1 L1 patches — handleSignOut guard + error handling.

  it("Case 15 (L1): sign-out error → captureError fires with `email-verification-signout` tag + French Alert", async () => {
    const fakeError = { name: "AuthApiError", message: "signout failed" };
    const { renderer } = renderGate({
      onSignOut: jest.fn(async () => ({ error: fakeError })),
    });
    const signOutBtn = findPressableByLabel(renderer, "Sign out");
    await act(async () => {
      await signOutBtn.props.onPress?.();
    });
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    const [errorArg, contextArg] = mockCaptureError.mock.calls[0];
    expect(errorArg).toBe(fakeError);
    expect(contextArg).toBe("email-verification-signout");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe("Erreur");
  });

  it("Case 16 (L1): concurrent sign-out taps → onSignOut dispatched only ONCE", async () => {
    let resolveSignOut: (v: { error: null }) => void = () => undefined;
    const onSignOut = jest.fn(() => new Promise<{ error: null }>((r) => (resolveSignOut = r)));
    const { renderer } = renderGate({
      onSignOut: onSignOut as unknown as () => Promise<{ error: unknown } | void>,
    });
    const signOutBtn = findPressableByLabel(renderer, "Sign out");
    let p1: Promise<unknown> | undefined;
    let p2: Promise<unknown> | undefined;
    await act(async () => {
      p1 = signOutBtn.props.onPress?.() as Promise<unknown>;
      p2 = signOutBtn.props.onPress?.() as Promise<unknown>;
      await Promise.resolve();
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSignOut({ error: null });
      await Promise.all([p1, p2]);
    });
  });

  // Review-round-1 L6 — `busy` accessibilityState flip on resend.

  it("Case 17 (L6): resend button `accessibilityState.busy` flips true during in-flight resend", async () => {
    // Resolve later so we can observe the `busy: true` window.
    let resolveResend: (v: { error: null }) => void = () => undefined;
    const onResendVerification = jest.fn(
      () =>
        new Promise<{ error: null }>((r) => {
          resolveResend = r;
        })
    );
    const { renderer } = renderGate({
      onResendVerification: onResendVerification as unknown as (
        email: string
      ) => Promise<{ error: unknown }>,
    });
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    // Fire the resend without awaiting the inner promise. Use jest's
    // microtask draining so React's setState commit lands.
    let onPressPromise: Promise<unknown> | undefined;
    await act(async () => {
      onPressPromise = resendBtn.props.onPress?.() as Promise<unknown> | undefined;
      // Let microtasks settle so setIsResending(true) commits.
      await Promise.resolve();
    });
    // Re-query AFTER the commit; busy should be true now.
    const inFlight = findPressableByLabel(renderer, "Resend verification email");
    expect(inFlight.props.accessibilityState).toMatchObject({ busy: true });
    // Resolve the resend; busy should flip back to false.
    await act(async () => {
      resolveResend({ error: null });
      await onPressPromise;
    });
    const afterResend = findPressableByLabel(renderer, "Resend verification email");
    expect(afterResend.props.accessibilityState).toMatchObject({ busy: false });
  });

  // Review-round-1 M3 — userEmail undefined produces distinct "missing
  // email" label, NOT "Renvoyer dans 0s" forever-disabled UX.

  it('Case 18 (M3): userEmail === undefined → resend label "Adresse e-mail manquante" + disabled', () => {
    const { renderer } = renderGate({ userEmail: undefined });
    const text = getAllTextContent(renderer).join(" ");
    expect(text).toContain("Adresse e-mail manquante");
    expect(text).not.toMatch(/Renvoyer dans \d+s/);
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    expect(resendBtn.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("Case 10: unmount during cooldown does not crash (interval cleanup runs)", async () => {
    const { renderer } = renderGate();
    const resendBtn = findPressableByLabel(renderer, "Resend verification email");
    await act(async () => {
      await resendBtn.props.onPress?.();
    });
    // Cooldown engaged; interval is running.
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    act(() => {
      renderer.unmount();
    });
    // Advance timers — no setState-after-unmount warning should fire.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
