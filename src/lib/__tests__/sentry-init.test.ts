import { getSentryInitConfig, scrubEvent } from "../sentry";

/**
 * Privacy-posture contract test.
 *
 * The privacy policy (`app/(tabs)/profile/privacy-policy.tsx`) and the Google Play
 * Data Safety declaration (`store/android-metadata.md`) make absolute claims:
 * "no screenshots, transcripts, conversation content, or email shared with the
 * error monitor." Those claims are enforced *only* by the Sentry.init shape
 * returned here. If a future PR flips a flag, this test fails as a forcing
 * function — it is the runtime guard for the legal text.
 *
 * Do not weaken these assertions without also updating the privacy policy
 * AND the Data Safety declaration in the Play / App Store consoles.
 */
describe("getSentryInitConfig — GDPR posture contract", () => {
  it("disables screenshot auto-attachment", () => {
    expect(getSentryInitConfig().attachScreenshot).toBe(false);
  });

  it("disables failed-request capture (would serialize OpenAI prompts)", () => {
    expect(getSentryInitConfig().enableCaptureFailedRequests).toBe(false);
  });

  it("explicitly disables sendDefaultPii (defends against IP auto-enrichment)", () => {
    expect(getSentryInitConfig().sendDefaultPii).toBe(false);
  });

  it("wires the GDPR scrubber into beforeSend", () => {
    expect(getSentryInitConfig().beforeSend).toBe(scrubEvent);
  });

  it("wires the GDPR scrubber into beforeSendTransaction", () => {
    expect(getSentryInitConfig().beforeSendTransaction).toBe(scrubEvent);
  });

  it("samples production traces at 5%, dev traces at 100%", () => {
    // __DEV__ branch: jest-expo sets __DEV__ to true; production builds set it false.
    const expected = (globalThis as unknown as { __DEV__?: boolean }).__DEV__ === true ? 1.0 : 0.05;
    expect(getSentryInitConfig().tracesSampleRate).toBe(expected);
  });

  it("reads DSN from EXPO_PUBLIC_SENTRY_DSN env (never hardcoded)", () => {
    const config = getSentryInitConfig();
    expect(config.dsn).toBe(process.env.EXPO_PUBLIC_SENTRY_DSN);
  });

  it("disables Sentry entirely when DSN is unset", () => {
    const original = process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    try {
      expect(getSentryInitConfig().enabled).toBe(false);
    } finally {
      if (original !== undefined) process.env.EXPO_PUBLIC_SENTRY_DSN = original;
    }
  });

  // ---------------------------------------------------------------------------
  // Story 13-6 — Epic 13 P2-x performance posture pins
  //
  // The 3 flags below default to ENABLED in @sentry/react-native. The JS
  // work to BUILD a transaction (auto-spans for HTTP / native frames bridge
  // round-trip / touch-handler auto-trace) runs for 100% of requests +
  // interactions; tracesSampleRate filters at SEND time, so 95% sampling
  // doesn't save the per-request CPU cost. Story 13-6 disables them
  // explicitly so production overhead stays linear in error rate, NOT
  // linear in user activity.
  // ---------------------------------------------------------------------------

  it("Story 13-6: disables auto-performance tracing (no auto-spans per HTTP request)", () => {
    expect(getSentryInitConfig().enableAutoPerformanceTracing).toBe(false);
  });

  it("Story 13-6: disables native-frames tracking (no native-bridge round-trip per transaction)", () => {
    expect(getSentryInitConfig().enableNativeFramesTracking).toBe(false);
  });

  it("Story 13-6: disables user-interaction auto-tracing (no auto-transaction per touch handler)", () => {
    // Story 13-6 review-round-1 P6: SDK 7.11.0 default for this flag is
    // already `false`; the explicit pin is defensive against a future SDK
    // version that flips the default. Matches the explicit-over-implicit
    // discipline at every other privacy flag in this config.
    expect(getSentryInitConfig().enableUserInteractionTracing).toBe(false);
  });

  it("Story 13-6 review-round-1 P2: disables stall tracking (no JS event-loop stall measurements on transactions)", () => {
    expect(getSentryInitConfig().enableStallTracking).toBe(false);
  });

  it("Story 13-6 review-round-1 P2: disables app-start tracking (no cold-launch auto-transaction)", () => {
    expect(getSentryInitConfig().enableAppStartTracking).toBe(false);
  });

  it("Story 13-6 review-round-1 P2: pins profilesSampleRate to 0 (CPU profiling disabled entirely)", () => {
    expect(getSentryInitConfig().profilesSampleRate).toBe(0);
  });
});
