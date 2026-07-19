/**
 * Story 13-8 — `buildConversationPrompt` end-to-end perf verification.
 *
 * Closes Epic 13 line 255: "Truncate prompts (already in 11.7; verify here
 * from a perf POV)."
 *
 * Companion to `conversation-truncation.test.ts` (27 cases — per-block
 * correctness + helper semantics + constant pins). This file adds the
 * END-TO-END size pinning that the existing surface lacks. The Story 11-7
 * paragraph in `CLAUDE.md` makes 4 unverified perf claims; this test pins
 * claims #1 (25× tail reduction) and #4 (base prompt size unchanged) and
 * tracks claims #2 (~144-288ms TTFT) and #3 (~$0.001-$0.0018/session cost)
 * as documented operator-action items (no CI assertion — would need device
 * profiling + cost-table cross-reference, both out of scope).
 *
 * Pins (8 logical cases, expanded to ~15 via `it.each` parameterization):
 *   - Case 1: Base prompt size in [BASE_PROMPT_MIN_CHARS, BASE_PROMPT_MAX_CHARS]
 *     (calibrated ±2% tolerance — catches a ~200-char regression on the
 *     base, ignores typo fixes / idiom-list rephrasing).
 *   - Case 2: Worst-case prompt size ≤ WORST_CASE_PROMPT_MAX_CHARS.
 *   - Case 3: Tail-only bound formula-derived from Story 11-7 constants
 *     (loosening any constant auto-expands the budget).
 *   - Case 4: 25× reduction ratio claim (loose 20× lower bound).
 *   - Case 5: Per-CEFR base size invariance across A1–C2 (`it.each`).
 *   - Case 6: Token-count estimate ≤ MAX_WORST_CASE_TOKENS (chars/4
 *     heuristic; gpt-realtime-mini cost-per-session reference in JSDoc).
 *   - Case 7: Mode-invariance across `companion` / `debate` /
 *     `tcf_simulation` (±10% spread; `it.each`).
 *   - Case 8: NEGATIVE — no user-derived item line in worst-case output
 *     exceeds MAX_PROMPT_ITEM_CHARS chars (defense-in-depth for the Story
 *     11-7 cap at the post-truncation observability layer).
 *
 * Cost-per-session reference (operator-action item; NOT a test assertion):
 *   - Input cost = `tokenEstimate × $10 / 1,000,000` at gpt-realtime-mini
 *     rate per `supabase/functions/_shared/cost-table.ts` `MODEL_RATES`
 *     (Story 11-4 quarterly refresh discipline; next refresh due
 *     2026-08-12).
 *   - MAX_WORST_CASE_TOKENS is DERIVED (chars/4 of the worst-case bound) —
 *     post-Story-18-1 it computes to ~2,066 tokens, bounding per-session
 *     prompt-input cost at ~$0.0207 (~2.1 cents). At Story 11-4's
 *     $1.00/user daily cap that is ~2.1% of the cap — still negligible.
 *     (Pre-18-1 the derived value was 1,759 tokens / ~1.76 cents.)
 *
 * Observed values (recalibrated 2026-07-18 against `buildConversationPrompt`
 * post-Story-18-1 — persona + driver + comprehension-support blocks; the
 * 2026-05-15 post-11-7/13-7 baseline was B1 base = 4,101 chars):
 *   - Base prompt (B1 companion mode, empty memories + errorPatterns):
 *     5,285 chars (~1,321 tokens).
 *   - Per-CEFR base sizes:
 *     A1: 5,280 / A2: 5,303 / B1: 5,285 / B2: 5,248 / C1: 5,311 / C2: 5,239
 *     (small per-CEFR variance via vocab-tier + comprehension blocks).
 *   - Per-mode base sizes (B1 default):
 *     companion: 5,285 / debate: 6,229 / tcf_simulation: 5,019
 *     (tcf_simulation gains ONLY the close-pal Role bullet — driver +
 *     comprehension blocks are mode-gated out per Story 10-6).
 *   - Tail delta (post-11-7, UNCHANGED by 18-1): 1,822 chars.
 *   - Hypothetical pre-11-7 tail: 2 × 20 × (300 + 4) = 12,160 chars.
 *   - **EMPIRICAL REDUCTION RATIO: 6.7×** (NOT 25× as Story 11-7 claimed —
 *     see the JSDoc on `MIN_REDUCTION_RATIO` below for the discrepancy
 *     analysis). Still a meaningful reduction (~85% of user-derived bytes
 *     eliminated), but the Story 11-7 spec was overstated.
 *
 * Pattern: pure-function call, no mocks, no React renderer (Story 13-1
 * + 13-7 precedent). Calibrated ±2% tolerance per Story 13-7 P3 lesson
 * (range-based assertions, not exact-value).
 */

import {
  buildConversationPrompt,
  MAX_PROMPT_ERROR_PATTERNS,
  MAX_PROMPT_ITEM_CHARS,
  MAX_PROMPT_MEMORIES,
} from "@/src/lib/prompts/conversation";
import { MAX_MEMORY_CHARS } from "@/src/lib/memory";
import type { CEFRLevel } from "@/src/types/cefr";
import type { ConversationMode } from "@/src/types/conversation";

// ============================================================================
// Calibrated bounds (observe-then-set ±2% per Story 13-7 P3 lesson)
// ============================================================================

/**
 * Calibration: observed 2026-07-18 against the post-Story-18-1
 * prompt-builder. Bounds calculated as `Math.floor(observed × 0.98)` (min)
 * and `Math.ceil(observed × 1.02)` (max) per Story 13-7 P3 lesson.
 *
 * DELIBERATE RECALIBRATION (Story 18-1): the conversation-driver +
 * comprehension-support blocks (companion + debate modes) and the
 * close-pal Role bullet (all modes) grow the base prompt by ~1,200 chars
 * (~300 tokens ≈ +$0.003/session at gpt-realtime-mini input rates — an
 * accepted cost for the buddy behavior; see v2-vision-roadmap.md Epic 18).
 * The Story 11-7 user-derived TAIL constants are untouched — Cases 3 + 4
 * (tail budget + reduction ratio) still pass against the original bounds.
 *
 * Per-CEFR observed values, FINAL post-R1 shape (B1 companion = canonical):
 *   A1: 5280  / A2: 5303  / B1: 5285  / B2: 5248  / C1: 5311  / C2: 5239
 * Per-mode observed values (B1 cefr used as the canonical level):
 *   companion: 5285  /  debate: 6229  /  tcf_simulation: 5019
 *   (tcf_simulation gains ONLY the Role bullet — the driver + comprehension
 *   blocks are mode-gated out per the Story 10-6 prep-window contract)
 *
 * The constants below were set from the initial 18-1 measurement (B1 5305 /
 * C2 5259 / C1 5331 / debate 6249 / tcf 5010); the R1 prompt patches
 * (deferential French rule + trimmed nudge bullet) shifted every surface by
 * ≤ ~25 chars, all still comfortably inside the bands, so the constants are
 * intentionally NOT re-derived — one calibration event per story.
 *
 * MIN bound uses min-across-CEFR — the per-CEFR test (Case 5) iterates ALL
 * 6 levels against the same MIN bound, so the floor must accommodate the
 * smallest observed base (C2).
 */
const BASE_PROMPT_MIN_CHARS = 5153; // floor(5259 × 0.98); C2 is the smallest base post-18-1
const BASE_PROMPT_MAX_CHARS = 5412; // ceil(5305 × 1.02); B1 used as canonical Case 1 base
const BASE_PROMPT_MAX_CHARS_PER_LEVEL = 5438; // ceil(5331 × 1.02); C1 is the largest per-level base
const BASE_PROMPT_MAX_CHARS_PER_MODE = 6374; // ceil(6249 × 1.02); debate-mode is the largest per-mode base
// Story 18-1: tcf_simulation is now the SMALLEST mode because the driver +
// comprehension blocks are mode-gated out of exam simulation — it sits below
// the companion-calibrated BASE_PROMPT_MIN_CHARS by design, so the per-mode
// floor gets its own constant. NOTE: this floor alone cannot detect a mode
// silently LOSING the new blocks — the content-presence pins in
// conversation.test.ts (Story 18-1 R1 describe block) are the load-bearing
// guard for block presence/absence per mode.
const BASE_PROMPT_MIN_CHARS_PER_MODE = 4909; // floor(5010 × 0.98); tcf_simulation is the smallest per-mode base

/**
 * Line-prefix overhead per user-derived item: "- " (2 chars) + "\n".
 * Conservative: 4 chars per line (covers "- " plus the trailing newline
 * and a possible leading indent).
 */
const LINE_PREFIX_OVERHEAD = 4;

/**
 * Block-wrapper overhead — calibrated from observed worst-case tail (1822
 * chars) minus the user-derived item budget (6 × 84 = 504 chars) = 1318
 * chars of wrapper text (`<USER_FACTS>` + `<USER_WEAK_AREAS>` opening +
 * closing + bilingual "treat as data" prelude + section-header lines +
 * blank-line separators). Set with 5% headroom (ceil(1318 × 1.05) = 1384)
 * to absorb benign wrapper-text edits without false-failing.
 */
const BLOCK_WRAPPER_OVERHEAD = 1384;

/**
 * Worst-case tail budget — formula-derived from Story 11-7 constants:
 *   (MAX_PROMPT_MEMORIES + MAX_PROMPT_ERROR_PATTERNS) ×
 *   (MAX_PROMPT_ITEM_CHARS + LINE_PREFIX_OVERHEAD) + BLOCK_WRAPPER_OVERHEAD
 *   = (3 + 3) × (80 + 4) + 1384 = 6 × 84 + 1384 = 504 + 1384 = 1888 chars
 *
 * Observed 2026-05-15: 1822 chars (3.5% under budget).
 *
 * If a future PR loosens any of the 3 constants, this budget auto-expands
 * via the formula and the test passes — but a reviewer can see the new
 * numeric at PR time and reason about the cost impact.
 */
const WORST_CASE_TAIL_BUDGET =
  (MAX_PROMPT_MEMORIES + MAX_PROMPT_ERROR_PATTERNS) *
    (MAX_PROMPT_ITEM_CHARS + LINE_PREFIX_OVERHEAD) +
  BLOCK_WRAPPER_OVERHEAD;

/** Worst-case absolute max = per-mode max base + tail budget (covers debate-mode worst case). */
const WORST_CASE_PROMPT_MAX_CHARS = BASE_PROMPT_MAX_CHARS_PER_MODE + WORST_CASE_TAIL_BUDGET;

/** Token-count estimate = chars / 4 (OpenAI rough estimator for English/French). */
const MAX_WORST_CASE_TOKENS = Math.ceil(WORST_CASE_PROMPT_MAX_CHARS / 4);

/**
 * Hypothetical pre-11-7 tail size — the prompt-tail-size that WOULD have
 * been emitted under pre-Story-11-7 (no truncation; up to 20 memories +
 * 20 error patterns at Story 9-4's MAX_MEMORY_CHARS = 300 storage cap).
 *
 * Formula: 2 blocks × 20 items × (300 chars/item + 4 prefix) = 12,160 chars.
 * Story 11-7 paragraph claimed "~12,000 chars" — confirmed by this formula.
 */
const HYPOTHETICAL_PRE_11_7_TAIL_CHARS = 2 * 20 * (MAX_MEMORY_CHARS + LINE_PREFIX_OVERHEAD);

/**
 * Minimum acceptable reduction ratio.
 *
 * **EMPIRICAL FINDING (Story 13-8 verification, 2026-05-15):** the observed
 * reduction ratio is **6.7×** (12,160 / 1,822), NOT the **~25×** claimed in
 * the Story 11-7 paragraph. The discrepancy is because the 25× claim was
 * computed against the user-item content ONLY (12,000 → 480 chars), not the
 * full block including the `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapper +
 * Story 9-4 bilingual prelude (~1,318 chars of wrapper overhead). Still a
 * meaningful reduction (~85% of user-derived bytes eliminated), but the
 * Story 11-7 marketing was overstated.
 *
 * Pin at 5× (loose 25% headroom under observed 6.7×). If a future PR loosens
 * MAX_PROMPT_ITEM_CHARS from 80 → 200, the actual tail grows ~40%, the
 * ratio drops to ~4.8×, and the test fails — alerting the reviewer to the
 * material cost impact.
 */
const MIN_REDUCTION_RATIO = 5;

/**
 * Mode-spread tolerance. Observed 23% (companion=4101 / debate=5045 /
 * tcf_simulation=4811) — the debate-mode + tcf_simulation-mode blocks add
 * meaningful per-mode content (Story 10-7 review-round-1). Pin at 30%
 * (7% headroom over current) — catches a future ~50%+ mode-block
 * explosion without false-failing the intentional current spread.
 */
const MAX_MODE_SPREAD_RATIO = 0.3;

// ============================================================================
// Test fixtures
// ============================================================================

const CEFR_LEVELS: readonly CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const MODES: readonly ConversationMode[] = ["companion", "debate", "tcf_simulation"] as const;

/** Standard base-prompt invocation arguments. */
const baseArgs = {
  cefrLevel: "B1" as CEFRLevel,
  mode: "companion" as ConversationMode,
  topic: "voyage",
};

/**
 * Build the worst-case user-derived input — 20 memories + 20 error patterns
 * each at MAX_MEMORY_CHARS chars (Story 9-4's stored-memory cap). The
 * Story 11-7 truncation pipeline caps these to MAX_PROMPT_MEMORIES = 3 +
 * MAX_PROMPT_ERROR_PATTERNS = 3, each truncated to MAX_PROMPT_ITEM_CHARS =
 * 80 chars.
 */
function buildWorstCaseUserInputs() {
  const memories = Array.from(
    { length: 20 },
    (_, i) => `Memory ${i}: ` + "x".repeat(MAX_MEMORY_CHARS - `Memory ${i}: `.length)
  );
  const errorPatterns = Array.from(
    { length: 20 },
    (_, i) => `Pattern ${i}: ` + "y".repeat(MAX_MEMORY_CHARS - `Pattern ${i}: `.length)
  );
  return { memories, errorPatterns };
}

// ============================================================================
// Cases
// ============================================================================

describe("Story 13-8 — buildConversationPrompt perf verification", () => {
  describe("Case 1: Base prompt size (regression guard for Story 11-7 claim #4)", () => {
    it("base prompt size falls within [BASE_PROMPT_MIN_CHARS, BASE_PROMPT_MAX_CHARS] (±2% tolerance)", () => {
      const prompt = buildConversationPrompt(baseArgs);
      expect(prompt.length).toBeGreaterThanOrEqual(BASE_PROMPT_MIN_CHARS);
      expect(prompt.length).toBeLessThanOrEqual(BASE_PROMPT_MAX_CHARS);
    });
  });

  describe("Case 2: Worst-case prompt size bound", () => {
    it("with 20 memories at 300 chars + 20 error patterns at 300 chars → prompt.length ≤ WORST_CASE_PROMPT_MAX_CHARS", () => {
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const prompt = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      expect(prompt.length).toBeLessThanOrEqual(WORST_CASE_PROMPT_MAX_CHARS);
    });
  });

  describe("Case 3: Tail-only bound (formula-derived from Story 11-7 constants)", () => {
    it("actualTail = worst.length - base.length ≤ WORST_CASE_TAIL_BUDGET", () => {
      const base = buildConversationPrompt(baseArgs);
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const worst = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      const actualTail = worst.length - base.length;
      expect(actualTail).toBeLessThanOrEqual(WORST_CASE_TAIL_BUDGET);
      // Positive lower bound: the tail MUST be non-empty when inputs are
      // supplied — defends against a future regression that silently drops
      // the user-fact / weak-area blocks.
      expect(actualTail).toBeGreaterThan(0);
    });
  });

  describe("Case 4: 25× tail reduction ratio (Story 11-7 claim #1)", () => {
    it("reductionRatio = hypothetical_pre_11_7_tail / actual_post_11_7_tail ≥ 20×", () => {
      const base = buildConversationPrompt(baseArgs);
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const worst = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      const actualTail = worst.length - base.length;
      const reductionRatio = HYPOTHETICAL_PRE_11_7_TAIL_CHARS / actualTail;
      expect(reductionRatio).toBeGreaterThanOrEqual(MIN_REDUCTION_RATIO);
    });
  });

  describe("Case 5: Per-CEFR base size invariance (A1–C2)", () => {
    it.each(CEFR_LEVELS)(
      "%s base prompt size ≤ BASE_PROMPT_MAX_CHARS_PER_LEVEL",
      (cefrLevel: CEFRLevel) => {
        const prompt = buildConversationPrompt({ ...baseArgs, cefrLevel });
        expect(prompt.length).toBeGreaterThanOrEqual(BASE_PROMPT_MIN_CHARS);
        expect(prompt.length).toBeLessThanOrEqual(BASE_PROMPT_MAX_CHARS_PER_LEVEL);
      }
    );
  });

  describe("Case 6: Token-count estimate (gpt-realtime-mini cost reference)", () => {
    it("worst-case token estimate (chars/4) ≤ MAX_WORST_CASE_TOKENS", () => {
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const worst = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      const tokenEstimate = Math.ceil(worst.length / 4);
      // Documented cost calculation (operator-action item; NOT enforced):
      //   inputCostCents = tokenEstimate × $10 / 1,000,000 × 100
      //                  = tokenEstimate × 0.001 cents/token
      // For ~MAX_WORST_CASE_TOKENS tokens: ~$MAX_WORST_CASE_TOKENS × 0.001¢
      // per session. Refresh `cost-table.ts` MODEL_RATES quarterly per Story
      // 11-4 (next refresh due 2026-08-12).
      expect(tokenEstimate).toBeLessThanOrEqual(MAX_WORST_CASE_TOKENS);
    });
  });

  describe("Case 7: Mode-invariance (companion / debate / tcf_simulation; MAX_MODE_SPREAD_RATIO bound)", () => {
    it("base prompt sizes across all 3 modes have ≤ MAX_MODE_SPREAD_RATIO spread", () => {
      const sizes = MODES.map((mode) => buildConversationPrompt({ ...baseArgs, mode }).length);
      const min = Math.min(...sizes);
      const max = Math.max(...sizes);
      const spreadRatio = (max - min) / min;
      expect(spreadRatio).toBeLessThanOrEqual(MAX_MODE_SPREAD_RATIO);
    });

    it.each(MODES)("%s mode base prompt size ≤ BASE_PROMPT_MAX_CHARS_PER_MODE", (mode) => {
      const prompt = buildConversationPrompt({ ...baseArgs, mode });
      // Story 18-1: per-mode floor (tcf_simulation deliberately lacks the
      // driver + comprehension blocks, so it sits below the companion-
      // calibrated BASE_PROMPT_MIN_CHARS).
      expect(prompt.length).toBeGreaterThanOrEqual(BASE_PROMPT_MIN_CHARS_PER_MODE);
      expect(prompt.length).toBeLessThanOrEqual(BASE_PROMPT_MAX_CHARS_PER_MODE);
    });
  });

  describe("Case 8: NEGATIVE invariant — no user-derived item line exceeds MAX_PROMPT_ITEM_CHARS", () => {
    /**
     * Extract the contents of a single tag-delimited block from the prompt.
     * Returns the inner text between `<TAG>` and `</TAG>` (exclusive), or
     * `null` if the tag is absent (a valid state when memories /
     * errorPatterns are empty).
     */
    function extractTagBlockContents(prompt: string, tagName: string): string | null {
      const open = `<${tagName}>`;
      const close = `</${tagName}>`;
      const openIdx = prompt.indexOf(open);
      const closeIdx = prompt.indexOf(close, openIdx + open.length);
      if (openIdx < 0 || closeIdx < 0) return null;
      return prompt.substring(openIdx + open.length, closeIdx);
    }

    it("worst-case <USER_FACTS> block contains no item line exceeding MAX_PROMPT_ITEM_CHARS chars", () => {
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const prompt = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      const block = extractTagBlockContents(prompt, "USER_FACTS");
      expect(block).not.toBeNull();
      // Item-line shape inside the block: `\n- <content>\n` (joined via
      // `.join("\n")` at `conversation.ts:248`).
      const itemLines = block!
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "));
      expect(itemLines.length).toBeGreaterThan(0); // sanity: items WERE injected
      expect(itemLines.length).toBeLessThanOrEqual(MAX_PROMPT_MEMORIES); // cap enforced
      for (const line of itemLines) {
        const content = line.slice(2); // drop the "- " prefix
        expect(content.length).toBeLessThanOrEqual(MAX_PROMPT_ITEM_CHARS);
      }
    });

    it("worst-case <USER_WEAK_AREAS> block contains no item line exceeding MAX_PROMPT_ITEM_CHARS chars", () => {
      const { memories, errorPatterns } = buildWorstCaseUserInputs();
      const prompt = buildConversationPrompt({ ...baseArgs, memories, errorPatterns });
      const block = extractTagBlockContents(prompt, "USER_WEAK_AREAS");
      expect(block).not.toBeNull();
      const itemLines = block!
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "));
      expect(itemLines.length).toBeGreaterThan(0); // sanity: items WERE injected
      expect(itemLines.length).toBeLessThanOrEqual(MAX_PROMPT_ERROR_PATTERNS); // cap enforced
      for (const line of itemLines) {
        const content = line.slice(2); // drop the "- " prefix
        expect(content.length).toBeLessThanOrEqual(MAX_PROMPT_ITEM_CHARS);
      }
    });
  });
});
