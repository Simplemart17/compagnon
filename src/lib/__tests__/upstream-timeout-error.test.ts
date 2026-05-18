/**
 * Story 11-3 — UpstreamTimeoutError contract test.
 *
 * The actual implementation lives in `supabase/functions/_shared/fetch-with-timeout.ts`
 * (Deno context — excluded from `tsconfig.json` so cannot be imported from Jest
 * without a project-wide config change). Instead of importing, this test
 * reads the Deno source from disk and asserts the load-bearing invariants
 * are present in the actual implementation. This guarantees the client-side
 * `isRetryable()` retry contract (literal lowercase substring "timeout" in
 * the error message) cannot drift silently — a future refactor that changes
 * the message format or the constants trips this test.
 *
 * Story 11-3 review patch P2: replaces the prior inline-mirror approach
 * (which tested only the mirror's behavior, not the real implementation's).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const DENO_HELPER_PATH = resolve(
  __dirname,
  "../../../supabase/functions/_shared/fetch-with-timeout.ts"
);
const DENO_HELPER_SOURCE = readFileSync(DENO_HELPER_PATH, "utf-8");

describe("UpstreamTimeoutError (Story 11-3) — Deno-source drift detector", () => {
  it("source file exists and is readable", () => {
    expect(DENO_HELPER_SOURCE.length).toBeGreaterThan(100);
  });

  it("UpstreamTimeoutError constructor uses the load-bearing message format", () => {
    // The literal substring "timeout" (lowercase) in the constructed message
    // is the LOAD-BEARING contract for the client-side `isRetryable()` check
    // at src/lib/openai.ts:23-37 (which calls msg.includes("timeout") to
    // decide retry eligibility). A future refactor that drops the substring
    // — e.g., changing to `"timed out after Xms"` (which does NOT contain
    // "timeout" as a substring) — silently breaks the retry path. This
    // assertion fails loudly if the format drifts.
    expect(DENO_HELPER_SOURCE).toContain(
      "`Upstream timeout: ${upstream} did not respond within ${timeoutMs}ms`"
    );
  });

  it("UpstreamTimeoutError sets name field to 'UpstreamTimeoutError'", () => {
    expect(DENO_HELPER_SOURCE).toContain(`this.name = "UpstreamTimeoutError"`);
  });

  it("UpstreamTimeoutError exposes readonly upstream + timeoutMs fields", () => {
    expect(DENO_HELPER_SOURCE).toMatch(/readonly upstream: string/);
    expect(DENO_HELPER_SOURCE).toMatch(/readonly timeoutMs: number/);
  });

  it("isUpstreamTimeoutError is exported", () => {
    expect(DENO_HELPER_SOURCE).toMatch(
      /export function isUpstreamTimeoutError\(err: unknown\): err is UpstreamTimeoutError/
    );
  });

  it("isUpstreamTimeoutError uses a defensive name-check fallback (P3 review patch)", () => {
    // Story 11-3 review patch P3: the type-guard must work even if the
    // UpstreamTimeoutError constructor identity drifts across realms or
    // polyfill boundaries. Verify the function body contains both an
    // instanceof check AND a name-based fallback.
    expect(DENO_HELPER_SOURCE).toMatch(/instanceof UpstreamTimeoutError/);
    expect(DENO_HELPER_SOURCE).toMatch(/name.*===.*UpstreamTimeoutError/);
  });

  it("default upstream timeout is 30s (DEFAULT_UPSTREAM_TIMEOUT_MS)", () => {
    expect(DENO_HELPER_SOURCE).toMatch(/export const DEFAULT_UPSTREAM_TIMEOUT_MS\s*=\s*30_000/);
  });

  it("Whisper upstream timeout is 90s (WHISPER_UPSTREAM_TIMEOUT_MS, bumped from 60s per P2 review patch D2)", () => {
    expect(DENO_HELPER_SOURCE).toMatch(/export const WHISPER_UPSTREAM_TIMEOUT_MS\s*=\s*90_000/);
  });

  it("Chat upstream timeout is 120s (CHAT_UPSTREAM_TIMEOUT_MS, sized for 12000-maxTokens mock-test sections)", () => {
    expect(DENO_HELPER_SOURCE).toMatch(/export const CHAT_UPSTREAM_TIMEOUT_MS\s*=\s*120_000/);
  });

  it("error-body-read timeout is 5s (ERROR_BODY_READ_TIMEOUT_MS, P1 review patch)", () => {
    expect(DENO_HELPER_SOURCE).toMatch(/export const ERROR_BODY_READ_TIMEOUT_MS\s*=\s*5_000/);
  });

  it("fetchWithTimeout uses AbortSignal.timeout for the request-and-headers phase", () => {
    expect(DENO_HELPER_SOURCE).toContain("AbortSignal.timeout(timeoutMs)");
  });

  it("fetchWithTimeout rejects caller-supplied init.signal with a typed error (P7 review patch)", () => {
    // Story 11-3 review patch P7: the misuse error must be a typed class
    // (not bare Error) so the outer catch can grep for the code.
    expect(DENO_HELPER_SOURCE).toMatch(/export class FetchWithTimeoutMisuseError extends Error/);
    expect(DENO_HELPER_SOURCE).toMatch(/readonly code = "FETCH_WITH_TIMEOUT_MISUSE"/);
    expect(DENO_HELPER_SOURCE).toContain("throw new FetchWithTimeoutMisuseError");
  });

  it("fetchWithTimeout logs to console.warn before throwing UpstreamTimeoutError (P5 review patch)", () => {
    // Story 11-3 review patch P5: surface timeout fires to Supabase function
    // logs so operators can distinguish hung-upstream from other failures.
    expect(DENO_HELPER_SOURCE).toMatch(/console\.warn\([^)]*upstream-timeout[^)]*\)/);
  });

  it("withTimeout helper is exported for body-read coverage (P1 review patch)", () => {
    // Story 11-3 review patch P1: bound body consumption (`.arrayBuffer()`,
    // `.text()`, `.json()`) in addition to the request-and-headers phase.
    expect(DENO_HELPER_SOURCE).toMatch(/export async function withTimeout<T>\(/);
    // Uses Promise.race + a separate timer (not AbortSignal-based)
    expect(DENO_HELPER_SOURCE).toContain("Promise.race");
    // Rejects with UpstreamTimeoutError on expiry
    expect(DENO_HELPER_SOURCE).toMatch(/reject\(new UpstreamTimeoutError\(label, timeoutMs\)\)/);
  });

  it("does NOT use the legacy 'timed out after' format that lacks the 'timeout' substring", () => {
    // Negative guard: catches a regression where the message format is
    // reverted to `"Upstream X timed out after Yms"`, which does NOT
    // contain "timeout" as a substring and would silently break the
    // client-side retry path.
    expect(DENO_HELPER_SOURCE).not.toMatch(/Upstream \$\{upstream\} timed out after/);
  });
});
