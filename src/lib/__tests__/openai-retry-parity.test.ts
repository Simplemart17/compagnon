/**
 * Story 11-8 — retry-parity tests for the 4 AI helpers in openai.ts.
 *
 * Pins:
 *   - `MAX_RETRIES = 2` + `RETRY_DELAYS = [1000, 2000]` as exported constants.
 *   - All 4 helpers consume the shared constants (drift detector reads
 *     openai.ts from disk; Story 11-3 / 11-6 / 11-7 pattern).
 *   - `isRetryable` includes the new "empty" substring branch.
 *   - Pre-11-8 local `const maxRetries = 1` and `sleep(1000)` literals are
 *     deleted (negative-guard drift detector).
 *
 * NB: the constants are exported from openai.ts as a single source of truth
 * so a future operator change propagates atomically across all 4 helpers.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { chatCompletion, isRetryable, MAX_RETRIES, RETRY_DELAYS } from "../openai";
import { supabase } from "../supabase";

// Mute Sentry — we're testing retry semantics, not telemetry.
jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
  SENTRY_EXTRAS_ALLOWLIST:
    jest.requireActual<typeof import("../sentry")>("../sentry").SENTRY_EXTRAS_ALLOWLIST,
}));

// requireNetwork must succeed.
jest.mock("../network", () => ({
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

// Mock the supabase client so we control upstream responses.
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn(),
  },
}));

const mockedInvoke = (supabase as unknown as { functions: { invoke: jest.Mock } }).functions.invoke;

const OPENAI_SOURCE_PATH = join(__dirname, "..", "openai.ts");
const OPENAI_SOURCE = readFileSync(OPENAI_SOURCE_PATH, "utf8");

describe("Story 11-8 — shared retry constants", () => {
  it("MAX_RETRIES is pinned at 2 (spec roadmap line 188: TTS = 2 retries)", () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it("RETRY_DELAYS is [1000, 2000] (exponential backoff schedule)", () => {
    expect(RETRY_DELAYS).toEqual([1000, 2000]);
  });

  it("RETRY_DELAYS.length === MAX_RETRIES (one delay per retry attempt)", () => {
    expect(RETRY_DELAYS.length).toBe(MAX_RETRIES);
  });

  it("P7 review-patch: RETRY_DELAYS is Object.freeze'd (consumers can't mutate)", () => {
    expect(Object.isFrozen(RETRY_DELAYS)).toBe(true);
    // Verify mutation actually throws / is silently rejected per JS strict-mode semantics.
    expect(() => {
      // @ts-expect-error — testing runtime freeze contract
      RETRY_DELAYS.push(4000);
    }).toThrow();
  });
});

describe("Story 11-8 review patch P8 — isRetryable runtime contract (exported)", () => {
  // Matrix of (message, expected) pairs proving the exact-match sentinel
  // allowlist (P1) at runtime, NOT via source grep alone.
  it.each([
    // The 4 canonical sentinels — MUST retry
    ["Empty AI response", true],
    ["Empty TTS response", true],
    ["Empty transcription response", true],
    ["Empty embedding response", true],
    // Case-insensitive (isRetryable lowercases internally)
    ["EMPTY AI RESPONSE", true],
    ["empty ai response", true],
    // Pre-existing retryable substrings (regression guard)
    ["Network error: ECONNREFUSED", true],
    ["Upstream timeout: chat did not respond within 30000ms", true],
    ["fetch failed", true],
    ["HTTP 500 Internal Server Error", true],
    ["HTTP 502 Bad Gateway", true],
    ["HTTP 503 Service Unavailable", true],
    ["HTTP 429 Too Many Requests", true],
    ["rate limit exhausted", true],
    // P1 negative guard — coincidental "empty" substring must NOT retry
    ["OpenAI error: empty quota", false],
    ["Empty request body — 400", false],
    ["Authentication failed: empty token cookie", false],
    ["Empty cache miss", false],
    // Non-Error inputs (defensive)
    // Unrelated errors stay non-retryable
    ["Schema validation failed: facts.0.type", false],
    ["Permission denied", false],
    ["Invalid CEFR level", false],
  ])('isRetryable(new Error("%s")) === %s', (message, expected) => {
    expect(isRetryable(new Error(message))).toBe(expected);
  });

  it("non-Error inputs return false (defensive)", () => {
    expect(isRetryable("Empty AI response")).toBe(false); // bare string, not Error
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable({ message: "Empty AI response" })).toBe(false); // plain object
    expect(isRetryable(42)).toBe(false);
  });
});

describe("Story 11-8 review patch P9 — chatCompletion Unicode whitespace empty-detection", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it.each([
    [" ", "ASCII space"],
    ["\t", "tab"],
    ["\n", "newline"],
    [" ", "NBSP (U+00A0)"],
    [" ", "line separator (U+2028)"],
    [" ", "paragraph separator (U+2029)"],
    ["   \t", "mixed Unicode whitespace"],
  ])("content `%s` (%s) is treated as empty → throws", async (whitespace) => {
    // Use shim for fast retries.
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      cb: (...args: unknown[]) => void
    ) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
      mockedInvoke.mockResolvedValue({
        data: { choices: [{ message: { content: whitespace } }] },
        error: null,
      });

      await expect(chatCompletion([{ role: "user", content: "hi" }])).rejects.toThrow(
        "Empty AI response"
      );
    } finally {
      (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
    }
  });
});

describe("Story 11-8 — `isRetryable` 'empty' branch (drift detector)", () => {
  it('source contains the new `msg.includes("empty")` branch', () => {
    expect(OPENAI_SOURCE).toMatch(/msg\.includes\("empty"\)/);
  });

  it("source preserves all pre-11-8 retryable substrings", () => {
    const requiredSubstrings = [
      "network",
      "timeout",
      "fetch",
      "500",
      "502",
      "503",
      "429",
      "rate limit",
    ];
    for (const sub of requiredSubstrings) {
      expect(OPENAI_SOURCE).toMatch(new RegExp(`msg\\.includes\\("${sub}"\\)`));
    }
  });
});

describe("Story 11-8 — parity drift detector (reads openai.ts from disk)", () => {
  it("generateSpeech uses shared MAX_RETRIES (not local `const maxRetries = 1`)", () => {
    // Slice the source from the `generateSpeech` declaration to the next
    // `export async function` to bound the per-helper scope.
    const sliceStart = OPENAI_SOURCE.indexOf("export async function generateSpeech");
    const sliceEnd = OPENAI_SOURCE.indexOf("export async function transcribeAudio");
    const slice = OPENAI_SOURCE.slice(sliceStart, sliceEnd);
    expect(slice).toMatch(/const maxRetries = MAX_RETRIES/);
    // P3 review-round-1 patch: anchor regex on \b + flexible whitespace so a
    // future formatter quirk like `const  maxRetries=1;` (double space, no
    // space before `=`) doesn't slip past.
    expect(slice).not.toMatch(/\bconst\s+maxRetries\s*=\s*1\s*[;\n]/);
  });

  it("transcribeAudio uses shared MAX_RETRIES (not local `const maxRetries = 1`)", () => {
    const sliceStart = OPENAI_SOURCE.indexOf("export async function transcribeAudio");
    const sliceEnd = OPENAI_SOURCE.indexOf("export async function generateEmbedding");
    const slice = OPENAI_SOURCE.slice(sliceStart, sliceEnd);
    expect(slice).toMatch(/const maxRetries = MAX_RETRIES/);
    // P3 review-round-1 patch: anchor regex on \b + flexible whitespace so a
    // future formatter quirk like `const  maxRetries=1;` (double space, no
    // space before `=`) doesn't slip past.
    expect(slice).not.toMatch(/\bconst\s+maxRetries\s*=\s*1\s*[;\n]/);
  });

  it("generateEmbedding uses shared MAX_RETRIES (not local `const maxRetries = 1`)", () => {
    const sliceStart = OPENAI_SOURCE.indexOf("export async function generateEmbedding");
    // generateEmbedding is the last helper — slice to end of file.
    const slice = OPENAI_SOURCE.slice(sliceStart);
    expect(slice).toMatch(/const maxRetries = MAX_RETRIES/);
    // P3 review-round-1 patch: anchor regex on \b + flexible whitespace so a
    // future formatter quirk like `const  maxRetries=1;` (double space, no
    // space before `=`) doesn't slip past.
    expect(slice).not.toMatch(/\bconst\s+maxRetries\s*=\s*1\s*[;\n]/);
  });

  it("all 3 non-chat helpers use RETRY_DELAYS[attempt] schedule (not fixed sleep(1000))", () => {
    // Count occurrences of `RETRY_DELAYS[attempt]` — expect 4 (one per helper
    // including chatCompletion's pre-existing usage).
    const matches = OPENAI_SOURCE.match(/RETRY_DELAYS\[attempt\] \?\? 2000/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("negative guard: zero occurrences of pre-11-8 fixed `await sleep(1000);` in retry loops", () => {
    // The pre-11-8 pattern was `await sleep(1000);` inside the retry loop.
    // Post-11-8 all 4 helpers use `sleep(RETRY_DELAYS[attempt] ?? 2000)`.
    // Any remaining `sleep(1000)` would indicate a non-migrated helper.
    expect(OPENAI_SOURCE).not.toMatch(/await sleep\(1000\)/);
  });

  it("chatCompletion empty-check covers ALL response formats (not gated on json_object)", () => {
    // Pre-11-8: `if (!content && options?.responseFormat === "json_object")`.
    // Post-11-8 (initial): `if (typeof content !== "string" || content.trim().length === 0)`.
    // Post-11-8 (review patch P9): `if (typeof content !== "string" || !/\S/u.test(content))`
    // — `.trim()` is ASCII-whitespace-only on older engines; the Unicode-aware
    // regex catches NBSP / line-separator / paragraph-separator too.
    // Negative guard: the pre-11-8 json_object-gated form must NOT be present.
    expect(OPENAI_SOURCE).not.toMatch(/!content && options\?\.responseFormat === "json_object"/);
    expect(OPENAI_SOURCE).toMatch(/typeof content !== "string" \|\| !\/\\S\/u\.test\(content\)/);
  });

  it("generateEmbedding throws on empty (not silent `?? []` return)", () => {
    const sliceStart = OPENAI_SOURCE.indexOf("export async function generateEmbedding");
    const slice = OPENAI_SOURCE.slice(sliceStart);
    expect(slice).toMatch(/throw new Error\("Empty embedding response"\)/);
    expect(slice).toMatch(/!Array\.isArray\(embedding\) \|\| embedding\.length === 0/);
    // Negative guard: the silent `?? []` return must NOT be present.
    expect(slice).not.toMatch(/\?\.\[0\]\?\.embedding \?\? \[\]/);
  });

  it("generateSpeech throws on empty Blob (bytes.length === 0)", () => {
    const sliceStart = OPENAI_SOURCE.indexOf("export async function generateSpeech");
    const sliceEnd = OPENAI_SOURCE.indexOf("export async function transcribeAudio");
    const slice = OPENAI_SOURCE.slice(sliceStart, sliceEnd);
    expect(slice).toMatch(/bytes\.length === 0/);
    expect(slice).toMatch(/throw new Error\("Empty TTS response"\)/);
  });

  it("transcribeAudio empty-text check preserved (pre-11-8 behavior + now retryable)", () => {
    const sliceStart = OPENAI_SOURCE.indexOf("export async function transcribeAudio");
    const sliceEnd = OPENAI_SOURCE.indexOf("export async function generateEmbedding");
    const slice = OPENAI_SOURCE.slice(sliceStart, sliceEnd);
    expect(slice).toMatch(/throw new Error\("Empty transcription response"\)/);
  });

  it("MAX_RETRIES + RETRY_DELAYS are EXPORTED constants (not module-private)", () => {
    expect(OPENAI_SOURCE).toMatch(/export const MAX_RETRIES = 2/);
    // Post-11-8-review (P7): RETRY_DELAYS is Object.freeze'd.
    expect(OPENAI_SOURCE).toMatch(/export const RETRY_DELAYS:\s*readonly number\[\]/);
    expect(OPENAI_SOURCE).toMatch(/Object\.freeze\(\[1000,\s*2000\]/);
  });
});
