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
});
