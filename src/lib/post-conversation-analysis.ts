/**
 * Consolidated post-conversation analysis (Story 11-5 / audit P1-10).
 *
 * Single AI call that replaces the pre-11-5 3-call pipeline:
 *   1. extractAndStoreMemories(transcript) — fact extraction
 *   2. extractErrorsFromCorrections(corrections) — error-pattern enrichment
 *   3. inline conversation-feedback prompt — feedback summary
 *
 * Saves ~1.25¢ per conversation on input cost (the transcript is now
 * counted once instead of three times). Output cost is roughly the same
 * (~1500 tokens vs 3 × ~500 tokens). User-perceived latency drops from
 * ~9s (3 serial calls) to ~3s (1 combined). The Story 11-4 daily-cost-cap
 * pre-check tightens automatically because maxTokens dropped from
 * 2048 × 3 = 6144 to a single 1500.
 *
 * Partial-result tolerance: the schema's sub-arrays are `.default([])`
 * and `feedback` is `.optional()` so if the model can't produce one of
 * the three outputs, the others still parse cleanly. Pre-11-5 fire-and-
 * forget semantics for memories + error patterns are preserved (a
 * model-side failure on either silently no-ops the corresponding persist).
 *
 * The non-Realtime flows (`use-echo-practice` + `use-translation`) still
 * use `extractErrorsFromCorrections` from `error-tracker.ts` directly —
 * they don't have a transcript / feedback to consolidate with.
 */

import type { CEFRLevel } from "@/src/types/cefr";
import type { Correction, ConversationFeedback } from "@/src/types/conversation";

import { chatCompletionJSON } from "./openai";
import { addBreadcrumb, captureError } from "./sentry";
import { supabase } from "./supabase";
import { persistErrorPatterns } from "./error-tracker";
import { persistMemories } from "./memory";
import {
  postConversationAnalysisSchema,
  type PostConversationAnalysisInferred,
} from "./schemas/ai-responses";
import { buildPostConversationAnalysisPrompt } from "./prompts/post-conversation-analysis";

/** Minimum transcript length to bother analyzing (matches pre-11-5 50-char guard). */
const MIN_TRANSCRIPT_CHARS = 50;

/**
 * maxTokens budget for the combined analysis call.
 *   feedback ~150 tokens + facts ~500 tokens + errorPatterns ~500 tokens
 *   + JSON envelope ~50 tokens = ~1200 tokens output; 1500 leaves headroom.
 *
 * Story 11-5: explicit per-call right-sizing (the openai.ts default
 * dropped from 2048 to 800; every call site now specifies its own).
 */
export const POST_CONVERSATION_ANALYSIS_MAX_TOKENS = 1500;

export type PostConversationAnalysis = PostConversationAnalysisInferred;

/**
 * Build the combined system+user prompt + invoke `chatCompletionJSON`.
 * Returns the parsed analysis or an all-empty default if the transcript
 * is below the minimum length threshold.
 *
 * Schema parse failure (after Story 9-7's `parseRetries: 1` retry) bubbles
 * as a thrown error from `chatCompletionJSON`. The caller (`persistConversation`)
 * wraps this in a try/catch that returns the all-empty default so the
 * rest of `persistConversation` (skill progress + streak + daily activity
 * + CEFR promotion) continues unaffected — matches pre-11-5 fire-and-forget
 * semantics for the post-conversation enrichment.
 */
export async function extractPostConversationAnalysis(args: {
  transcript: string;
  corrections: readonly Correction[];
  cefrLevel: CEFRLevel;
}): Promise<PostConversationAnalysis> {
  if (typeof args.transcript !== "string" || args.transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { facts: [], errorPatterns: [], feedback: undefined };
  }

  const { system, user } = buildPostConversationAnalysisPrompt({
    cefrLevel: args.cefrLevel,
    transcript: args.transcript,
    corrections: [...args.corrections],
  });

  const result = (await chatCompletionJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    postConversationAnalysisSchema,
    {
      temperature: 0.3,
      maxTokens: POST_CONVERSATION_ANALYSIS_MAX_TOKENS,
      feature: "post-conversation-analysis",
    }
  )) as Partial<PostConversationAnalysis> | null;

  // Story 11-5 review patch P8: defensive defaults instead of bare `as`-cast.
  // Zod's `.default([])` fires on `undefined` but NOT on `null`; an
  // unexpected `null` from a custom transform or a future refactor would
  // make `analysis.facts.map(...)` throw TypeError downstream. Normalize
  // at this boundary so all callers see a consistent shape.
  const normalized: PostConversationAnalysis = {
    facts: Array.isArray(result?.facts) ? result.facts : [],
    errorPatterns: Array.isArray(result?.errorPatterns) ? result.errorPatterns : [],
    feedback: result?.feedback ?? undefined,
  };

  // Story 11-5 review patch P2: detect the silent-empty-result failure
  // mode where the model returned `{}` (or an all-empty equivalent) despite
  // a long transcript. The schema's `.default([])` + `.optional()` accept
  // empty output WITHOUT triggering Story 9-7's `parseRetries: 1`, so an
  // empty result is indistinguishable from a parse failure to the caller.
  // We breadcrumb the suspicion so operators can spot a model that's
  // silently producing no useful output for long sessions.
  if (
    normalized.facts.length === 0 &&
    normalized.errorPatterns.length === 0 &&
    normalized.feedback === undefined
  ) {
    addBreadcrumb({
      category: "ai",
      level: "warning",
      message: "post-conversation-analysis produced all-empty output for long transcript",
      data: {
        feature: "post-conversation-analysis-empty",
        // Bounded numeric — Story 9-3 allowlist-safe.
        key: "transcript-length",
      },
    });
  }

  return normalized;
}

/**
 * Persist the parsed analysis via three parallel writes. Uses
 * `Promise.allSettled` so a failure on any one slot doesn't block the
 * others — matches pre-11-5 semantics where memory + error-pattern
 * persists were fire-and-forget independently.
 *
 * Returns `{ feedback }` so the caller can update the UI surface with
 * the parsed feedback (or `undefined` for the no-feedback case). Per-slot
 * rejections are routed through `captureError(_, "post-conversation-persist")`.
 */
export async function persistPostConversationAnalysis(args: {
  userId: string;
  conversationId: string;
  analysis: PostConversationAnalysis;
}): Promise<{ feedback: ConversationFeedback | undefined }> {
  const { userId, conversationId, analysis } = args;

  const results = await Promise.allSettled([
    persistMemories(userId, conversationId, analysis.facts),
    persistErrorPatterns(userId, analysis.errorPatterns),
    analysis.feedback
      ? supabase
          .from("conversations")
          .update({ ai_feedback: analysis.feedback })
          .eq("id", conversationId)
      : Promise.resolve({ error: null } as { error: { message: string } | null }),
  ]);

  // Story 11-5 review patch P3: Supabase JS v2 query builders resolve with
  // `{ data, error }` and NEVER reject on Postgres errors (RLS denial,
  // FK violation, PostgrestError, etc.) — only network-level failures
  // surface as rejections. A naive `status === "rejected"` check misses
  // every Postgres-side write failure, so feedback could show in the UI
  // (returned from in-memory `analysis.feedback`) while the DB never gets
  // updated. We now inspect `result.value?.error` on fulfilled supabase
  // slots and route them through captureError too.
  for (const r of results) {
    if (r.status === "rejected") {
      captureError(
        r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
        "post-conversation-persist"
      );
      continue;
    }
    // Fulfilled slot — inspect for a Supabase-style `{ error }` payload.
    const v = r.value as { error?: { message?: string } | null } | undefined;
    if (v && v.error && typeof v.error === "object") {
      captureError(
        new Error(v.error.message ?? "post-conversation-persist supabase error"),
        "post-conversation-persist"
      );
    }
  }

  return { feedback: analysis.feedback };
}
