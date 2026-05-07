import type * as Sentry from "@sentry/react-native";

import { REDACT_LONG_STRING_THRESHOLD, scrubEvent } from "../sentry";

type ErrorEvent = Sentry.ErrorEvent;
type TransactionEvent = Sentry.TransactionEvent;

const SHORT = "grammar";
const LONG_FRENCH =
  "Le user dit beaucoup beaucoup de fautes en passé composé en parlant de hier soir.";

beforeAll(() => {
  // Invariant guard: tests rely on LONG_FRENCH triggering the length rule.
  // If a copy-edit ever shrinks it under the threshold, fail loudly here.
  expect(LONG_FRENCH.length).toBeGreaterThan(REDACT_LONG_STRING_THRESHOLD);
});

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: "abc123",
    ...overrides,
  } as ErrorEvent;
}

describe("scrubEvent — GDPR scrubber", () => {
  it("drops email from event.user", () => {
    const event = makeEvent({ user: { id: "uid-1", email: "user@example.com" } });
    const result = scrubEvent(event);
    expect(result.user?.email).toBeUndefined();
  });

  it("drops username from event.user", () => {
    const event = makeEvent({ user: { id: "uid-1", username: "alice" } });
    const result = scrubEvent(event);
    expect(result.user?.username).toBeUndefined();
  });

  it("drops ip_address from event.user", () => {
    const event = makeEvent({ user: { id: "uid-1", ip_address: "1.2.3.4" } });
    const result = scrubEvent(event);
    expect(result.user?.ip_address).toBeUndefined();
  });

  it("drops event.request entirely", () => {
    const event = makeEvent({
      request: { url: "https://api.openai.com/v1/chat", data: { prompt: LONG_FRENCH } },
    });
    const result = scrubEvent(event);
    expect(result.request).toBeUndefined();
  });

  it("preserves event.user.id", () => {
    const event = makeEvent({ user: { id: "uid-1", email: "user@example.com" } });
    const result = scrubEvent(event);
    expect(result.user?.id).toBe("uid-1");
  });

  it("passes allowlisted extra keys with short string values through", () => {
    const event = makeEvent({
      extra: { errorType: SHORT, category: "vocabulary", skill: "grammar" },
    });
    const result = scrubEvent(event);
    expect(result.extra).toEqual({
      errorType: SHORT,
      category: "vocabulary",
      skill: "grammar",
    });
  });

  it("replaces allowlisted extra keys with long string values with redaction marker", () => {
    const event = makeEvent({
      // feature is a generic short-string key with the default 80-char threshold.
      extra: { feature: LONG_FRENCH },
    });
    const result = scrubEvent(event);
    expect((result.extra as Record<string, unknown>).feature).toBe("[redacted:long-string]");
  });

  it("drops non-allowlisted extra keys (uses a clearly-short value to isolate the rule)", () => {
    const event = makeEvent({
      extra: {
        errorType: SHORT,
        // `transcript` is short here; if it leaks through, the failure is unambiguously
        // an allowlist bug, not a length-rule bug.
        transcript: "abc",
        description: LONG_FRENCH,
      },
    });
    const result = scrubEvent(event);
    expect((result.extra as Record<string, unknown>).errorType).toBe(SHORT);
    expect((result.extra as Record<string, unknown>).transcript).toBeUndefined();
    expect((result.extra as Record<string, unknown>).description).toBeUndefined();
  });

  it("filters breadcrumb data with the same allowlist and length rule", () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          category: "promotion",
          message: "checked",
          data: {
            currentLevel: "A1",
            description: LONG_FRENCH,
            feature: LONG_FRENCH,
            skill: "grammar",
          },
        },
      ],
    });
    const result = scrubEvent(event);
    const data = result.breadcrumbs?.[0]?.data as Record<string, unknown>;
    expect(data.skill).toBe("grammar");
    expect(data.feature).toBe("[redacted:long-string]");
    expect(data.description).toBeUndefined();
    expect(data.currentLevel).toBe("A1"); // allowlisted (9-2 promotion telemetry)
  });

  it("never returns null — even for events with PII or unknown keys", () => {
    const event = makeEvent({
      user: { id: "uid-1", email: "user@example.com" },
      extra: { description: LONG_FRENCH },
    });
    const result = scrubEvent(event);
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
  });

  it("returns unchanged structure when event has no extra, breadcrumbs, user, or request", () => {
    const event = makeEvent({ event_id: "minimal" });
    const result = scrubEvent(event);
    expect(result.event_id).toBe("minimal");
    expect(result.user).toBeUndefined();
    expect(result.extra).toBeUndefined();
    expect(result.breadcrumbs).toBeUndefined();
    expect(result.request).toBeUndefined();
  });

  it("REDACT_LONG_STRING_THRESHOLD is 80 — boundary safety net", () => {
    // Exactly 80 chars passes through; 81 chars is redacted (rule: "over 80").
    const exactly80 = "a".repeat(REDACT_LONG_STRING_THRESHOLD);
    const over80 = "a".repeat(REDACT_LONG_STRING_THRESHOLD + 1);
    const event = makeEvent({
      extra: { feature: exactly80, context: over80 },
    });
    const result = scrubEvent(event);
    const extra = result.extra as Record<string, unknown>;
    expect(extra.feature).toBe(exactly80);
    expect(extra.context).toBe("[redacted:long-string]");
  });

  // ──────────────────────────────────────────────────────────────────
  // Coverage added per code-review patches P1, P2, P3, P4, P5, P11, P12
  // ──────────────────────────────────────────────────────────────────

  it("P1: redacts long event.exception.values[].value (upstream API messages)", () => {
    const event = makeEvent({
      exception: {
        values: [
          { type: "Error", value: LONG_FRENCH },
          { type: "OpenAIError", value: "short" },
        ],
      },
    });
    const result = scrubEvent(event);
    expect(result.exception?.values?.[0]?.value).toBe("[redacted:long-string]");
    expect(result.exception?.values?.[1]?.value).toBe("short");
  });

  it("P5: redacts long event.message", () => {
    const event = makeEvent({ message: LONG_FRENCH });
    const result = scrubEvent(event);
    expect(result.message).toBe("[redacted:long-string]");
  });

  it("P5: leaves short event.message untouched", () => {
    const event = makeEvent({ message: "boom" });
    const result = scrubEvent(event);
    expect(result.message).toBe("boom");
  });

  it("P2: componentStack uses a relaxed 800-char threshold", () => {
    const stack300 = "a".repeat(300);
    const stack900 = "a".repeat(900);
    const event = makeEvent({
      extra: { componentStack: stack300 },
    });
    expect((scrubEvent(event).extra as Record<string, unknown>).componentStack).toBe(stack300);

    const event2 = makeEvent({ extra: { componentStack: stack900 } });
    expect((scrubEvent(event2).extra as Record<string, unknown>).componentStack).toBe(
      "[redacted:long-string]"
    );
  });

  it("P4: drops non-primitive values for allowlisted keys (object, array, buffer)", () => {
    const event = makeEvent({
      extra: {
        errorId: { transcript: LONG_FRENCH }, // object — must be dropped
        rawBytes: [1, 2, 3], // array — must be dropped
        category: "grammar", // primitive — passes through
      },
    });
    const result = scrubEvent(event);
    const extra = result.extra as Record<string, unknown>;
    expect(extra.errorId).toBeUndefined();
    expect(extra.rawBytes).toBeUndefined();
    expect(extra.category).toBe("grammar");
  });

  it("P4: allows null/number/boolean primitives for allowlisted keys", () => {
    const event = makeEvent({
      extra: { statusCode: 500, errorType: null, attempt: false },
    });
    const result = scrubEvent(event);
    expect(result.extra).toEqual({ statusCode: 500, errorType: null, attempt: false });
  });

  it("P11: does not mutate the input event", () => {
    const input = makeEvent({
      user: { id: "uid-1", email: "user@example.com" },
      extra: { description: LONG_FRENCH, errorType: "grammar" },
      request: { url: "https://api.example.com" },
    });
    const snapshot = JSON.stringify(input);
    scrubEvent(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("P12: handles null user without crashing", () => {
    const event = makeEvent({ user: null as unknown as ErrorEvent["user"] });
    const result = scrubEvent(event);
    expect(result.user).toBeNull();
  });

  it("P12: handles empty user object — strips all PII fields harmlessly", () => {
    const event = makeEvent({ user: {} });
    const result = scrubEvent(event);
    expect(result.user?.email).toBeUndefined();
    expect(result.user?.username).toBeUndefined();
    expect(result.user?.ip_address).toBeUndefined();
  });

  it("P12: preserves crumbs that have no data field", () => {
    const event = makeEvent({
      breadcrumbs: [{ category: "nav", message: "navigated" }],
    });
    const result = scrubEvent(event);
    expect(result.breadcrumbs?.[0]?.data).toBeUndefined();
    expect(result.breadcrumbs?.[0]?.message).toBe("navigated");
  });

  it("P12: redacts long crumb.message (auto-instrumented breadcrumbs leak via message field)", () => {
    const event = makeEvent({
      breadcrumbs: [{ category: "console", message: LONG_FRENCH }],
    });
    const result = scrubEvent(event);
    expect(result.breadcrumbs?.[0]?.message).toBe("[redacted:long-string]");
  });

  it("P12: 79-char allowlisted string passes through (boundary on the safe side)", () => {
    const at79 = "a".repeat(REDACT_LONG_STRING_THRESHOLD - 1);
    const event = makeEvent({ extra: { feature: at79 } });
    const result = scrubEvent(event);
    expect((result.extra as Record<string, unknown>).feature).toBe(at79);
  });

  it("P12: empty string allowlisted value passes through", () => {
    const event = makeEvent({ extra: { feature: "" } });
    const result = scrubEvent(event);
    expect((result.extra as Record<string, unknown>).feature).toBe("");
  });

  it("P3: works on TransactionEvent shape (beforeSendTransaction parity)", () => {
    const txEvent: TransactionEvent = {
      type: "transaction",
      event_id: "tx1",
      user: { id: "uid-1", email: "x@y.z" },
      extra: { errorType: "grammar", description: LONG_FRENCH },
    } as TransactionEvent;
    const result = scrubEvent(txEvent);
    expect(result.user?.email).toBeUndefined();
    expect(result.user?.id).toBe("uid-1");
    expect((result.extra as Record<string, unknown>).errorType).toBe("grammar");
    expect((result.extra as Record<string, unknown>).description).toBeUndefined();
  });

  it("B1: 9-2 promotion-telemetry keys (currentLevel, fromLevel, toLevel, score, missingSkills) survive scrubbing", () => {
    const event = makeEvent({
      extra: {
        currentLevel: "A1",
        fromLevel: "A1",
        toLevel: "A2",
        score: 87,
        missingSkills: "reading,writing",
      },
    });
    const result = scrubEvent(event);
    expect(result.extra).toEqual({
      currentLevel: "A1",
      fromLevel: "A1",
      toLevel: "A2",
      score: 87,
      missingSkills: "reading,writing",
    });
  });
});
