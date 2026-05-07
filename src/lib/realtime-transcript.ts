/**
 * Pure transcript-bookkeeping helpers for the OpenAI Realtime voice hook.
 *
 * Owns the dedup, append, and delta-accumulator logic that previously lived
 * (copy-pasted) inside `useRealtimeVoice`'s `response.output_*.done` and
 * `response.output_*.delta` handlers. Story 9-5 extracted them so:
 *
 * 1. There is exactly one place to edit the append/dedup contract.
 * 2. The contract is unit-testable without mocking a WebSocket or rendering a hook.
 *
 * Dedup contract:
 *   - Each AI turn is keyed by its upstream `item_id` (preferred), falling back
 *     to `response_id`, then to a deterministic content hash (`fallback_<hash>`).
 *     The fallback intentionally carries no raw text and no timestamp so two
 *     `.done` events for the same logical turn produce the same key.
 *   - A duplicate event with the same key is suppressed and the optional
 *     `onDedup` callback is invoked (the hook wires this to a Sentry breadcrumb).
 *   - Empty / whitespace-only payloads do NOT consume a dedup key — they are
 *     dropped at the top of `appendIfNew` so a stray empty `.done` cannot
 *     poison the Set or render a blank assistant bubble.
 *   - The `processed` Set is mutated in place; the caller owns its lifetime
 *     (e.g., resets it on `start()`).
 *   - The Set is capped at `DEDUP_SET_CAP` with FIFO eviction: when full, the
 *     oldest key is removed before the new one is added, so dedup remains
 *     correct past the cap (a retransmitted `.done` for a still-resident key
 *     is still suppressed).
 *
 * Delta contract:
 *   - The first `.delta` event of an AI turn that carries an `item_id`
 *     adopts that id as the in-flight item.
 *   - Subsequent deltas with a different `item_id` are dropped (cross-item
 *     drift, e.g., a future modality regression that re-enables `"text"`).
 *   - Deltas with no `item_id` are appended only when an in-flight item is
 *     already adopted — between turns (inflight is null), an unattributed
 *     delta has nothing to attach to and is dropped.
 *   - The hook clears `inflightItemId` to `null` on `appendIfNew` (terminal
 *     `.done` event) and on `response.done` (catch-all for cancelled responses).
 */

import type { Correction } from "@/src/types/conversation";

/**
 * Soft cap on the dedup Set's size. When full, the oldest key is FIFO-evicted
 * before the new one is added. 256 is well past the longest realistic session;
 * the cap exists to bound memory, not to act as a TTL.
 */
export const DEDUP_SET_CAP = 256;

/**
 * Single AI- or user-side transcript entry.
 *
 * Defined here so the pure module owns its primary data type. The hook
 * re-exports this for backwards-compat with `TranscriptView`.
 */
export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  corrections?: Correction[];
  timestamp: number;
}

/**
 * Inputs to `appendIfNew`. The `processed` Set is mutated in place
 * on append; the arrays are never mutated (new arrays are returned on append).
 */
export interface AppendInput {
  processed: Set<string>;
  transcript: TranscriptEntry[];
  corrections: Correction[];
}

export interface AppendOptions {
  parseCorrections: (text: string) => Correction[];
  /** Invoked when an event whose key is already in `processed` is suppressed. */
  onDedup?: (key: string) => void;
  /** Clock override for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface AppendResult {
  appended: boolean;
  /** New array if `appended === true`; the input array otherwise. */
  transcript: TranscriptEntry[];
  /** New array if `appended === true`; the input array otherwise. */
  corrections: Correction[];
  /** The new entry that was appended, when `appended === true`. */
  entry?: TranscriptEntry;
}

/**
 * djb2 hash over Unicode code points. Iterating with `for...of` walks code
 * points (not UTF-16 code units), so emoji and other surrogate-pair text are
 * handled cleanly. The result is a short base-36 string with no embedded
 * free-text — safe to pass through Sentry breadcrumb data.
 */
function hashText(text: string): string {
  let hash = 5381;
  for (const ch of text) {
    hash = ((hash << 5) + hash + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Append one AI-turn `TranscriptEntry`, applying dedup keyed by `key`.
 *
 * The entry's `id` is `ai_${key}` — a stable, upstream-derived id so that
 * a future double would surface as a `keyExtractor` collision in `FlatList`
 * (the previous `ai_${Date.now()}` pattern hid the bug from React).
 *
 * Empty / whitespace-only `text` is treated as a no-op: `appended` is false
 * and the dedup Set is unchanged. This protects against a stray `.done`
 * event with an empty payload (e.g., upstream transcription failure) from
 * rendering a blank bubble or burning a key slot.
 */
export function appendIfNew(
  input: AppendInput,
  key: string,
  text: string,
  opts: AppendOptions
): AppendResult {
  if (text.trim().length === 0) {
    return {
      appended: false,
      transcript: input.transcript,
      corrections: input.corrections,
    };
  }

  if (input.processed.has(key)) {
    opts.onDedup?.(key);
    return {
      appended: false,
      transcript: input.transcript,
      corrections: input.corrections,
    };
  }

  // FIFO eviction so dedup stays correct past the cap. `Set` preserves
  // insertion order, so `values().next().value` is the oldest entry.
  if (input.processed.size >= DEDUP_SET_CAP) {
    const oldest = input.processed.values().next().value;
    if (oldest !== undefined) input.processed.delete(oldest);
  }
  input.processed.add(key);

  const newCorrections = opts.parseCorrections(text);
  const entry: TranscriptEntry = {
    id: `ai_${key}`,
    role: "assistant",
    text,
    corrections: newCorrections.length > 0 ? newCorrections : undefined,
    timestamp: (opts.now ?? Date.now)(),
  };

  return {
    appended: true,
    transcript: [...input.transcript, entry],
    corrections: [...input.corrections, ...newCorrections],
    entry,
  };
}

/**
 * Resolve the dedup key for a transcript event.
 *
 * Falls back: `item_id` → `response_id` → `fallback_<contentHash>`.
 * The content hash is deterministic — two `.done` events with identical
 * text (i.e., a real duplicate) produce the same key, so the dedup Set
 * actually catches them. The hash carries no raw text, so the key is
 * safe to log to Sentry as opaque diagnostic data.
 */
export function resolveTranscriptKey(
  event: { item_id?: string; response_id?: string },
  text: string
): string {
  if (event.item_id) return event.item_id;
  if (event.response_id) return event.response_id;
  return `fallback_${hashText(text)}`;
}

export interface DeltaState {
  /** item_id of the AI response currently being streamed; null between turns. */
  inflightItemId: string | null;
  /** Pending text accumulated from this turn's deltas. */
  pendingText: string;
}

export interface AcceptDeltaResult {
  state: DeltaState;
  /** True if the delta was appended; false if dropped (cross-item drift). */
  accepted: boolean;
}

/**
 * Apply a streaming delta to the in-flight pending text.
 *
 * - itemId === null and inflight === null: drop (no turn to attribute to).
 * - itemId === null and inflight !== null: append (mid-turn, trust protocol).
 * - inflightItemId === null and itemId provided: adopt itemId; append.
 * - itemId !== inflightItemId: cross-item drift; drop.
 * - itemId === inflightItemId: append.
 */
export function acceptDelta(
  state: DeltaState,
  itemId: string | null,
  delta: string
): AcceptDeltaResult {
  if (itemId === null) {
    if (state.inflightItemId === null) {
      return { state, accepted: false };
    }
    return {
      state: { inflightItemId: state.inflightItemId, pendingText: state.pendingText + delta },
      accepted: true,
    };
  }

  if (state.inflightItemId === null) {
    return {
      state: { inflightItemId: itemId, pendingText: state.pendingText + delta },
      accepted: true,
    };
  }

  if (state.inflightItemId !== itemId) {
    return { state, accepted: false };
  }

  return {
    state: { inflightItemId: state.inflightItemId, pendingText: state.pendingText + delta },
    accepted: true,
  };
}
