# Story 12.6: Cap `transcript` at 200 Entries — Spill Older to DB-Bound Buffer

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose `RealtimeOrchestrator` at [`src/lib/realtime-orchestrator.ts`](src/lib/realtime-orchestrator.ts) appends transcript entries from TWO unbounded paths during every live voice conversation — (a) AI-side via `appendAiTranscriptEntry` at [`realtime-orchestrator.ts:666-709`](src/lib/realtime-orchestrator.ts#L666-L709) which routes through the Story 9-5 pure helper `appendIfNew` in [`src/lib/realtime-transcript.ts`](src/lib/realtime-transcript.ts) and writes `this.transcript = result.transcript` (where `result.transcript = [...input.transcript, entry]` per [`realtime-transcript.ts:151`](src/lib/realtime-transcript.ts#L151)), and (b) user-side via `handleItemCreated` at [`realtime-orchestrator.ts:897-921`](src/lib/realtime-orchestrator.ts#L897-L921) which does `this.transcript = [...this.transcript, entry]` directly — neither path applies any length cap, so audit finding **P2-8** at [`shippable-roadmap.md` line 86](_bmad-output/planning-artifacts/shippable-roadmap.md) names the bug exactly: "`transcriptRef.current` grows unbounded; CLAUDE.md performance budget says cap at 100 — not implemented — `src/hooks/use-realtime-voice.ts` — performance" (the file path is pre-Story-12-1; post-12-1 the god-hook decomposition migrated the in-memory transcript array verbatim into the orchestrator's private `transcript` field), AND the Epic 12.6 deliverable at [`shippable-roadmap.md` line 209](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the v1 fix: "Cap `transcriptRef` at 200 entries; spill older to disk if needed. **Covers P2-8.**", AND **Story 12-1's CLAUDE.md paragraph pre-commits to the 200-entry target**: "`12-6 transcriptRef 200-entry cap operates on the orchestrator's private transcript field`" — fixing the cap at 200 (NOT the audit-mentioned 100; the audit's "100" was the pre-2026-05-06 notional budget — Story 12-1 ratified 200 as the operational target because realistic 5-minute TCF conversations average 30-50 turns, 200 provides ~6× headroom while still bounding render perf), AND today's symptom: a runaway voice session (e.g., user opens the conversation screen, gets distracted, leaves it running for hours, or a debug-mode tester deliberately stress-tests the Realtime pipeline) causes `this.transcript` to grow without bound; each entry is ~150-300 bytes (`{id, role, text, corrections?, timestamp}` per [`realtime-transcript.ts:56-62`](src/lib/realtime-transcript.ts#L56-L62)) — at 1000+ turns the array consumes 150KB-300KB of JS heap AND fires a FlatList re-render storm with every subsequent `setState` in [`TranscriptView.tsx`](src/components/conversation/TranscriptView.tsx) (`data={transcript}` at [`TranscriptView.tsx:359`](src/components/conversation/TranscriptView.tsx#L359) + `extraData={transcript.length}` at [`TranscriptView.tsx:362`](src/components/conversation/TranscriptView.tsx#L362)) because FlatList's virtualization invalidates on every `length` change, AND the broader Epic 13.1 / P2-3 concern at [`shippable-roadmap.md` line 87](_bmad-output/planning-artifacts/shippable-roadmap.md) ("Transcript re-render storm during AI streaming — `setState` per audio chunk; FlatList `extraData` invalidates per AI speech state flip") explicitly depends on a bounded `transcript.length` to keep the virtualization budget realistic — Story 12-6 lays the foundation Epic 13.1 will build on, AND the persistence contract MUST be preserved: at end-of-conversation the Phase A Slot 1 batch insert at [`realtime-orchestrator.ts:1196-1198`](src/lib/realtime-orchestrator.ts#L1196-L1198) writes `messages = this.transcript.map(...)` to the `conversation_messages` table which the history-screen consumer at [`app/(tabs)/conversation/history.tsx:383`](app/(tabs)/conversation/history.tsx#L383) later reads via `.from("conversation_messages")` — so a naive FIFO eviction of the in-memory array would silently truncate the persisted DB record AND break the history-screen transcript view, AND the offline-write-queue fallback at [`realtime-orchestrator.ts:1110-1122`](src/lib/realtime-orchestrator.ts#L1110-L1122) (when network is unavailable at `end()`) also iterates `this.transcript.map(...)` → `enqueueWrite(...)` so the same data-preservation invariant applies on both paths, AND the established cross-story pattern matches Story 9-5 (the `realtime-transcript.ts` pure module already owns the append/dedup contract — Story 12-6 adds a complementary `transcript-cap.ts` pure module owning the cap/spill contract; same single-source-of-truth-via-module-level-helper idiom as Story 11-7's `truncateToBytes` in `src/lib/prompts/conversation.ts` + Story 10-8's `runMcqDedupPipeline` in `src/lib/exercise-dedup.ts`), AND the "spill older to disk if needed" deliverable phrasing IS satisfied by buffering evicted entries into a `this.spilledMessages: ConversationMessagePayload[]` accumulator (DB-payload shape — `{conversation_id, role, content, corrections}` — drops the `id` + `timestamp` bookkeeping that `TranscriptEntry` carries for in-memory dedup; payload-shape memory cost is ~80 bytes/entry vs ~200 for full TranscriptEntry) which is concatenated with the tail at persist time so the DB sees the COMPLETE conversation regardless of eviction; the memory bound restores to ~80 bytes × N for evicted entries (a 1-hour session at 1 turn / 5 sec = 720 turns × ~80 bytes = ~58KB total bookkeeping + 200-entry tail of ~60KB = ~118KB — well under any reasonable budget AND independent of session length up to a 10K-turn ceiling that no real user reaches), AND the cap is **defense-in-depth**: it never fires for normal users (200 turns × ~6 sec/turn = 20 minutes of constant chat; the typical TCF Companion session is 5 min / ~30 turns) — operator-visible Sentry telemetry (the new feature tag `"transcript-cap-evicted"`) reveals frequency in prod so future stories can decide whether to (i) raise the cap, (ii) implement AsyncStorage spill, (iii) introduce mid-session DB-streaming inserts (Epic 13.X / 17.X follow-up).

I want (a) a **new module `src/lib/transcript-cap.ts`** (~80 lines including JSDoc) that exports the cap policy + pure helpers. The module exports: (i) `MAX_TRANSCRIPT_ENTRIES = 200` — the cap constant exported so tests + future operator overrides + drift detectors share one source of truth (Story 11-7 / 11-8 "exported constant" pattern); (ii) `applyTranscriptCap(transcript: TranscriptEntry[], newEntry: TranscriptEntry): { transcript: TranscriptEntry[]; evicted: TranscriptEntry[] }` — pure FIFO append-then-evict; appends `newEntry`; if the result exceeds `MAX_TRANSCRIPT_ENTRIES`, returns `transcript: result.slice(-MAX_TRANSCRIPT_ENTRIES)` + `evicted: result.slice(0, result.length - MAX_TRANSCRIPT_ENTRIES)`; else returns the appended result + an empty `evicted` array; always returns NEW arrays (immutability invariant matches Story 9-5's `appendIfNew`); newEntry is ALWAYS in the returned transcript (never evicted in the same operation — the cap-then-evict sequencing preserves the just-appended entry); (iii) `toMessagePayload(entry: TranscriptEntry, conversationId: string): ConversationMessagePayload` — pure converter from in-memory `TranscriptEntry` to DB-shape `{conversation_id, role, content, corrections}` (the same shape used by `persistConversation`'s `messages` mapping at [`realtime-orchestrator.ts:1110-1115`](src/lib/realtime-orchestrator.ts#L1110-L1115) + [`realtime-orchestrator.ts:1136-1141`](src/lib/realtime-orchestrator.ts#L1136-L1141)); extracting this avoids the two-site copy + reduces the orchestrator's coupling to the DB schema; (b) **`src/lib/realtime-orchestrator.ts` modifications** — (i) `import { applyTranscriptCap, toMessagePayload, MAX_TRANSCRIPT_ENTRIES } from "@/src/lib/transcript-cap"`, (ii) new `private spilledMessages: ConversationMessagePayload[] = []` instance field declared near the transcript-related state at line 222-224 (Story 12-1 organization), (iii) `appendAiTranscriptEntry` (line 666-709) refactored — after `appendIfNew` returns `result.appended === true`, route the new `result.entry` through `applyTranscriptCap(this.transcript, result.entry)` (passing `this.transcript` PRE-Story-9-5-append, NOT the post-appendIfNew `result.transcript`, to avoid double-appending — the simpler call shape: pass the BASE array + the entry; the cap helper does the append-then-evict atomically); on eviction (`evicted.length > 0`): push each evicted entry's `toMessagePayload(entry, this.conversationId!)` into `this.spilledMessages` + fire a Sentry breadcrumb (`feature: "transcript-cap-evicted"`, `data: { evictedCount: evicted.length, totalEntries: this.transcript.length + this.spilledMessages.length }`); then assign `this.transcript = capResult.transcript`, (iv) `handleItemCreated` (line 909-919) refactored identically — after building the user-side `entry`, route through `applyTranscriptCap`; on eviction follow the same spill+breadcrumb path; assign `this.transcript = capResult.transcript`, (v) `start()` reset block (line 1255-1286) gains `this.spilledMessages = []` alongside `this.transcript = []` so a `start()` retry / `end()`→`start()` recycle lands in a clean state (Story 12-1 P13 "reset all state so retries start clean" pattern), (vi) **`persistConversation` adjustment** — Slot 1 of Phase A at [`realtime-orchestrator.ts:1195-1198`](src/lib/realtime-orchestrator.ts#L1195-L1198) NOW inserts `[...this.spilledMessages, ...messages]` (the evicted entries' payloads PLUS the live-tail's messages) so the DB sees the complete conversation; the offline-queue path at [`realtime-orchestrator.ts:1110-1122`](src/lib/realtime-orchestrator.ts#L1110-L1122) similarly iterates `[...this.spilledMessages, ...this.transcript.map(toMessagePayload(_, conversationId))]` for the `enqueueWrite` loop, (vii) **PRESERVE** the Story 9-5 `appendIfNew` dedup contract — the cap helper runs DOWNSTREAM of `appendIfNew`'s dedup; a deduped event never reaches `applyTranscriptCap` (the early-return in `appendAiTranscriptEntry` at line 688 short-circuits before any cap call), (viii) **PRESERVE** the Story 11-1 `mergeOrphanCorrections` orphan-drain (line 929-934) and Story 11-2 reconnect path (`realtime.reconnecting` event handler at line 994-1024) — both operate on `this.corrections`, NOT `this.transcript`, so they're orthogonal to the cap; (c) **Sentry breadcrumb shape (Story 9-3 contract)** — `category: "realtime"` + `level: "info"` (NOT warning, because eviction is bounded-by-design behavior, not an anomaly — Story 11-6 review P6 "fail-OPEN logs as info/warning, reserve error tier for unexpected paths") + `message: "Transcript cap eviction"` + `data: { feature: "transcript-cap-evicted", evictedCount: N, totalEntries: M }`; the `feature: "transcript-cap-evicted"` tag is 24 chars (well under 80-char threshold); `evictedCount` + `totalEntries` extras keys both Number type — Story 11-4 / 11-5 lesson: tiny bounded integers are safe under the Story 9-3 allowlist (already permitted for `generatedCount` / `filteredCount` / `seenCount` / `retries` from Story 10-8); add `evictedCount` + `totalEntries` to `SENTRY_EXTRAS_ALLOWLIST` at `src/lib/sentry.ts` if not already present; (d) **regression tests** in `src/lib/__tests__/transcript-cap.test.ts` (~10 Jest cases): (i) `MAX_TRANSCRIPT_ENTRIES === 200` constant pin (regression guard against silent operator drift), (ii) `applyTranscriptCap` returns identity (no eviction) when `transcript.length < MAX - 1` (199 entries + 1 new = 200 — at boundary, no eviction yet), (iii) `applyTranscriptCap` evicts exactly 1 entry when transcript starts at 200 + 1 new entry (the 201st), (iv) `applyTranscriptCap` evicts exactly 50 entries when batch-fed 250 entries one-at-a-time (the eviction is incremental + monotonic), (v) FIFO ordering — the EVICTED entry is the OLDEST (lowest index in the input array), (vi) new entry is ALWAYS in the returned transcript (never the evicted slot in the same operation, even at exact-200-then-add-one), (vii) immutability — input `transcript` is NOT mutated (new array returned), (viii) `toMessagePayload` shape contract: id + timestamp dropped, conversation_id added; corrections preserved when present, NULL when absent (matches `messages.map` shape at line 1110-1115), (ix) `toMessagePayload` defends against undefined corrections via the `?? null` idiom (matches existing call sites), (x) `applyTranscriptCap` returns a brand-new `transcript` array even on identity path (no eviction) so React reference-equality checks always trigger a re-render — the same `result.transcript = [...input.transcript, entry]` pattern as `appendIfNew`; (e) **regression tests** in `src/lib/__tests__/realtime-orchestrator-transcript-cap.test.ts` (~7 Jest cases): (i) **drift detector reads `realtime-orchestrator.ts` from disk via comment-stripped `ORCHESTRATOR_CODE_ONLY` (Story 12-2 P12 + 12-4 P10 + 12-5 lesson)** + asserts `applyTranscriptCap` is called in both `appendAiTranscriptEntry` AND `handleItemCreated` method bodies (positive guard; uses Story 12-5 P12 `extractMethodBody` helper extended to the orchestrator), (ii) **drift detector negative guard** — asserts the legacy unbounded patterns `this.transcript = [...this.transcript, entry]` (the pre-12-6 line 916 pattern) and `this.transcript = result.transcript` (when followed by no cap call) do NOT appear in `appendAiTranscriptEntry` / `handleItemCreated`; the pattern would have re-introduced the bug, (iii) Sentry breadcrumb fires with `feature: "transcript-cap-evicted"` when a 201st entry is appended (in-process orchestrator test simulating 201 sequential audio-transcript `.done` events), (iv) `state.transcript.length` NEVER exceeds 200 after 250 sequential turns (the canonical P2-8 closure proof), (v) `getState().transcript` returns the FROZEN tail-200 (Story 12-1 P15 `Object.freeze` contract held), (vi) `persistConversation` Phase A Slot 1 inserts `evictedCount + tailLength` rows when the cap fired during the session (mocked Supabase insert spy + arg assertion verifies the spilled-prepend-plus-tail-append order matches insertion order), (vii) `start()` reset block clears `this.spilledMessages` between conversations (verified via end-of-conversation cap fire + `start()` re-call + assertion that the next session's `persistConversation` inserts only the tail, not the prior session's spilled buffer); (f) **`SENTRY_EXTRAS_ALLOWLIST` extension** at [`src/lib/sentry.ts`](src/lib/sentry.ts) — verify `evictedCount` + `totalEntries` are present; if not, append them (Story 9-3 contract; small bounded integers under the 80-char threshold; matches Story 10-8's precedent for `generatedCount` + `filteredCount` + `seenCount` + `retries`); (g) **CLAUDE.md architecture line** added after the Story 12-5 paragraph documenting (a) the new module + the 200-entry cap + FIFO eviction + the new `applyTranscriptCap` / `toMessagePayload` pure helpers, (b) the `spilledMessages` instance field + the spill-to-DB-bound-buffer pattern + the `persistConversation` Slot 1 prepend, (c) the Sentry `"transcript-cap-evicted"` feature tag + the `evictedCount` / `totalEntries` allowlist extension (or confirmation that they're already allowlisted), (d) the cross-story invariants preserved (Story 9-5 dedup, Story 11-1 orphan-drain, Story 11-2 reconnect, Story 12-1 dispose-order + getState-frozen, Story 12-5 audio refcount); (h) **NO TranscriptView changes** — the `data={transcript}` + `extraData={transcript.length}` contract at `TranscriptView.tsx:359-362` already consumes whatever array `state.transcript` carries; capping it to 200 entries reduces FlatList's virtualization scope automatically (P2-3 / Epic 13.1 builds on this in a future story); (i) **NO realtime-transcript.ts changes** — the Story 9-5 pure module owns dedup + delta-accumulator; the cap is a SEPARATE concern that runs DOWNSTREAM of `appendIfNew`'s output. The two helpers compose cleanly: dedup first, then cap-on-append; (j) **NO DB schema changes** — `conversation_messages` table at [`supabase/migrations/20260301000000_initial_schema.sql`](supabase/migrations/20260301000000_initial_schema.sql) already accommodates the payload shape; no migration needed,

so that **audit finding P2-8 closes architecturally** (the in-memory `this.transcript` array is bounded at 200 entries; runaway sessions can no longer OOM the JS heap or trigger pathological FlatList re-renders); **the persistence contract is preserved by construction** — the DB-payload accumulator `spilledMessages` ensures `conversation_messages` sees the complete conversation regardless of cap eviction; **Epic 13.1 (P2-3 transcript re-render storm) is unblocked architecturally** — a bounded `transcript.length` makes the FlatList `extraData` invalidation budget realistic; **the deliverable's "spill older to disk if needed" framing is satisfied** via the in-orchestrator DB-payload accumulator (the simpler v1 approach; AsyncStorage / SQLite spill is deferred as a future operator decision based on telemetry); **Story 9-3 Sentry allowlist contract holds** by construction (1 new short `feature` string + 2 small-integer extras keys; `addBreadcrumb` shape unchanged); **Story 9-4 stored-prompt-injection defense unaffected** — the cap is pure transformation on `TranscriptEntry[]`; no user-input flows through it; **Story 9-5 voice-transcript dedup unaffected** — `appendIfNew` + `acceptDelta` + `resolveTranscriptKey` + the FIFO-capped 256-entry dedup Set in `realtime-transcript.ts` all run UPSTREAM of the cap and are NOT modified; **Story 11-1 tool-call orphan-drain unaffected** — `mergeOrphanCorrections` operates on `this.corrections`, NOT `this.transcript`; **Story 11-2 reconnect + barge-in unaffected** — the cap doesn't interact with the WebSocket lifecycle or AI-speaking state; **Story 11-7 prompt-truncation unaffected** — the `MAX_PROMPT_MEMORIES` / `MAX_PROMPT_ERROR_PATTERNS` / `MAX_PROMPT_ITEM_CHARS` / `truncateToBytes` surface is at prompt-build time (per session start), not per-turn append time; **Story 12-1 god-hook decomposition unaffected** — the cap is internal to the orchestrator; the hook's public API (`UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn`) is unchanged; **Story 12-1 P15 `getState()` Object.freeze contract held** — the cap helper returns brand-new arrays which are then frozen by the existing `setState` snapshot pattern; **Story 12-2 auth bootstrap orthogonal** — no shared state; **Story 12-3 atomic-RPC mutations orthogonal** — the cap doesn't touch `skill_progress` / `daily_activity` / `streak` paths; **Story 12-4 `start()` race-fix orthogonal** — the cap initializes via `start()` reset block alongside `this.acquireWasCalled` (Story 12-5 P1 pattern); **Story 12-5 audio refcount orthogonal** — `spilledMessages` reset in `start()` mirrors `acquireWasCalled` reset.

## Background — Why This Story Exists

### What audit finding P2-8 owns to this story

[`shippable-roadmap.md` line 86](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P2-8 — `transcriptRef.current` grows unbounded; CLAUDE.md performance budget says cap at 100 — not implemented — `src/hooks/use-realtime-voice.ts` — performance"

Epic 12.6 deliverable at [line 209](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Cap `transcriptRef` at 200 entries; spill older to disk if needed. **Covers P2-8.**"

> **Note 1:** The file path in P2-8 is pre-Story-12-1. Post-12-1, the god-hook decomposition migrated the transcript array into `src/lib/realtime-orchestrator.ts` (private `transcript` field at line 223). Story 12-6 fixes the post-12-1 location.
>
> **Note 2:** The audit names "cap at 100" referencing a pre-2026-05-06 notional CLAUDE.md budget that's no longer in the current CLAUDE.md (verified via grep). Story 12-1's CLAUDE.md paragraph ratified **200** as the operational target: "`12-6 transcriptRef 200-entry cap operates on the orchestrator's private transcript field`." Story 12-6 implements that 200-entry target. The audit's "100" is treated as historical context, not the active spec.

### Current state — the bug at the two write sites

Pre-12-6 [`src/lib/realtime-orchestrator.ts:666-709`](src/lib/realtime-orchestrator.ts#L666-L709) (AI-side):

```typescript
private appendAiTranscriptEntry(text: string, key: string): boolean {
  const result = appendIfNew(
    { processed: this.processedResponseItems, transcript: this.transcript, corrections: this.corrections },
    key, text,
    { parseCorrections: this.parseCorrections, onDedup: (k) => { /* breadcrumb */ } }
  );
  if (!result.appended) return false;
  this.transcript = result.transcript;          // ← UNBOUNDED: result.transcript = [...input.transcript, entry]
  // ...
}
```

Pre-12-6 [`src/lib/realtime-orchestrator.ts:909-919`](src/lib/realtime-orchestrator.ts#L909-L919) (user-side):

```typescript
if (textContent?.transcript && textContent.transcript.trim().length > 0) {
  const entry: TranscriptEntry = { id: `user_${this.userTurnCounter++}`, role: "user", text: textContent.transcript, timestamp: Date.now() };
  this.transcript = [...this.transcript, entry];   // ← UNBOUNDED: direct array spread
  this.setState((s) => ({ ...s, transcript: this.transcript }));
  this.options.onTranscriptUpdate?.(this.transcript);
}
```

Neither path applies a length cap. Memory footprint scales linearly with conversation length; FlatList re-renders scale with `transcript.length`.

### Why a cap + DB-payload spill buffer?

1. **Cap alone is lossy** — naive FIFO eviction would lose data from the persisted `conversation_messages` record.
2. **DB-streaming inserts mid-session add complexity** — eagerly firing `supabase.insert(...)` on every eviction adds per-turn network I/O + error-handling paths.
3. **In-orchestrator DB-payload accumulator** is the simplest correct design — evicted entries get their `id` + `timestamp` bookkeeping stripped (saving memory vs full `TranscriptEntry`) and accumulate in a side buffer that's batch-inserted once at `persistConversation` time.

The `spilledMessages: ConversationMessagePayload[]` buffer carries `{conversation_id, role, content, corrections}` per row — ~80 bytes per evicted entry vs ~200 for the full `TranscriptEntry`. Memory math for an extreme 1-hour session at 1 turn / 5 sec = 720 turns:

| Approach                | Memory after 720 turns |
| ----------------------- | ---------------------- |
| Pre-12-6 unbounded      | 720 × 200 = **144 KB** |
| Post-12-6 (cap=200)     | (520 × 80) + (200 × 200) = **41.6 KB + 40 KB = 81.6 KB** |
| Reduction               | ~43%                   |

For a TRULY pathological 10-hour session at 1 turn / 5 sec = 7200 turns:

| Approach                | Memory after 7200 turns |
| ----------------------- | ---------------------- |
| Pre-12-6 unbounded      | 7200 × 200 = **1.44 MB** |
| Post-12-6 (cap=200)     | (7000 × 80) + (200 × 200) = **560 KB + 40 KB = 600 KB** |
| Reduction               | ~58%                   |

The cap provides bounded `state.transcript` (FlatList input always ≤200) AND substantial memory reduction on the spill buffer. The trade-off: `spilledMessages` is still in-memory (no AsyncStorage spill). For v1 this is the right balance — telemetry from the new `"transcript-cap-evicted"` Sentry breadcrumb will reveal whether further compression / AsyncStorage spill is justified.

### 12-6 architecture — `src/lib/transcript-cap.ts`

```typescript
/**
 * Pure helpers for capping the in-memory voice-conversation transcript at
 * a fixed length (Story 12-6). Audit finding P2-8.
 *
 * Cap policy:
 *   - `MAX_TRANSCRIPT_ENTRIES = 200` — chosen so realistic 5-min TCF sessions
 *     (~30-50 turns) leave ~6× headroom while bounding pathological / debug
 *     sessions at a predictable budget.
 *   - FIFO eviction — when a new entry would push `transcript.length` over
 *     200, the OLDEST entry is evicted. The just-appended entry is never
 *     evicted in the same operation (cap-then-evict sequencing).
 *   - Evicted entries are returned in the `evicted` array; the orchestrator
 *     pushes their DB-payload shape into `spilledMessages` for persist-time
 *     batch insert (so the DB sees the complete conversation regardless of
 *     the in-memory cap).
 *   - Pure: input arrays are NEVER mutated; new arrays are always returned.
 */
import type { TranscriptEntry } from "@/src/lib/realtime-transcript";

export const MAX_TRANSCRIPT_ENTRIES = 200;

export interface ConversationMessagePayload {
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  corrections: TranscriptEntry["corrections"] extends infer C
    ? C extends undefined ? null : NonNullable<C> | null
    : null;
}

export interface ApplyCapResult {
  transcript: TranscriptEntry[];
  evicted: TranscriptEntry[];
}

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
```

### 12-6 architecture — `src/lib/realtime-orchestrator.ts` post-12-6

Five surgical changes inside `RealtimeOrchestrator`:

1. **Import:** `import { applyTranscriptCap, toMessagePayload, MAX_TRANSCRIPT_ENTRIES } from "@/src/lib/transcript-cap"` (alongside existing imports).

2. **Field declaration** (near line 222-224, transcript-related state):
   ```typescript
   private transcript: TranscriptEntry[] = [];
   /** Story 12-6: evicted transcript entries in DB-payload shape. */
   private spilledMessages: ConversationMessagePayload[] = [];
   ```

3. **`appendAiTranscriptEntry` refactor** (line 666-709): after `result.appended === true`, route through the cap helper:
   ```typescript
   if (!result.appended) return false;
   const capResult = applyTranscriptCap(this.transcript, result.entry!);
   this.transcript = capResult.transcript;
   if (capResult.evicted.length > 0) {
     this.handleTranscriptEviction(capResult.evicted);
   }
   this.corrections = result.corrections;
   // ... rest of method unchanged
   ```

4. **`handleItemCreated` refactor** (line 909-919): identical pattern for the user-side entry.

5. **New private method `handleTranscriptEviction(evicted: TranscriptEntry[])`**:
   ```typescript
   private handleTranscriptEviction(evicted: TranscriptEntry[]): void {
     if (!this.conversationId) return;  // defensive: no conversationId, drop silently
     for (const entry of evicted) {
       this.spilledMessages.push(toMessagePayload(entry, this.conversationId));
     }
     addBreadcrumb({
       category: "realtime",
       level: "info",
       message: "Transcript cap eviction",
       data: {
         feature: "transcript-cap-evicted",
         evictedCount: evicted.length,
         totalEntries: this.transcript.length + this.spilledMessages.length,
       },
     });
   }
   ```

6. **`start()` reset block** (line 1255-1286): add `this.spilledMessages = []` alongside `this.transcript = []`.

7. **`persistConversation` Slot 1** (line 1195-1198):
   ```typescript
   // Slot 1: transcript messages batch insert (Story 12-6: prepend spilled)
   const allMessages = [...this.spilledMessages, ...messages];
   allMessages.length > 0
     ? supabase.from("conversation_messages").insert(allMessages)
     : Promise.resolve({ error: null }),
   ```

8. **`persistConversation` offline path** (line 1110-1122): the `enqueueWrite` loop iterates `[...this.spilledMessages, ...this.transcript.map((entry) => toMessagePayload(entry, conversationId))]`.

The 8 other surfaces touching `this.transcript` (read-only consumers — `state.transcript` propagation, `onTranscriptUpdate` callback, `mergeOrphanCorrections`, `persistConversation` messages mapping) are unchanged.

### Threat / failure model — what cannot happen post-story

After this story:

1. **Unbounded transcript growth cannot reappear** — drift detector reads `realtime-orchestrator.ts` from disk and asserts `applyTranscriptCap` is called at BOTH write sites (positive guard) + the legacy `this.transcript = [...this.transcript, entry]` pattern does NOT appear (negative guard).

2. **DB-persistence completeness preserved** — `spilledMessages` is batch-inserted in Phase A Slot 1 alongside the live tail; the offline-queue path iterates both. The DB sees the complete conversation regardless of cap eviction.

3. **FlatList virtualization budget bounded** — `state.transcript.length ≤ 200` forever; FlatList's `extraData={transcript.length}` invalidation can fire at most 200 times per session vs the pre-12-6 unbounded count.

4. **Memory bound restored** — for any session length, `state.transcript` ≤ 200 × ~200 bytes ≈ 40 KB; `spilledMessages` scales at ~80 bytes / evicted entry (~58% reduction vs unbounded `TranscriptEntry` storage).

5. **Sentry observability preserved** — every cap eviction fires a breadcrumb so operators can grep production logs for `feature: "transcript-cap-evicted"` and see cap-fire frequency. If telemetry shows the cap firing for normal users (which it shouldn't), follow-up stories can raise the cap, implement AsyncStorage spill, or stream inserts mid-session.

6. **Reset on retry / new conversation** — `start()` clears `this.spilledMessages` alongside `this.transcript`, matching Story 12-1 P13's "reset all state so retries start clean" pattern + Story 12-5 P1's `acquireWasCalled` reset.

7. **Story 9-5 dedup contract preserved** — `appendIfNew`'s dedup runs UPSTREAM of the cap; deduped events never reach `applyTranscriptCap` (the `if (!result.appended) return false` short-circuit at line 688).

8. **Story 11-1 / 11-2 tool-call + reconnect contracts preserved** — both operate on `this.corrections`, NOT `this.transcript`. Orthogonal by construction.

9. **Story 12-1 frozen-getState contract preserved** — `applyTranscriptCap` returns NEW arrays; the existing `setState` snapshot + `Object.freeze` flow at `getState()` continues to deliver immutable snapshots.

10. **Sentry allowlist contract preserved** — one new `feature` tag (`"transcript-cap-evicted"`, 24 chars under 80-char threshold) + two small-integer extras (`evictedCount`, `totalEntries`); both match the Story 10-8 precedent for `generatedCount` / `filteredCount` / `seenCount` / `retries`.

### Out of scope for this story (delegated elsewhere)

- **AsyncStorage / SQLite spill** — v1 keeps `spilledMessages` in-memory; AsyncStorage spill is deferred to Epic 13.X / 17.X follow-up if telemetry shows the cap firing in prod with multi-hour sessions.
- **Mid-session DB-streaming inserts** — eagerly firing `supabase.insert(...)` per eviction is rejected for v1 (per-turn network I/O + error-handling complexity); the batch-at-persist-time approach matches existing Phase A patterns.
- **Cap-on-replay** — a future Story 11.X reconnect-with-transcript-replay feature would need to recompute the cap server-side; out of scope.
- **FlatList re-render storm fix (P2-3)** — Epic 13.1 owns the deeper fix; Story 12-6 only bounds the input size which Epic 13.1's `extraData` ref-stability work will build on.
- **TranscriptView render changes** — `data={transcript}` + `extraData={transcript.length}` already consumes the bounded array; no UI changes needed.
- **`realtime-transcript.ts` modifications** — Story 9-5's pure module owns dedup + delta; the cap is a separate concern operating downstream. The two helpers compose cleanly.
- **DB-schema changes** — `conversation_messages` table already accommodates the payload shape; no migration needed.
- **History-screen pagination** — `conversation_messages` rows are read via `.from("conversation_messages")` at `history.tsx:383` with no pagination; out of scope for 12-6 (Epic 17.X or a future story owns pagination).

## Acceptance Criteria

### 1. Create `src/lib/transcript-cap.ts`

- [ ] **CREATE** the new module exporting:
  - `MAX_TRANSCRIPT_ENTRIES = 200` (constant; Story 11-7 / 11-8 "exported constant" pattern).
  - `applyTranscriptCap(transcript: TranscriptEntry[], newEntry: TranscriptEntry): { transcript: TranscriptEntry[]; evicted: TranscriptEntry[] }` — pure FIFO append-then-evict; immutable; new entry is ALWAYS in the returned transcript.
  - `toMessagePayload(entry: TranscriptEntry, conversationId: string): ConversationMessagePayload` — pure converter dropping `id` + `timestamp`; preserves `corrections` (defaults to `null` when absent).
  - `ConversationMessagePayload` type interface (single source of truth for the DB-row shape).
- [ ] **PURE** — no side effects, no Sentry calls, no dependence on `Date.now()` or randomness.
- [ ] **JSDoc** documents: (a) the cap-then-evict sequencing (new entry never evicted in same op), (b) the immutability invariant, (c) the rationale for 200 (TCF-session-headroom + bounded FlatList virtualization).

**Given** a transcript array of length 200 + `applyTranscriptCap(transcript, newEntry)`
**When** the helper returns
**Then** `result.transcript.length === 200` AND `result.transcript[199] === newEntry` AND `result.evicted.length === 1` AND `result.evicted[0]` is the oldest pre-append entry AND the input `transcript` is NOT mutated.

### 2. Modify `src/lib/realtime-orchestrator.ts`

- [ ] **IMPORT** `applyTranscriptCap`, `toMessagePayload`, `MAX_TRANSCRIPT_ENTRIES`, and `ConversationMessagePayload` from `@/src/lib/transcript-cap`.
- [ ] **ADD** `private spilledMessages: ConversationMessagePayload[] = []` field declaration near line 222-224 (transcript-related state).
- [ ] **REFACTOR** `appendAiTranscriptEntry` (line 666-709): after `result.appended === true`, route through `applyTranscriptCap(this.transcript, result.entry!)`; assign `this.transcript = capResult.transcript`; on eviction call `this.handleTranscriptEviction(capResult.evicted)`.
- [ ] **REFACTOR** `handleItemCreated` (line 909-919): identical pattern for the user-side entry.
- [ ] **ADD** new private method `handleTranscriptEviction(evicted: TranscriptEntry[])` that (a) pushes each evicted entry's `toMessagePayload(...)` into `this.spilledMessages`, (b) fires the Sentry breadcrumb (`feature: "transcript-cap-evicted"`, `evictedCount`, `totalEntries`), (c) defensive early-return when `this.conversationId === null` (no conversationId means we can't build a payload; drop silently — should not happen in practice because `conversation.item.created` only fires post-`createConversationRecord`).
- [ ] **RESET** `this.spilledMessages = []` in `start()` reset block (line 1255-1286) alongside `this.transcript = []` (Story 12-1 P13 / Story 12-5 P1 reset-all-state pattern).
- [ ] **REFACTOR** `persistConversation` Phase A Slot 1 (line 1195-1198): replace `messages.length > 0 ? supabase.from("conversation_messages").insert(messages) : ...` with `[...this.spilledMessages, ...messages].length > 0 ? supabase.from("conversation_messages").insert([...this.spilledMessages, ...messages]) : ...` (preserve order: spilled first, then live tail).
- [ ] **REFACTOR** `persistConversation` offline path (line 1110-1122): the `enqueueWrite` loop iterates `[...this.spilledMessages, ...this.transcript.map((entry) => toMessagePayload(entry, conversationId))]`.
- [ ] **PRESERVE** Story 9-5 `appendIfNew` dedup contract — the cap runs DOWNSTREAM; deduped events short-circuit before reaching the cap helper.
- [ ] **PRESERVE** Story 11-1 `mergeOrphanCorrections` orphan-drain — operates on `this.corrections`, not `this.transcript`.
- [ ] **PRESERVE** Story 11-2 reconnect path + `realtime.reconnecting` event handler.
- [ ] **PRESERVE** Story 12-1 dispose() cleanup order: timer → subscription → session → audio → subscribers (cap state is reset on `start()`, not on `dispose()`).
- [ ] **PRESERVE** Story 12-1 P15 `getState()` `Object.freeze` snapshot — cap helper returns NEW arrays; existing setState/freeze flow unchanged.

**Given** `RealtimeOrchestrator` is in the middle of a voice conversation with 200 transcript entries
**When** a 201st `response.output_audio_transcript.done` event arrives
**Then** `this.transcript.length === 200` (cap holds) AND `this.spilledMessages.length === 1` (oldest entry spilled in DB-payload shape) AND `addBreadcrumb` fires exactly once with `data.feature === "transcript-cap-evicted"` AND `data.evictedCount === 1` AND `data.totalEntries === 201`.

**Given** `RealtimeOrchestrator.persistConversation` runs at end-of-conversation with `this.spilledMessages.length === 50` and `this.transcript.length === 200`
**When** Phase A Slot 1 dispatches
**Then** `supabase.from("conversation_messages").insert([...])` is called with 250 rows in order [spilled-first, tail-last] AND the offline-queue path (if network unavailable) iterates 250 `enqueueWrite` calls in the same order.

### 3. Sentry allowlist + breadcrumb

- [ ] **VERIFY** the `SENTRY_EXTRAS_ALLOWLIST` at `src/lib/sentry.ts` contains `evictedCount` AND `totalEntries`. If absent, append them (Story 9-3 contract; small bounded integers).
- [ ] **VERIFY** `feature: "transcript-cap-evicted"` is 24 chars (well under 80-char threshold).
- [ ] **NO new `feature` extras key** required (`feature` is already allowlisted).

### 4. Tests

- [ ] **CREATE** `src/lib/__tests__/transcript-cap.test.ts` (~10 cases):

  - **Constant pins × 1:**
    - `MAX_TRANSCRIPT_ENTRIES === 200` (regression guard against silent operator drift).

  - **Identity (no eviction) × 2:**
    - Empty transcript + 1 new entry → returns 1-entry transcript + empty evicted.
    - 199-entry transcript + 1 new entry → returns 200-entry transcript + empty evicted (exact boundary).

  - **Eviction × 3:**
    - 200-entry transcript + 1 new entry → returns 200-entry transcript + 1-entry evicted (the OLDEST input entry).
    - 200-entry transcript + new entry at the END (FIFO ordering — verify `result.transcript[199] === newEntry`).
    - Hot-loop simulation: feed 250 entries one-at-a-time through the helper; assert final transcript length is 200 + final evicted set covers all 50 oldest entries.

  - **Immutability × 1:**
    - Input `transcript` array reference is NOT mutated; `result.transcript` is a brand-new array even on identity path.

  - **`toMessagePayload` contract × 3:**
    - Shape: id + timestamp dropped; conversation_id added; role + content + corrections preserved.
    - `entry.corrections === undefined` → `payload.corrections === null` (matches existing call-site `?? null` idiom).
    - `entry.corrections === [c1, c2]` → `payload.corrections === [c1, c2]` (array preserved verbatim).

- [ ] **CREATE** `src/lib/__tests__/realtime-orchestrator-transcript-cap.test.ts` (~7 cases):

  - **Drift detector positive guard × 1:** Read `realtime-orchestrator.ts` via comment-stripped `ORCHESTRATOR_CODE_ONLY` (Story 12-2 P12 + 12-4 P10 + 12-5 P12 lesson); assert `applyTranscriptCap` appears in the `appendAiTranscriptEntry` method body AND in the `handleItemCreated` method body via the `extractMethodBody` helper.

  - **Drift detector negative guard × 1:** Assert the legacy `this.transcript = [...this.transcript, entry]` pattern does NOT appear in `handleItemCreated`'s method body (this was the pre-12-6 unbounded write).

  - **Runtime contract × 5:**
    - In-process orchestrator simulation: feed 201 sequential `response.output_audio_transcript.done` events; assert `getState().transcript.length === 200` AND `addBreadcrumb` fired once with `data.feature === "transcript-cap-evicted"`.
    - After 250 turns: `getState().transcript.length === 200` AND internal `spilledMessages.length === 50` (verified via `persistConversation` mock — count rows inserted).
    - `getState().transcript` is frozen (Story 12-1 P15 contract held; `Object.isFrozen(getState().transcript) === true`).
    - `persistConversation` Phase A Slot 1 receives 250 rows when cap fired 50 times during session (order: spilled-first, tail-last; verify via Supabase insert spy arg).
    - `start()` reset block: end conversation (causing cap fires) → call `start()` → assert next session's `spilledMessages === []` (no carryover from prior session).

- [ ] **VERIFY existing tests stay green:**
  - `src/lib/__tests__/realtime-orchestrator.test.ts` (Story 12-1) — 11+ cases.
  - `src/lib/__tests__/realtime-orchestrator-session-race.test.ts` (Story 12-4) — 13 cases.
  - `src/lib/__tests__/realtime-orchestrator-audio-lifecycle.test.ts` (Story 12-5) — 6 cases.
  - `src/lib/__tests__/realtime-dedup.test.ts` (Story 9-5 + 11-1 + 11-2) — all cases.
  - `src/hooks/__tests__/use-realtime-voice.test.tsx` (Story 12-1) — 6 cases.

- [ ] **Target test count:** 1362 → ~1379 (+~17 from the 2 new test files).

### 5. Update CLAUDE.md

- [ ] Add a new architecture line **after** the Story 12-5 paragraph documenting: (a) the new `src/lib/transcript-cap.ts` module + `MAX_TRANSCRIPT_ENTRIES = 200` + `applyTranscriptCap` + `toMessagePayload` pure helpers, (b) the `spilledMessages: ConversationMessagePayload[]` instance field + the spill-to-DB-bound-buffer pattern, (c) the `persistConversation` Slot 1 + offline-queue path prepend semantics, (d) the new Sentry feature tag `"transcript-cap-evicted"` + `evictedCount` / `totalEntries` allowlist entries, (e) the Epic 13.1 (P2-3) follow-up handoff (the bounded `transcript.length` makes the FlatList re-render fix's budget realistic), (f) cross-story invariants preserved: 9-3 (Sentry allowlist), 9-4 (prompt injection — pure transformation, no user-input path), 9-5 (`appendIfNew` upstream), 11-1 (orphan-drain orthogonal), 11-2 (reconnect orthogonal), 11-7 (prompt-truncation orthogonal), 12-1 (orchestrator structure + frozen getState), 12-2 / 12-3 / 12-4 / 12-5 orthogonal.

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-6 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [ ] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — the cap helper is pure (no try/catch); the orchestrator's existing try/catch surfaces are unchanged.
- [ ] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [ ] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [ ] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass.
- [ ] **Story 9-3 Sentry allowlist contract holds** — one new `feature` string (`"transcript-cap-evicted"`) + two small-integer extras (`evictedCount`, `totalEntries`) added to `SENTRY_EXTRAS_ALLOWLIST` if not already present.
- [ ] **Story 9-4 stored-prompt-injection defense unaffected** — the cap is pure transformation; no user input flows through it.
- [ ] **Story 9-5 voice-transcript dedup unaffected** — `appendIfNew` + `acceptDelta` + `resolveTranscriptKey` + the FIFO-capped 256-entry dedup Set in `realtime-transcript.ts` run UPSTREAM of the cap and are NOT modified.
- [ ] **Story 11-1 tool-call orphan-drain unaffected** — `mergeOrphanCorrections` operates on `this.corrections`, NOT `this.transcript`.
- [ ] **Story 11-2 reconnect + barge-in unaffected** — the cap does not interact with the WebSocket lifecycle or AI-speaking state.
- [ ] **Story 11-7 prompt-truncation unaffected** — `MAX_PROMPT_MEMORIES` / `MAX_PROMPT_ERROR_PATTERNS` / `MAX_PROMPT_ITEM_CHARS` / `truncateToBytes` operate at prompt-build time, not per-turn append time.
- [ ] **Story 12-1 god-hook decomposition unaffected** — the cap is internal to the orchestrator; hook public API unchanged.
- [ ] **Story 12-1 P15 frozen `getState()` contract held** — cap helper returns NEW arrays; existing setState + Object.freeze flow unchanged.
- [ ] **Story 12-2 / 12-3 / 12-4 / 12-5 invariants orthogonal** — no shared state with the cap path.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/12-6-transcript-ref-cap.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Create `src/lib/transcript-cap.ts`** (AC #1)
  - [ ] Export `MAX_TRANSCRIPT_ENTRIES = 200`.
  - [ ] Export `applyTranscriptCap(transcript, newEntry)` pure FIFO helper.
  - [ ] Export `toMessagePayload(entry, conversationId)` pure converter.
  - [ ] Export `ConversationMessagePayload` type interface.
  - [ ] JSDoc the cap-then-evict sequencing + immutability invariant + 200-entry rationale.

- [ ] **Task 2: Modify `src/lib/realtime-orchestrator.ts`** (AC #2)
  - [ ] Add the new import line.
  - [ ] Add `private spilledMessages: ConversationMessagePayload[] = []` field near line 222-224.
  - [ ] Refactor `appendAiTranscriptEntry` to route through `applyTranscriptCap` after `result.appended === true`.
  - [ ] Refactor `handleItemCreated` to route through `applyTranscriptCap` after the user-side `entry` is built.
  - [ ] Add new private method `handleTranscriptEviction(evicted)` that spills to `this.spilledMessages` + fires the Sentry breadcrumb.
  - [ ] Reset `this.spilledMessages = []` in `start()` reset block.
  - [ ] Refactor `persistConversation` Phase A Slot 1 to insert `[...this.spilledMessages, ...messages]`.
  - [ ] Refactor `persistConversation` offline path to iterate `[...this.spilledMessages, ...this.transcript.map(toMessagePayload)]`.
  - [ ] Preserve the 8 read-only consumers of `this.transcript` unchanged.

- [ ] **Task 3: Sentry allowlist verification + extension** (AC #3)
  - [ ] Verify `evictedCount` is in `SENTRY_EXTRAS_ALLOWLIST` at `src/lib/sentry.ts`. Append if missing.
  - [ ] Verify `totalEntries` is in `SENTRY_EXTRAS_ALLOWLIST`. Append if missing.
  - [ ] Verify `"transcript-cap-evicted"` is 24 chars (well under 80 threshold).

- [ ] **Task 4: Tests** (AC #4)
  - [ ] Create `src/lib/__tests__/transcript-cap.test.ts` with 10 Jest cases (constant pin + identity × 2 + eviction × 3 + immutability + payload contract × 3).
  - [ ] Create `src/lib/__tests__/realtime-orchestrator-transcript-cap.test.ts` with 7 Jest cases (drift detector × 2 + runtime contract × 5).
  - [ ] Verify existing tests stay green (1362 → ~1379).

- [ ] **Task 5: Update CLAUDE.md** (AC #5)
  - [ ] Add Story 12-6 architecture paragraph after the Story 12-5 paragraph.

- [ ] **Task 6: Quality gates** (AC #Z)
  - [ ] `npm run type-check` passes.
  - [ ] `npm run lint` passes.
  - [ ] `npm run format:check` passes.
  - [ ] `npm test` passes (target 1362 → ~1379).
  - [ ] `npm run check:colors` passes.
  - [ ] CI Sentry DSN + Submit credentials leak guards pass.
  - [ ] `git status` shows the story file as untracked-but-not-ignored before initial commit.
  - [ ] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Pure-helper module with single source of truth for the cap policy** — mirrors Story 11-7's `truncateToBytes` + `MAX_PROMPT_MEMORIES` / `MAX_PROMPT_ERROR_PATTERNS` / `MAX_PROMPT_ITEM_CHARS` exports in `src/lib/prompts/conversation.ts`; Story 10-8's `runMcqDedupPipeline` + `MIN_FRESH_QUESTIONS_PER_SKILL` in `src/lib/exercise-dedup.ts`; Story 9-5's `appendIfNew` + `acceptDelta` + `resolveTranscriptKey` + `DEDUP_SET_CAP` in `src/lib/realtime-transcript.ts`. Same single-source-of-truth-via-module-level-helper idiom.
- **DB-payload accumulator for spilled entries** — analogous to Story 11-5's `extractPostConversationAnalysis` + `persistPostConversationAnalysis` pattern of buffering AI results before a single batch persist; analogous to Story 10-8's `extractExerciseHashes` + `persistExercise` payload-stamping. Both stories use post-processing helpers to drop in-memory bookkeeping before DB write.
- **Drift detector with comment-stripped CODE_ONLY source** — Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 pattern. Story 12-5 P12's `extractMethodBody` helper is reused here (anchor regex to method body so unrelated call sites can't false-positive).
- **Reset-all-state-on-start** — Story 12-1 P13 (spread `INITIAL_STATE` explicitly) + Story 12-5 P1 (`acquireWasCalled = false` in start's reset block). Story 12-6's `spilledMessages = []` extends the pattern.
- **Info-level Sentry breadcrumb for bounded-by-design events** — Story 11-6 review P6 lesson: info / warning levels for non-anomalous instrumentation; reserve error tier for unexpected failures. The cap eviction IS an expected operational signal, not an error.
- **No mid-session DB inserts** — analogous to Story 11-5's "consolidated post-conversation analysis" pattern (3 calls → 1 batch at end); Story 12-1's `persistConversation` 8-step chain collapsed to Phase A's 6-parallel slots. Story 12-6 keeps the batch-at-end-of-session pattern.
- **Pure helper returning NEW arrays** — Story 9-5 `appendIfNew` pattern + Story 10-8 dedup pipeline pattern. Immutability invariant matches React's reference-equality optimization expectations.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section included.

- **Epic 9 + 10 + 11 + 12-1 / 12-2 / 12-3 / 12-4 / 12-5 retros A3** (review-patch budget): Story 12-6 is a SMALL story — new ~80-line module + 5 orchestrator edits (import + field + 2 method refactors + new helper + reset + 2 persist surfaces) + 2 test files (~17 cases). Expect **4-7 review patches**. Risk surfaces:
  - (a) **Spill ordering at persist time**: the prepend `[...this.spilledMessages, ...messages]` preserves chronological order ONLY if eviction was strictly FIFO (no out-of-order writes). The helper's FIFO contract makes this true, BUT verify via test (Case 6: simulated session with 250 turns asserts insertion-order matches turn-order).
  - (b) **`handleTranscriptEviction` defensive early-return on null conversationId**: `conversation.item.created` only fires post-`createConversationRecord`, so `this.conversationId` should always be non-null at eviction time. BUT defensive guard handles the edge case where `start()` partially failed yet the WebSocket somehow delivered events. Test the null-guard explicitly.
  - (c) **`result.entry` non-null assertion** in `appendAiTranscriptEntry`: `appendIfNew` guarantees `result.entry !== undefined` when `result.appended === true` (verify `realtime-transcript.ts:141-154`). The `!` non-null assertion is safe by `appendIfNew`'s contract; document in JSDoc to defend against future refactors.
  - (d) **TypeScript `corrections` typing on `ConversationMessagePayload`**: the conditional `extends infer C` shape is fragile; alternative is a simple `corrections: Correction[] | null`. Use the simpler form.
  - (e) **Drift detector regex tolerance**: Story 12-4 P10 lesson — use `[\s\S]*?` separators in multi-line patterns + `extractMethodBody` for method-body anchoring; never match raw across method boundaries.
  - (f) **Offline-queue payload shape symmetry**: pre-12-6 offline path used `payload: msg as unknown as Record<string, unknown>`; post-12-6 the same shape should work — verify no FK/type mismatch with `enqueueWrite`.
  - (g) **Sentry breadcrumb level "info" vs "warning"**: Story 11-6 review P6 standardized fail-OPEN paths to info; the cap eviction is a successful bounded-by-design event. Use `info`.

- **Story 12-1 lesson** (decompose god-hook + parallelize persist): Story 12-6 strictly preserves the Phase A 6-slot shape — the only Slot 1 change is the input array, not the slot count or parallelism.
- **Story 12-5 lesson** (singleton-manager + acquireWasCalled tracking): The `spilledMessages` field follows the same instance-field-with-start-reset pattern as `acquireWasCalled`.
- **Story 9-5 lesson** (pure module owns dedup): Story 12-6 mirrors this by owning the cap policy in `src/lib/transcript-cap.ts`. The two modules compose: dedup first, cap second.

### Cross-story invariant table (regression guards)

| Story  | Invariant                                                                    | Preserved by                                                                                          |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 9-3    | `SENTRY_EXTRAS_ALLOWLIST` short categorical strings under 80 chars            | New `feature` tag is 24 chars; `evictedCount` + `totalEntries` are small bounded integers (Story 10-8 precedent) |
| 9-4    | Stored-prompt-injection defense — user input wrapped + sanitized               | Cap is pure transformation on `TranscriptEntry[]`; no user-input path                                  |
| 9-5    | Voice-transcript dedup — `appendIfNew` + FIFO 256-cap dedup Set                | Cap runs DOWNSTREAM of `appendIfNew`'s short-circuit; pure module unchanged                            |
| 9-6    | Auth listener event gating                                                   | Orthogonal — no shared state                                                                          |
| 9-7    | Zod schema retry contract                                                    | Orthogonal — no AI calls in cap path                                                                  |
| 9-8    | Speaking pipeline (record-and-grade)                                         | Orthogonal — separate non-Realtime flow                                                               |
| 9-9    | Deploy substrate                                                             | Orthogonal                                                                                            |
| 9-10   | Auth + cache race hardening                                                  | Orthogonal — no shared state                                                                          |
| 10-X   | TCF pedagogy + scoring + dedup                                               | Orthogonal — no prompt or scoring surfaces touched                                                    |
| 11-1   | Tool-call protocol + orphan-drain                                            | `mergeOrphanCorrections` operates on `this.corrections`, not `this.transcript`                       |
| 11-2   | Reconnect + barge-in                                                         | Cap doesn't touch WebSocket lifecycle or AI-speaking state                                            |
| 11-3   | Edge-function upstream timeouts                                              | Orthogonal — server-side                                                                              |
| 11-4   | Postgres rate-limit + daily cost cap                                         | Orthogonal — no AI calls in cap path                                                                  |
| 11-5   | Post-conversation analysis consolidation                                     | Cap runs UPSTREAM; analysis sees full transcript via `[...spilledMessages, ...messages]` concat       |
| 11-6   | Embedding-based dedupe in error-tracker                                      | Orthogonal — error-tracker is a separate path                                                          |
| 11-7   | Prompt truncation (memories + error patterns × max 80 chars)                 | Orthogonal — prompt-build time vs per-turn-append time                                                |
| 11-8   | Empty-response detection + retry parity                                      | Orthogonal — AI helpers unchanged                                                                     |
| 12-1   | Orchestrator structure + `PHASE_A_SLOT_NAMES` + `INITIAL_STATE` + frozen `getState()` | Slot 1 input shape changes; slot count + parallelism unchanged; cap helper returns new arrays         |
| 12-2   | Auth bootstrap one-time install                                              | Orthogonal — no shared state                                                                          |
| 12-3   | Atomic-RPC mutations                                                         | Orthogonal — no shared state                                                                          |
| 12-4   | `start()` race fix (assign before await)                                     | Cap state reset alongside `acquireWasCalled` in `start()` reset block                                  |
| 12-5   | `ExpoPlayAudioStream` singleton + refcount                                   | Orthogonal — audio lifecycle separate from transcript bookkeeping                                      |

### Anticipated File List

**Created:**

- `src/lib/transcript-cap.ts` (~80 lines)
- `src/lib/__tests__/transcript-cap.test.ts` (~10 cases)
- `src/lib/__tests__/realtime-orchestrator-transcript-cap.test.ts` (~7 cases)

**Modified:**

- `src/lib/realtime-orchestrator.ts` — add transcript-cap import + `spilledMessages` field + refactor 2 write sites + new `handleTranscriptEviction` private method + `start()` reset block + `persistConversation` Slot 1 + offline-queue path.
- `src/lib/sentry.ts` — verify / append `evictedCount` + `totalEntries` to `SENTRY_EXTRAS_ALLOWLIST` (if not already present).
- `CLAUDE.md` — Story 12-6 architecture paragraph.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status flip.

### References

- `[shippable-roadmap.md:86](_bmad-output/planning-artifacts/shippable-roadmap.md)` — audit P2-8.
- `[shippable-roadmap.md:209](_bmad-output/planning-artifacts/shippable-roadmap.md)` — Epic 12.6 deliverable.
- `[CLAUDE.md — Story 12-1 paragraph](CLAUDE.md)` — pre-commits 200-entry cap target.
- `[realtime-orchestrator.ts:223](src/lib/realtime-orchestrator.ts#L223)` — `private transcript: TranscriptEntry[] = []` field.
- `[realtime-orchestrator.ts:666-709](src/lib/realtime-orchestrator.ts#L666-L709)` — `appendAiTranscriptEntry` write site (AI-side).
- `[realtime-orchestrator.ts:909-919](src/lib/realtime-orchestrator.ts#L909-L919)` — `handleItemCreated` write site (user-side).
- `[realtime-orchestrator.ts:1110-1122](src/lib/realtime-orchestrator.ts#L1110-L1122)` — offline-queue path.
- `[realtime-orchestrator.ts:1195-1198](src/lib/realtime-orchestrator.ts#L1195-L1198)` — Phase A Slot 1.
- `[realtime-orchestrator.ts:1255-1286](src/lib/realtime-orchestrator.ts#L1255-L1286)` — `start()` reset block.
- `[realtime-transcript.ts:56-62](src/lib/realtime-transcript.ts#L56-L62)` — `TranscriptEntry` shape.
- `[realtime-transcript.ts:109-155](src/lib/realtime-transcript.ts#L109-L155)` — `appendIfNew` contract.
- `[TranscriptView.tsx:357-362](src/components/conversation/TranscriptView.tsx#L357-L362)` — FlatList consumer.
- `[history.tsx:383](app/(tabs)/conversation/history.tsx#L383)` — history-screen `conversation_messages` query.

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent._

### Debug Log References

### Completion Notes List

### File List

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-13 | Story 12-6 story file created; closes audit P2-8 (`transcriptRef.current` grows unbounded — runaway voice sessions cause JS-heap growth + FlatList re-render storm); Epic 12.6 deliverable at `shippable-roadmap.md:209` satisfied via 200-entry FIFO cap + in-orchestrator DB-payload spill buffer (`spilledMessages: ConversationMessagePayload[]`); Story 12-1 CLAUDE.md paragraph pre-committed 200-entry target ratified by this story; SMALL risk surface (~80-line new module + 5 orchestrator edits + 2 test files); ~4-7 review patches anticipated per Epic 9/10/11/12 retro budget. |
