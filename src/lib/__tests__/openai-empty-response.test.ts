/**
 * Story 11-8 — runtime empty-response detection tests for all 4 AI helpers.
 *
 * Mocks `supabase.functions.invoke` (the underlying upstream call) so we
 * drive each helper's empty-response code path deterministically and
 * verify:
 *
 *   - chatCompletion text-mode + JSON-mode + whitespace-only all throw
 *     "Empty AI response"; the throw is retryable so the retry loop fires.
 *   - generateSpeech empty Blob + empty-string fallback both throw
 *     "Empty TTS response" + retry fires.
 *   - transcribeAudio empty text throws "Empty transcription response"
 *     (pre-existing message) + retry NOW fires (was non-retried pre-11-8).
 *   - generateEmbedding undefined / empty-array / non-array all throw
 *     "Empty embedding response" + retry fires.
 *   - Three-attempt exhaustion: always-empty mock → final error propagates
 *     after MAX_RETRIES retries.
 *
 * To avoid real-time waits on the [1000, 2000]ms backoff schedule, we mock
 * `globalThis.setTimeout` to resolve immediately. This keeps the retry-loop
 * semantics intact (the await fires) without the wall-clock cost.
 */

import { isValidEmbedding } from "../error-tracker";
import {
  chatCompletion,
  generateEmbedding,
  generateSpeech,
  MAX_RETRIES,
  transcribeAudio,
} from "../openai";
import { supabase } from "../supabase";

// Override globalThis.setTimeout with an immediate-callback shim before each
// test, restore after. `openai.ts`'s `sleep` helper calls setTimeout at call
// time (not at module load), so the per-test override applies correctly.
// Keeps retry-loop semantics intact (the await fires) without the wall-clock
// cost of the real [1000, 2000]ms backoff schedule.
//
// P4 review-round-1 patch: switched from beforeAll/afterAll to
// beforeEach/afterEach for per-test isolation. With beforeAll, an
// `afterAll` failure (e.g., unhandled Promise rejection terminating the
// worker mid-suite) would leak the shim into other test files running on
// the same Jest worker, causing flaky timing tests elsewhere. Per-test
// install/restore bounds the shim's lifetime tightly to the tests that
// need it.
const originalSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
    cb: (...args: unknown[]) => void
  ) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
});

afterEach(() => {
  (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
});

// Mute Sentry — we're testing helper behavior, not telemetry.
jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
  SENTRY_EXTRAS_ALLOWLIST:
    jest.requireActual<typeof import("../sentry")>("../sentry").SENTRY_EXTRAS_ALLOWLIST,
}));

// requireNetwork must succeed for the helper to proceed.
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

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("Story 11-8 — chatCompletion empty-response detection (all modes)", () => {
  it('text mode + empty content "" → throws "Empty AI response" + retries fire', async () => {
    mockedInvoke.mockResolvedValue({
      data: { choices: [{ message: { content: "" } }] },
      error: null,
    });

    await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Empty AI response"
    );
    // 1 original + MAX_RETRIES retries = MAX_RETRIES + 1 total invocations.
    expect(mockedInvoke).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('text mode + whitespace-only content "   " → throws "Empty AI response"', async () => {
    mockedInvoke.mockResolvedValue({
      data: { choices: [{ message: { content: "   " } }] },
      error: null,
    });

    await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Empty AI response"
    );
    expect(mockedInvoke).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('text mode + null content → throws "Empty AI response"', async () => {
    mockedInvoke.mockResolvedValue({
      data: { choices: [{ message: { content: null } }] },
      error: null,
    });

    await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Empty AI response"
    );
  });

  it('JSON mode + empty content "" → throws "Empty AI response" (pre-11-8 behavior preserved)', async () => {
    mockedInvoke.mockResolvedValue({
      data: { choices: [{ message: { content: "" } }] },
      error: null,
    });

    await expect(
      chatCompletion([{ role: "user", content: "hi" }], { responseFormat: "json_object" })
    ).rejects.toThrow("Empty AI response");
  });

  it("happy path: text mode + non-empty content returns the string (single invocation)", async () => {
    mockedInvoke.mockResolvedValue({
      data: { choices: [{ message: { content: "valid response" } }] },
      error: null,
    });

    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result).toBe("valid response");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("recovery: empty on attempt 1 → success on attempt 2 (1 retry)", async () => {
    mockedInvoke.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "" } }] }, // empty on 1st
      error: null,
    });
    mockedInvoke.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "recovered" } }] }, // valid on 2nd
      error: null,
    });

    const result = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(result).toBe("recovered");
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("Story 11-8 — generateSpeech empty-response detection", () => {
  it('empty Blob (bytes.length === 0) → throws "Empty TTS response" + retries fire', async () => {
    const emptyBlob = new Blob([], { type: "audio/mpeg" });
    mockedInvoke.mockResolvedValue({ data: emptyBlob, error: null });

    await expect(generateSpeech("bonjour")).rejects.toThrow("Empty TTS response");
    expect(mockedInvoke).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('empty-string fallback path → throws "Empty TTS response"', async () => {
    mockedInvoke.mockResolvedValue({ data: "", error: null });

    await expect(generateSpeech("bonjour")).rejects.toThrow("Empty TTS response");
  });

  it("happy path: non-empty Blob returns base64 (no retry)", async () => {
    const validBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" });
    mockedInvoke.mockResolvedValue({ data: validBlob, error: null });

    const result = await generateSpeech("bonjour");
    // 4 bytes [1, 2, 3, 4] → btoa of "\x01\x02\x03\x04" = "AQIDBA=="
    expect(result).toBe("AQIDBA==");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("Story 11-8 — transcribeAudio empty-response detection (now retried)", () => {
  it('empty text → throws "Empty transcription response" + retries fire (was non-retried pre-11-8)', async () => {
    mockedInvoke.mockResolvedValue({ data: { text: "" }, error: null });

    await expect(transcribeAudio("base64audio")).rejects.toThrow("Empty transcription response");
    expect(mockedInvoke).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('missing text field → throws "Empty transcription response"', async () => {
    mockedInvoke.mockResolvedValue({ data: {}, error: null });

    await expect(transcribeAudio("base64audio")).rejects.toThrow("Empty transcription response");
  });

  it("happy path: non-empty text returns verbatim", async () => {
    mockedInvoke.mockResolvedValue({ data: { text: "bonjour le monde" }, error: null });

    const result = await transcribeAudio("base64audio");
    expect(result).toBe("bonjour le monde");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('Story 11-8 — generateEmbedding empty-response detection (was silent "?? []" pre-11-8)', () => {
  it('undefined data → throws "Empty embedding response" + retries fire', async () => {
    mockedInvoke.mockResolvedValue({ data: undefined, error: null });

    await expect(generateEmbedding("hello")).rejects.toThrow("Empty embedding response");
    expect(mockedInvoke).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('empty-array embedding → throws "Empty embedding response"', async () => {
    mockedInvoke.mockResolvedValue({ data: { data: [{ embedding: [] }] }, error: null });

    await expect(generateEmbedding("hello")).rejects.toThrow("Empty embedding response");
  });

  it('missing embedding field → throws "Empty embedding response"', async () => {
    mockedInvoke.mockResolvedValue({ data: { data: [{}] }, error: null });

    await expect(generateEmbedding("hello")).rejects.toThrow("Empty embedding response");
  });

  it('non-array embedding (defensive) → throws "Empty embedding response"', async () => {
    mockedInvoke.mockResolvedValue({
      data: { data: [{ embedding: "not-an-array" }] },
      error: null,
    });

    await expect(generateEmbedding("hello")).rejects.toThrow("Empty embedding response");
  });

  it("happy path: valid 1536-dim embedding returns the array verbatim (no retry)", async () => {
    const validEmbedding = new Array(1536).fill(0.5);
    mockedInvoke.mockResolvedValue({
      data: { data: [{ embedding: validEmbedding }] },
      error: null,
    });

    const result = await generateEmbedding("hello");
    expect(result).toEqual(validEmbedding);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("two-layer defense (P5): boundary accepts a 5-element array AND consumer guard isValidEmbedding rejects it", async () => {
    // P5 review-round-1 patch: pre-patch this test only asserted the boundary
    // passes a short non-empty array through. It claimed the consumer-side
    // `isValidEmbedding` from Story 11-6 catches the wrong-dim case BUT
    // didn't actually import or call it. Post-patch we import the consumer
    // guard and assert it returns `false` on the same array the boundary
    // accepts — proving the two-layer defense contract end-to-end. A future
    // refactor that removes `isValidEmbedding` from error-tracker.ts would
    // fail to import + fail this test loudly.
    //
    // `isValidEmbedding` is imported statically at the top — it's a pure
    // helper that doesn't touch supabase, so no mock interference.
    const shortArray = [0.1, 0.2, 0.3, 0.4, 0.5];
    mockedInvoke.mockResolvedValue({
      data: { data: [{ embedding: shortArray }] },
      error: null,
    });

    // Layer 1 (boundary): accepts the array.
    const result = await generateEmbedding("hello");
    expect(result).toEqual(shortArray);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    // Layer 2 (consumer guard, Story 11-6): rejects it for wrong dim (5 !== 1536).
    expect(isValidEmbedding(shortArray)).toBe(false);

    // Inverse direction: a valid 1536-dim finite-component array passes BOTH layers.
    const validArray = new Array(1536).fill(0.5);
    expect(isValidEmbedding(validArray)).toBe(true);
  });
});
