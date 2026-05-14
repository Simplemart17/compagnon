/**
 * Story 12-11 — Edge Function `parseUpstreamError` sanitization drift detector.
 *
 * Pins the post-12-11 contract against silent regression by reading the
 * shared `errors.ts` AND the 3 Edge Function files from disk + applying
 * targeted regex assertions. Mirrors Story 12-10's `ci-audit-gate-source-drift.test.ts`
 * pattern.
 *
 * Cases:
 *   (1) `parseUpstreamError` signature contains the 2nd parameter
 *       `upstreamLabel: string` — Story 12-11 deliverable (a)(i).
 *   (2) Return-value template `"Upstream API error (status "` is present
 *       in `parseUpstreamError` body — positive guard on the generic
 *       message path.
 *   (3) NEGATIVE — `parseUpstreamError` body does NOT contain leak
 *       patterns: `return rawText` / `return parsed.message` /
 *       `return errObj.message`. The pre-12-11 JSON-parsing branch was
 *       DELETED ("delete don't alias" pattern); this guard prevents
 *       resurrection.
 *   (4) Each of the 5 caller sites passes a kebab-case lowercase ASCII
 *       label as the 2nd argument to `parseUpstreamError(...)`.
 *   (5) `parseUpstreamError` body contains the `console.error("[upstream-error]"...)`
 *       log call — operator-visible log channel is the LOAD-BEARING
 *       design choice.
 *   (6) Per-file caller count: `ai-proxy/index.ts` has exactly 3 calls;
 *       `pronunciation-assess/index.ts` has exactly 1; `realtime-session/index.ts`
 *       has exactly 1. A future caller added without the label arg fails
 *       Case 4 (the label-arg regex won't match), but Case 6 also catches
 *       the case where a new call site appears outside the current 5.
 */

import * as fs from "fs";
import * as path from "path";

const ERRORS_TS_PATH = path.resolve(__dirname, "../../../supabase/functions/_shared/errors.ts");
const AI_PROXY_PATH = path.resolve(__dirname, "../../../supabase/functions/ai-proxy/index.ts");
const PRONUNCIATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/functions/pronunciation-assess/index.ts"
);
const REALTIME_PATH = path.resolve(
  __dirname,
  "../../../supabase/functions/realtime-session/index.ts"
);

const ERRORS_TS = fs.readFileSync(ERRORS_TS_PATH, "utf-8");
const AI_PROXY = fs.readFileSync(AI_PROXY_PATH, "utf-8");
const PRONUNCIATION = fs.readFileSync(PRONUNCIATION_PATH, "utf-8");
const REALTIME = fs.readFileSync(REALTIME_PATH, "utf-8");

/**
 * Strip /* block * / comments + // line comments so JSDoc that mentions
 * deprecated patterns (e.g., "pre-12-11 the function returned rawText")
 * does not trip the negative-guard regex in Case 3. (Story 12-2 P12 lesson.)
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ERRORS_TS_CODE_ONLY = stripComments(ERRORS_TS);

/**
 * Extract the `parseUpstreamError` function body (from its `export async`
 * declaration to the closing brace of the function). Used by Cases 2, 3,
 * 5 so the assertions are scoped to the function — not the whole file —
 * and don't false-positive on JSDoc / unrelated code. (Story 12-10 H1
 * lesson: whole-file substring matches are brittle.)
 */
function extractParseUpstreamErrorBody(source: string): string {
  // Match from `export async function parseUpstreamError` through the
  // closing brace. We rely on the function having a single top-level
  // body — if it ever gets nested closures with `{ }` we'd need a depth
  // counter; for now a non-greedy match to the next top-level `^}` is
  // sufficient because the body has no top-level closing braces that
  // aren't the function's.
  const match = source.match(/export async function parseUpstreamError[\s\S]*?\n\}\n/);
  return match ? match[0] : "";
}

describe("parseUpstreamError sanitization — Story 12-11 source drift detector", () => {
  it("Case 1: signature contains the 2nd parameter `upstreamLabel: string`", () => {
    // Allow the parameter list to span one or multiple lines (Prettier-tolerant).
    expect(ERRORS_TS_CODE_ONLY).toMatch(
      /export async function parseUpstreamError\(\s*response:\s*Response\s*,\s*upstreamLabel:\s*string\s*\)/
    );
  });

  it('Case 2: parseUpstreamError body contains the generic return-value template `"Upstream API error (status "`', () => {
    const body = extractParseUpstreamErrorBody(ERRORS_TS_CODE_ONLY);
    expect(body).not.toBe("");
    expect(body).toContain("Upstream API error (status ");
  });

  it("Case 3: NEGATIVE — parseUpstreamError body does NOT contain pre-12-11 leak patterns", () => {
    const body = extractParseUpstreamErrorBody(ERRORS_TS_CODE_ONLY);
    expect(body).not.toBe("");
    // The deleted JSON-parsing branch had three distinct leak-return paths:
    //   (a) `return parts.join(...)` where parts started with `errObj.message`
    //   (b) `return parsed.message`
    //   (c) `return rawText` (fallback for unparseable bodies)
    // Pin against each pattern. The post-12-11 body only has
    // `return genericMessage` (the local const) — no upstream content
    // can flow through any of these regexes.
    expect(body).not.toMatch(/return\s+rawText\b/);
    expect(body).not.toMatch(/return\s+parsed[.?]?\.?message\b/);
    expect(body).not.toMatch(/return\s+errObj\.message\b/);
    expect(body).not.toMatch(/return\s+parts\.join\b/);
  });

  it("Case 4: each of the 5 caller sites passes a kebab-case lowercase ASCII label as 2nd arg", () => {
    // The expected label allowlist — drift-pinned here so adding a new
    // label requires extending this list.
    const expectedLabels = [
      "azure-tts",
      "openai-whisper",
      "openai-chat-or-embedding",
      "azure-pronunciation",
      "openai-realtime-token",
    ];

    // Validate each label is kebab-case lowercase ASCII (defense against
    // a future refactor introducing snake_case / camelCase labels).
    for (const label of expectedLabels) {
      expect(label).toMatch(/^[a-z][a-z0-9-]*[a-z0-9]$/);
    }

    // Each label appears in the corresponding Edge Function file.
    expect(AI_PROXY).toMatch(/parseUpstreamError\(\s*\w+\s*,\s*"azure-tts"\s*\)/);
    expect(AI_PROXY).toMatch(/parseUpstreamError\(\s*\w+\s*,\s*"openai-whisper"\s*\)/);
    expect(AI_PROXY).toMatch(/parseUpstreamError\(\s*\w+\s*,\s*"openai-chat-or-embedding"\s*\)/);
    expect(PRONUNCIATION).toMatch(/parseUpstreamError\(\s*\w+\s*,\s*"azure-pronunciation"\s*\)/);
    expect(REALTIME).toMatch(/parseUpstreamError\(\s*\w+\s*,\s*"openai-realtime-token"\s*\)/);
  });

  it('Case 5: parseUpstreamError body contains the `console.error("[upstream-error]"...)` operator-log call', () => {
    const body = extractParseUpstreamErrorBody(ERRORS_TS_CODE_ONLY);
    expect(body).not.toBe("");
    // Pin the prefix substring + upstreamLabel template placement
    // (a single template literal containing both is the post-12-11
    // canonical form).
    expect(body).toMatch(/console\.error\(\s*`\[upstream-error\]\s*\$\{upstreamLabel\}/);
  });

  it("Case 6: per-file caller counts pin exact call sites — 3 / 1 / 1", () => {
    // Count occurrences of `parseUpstreamError(` in each file. A future
    // caller added without going through the label-arg pattern fails
    // Case 4; a future caller added WITH a label still bumps the count
    // and fails this case so the operator must update both the drift
    // detector AND the runbook's label allowlist.
    const aiProxyCount = (AI_PROXY.match(/parseUpstreamError\(/g) || []).length;
    const pronunciationCount = (PRONUNCIATION.match(/parseUpstreamError\(/g) || []).length;
    const realtimeCount = (REALTIME.match(/parseUpstreamError\(/g) || []).length;

    expect(aiProxyCount).toBe(3);
    expect(pronunciationCount).toBe(1);
    expect(realtimeCount).toBe(1);
  });
});
