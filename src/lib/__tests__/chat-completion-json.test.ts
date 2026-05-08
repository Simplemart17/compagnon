/**
 * Story 9-7 — chatCompletionJSON retry-once-on-parse-failure tests.
 *
 * Mocks `chatCompletion` (the non-JSON underlying call) and the Sentry
 * helpers (`captureError`, `addBreadcrumb`) so we can drive the retry
 * loop deterministically and assert the exactly-once event cardinality:
 *
 *   - success on first try → 0 breadcrumbs, 0 captureError
 *   - success on retry     → 1 breadcrumb (attempt: 1), 0 captureError
 *   - retry exhaustion     → 1 breadcrumb (attempt: 1), 1 captureError (attempt: 2)
 *   - non-JSON response    → 0 retries, captureError under a different context
 *
 * The schema-first signature is required at the type level — TypeScript
 * compile-error coverage is asserted via `// @ts-expect-error` in case 7.
 */

import { z } from "zod";

import { chatCompletionJSON } from "../openai";
import { addBreadcrumb, captureError, SENTRY_EXTRAS_ALLOWLIST } from "../sentry";
import { supabase } from "../supabase";

// ---------------------------------------------------------------------------
// Module mocks — control supabase.functions.invoke (the underlying upstream
// call inside `chatCompletion`) so the real `chatCompletion` runs against
// our fake responses. This tests the actual retry loop and Sentry signaling
// of `chatCompletionJSON`, not a re-implementation.
// ---------------------------------------------------------------------------

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
  SENTRY_EXTRAS_ALLOWLIST:
    jest.requireActual<typeof import("../sentry")>("../sentry").SENTRY_EXTRAS_ALLOWLIST,
}));

// `requireNetwork` is called inside `chatCompletion` — must succeed for
// the underlying call to proceed.
jest.mock("../network", () => ({
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

// Mock the supabase client so `supabase.functions.invoke("ai-proxy", ...)`
// is controllable per-test.
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(),
  },
}));

const mockedInvoke = (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;
const mockedCaptureError = captureError as jest.Mock;
const mockedAddBreadcrumb = addBreadcrumb as jest.Mock;

// Helper to mock a single ai-proxy response containing the given JSON string.
function mockAiResponseOnce(rawJson: string) {
  mockedInvoke.mockResolvedValueOnce({
    data: { choices: [{ message: { content: rawJson } }] },
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fooSchema = z.object({ foo: z.string() });

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedCaptureError.mockReset();
  mockedAddBreadcrumb.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chatCompletionJSON — retry-once-on-parse-failure (story 9-7)", () => {
  it("Case 1: schema-passing response on first try emits no breadcrumb / captureError", async () => {
    mockAiResponseOnce(JSON.stringify({ foo: "ok" }));

    const result = await chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
      feature: "test-case-1",
    });

    expect(result).toEqual({ foo: "ok" });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(0);
    expect(mockedCaptureError).toHaveBeenCalledTimes(0);
  });

  it("Case 2: schema-failing then schema-passing — 2 chat calls, 1 breadcrumb, 0 captureError", async () => {
    mockAiResponseOnce(JSON.stringify({ wrong: "shape" }));
    mockAiResponseOnce(JSON.stringify({ foo: "ok" }));

    const result = await chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
      feature: "test-case-2",
    });

    expect(result).toEqual({ foo: "ok" });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockedAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "ai",
        level: "warning",
        data: expect.objectContaining({ feature: "test-case-2", attempt: 1 }),
      })
    );
    expect(mockedCaptureError).toHaveBeenCalledTimes(0);
  });

  it("Case 3: schema-failing on both attempts — 2 chat calls, 1 breadcrumb, 1 captureError, rejects", async () => {
    mockAiResponseOnce(JSON.stringify({ wrong: "shape" }));
    mockAiResponseOnce(JSON.stringify({ also: "wrong" }));

    await expect(
      chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
        feature: "test-case-3",
      })
    ).rejects.toThrow(/AI schema parse failed/);

    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      "ai-schema-parse-failed",
      expect.objectContaining({
        feature: "test-case-3",
        attempt: 2,
      })
    );
  });

  it("Case 4: parseRetries: 0 with schema failure — 1 chat call, 0 breadcrumbs, 1 captureError, rejects", async () => {
    mockAiResponseOnce(JSON.stringify({ wrong: "shape" }));

    await expect(
      chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
        feature: "test-case-4",
        parseRetries: 0,
      })
    ).rejects.toThrow(/AI schema parse failed/);

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(0);
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      "ai-schema-parse-failed",
      expect.objectContaining({ feature: "test-case-4", attempt: 1 })
    );
  });

  it("Case 5: parseRetries: 2 succeeding on attempt 3 — 3 chat calls, 2 breadcrumbs, 0 captureError", async () => {
    mockAiResponseOnce(JSON.stringify({ wrong: "1" }));
    mockAiResponseOnce(JSON.stringify({ wrong: "2" }));
    mockAiResponseOnce(JSON.stringify({ foo: "ok" }));

    const result = await chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
      feature: "test-case-5",
      parseRetries: 2,
    });

    expect(result).toEqual({ foo: "ok" });
    expect(mockedInvoke).toHaveBeenCalledTimes(3);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(2);
    expect(mockedAddBreadcrumb).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ attempt: 1 }) })
    );
    expect(mockedAddBreadcrumb).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ attempt: 2 }) })
    );
    expect(mockedCaptureError).toHaveBeenCalledTimes(0);
  });

  it("Case 6: malformed JSON (non-parseable) — no schema retry, captureError under ai-proxy-json-parse, rethrows", async () => {
    mockAiResponseOnce("not valid json {{{");

    await expect(
      chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
        feature: "test-case-6",
      })
    ).rejects.toThrow();

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedAddBreadcrumb).toHaveBeenCalledTimes(0);
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      "ai-proxy-json-parse",
      expect.objectContaining({ feature: "test-case-6" })
    );
  });

  it("Case 7: feature tag is required at type level (compile-error coverage)", () => {
    // The function is referenced behind `false &&` so it's never invoked at
    // runtime — the test passes if TypeScript flagged the missing `feature`
    // option. Calling the function would trigger the async machinery and
    // surface as a process-level unhandled rejection because no `await`
    // captures it here.
    if (false as boolean) {
      // @ts-expect-error feature is required
      void chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {});
    }
    expect(true).toBe(true);
  });

  it("Case 8: captureError extras contain only allowlisted keys", async () => {
    mockAiResponseOnce(JSON.stringify({ wrong: "shape" }));
    mockAiResponseOnce(JSON.stringify({ also: "wrong" }));

    await expect(
      chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
        feature: "test-case-8",
      })
    ).rejects.toThrow();

    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    const lastCall = mockedCaptureError.mock.calls[0];
    const extras = lastCall[2] as Record<string, unknown>;
    for (const key of Object.keys(extras)) {
      expect(SENTRY_EXTRAS_ALLOWLIST.has(key)).toBe(true);
    }
  });

  it("Final Error message is short and does not leak the offending JSON", async () => {
    const offendingResponse = JSON.stringify({
      wrong: "field-name-that-might-include-user-prompt-text",
      moreWrong: "x".repeat(500),
    });
    // Both attempts return the same offending response
    mockAiResponseOnce(offendingResponse);
    mockAiResponseOnce(offendingResponse);

    let caught: Error | null = null;
    try {
      await chatCompletionJSON([{ role: "user", content: "x" }], fooSchema, {
        feature: "leak-test",
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    // The Error message should be the constructed short form, not a JSON dump.
    expect(caught!.message).toMatch(/^AI schema parse failed: /);
    expect(caught!.message).not.toContain("field-name-that-might-include-user-prompt-text");
    expect(caught!.message).not.toContain("xxxxx");
    // 80-char rule: the message stays short. Allow up to ~120 to be safe; the
    // construction is `path — issue.message` and Zod's `invalid_type` issue is
    // typically <60 chars.
    expect(caught!.message.length).toBeLessThan(200);
  });
});
