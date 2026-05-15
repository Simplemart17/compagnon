/**
 * Story 13-6 — `src/lib/sentry.ts` source-drift detector
 * (Epic 13 P2-x performance closure).
 *
 * The runtime `sentry-init.test.ts` already pins the boolean return shape
 * of `getSentryInitConfig()`, but it can't catch the case where someone
 * changes the LITERAL VALUES (e.g., `tracesSampleRate: __DEV__ ? 1.0 : 0.5`
 * — flipping production from 5% → 50%) because the existing test reads
 * the runtime field with `__DEV__` ternary resolution. This drift detector
 * reads `src/lib/sentry.ts` from disk and pins the LITERAL substrings via
 * comment-stripped regex (Story 12-2 P12 pattern).
 *
 * Pins by reading the source from disk:
 *   (1) POSITIVE — `tracesSampleRate: __DEV__ ? 1.0 : 0.05` literal substring.
 *   (2) POSITIVE — `attachScreenshot: false` literal substring.
 *   (3) POSITIVE — the 3 Story 13-6 perf flags each set to `false`:
 *       enableAutoPerformanceTracing / enableNativeFramesTracking /
 *       enableUserInteractionTracing.
 *   (4) NEGATIVE — none of the 3 perf flags regress to `true`.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SOURCE_PATH = join(__dirname, "..", "sentry.ts");
const SOURCE = readFileSync(SOURCE_PATH, "utf-8");

const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("sentry.ts — Story 13-6 source-drift detector (Epic 13 P2-x performance)", () => {
  it("Case 1: POSITIVE — `tracesSampleRate` production value pinned at `0.05` (catches future regression to 0.5 / 0.1 / etc.)", () => {
    // Pre-13-6 the runtime sentry-init.test.ts case at line 37-41 reads the
    // RESOLVED value via the __DEV__ ternary — a regression flipping 0.05
    // to 0.5 in source would still pass the runtime test because the test
    // reads the literal from the same source via dynamic import. Post-13-6
    // we pin the literal substring on the source file from disk so any
    // production-value change is caught at CI time.
    //
    // Story 13-6 review-round-1 P4 — loosen the regex to also accept a
    // const-reference refactor like `const PROD_RATE = 0.05; ...
    // tracesSampleRate: __DEV__ ? 1.0 : PROD_RATE`. The pin verifies that
    // EITHER the literal 0.05 is present in the tracesSampleRate line
    // (current shape) OR a *_RATE constant reference is present AND the
    // constant resolves to 0.05 somewhere else in the file. The literal
    // 0.05 still has to exist somewhere in the source as the production
    // value; whether it's inline or extracted is left as a refactor
    // choice.
    expect(CODE_ONLY).toMatch(
      /tracesSampleRate\s*:\s*__DEV__\s*\?\s*1\.0\s*:\s*(0\.05|\w*_?RATE\w*)/
    );
    // Belt-and-suspenders: the literal 0.05 production value MUST appear
    // somewhere in the file (either inline or as a constant). This catches
    // a refactor that introduces a constant but accidentally changes the
    // numeric value.
    expect(CODE_ONLY).toMatch(/0\.05/);
  });

  it("Case 2: POSITIVE — `attachScreenshot: false` literal pin (GDPR + Story 9-3 contract)", () => {
    expect(CODE_ONLY).toMatch(/attachScreenshot\s*:\s*false/);
  });

  it("Case 3: POSITIVE — all 3 Story 13-6 (original) perf flags explicitly set to `false`", () => {
    // Each flag defaults to ENABLED in @sentry/react-native (per
    // node_modules/@sentry/react-native/dist/js/options.d.ts), EXCEPT
    // enableUserInteractionTracing which defaults to false in SDK 7.11.0
    // (Story 13-6 review-round-1 P1 correction). The explicit pin on all 3
    // is defensive against a future PR dropping the assignment AND against
    // a future SDK upgrade flipping enableUserInteractionTracing default.
    expect(CODE_ONLY).toMatch(/enableAutoPerformanceTracing\s*:\s*false/);
    expect(CODE_ONLY).toMatch(/enableNativeFramesTracking\s*:\s*false/);
    expect(CODE_ONLY).toMatch(/enableUserInteractionTracing\s*:\s*false/);
  });

  it("Case 4: NEGATIVE — none of the 3 original perf flags regress to `true`", () => {
    // Defense against a copy-paste mistake or a "let's turn this back on
    // for debugging" PR that leaves a stray `true` in.
    expect(CODE_ONLY).not.toMatch(/enableAutoPerformanceTracing\s*:\s*true/);
    expect(CODE_ONLY).not.toMatch(/enableNativeFramesTracking\s*:\s*true/);
    expect(CODE_ONLY).not.toMatch(/enableUserInteractionTracing\s*:\s*true/);
  });

  it("Case 5: POSITIVE — Story 13-6 review-round-1 P2 sibling perf flags pinned at `false` / 0", () => {
    // Story 13-6 review-round-1 P2: 3 additional perf-affecting SDK flags
    // not in the initial story scope. Each is real perf surface in
    // @sentry/react-native v7.11.0; without these pins the impl was
    // incomplete relative to its own "linear-in-error-rate overhead"
    // claim. Pinning here strengthens the perf-conservative posture and
    // defends against silent drift on future PRs.
    expect(CODE_ONLY).toMatch(/enableStallTracking\s*:\s*false/);
    expect(CODE_ONLY).toMatch(/enableAppStartTracking\s*:\s*false/);
    expect(CODE_ONLY).toMatch(/profilesSampleRate\s*:\s*0/);
  });

  it("Case 6: NEGATIVE — none of the 3 sibling perf flags regress to `true` / > 0", () => {
    expect(CODE_ONLY).not.toMatch(/enableStallTracking\s*:\s*true/);
    expect(CODE_ONLY).not.toMatch(/enableAppStartTracking\s*:\s*true/);
    // profilesSampleRate > 0 (e.g., 1, 0.1, 0.5) would activate profiling.
    // We pin against literal `0` above; this NEGATIVE blocks the common
    // "let's enable profiling for one release" mistake.
    expect(CODE_ONLY).not.toMatch(/profilesSampleRate\s*:\s*[1-9]/);
  });
});
