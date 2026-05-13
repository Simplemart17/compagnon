/**
 * Pure helpers for capping the in-memory voice-conversation transcript at
 * a fixed length (Story 12-6). Closes audit finding **P2-8** at
 * `_bmad-output/planning-artifacts/shippable-roadmap.md` line 86
 * ("`transcriptRef.current` grows unbounded; CLAUDE.md performance
 * budget says cap at 100 — not implemented") via the Epic 12.6
 * deliverable at line 209 ("Cap `transcriptRef` at 200 entries; spill
 * older to disk if needed.").
 *
 * Cap policy:
 *   - `MAX_TRANSCRIPT_ENTRIES = 200` — chosen so realistic 5-min TCF
 *     sessions (~30-50 turns) leave ~6× headroom while bounding
 *     pathological / debug sessions at a predictable budget. Story
 *     12-1's CLAUDE.md paragraph pre-commits to this value:
 *     "12-6 transcriptRef 200-entry cap operates on the orchestrator's
 *     private `transcript` field."
 *   - **FIFO eviction** — when a new entry would push `transcript.length`
 *     over 200, the OLDEST entries (lowest index) are evicted.
 *   - **Cap-then-evict sequencing** — the newly-appended entry is NEVER
 *     evicted in the same operation. The helper appends first, then
 *     slices the tail-200; the just-appended entry always lives at the
 *     end of the returned array.
 *   - **Pure** — input arrays are NEVER mutated; new arrays are always
 *     returned (matches Story 9-5's `appendIfNew` immutability invariant
 *     so React reference-equality optimizations trigger correctly).
 *   - **Caller-owned spill** — evicted entries are returned in the
 *     `evicted` array; the orchestrator pushes their DB-payload shape
 *     (via `toMessagePayload`) into `spilledMessages` for persist-time
 *     batch insert so the DB sees the COMPLETE conversation regardless
 *     of in-memory cap eviction.
 *
 * **Architectural pattern alignment:**
 * - Single-source-of-truth-via-module-level-helper idiom — mirrors
 *   Story 11-7's `MAX_PROMPT_MEMORIES` / `MAX_PROMPT_ERROR_PATTERNS` /
 *   `truncateToBytes` exports; Story 10-8's `MIN_FRESH_QUESTIONS_PER_SKILL`
 *   + pipeline helpers; Story 9-5's `DEDUP_SET_CAP` + `appendIfNew`.
 * - Composes downstream of Story 9-5's `appendIfNew` dedup — a deduped
 *   event never reaches `applyTranscriptCap` (the caller's
 *   `if (!result.appended) return false` short-circuits before any cap
 *   call).
 *
 * **Cross-story invariants preserved by construction:**
 * - Story 9-4 stored-prompt-injection defense: cap is pure transformation
 *   on `TranscriptEntry[]`; no user-input flows through it.
 * - Story 9-5 voice-transcript dedup: cap runs DOWNSTREAM; the dedup
 *   contract in `realtime-transcript.ts` is unchanged.
 * - Story 11-1 tool-call orphan-drain: `mergeOrphanCorrections` operates
 *   on `corrections`, not `transcript` — orthogonal.
 * - Story 11-2 reconnect + barge-in: orthogonal — no WebSocket interaction.
 * - Story 12-1 orchestrator structure + frozen `getState()`: cap returns
 *   NEW arrays which the existing setState + Object.freeze flow snapshots.
 */
import type { Correction } from "@/src/types/conversation";

import type { TranscriptEntry } from "./realtime-transcript";

/**
 * Maximum number of in-memory transcript entries before FIFO eviction
 * kicks in. Pinned at 200 per Story 12-1's CLAUDE.md commitment.
 */
export const MAX_TRANSCRIPT_ENTRIES = 200;

/**
 * DB-payload shape for a `conversation_messages` row. Drops the
 * in-memory bookkeeping fields (`id`, `timestamp`) that `TranscriptEntry`
 * carries — those exist for dedup + React `keyExtractor` stability only.
 * Matches the inline shape used by `realtime-orchestrator.ts`'s
 * `messages = this.transcript.map(...)` at the Slot 1 + offline-queue
 * sites pre-12-6.
 */
export interface ConversationMessagePayload {
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  corrections: Correction[] | null;
}

export interface ApplyCapResult {
  /** Tail-200 of (input ++ newEntry); never longer than MAX_TRANSCRIPT_ENTRIES. */
  transcript: TranscriptEntry[];
  /** Entries dropped from the front of the array; empty when no eviction. */
  evicted: TranscriptEntry[];
}

/**
 * Append `newEntry` to `transcript`, then FIFO-evict the front of the
 * array so the result is at most `MAX_TRANSCRIPT_ENTRIES` long. The
 * just-appended entry is NEVER evicted (cap-then-evict sequencing).
 *
 * Returns NEW arrays on every call (immutability invariant) — even on
 * the identity path, so React reference-equality checks always trigger
 * a re-render and observers can detect the append.
 */
export function applyTranscriptCap(
  transcript: TranscriptEntry[],
  newEntry: TranscriptEntry
): ApplyCapResult {
  const appended = [...transcript, newEntry];
  if (appended.length <= MAX_TRANSCRIPT_ENTRIES) {
    return { transcript: appended, evicted: [] };
  }
  const overflow = appended.length - MAX_TRANSCRIPT_ENTRIES;
  return {
    transcript: appended.slice(overflow),
    evicted: appended.slice(0, overflow),
  };
}

/**
 * Convert a `TranscriptEntry` (in-memory shape) to a
 * `ConversationMessagePayload` (DB-row shape) by dropping `id` +
 * `timestamp` and adding `conversation_id`. `corrections` defaults to
 * `null` when absent (matches the existing `?? null` idiom in
 * `realtime-orchestrator.ts`'s pre-12-6 inline mapping).
 *
 * Single source of truth for the conversion — extracting this avoids
 * the pre-12-6 two-site copy at the orchestrator's online + offline
 * persist paths and reduces coupling to the DB schema.
 */
export function toMessagePayload(
  entry: TranscriptEntry,
  conversationId: string
): ConversationMessagePayload {
  return {
    conversation_id: conversationId,
    role: entry.role,
    content: entry.text,
    corrections: entry.corrections ?? null,
  };
}
