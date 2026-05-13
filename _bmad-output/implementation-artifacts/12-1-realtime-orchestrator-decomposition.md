# Story 12.1: Decompose `useRealtimeVoice` into `RealtimeOrchestrator` Class + Thin Hook + Parallelize the 8-Step `persistConversation` Chain

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose **central Realtime voice conversation feature is owned by a 1,354-line "god hook"** at [`src/hooks/use-realtime-voice.ts`](src/hooks/use-realtime-voice.ts) that has organically grown across Stories 9-3 through 11-8 to absorb **14 distinct responsibilities** (state management with 16 separate `useRef`s + a `useState` + a `statusRef` mirror; WebSocket connection lifecycle including Story 11-2's reconnect + barge-in; ExpoPlayAudioStream subscription management; the massive `handleEvent` switch routing 12+ Realtime event types; `handleFunctionCall` dispatching 3 Story-11-1 tools — `save_vocabulary` + `note_error_pattern` + `report_correction`; `appendAiTranscriptEntry` + Story 9-5 dedup; `correctionsRef` + Story 11-1 `pendingToolCorrectionsRef` orphan buffer; AI-speaking state tracking + barge-in trigger timing; `createConversationRecord` Supabase write; `persistConversation` 8-step chain; duration tracking; inflight-response tracking; reconnect state coordination; and offline queue fallback via `enqueueWrite`) so the file has **far exceeded the CLAUDE.md 200-line component guideline** AND the audit-spec'd `useRealtimeVoice.ts ≤ 250 lines` target — a 5.4× over-budget condition that makes every Realtime-conversation bug fix a high-blast-radius operation (the file's grown ~70% larger since the P1-17 audit was filed at 794 lines), AND the `persistConversation` chain at [`use-realtime-voice.ts:923-1101`](src/hooks/use-realtime-voice.ts) runs **8 sequential `await`s** before the user sees the post-conversation feedback summary (Step 1: `conversations.update` ~200ms; Step 2: `conversation_messages.insert` batch ~300ms; Step 3: `extractPostConversationAnalysis` AI call ~3,000ms; Step 4: `updateSkillProgress` ~200ms; Step 5: `incrementDailyActivity` ~200ms; Step 6: `updateStreak` ~200ms; Step 7: `checkCefrPromotion` — depends on Step 4's updated skill_progress row, sequential — ~300ms; pre-11-5 Step 8 was deleted), producing a **tail latency of ~4,400ms = ~4.4 seconds of "saving..." UI** that the user sees AFTER they've finished speaking AND AFTER the AI has finished its closing turn — a UX dead zone where users either tap-away (losing the feedback surface) or wait staring at a spinner; the audit P1-17 row at [`shippable-roadmap.md` line 69](_bmad-output/planning-artifacts/shippable-roadmap.md) explicitly tags this "5-7s tail latency" (the audit's ~5-7s estimate matches a pessimistic version of my ~4.4s breakdown; the variance comes from network conditions), and the Epic 12.1 deliverable at [`shippable-roadmap.md` line 204](_bmad-output/planning-artifacts/shippable-roadmap.md) names the architectural fix explicitly: **"Decompose `useRealtimeVoice` into a `RealtimeOrchestrator` class (lib) + thin hook (state surface only); parallelize the 8-step persistConversation chain. Covers P1-17."** + Epic 12 acceptance criterion at [`shippable-roadmap.md` line 218](_bmad-output/planning-artifacts/shippable-roadmap.md): **"`useRealtimeVoice.ts` ≤ 250 lines."** + the surrounding stories explicitly carve out non-overlapping scope (12-3 owns atomic-RPC mutations for `incrementDailyActivity` / `updateStreak` / `updateSkillProgress`; 12-4 owns the `useRealtimeVoice.start` `sessionRef.current = session` race fix at audit P2-21; 12-5 owns the `ExpoPlayAudioStream` lifecycle singleton; 12-6 owns the `transcriptRef` 200-entry cap) so **12-1 is purely the architectural decomposition + parallelization + hook-line-budget enforcement** — every other concern delegates to its sibling story,

I want (a) a **new module `src/lib/realtime-orchestrator.ts`** exporting `class RealtimeOrchestrator` that absorbs the 14 responsibilities listed above as private fields + methods + state; the class is **plain TypeScript** (not a React hook) so it's directly unit-testable without a React renderer + has a stable surface for Story 12-3/12-4/12-5/12-6 to refine without touching the hook layer, (b) the **observer pattern** for state propagation: `class RealtimeOrchestrator` exposes a public `subscribe(callback: (state: ConversationState) => void): () => void` method returning an unsubscribe closure (the React hook becomes the sole subscriber; if a future feature needs to mirror state into Zustand for cross-screen access, it'd be a second subscriber); the orchestrator's INTERNAL state mutation routes through a private `setState(updater)` that fires the observer; this mirrors Story 11-2's `RealtimeSession` event-emitter pattern (`session.on("realtime.reconnected", ...)`) so operator mental model is consistent across both `lib/` modules, (c) the **hook at `src/hooks/use-realtime-voice.ts` shrinks to ≤ 250 lines** (target: ~80-120 lines; the spec budget is 250) by becoming a pure React binding: `useRef` to lazily construct the orchestrator on first render; `useState` mirroring the orchestrator's `ConversationState`; `useEffect` subscribing to the orchestrator + cleaning up on unmount; `useCallback`-wrapped pass-through methods (`start` / `end`); zero business logic in the hook itself — the orchestrator owns ALL of `handleEvent` / `handleFunctionCall` / `persistConversation` / etc., (d) the **8-step `persistConversation` chain parallelizes** into **two phases** — Phase A (independent writes): Steps 1, 2, 4, 5, 6 + the new post-conversation analysis call (Step 3) all fire concurrently via `Promise.allSettled`; Phase B (Step 7 only): `checkCefrPromotion` runs AFTER Phase A completes because it reads the `skill_progress` row updated by Step 4 — running it in Phase A would race against the UPDATE and read stale data; Phase A's worst-case is `max(Step1, Step2, Step3, Step4, Step5, Step6) = ~3,000ms` (dominated by the AI analysis); Phase B adds ~300ms; **total ~3,300ms** down from ~4,400ms (~25% reduction on the tail; the AI call is the dominator, not the Supabase writes — but the writes still steal ~1.1s pre-12-1), (e) the **`Promise.allSettled` failure semantics** match Story 11-5's pattern: per-slot failures route through `captureError(_, "persist-conversation-XYZ")` without blocking the other slots; Step 7's `checkCefrPromotion` runs even if Phase A had a partial failure (Step 4 may have succeeded → CEFR check still meaningful; Step 4 may have failed → CEFR check sees stale data + no-ops cleanly per its existing internal guard), (f) the **public hook API surface stays IDENTICAL** to pre-12-1 — `UseRealtimeVoiceOptions` input shape + `UseRealtimeVoiceReturn` output shape are unchanged; the conversation screen at [`app/(tabs)/conversation/[sessionId].tsx`](app/(tabs)/conversation/[sessionId].tsx) consumes the hook with **zero changes required** — Story 12-1 is a private-implementation refactor that's invisible to callers, (g) **NO scope creep into sibling stories** — Story 12-1 explicitly DOES NOT (g1) refactor `incrementDailyActivity` / `updateStreak` / `updateSkillProgress` into atomic-RPC mutations (12-3's scope; per-row Supabase round-trips stay), (g2) move `sessionRef.current = session` before `await connect()` (12-4's scope; the race window pre-12-1 stays — moving it as part of 12-1 would tangle the refactor's review surface with an orthogonal race fix), (g3) refactor `ExpoPlayAudioStream` into a singleton with refcounting (12-5's scope), (g4) cap `transcriptRef` at 200 entries (12-6's scope), AND it explicitly DOES preserve every Story 9-X / 10-X / 11-X invariant — Story 9-3 Sentry allowlist (no new `feature` tags introduced; the orchestrator routes through the same `captureError(_, "feature")` sites the hook used pre-12-1), Story 9-4 stored-prompt-injection defense (`buildConversationPrompt` continues wrapping memories + error patterns in `<USER_FACTS>` / `<USER_WEAK_AREAS>` blocks; the orchestrator passes these through unchanged), Story 9-5 voice transcript dedup (`appendIfNew` / `acceptDelta` / `resolveTranscriptKey` from `realtime-transcript.ts` are pure helpers — orchestrator calls them at the same boundary the hook did), Story 9-6 auth listener (orthogonal — the orchestrator reads `user` from constructor options, not via Zustand subscription), Story 9-7 Zod schema retry contract (`extractPostConversationAnalysis` keeps its `parseRetries: 1` contract; orchestrator calls it transparently), Story 9-8 / 10-6 speaking pipeline (separate `chatCompletionJSON(speakingTaskEvaluationSchema)` flow at `mock-test/speaking.tsx`; not touched), Story 9-9 / 9-10 (orthogonal), Story 10-X surfaces (prompts + scoring; orchestrator consumes unchanged), Story 11-1 `report_correction` tool-call protocol (the orchestrator's `handleFunctionCall` method preserves the `processReportCorrectionCall` + `drainPendingCorrections` pure-helper invocations from `src/lib/realtime-corrections.ts` — Story 11-1's P2/P3 orphan-drain semantics on reconnect-start + response.done + case "error" all preserved by construction), Story 11-2 reconnect + barge-in (`RealtimeSession.subscribe("realtime.reconnecting" / "realtime.reconnected")` + `computeBargeInDirective` + `inflightItemIdRef` + `aiSpeakingStartedAtMsRef` all migrate from hook-level refs to orchestrator-level fields with identical semantics; reconnect-start drain of `pendingToolCorrectionsRef` into `correctionsRef` preserved), Story 11-3 Edge Function upstream timeouts (`fetchWithTimeout` is server-side; orchestrator calls `chatCompletionJSON` / `generateSpeech` / etc. transparently), Story 11-4 Postgres-backed rate-limit + daily cost cap (orchestrator's persist-chain calls Supabase + AI helpers transparently; rate-limit pre-checks unchanged), Story 11-5 cost discipline (`extractPostConversationAnalysis` + `persistPostConversationAnalysis` + `gpt-realtime-mini` MODEL all unchanged; the orchestrator just moves the call site from hook-level `useCallback` to class method), Story 11-6 embedding-based dedupe (`trackError` boundary unchanged), Story 11-7 prompt truncation (`MAX_PROMPT_MEMORIES` + `MAX_PROMPT_ERROR_PATTERNS` + `truncateToBytes` consumed via `buildConversationPrompt`; bootstrap fetch at `[sessionId].tsx:205-206` unchanged), Story 11-8 empty-response detection + retry parity (`MAX_RETRIES` + `RETRY_DELAYS` + `isRetryable` + `RETRYABLE_EMPTY_MESSAGES` consumed transparently through the AI helpers), (h) regression tests cover: the orchestrator's `subscribe` observer contract (1 subscriber, multi-update-deliver, unsubscribe-cleanup), the persist-phase parallel-vs-sequential ordering invariant (Phase A all fire concurrently; Phase B fires AFTER Phase A completes), the hook-line-budget invariant via a drift-detector test reading `use-realtime-voice.ts` from disk + asserting `line count ≤ 250` (mirrors Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 drift-detector pattern), the public hook API surface invariant (`UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn` shape pinned by TypeScript at the call site + a runtime test that constructs the hook with the same options shape the conversation screen uses), the Phase A failure-isolation contract (one slot rejecting doesn't block the others; Sentry capture fires per failed slot), the Phase B preserve-semantics contract (`checkCefrPromotion` runs even on partial Phase A failure), and a smoke-level E2E test that drives the orchestrator through a stub Realtime event stream and verifies the same final state the hook produced pre-12-1,

so that **audit finding P1-17 closes architecturally**; the Realtime voice conversation feature has a **clean architectural seam** that 12-3 / 12-4 / 12-5 / 12-6 can build on without re-disturbing the 1,354-line surface; the persistConversation tail latency drops from ~4.4s to ~3.3s (~25% reduction; bigger wins available in future stories once 12-3's atomic-RPC mutations + 11-5's already-applied AI-call consolidation compound); the hook's line budget hits the spec literal ≤ 250 lines (target ~80-120, well under); the orchestrator class is **directly unit-testable without a React renderer** — Story 11-2's `RealtimeSession.test.ts` pattern (`new RealtimeSession(config); session.subscribe(...)`) extends naturally here; future engineering on Realtime conversation features (e.g., Epic 14.X new modes, Epic 16.X tier-aware model routing) has a class-level API to extend instead of a god-hook to surgically modify; the verified-correct surfaces NOT touched are Stories 9-3 / 9-4 / 9-5 / 9-6 / 9-7 / 9-8 / 9-9 / 9-10 / 10-2 / 10-3 / 10-4 / 10-5 / 10-6 / 10-7 / 10-8 / 11-1 / 11-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 invariants (all preserved by construction — the orchestrator is a pure call-site-relocation refactor of business logic that already existed inside the hook).

## Background — Why This Story Exists

### What audit finding P1-17 owns to this story

[`shippable-roadmap.md` line 69](_bmad-output/planning-artifacts/shippable-roadmap.md): "P1-17 — `useRealtimeVoice` is an 794-line god-hook running 14 responsibilities; `persistConversation` runs 8 sequential awaits before showing summary (5-7s tail latency)."

The audit was filed at 794 lines; the hook has since grown to **1,354 lines** (+70%) through Stories 11-1 (correction tool-call protocol added ~150 LOC), 11-2 (reconnect + barge-in added ~200 LOC), 11-5 (consolidation refactor net +50 LOC), 11-8 (no LOC change — boundary moved into `openai.ts`). The growth direction is unmistakable; without 12-1 the hook continues sprawling.

[`shippable-roadmap.md` line 204](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 12.1 deliverable: "Decompose `useRealtimeVoice` into a `RealtimeOrchestrator` class (lib) + thin hook (state surface only); parallelize the 8-step persistConversation chain. **Covers P1-17.**"

[`shippable-roadmap.md` line 218](_bmad-output/planning-artifacts/shippable-roadmap.md) Epic 12 acceptance criterion: "`useRealtimeVoice.ts` ≤ 250 lines."

### Current state — the 14 responsibilities

Inventory of `use-realtime-voice.ts` (1,354 lines as of 2026-05-13):

| # | Responsibility | Current location | Lines |
|---|---|---|---|
| 1 | State management (16 `useRef`s + `useState`) | lines 120-213 | ~95 |
| 2 | `parseCorrections` Story 11-1 buffer drain | lines 237-240 | ~5 |
| 3 | Audio streaming start/stop | lines 242-291 | ~50 |
| 4 | `handleFunctionCall` (3 Story 11-1 tools) | lines 292-410 | ~120 |
| 5 | `appendAiTranscriptEntry` + Story 9-5 dedup | lines 411-468 | ~60 |
| 6 | `handleEvent` (massive switch; 12+ event types) | lines 469-898 | ~430 |
| 7 | `createConversationRecord` | lines 899-920 | ~20 |
| 8 | `persistConversation` 8-step chain | lines 922-1101 | ~180 |
| 9 | `start` + connection bootstrap + Story 11-2 reconnect | lines 1103-1265 | ~165 |
| 10 | `end` + cleanup + duration finalization | lines 1267-1330 | ~65 |
| 11 | `useEffect` (mount → start, unmount → cleanup) | lines 1332-1354 | ~25 |

**Total: ~1,215 lines of business logic + ~140 lines of imports/types/comments.**

### Current state — the 8-step `persistConversation` sequential chain

[`use-realtime-voice.ts:923-1101`](src/hooks/use-realtime-voice.ts):

```typescript
const persistConversation = useCallback(async (duration: number) => {
  if (!user || !conversationIdRef.current) return;
  const conversationId = conversationIdRef.current;

  // Offline branch: enqueueWrite all, return.
  if (!(await isOnline())) { /* ... */ return; }

  try {
    // 1. Update conversation record               ~200ms
    await supabase.from("conversations").update(...).eq("id", conversationId);

    // 2. Save transcript messages                 ~300ms
    if (messages.length > 0) {
      await supabase.from("conversation_messages").insert(messages);
    }

    // 3. Consolidated post-conv analysis (Story 11-5)  ~3,000ms
    if (hasLongTranscript) {
      const analysis = await extractPostConversationAnalysis(...);
      const { feedback } = await persistPostConversationAnalysis(...);
      if (feedback) setState((s) => ({ ...s, feedback }));
    } else if (hasCorrections) {
      await persistErrorPatterns(user.id, patterns);
    }

    // 4. updateSkillProgress                       ~200ms
    await updateSkillProgress(user.id, "speaking", cefrLevel, speakingScore, minutesPracticed);

    // 5. incrementDailyActivity                    ~200ms
    await incrementDailyActivity(user.id, { minutes: minutesPracticed, conversations: 1 });

    // 6. updateStreak                              ~200ms
    await updateStreak(user.id);

    // 7. checkCefrPromotion (depends on Step 4)    ~300ms
    await checkCefrPromotion(user.id);

    // 8. (deleted in Story 11-5 — feedback now in Step 3)
  } catch (err) {
    captureError(err, "persist-conversation");
  }
}, [user, cefrLevel]);
```

**Tail latency = ~200 + 300 + 3,000 + 200 + 200 + 200 + 300 = ~4,400ms** (rough; AI call dominates).

### Dependency graph of the 7 active steps

```
                ┌────────────────┐
                │ persistConv()  │
                └───────┬────────┘
                        │
        ┌───┬───┬───┬───┼───┬───┐
        ▼   ▼   ▼   ▼   ▼   ▼   ▼
       (1) (2) (3) (4) (5) (6)  ← all independent
                    │
                    └──► (7) checkCefrPromotion (reads skill_progress)
```

- Steps 1, 2, 3, 4, 5, 6 have **no inter-dependencies** — they touch disjoint tables (`conversations`, `conversation_messages`, `companion_memory` + `error_patterns` + `conversations.ai_feedback`, `skill_progress`, `daily_activity`, `profiles.current_streak`).
- Step 7 depends on Step 4's `UPDATE skill_progress` — runs AFTER.

### Parallelization design — Phase A + Phase B

Post-12-1 `persistConversation`:

```typescript
// Phase A: 6 independent writes/calls fire concurrently.
const phaseAResults = await Promise.allSettled([
  // Step 1: conversation completion
  supabase.from("conversations").update(...).eq("id", conversationId),
  // Step 2: transcript messages
  messages.length > 0 ? supabase.from("conversation_messages").insert(messages) : Promise.resolve(),
  // Step 3: AI analysis + persist (Story 11-5 already uses Promise.allSettled internally)
  hasLongTranscript
    ? extractPostConversationAnalysis(...).then(persistPostConversationAnalysis)
    : (hasCorrections ? persistErrorPatterns(user.id, patterns) : Promise.resolve()),
  // Step 4
  updateSkillProgress(user.id, "speaking", cefrLevel, speakingScore, minutesPracticed),
  // Step 5
  incrementDailyActivity(user.id, { minutes: minutesPracticed, conversations: 1 }),
  // Step 6
  updateStreak(user.id),
]);

// Capture per-slot failures (matches Story 11-5 persistPostConversationAnalysis pattern).
for (let i = 0; i < phaseAResults.length; i++) {
  const r = phaseAResults[i];
  if (r.status === "rejected") {
    captureError(r.reason, `persist-conversation-phase-a-${PHASE_A_SLOT_NAMES[i]}`);
    continue;
  }
  // Supabase-fulfilled-with-error detection (Story 11-5 P3 pattern)
  const v = r.value as { error?: { message?: string } | null } | undefined;
  if (v?.error) {
    captureError(new Error(v.error.message ?? "phase A supabase error"),
                 `persist-conversation-phase-a-${PHASE_A_SLOT_NAMES[i]}`);
  }
}

// Phase B: depends on Step 4's skill_progress UPDATE having landed.
try {
  await checkCefrPromotion(user.id);
} catch (err) {
  captureError(err, "persist-conversation-cefr-promotion");
}
```

**Phase A tail = max(~200, ~300, ~3000, ~200, ~200, ~200) = ~3,000ms** (AI call still dominates).
**Phase B tail = ~300ms.**
**Total = ~3,300ms** (~25% reduction; would be larger if the AI call weren't already the dominator — Story 11-5's consolidation already collapsed 3 AI calls into 1, so 11-5 captured most of the addressable AI cost).

The realistic-best parallel speedup is bounded by the AI call. The Supabase writes save ~1.1s of cumulative time.

### Orchestrator design — observer pattern

New module `src/lib/realtime-orchestrator.ts`:

```typescript
export class RealtimeOrchestrator {
  private state: ConversationState = INITIAL_STATE;
  private subscribers: Set<(state: ConversationState) => void> = new Set();

  // All pre-12-1 hook-level refs become private class fields.
  private session: RealtimeSession | null = null;
  private currentAiText = "";
  private transcript: TranscriptEntry[] = [];
  private corrections: Correction[] = [];
  private conversationId: string | null = null;
  private startTimeMs = 0;
  // ... (the rest of the 16 refs)

  constructor(private readonly options: RealtimeOrchestratorOptions) {}

  /** Public API — start a new conversation. */
  async start(): Promise<void> { /* ... */ }

  /** Public API — end the conversation. */
  async end(): Promise<void> { /* ... */ }

  /** Public API — observer pattern; hook subscribes here. */
  subscribe(callback: (state: ConversationState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.state); // Initial sync
    return () => { this.subscribers.delete(callback); };
  }

  /** Public API — synchronous state read. */
  getState(): ConversationState { return this.state; }

  /** Public API — cleanup on unmount. */
  dispose(): void { /* clear timers, close session, drop subscribers */ }

  // Private internals: all pre-12-1 hook methods become class methods.
  private setState(updater: (s: ConversationState) => ConversationState): void {
    this.state = updater(this.state);
    this.subscribers.forEach((cb) => cb(this.state));
  }

  private handleEvent(event: RealtimeEvent): void { /* ... */ }
  private handleFunctionCall(name: string, args: unknown): void { /* ... */ }
  private appendAiTranscriptEntry(itemId: string, text: string): void { /* ... */ }
  private async persistConversation(duration: number): Promise<void> { /* Phase A + B */ }
  private async createConversationRecord(): Promise<string | null> { /* ... */ }
  // ... etc.
}
```

The pattern mirrors Story 11-2's `RealtimeSession` class. Operator mental model: both `lib/` classes use observer-pattern public APIs (`subscribe` / `on`), private internals for state, and a `dispose` boundary for cleanup. Symmetric → easy to reason about.

### Hook design — pure React binding

Post-12-1 `src/hooks/use-realtime-voice.ts`:

```typescript
export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const orchestratorRef = useRef<RealtimeOrchestrator | null>(null);
  const [state, setState] = useState<ConversationState>(INITIAL_STATE);

  // Lazy-construct on first render.
  if (!orchestratorRef.current) {
    orchestratorRef.current = new RealtimeOrchestrator({
      user: options.user,
      cefrLevel: options.cefrLevel,
      mode: options.mode,
      topic: options.topic,
      topicDescription: options.topicDescription,
      voice: options.voice,
      memories: options.memories,
      errorPatterns: options.errorPatterns,
      onConversationEnd: options.onConversationEnd,
    });
  }

  // Subscribe to state updates from orchestrator.
  useEffect(() => {
    const unsubscribe = orchestratorRef.current!.subscribe(setState);
    return unsubscribe;
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => { orchestratorRef.current?.dispose(); };
  }, []);

  // Public hook API (unchanged shape).
  const start = useCallback(() => orchestratorRef.current!.start(), []);
  const end = useCallback(() => orchestratorRef.current!.end(), []);

  return { state, start, end };
}
```

**Line budget: ~80-100 lines including imports, types, JSDoc.** Well under the 250-line spec target.

### Spec compliance — exactly what the roadmap asks for

| Spec requirement | Story 12-1 delivers |
|---|---|
| Decompose `useRealtimeVoice` into orchestrator class | `class RealtimeOrchestrator` at `src/lib/realtime-orchestrator.ts` |
| Thin hook (state surface only) | `useRealtimeVoice.ts` becomes ~80-100 lines |
| Parallelize the 8-step persistConversation | Phase A `Promise.allSettled([...])` + Phase B `await checkCefrPromotion` |
| `useRealtimeVoice.ts ≤ 250 lines` | Target ~80-100; spec budget ≤ 250 |

No interpretation, no embellishment. Three artifacts: orchestrator class + thin hook + parallel persist.

### Threat / failure model — what cannot happen post-story

After this story:

1. **The hook is mechanically capped at 250 lines** via a drift-detector test that reads `use-realtime-voice.ts` from disk and asserts `wc -l ≤ 250`. A future regression that grows the hook past the budget fails CI loudly.

2. **The orchestrator is unit-testable without a React renderer.** Story 11-2's `realtime-reconnect.test.ts` pattern extends here: `new RealtimeOrchestrator(opts); orchestrator.subscribe(...)`.

3. **Phase A failure-isolation contract** preserved per Story 11-5 (`persistPostConversationAnalysis` is the canonical pattern): per-slot rejections route through `captureError` without blocking the others. Supabase-fulfilled-with-error detection (Story 11-5 review patch P3) also preserved.

4. **Phase B preserves the Step 7 → Step 4 dependency.** `checkCefrPromotion` reads `skill_progress` which is updated by Step 4 (`updateSkillProgress`). Running Phase B after Phase A's allSettled completes guarantees Step 4's write has landed (or failed with operator visibility). Tests pin this ordering.

5. **The public hook API surface stays IDENTICAL** to pre-12-1. The conversation screen at `[sessionId].tsx` consumes the hook with zero changes. Verified by TypeScript at the call site + a runtime smoke test.

6. **Stories 11-1 / 11-2 / 11-5 / 11-6 / 11-7 / 11-8 invariants preserved by construction.** The orchestrator absorbs business logic without modifying the helper functions those stories ship (`processReportCorrectionCall`, `shouldReconnect`, `computeBargeInDirective`, `extractPostConversationAnalysis`, `trackError`, `truncateToBytes`, `MAX_RETRIES`/`RETRY_DELAYS`).

7. **No new Sentry feature tags.** The orchestrator uses the same `captureError(_, "feature")` sites the hook used pre-12-1, plus the new Phase A per-slot tags `persist-conversation-phase-a-{conversation|messages|analysis|skill-progress|daily-activity|streak}` and Phase B `persist-conversation-cefr-promotion`. These are short categorical strings (< 80 chars); `feature` is already allowlisted (Story 9-3).

8. **Sibling stories' scopes are explicitly preserved.** 12-3 (atomic-RPC mutations) takes Phase A as input + replaces per-row Supabase round-trips with atomic RPCs. 12-4 (start race fix) operates on the new orchestrator's `start()` method instead of the deleted `useRealtimeVoice.start` `useCallback`. 12-5 (ExpoPlayAudioStream singleton) operates on the orchestrator's `startAudioStreaming` / `stopAudioStreaming` methods. 12-6 (transcriptRef cap) operates on the orchestrator's private `transcript` field. Clean handoff.

9. **Concurrent `start()` calls** still no-op via the orchestrator's internal status guard (`if (this.state.status === "connecting" || "connected" || "reconnecting") return;` — preserved from Story 11-2 P25). Multiple orchestrator instances would each run their own conversation, but only one orchestrator exists per hook invocation (lazy-construct via `useRef`).

10. **Tests for the orchestrator class** are in a NEW file `src/lib/__tests__/realtime-orchestrator.test.ts` (mirrors `realtime-reconnect.test.ts`); tests for the hook stay at `src/hooks/__tests__/use-realtime-voice.test.tsx` (if any pre-12-1 tests exist) and assert the surface only — observer hookup, line-budget drift detector, etc.

### Out of scope for this story (delegated elsewhere)

- **Atomic-RPC mutations for `incrementDailyActivity` / `updateStreak` / `updateSkillProgress`** — Story 12-3 (`12-3-atomic-rpc-mutations`). 12-1 keeps the existing per-row Supabase round-trips; 12-3 replaces them with `UPDATE x = x + $1` server-side RPCs.
- **`sessionRef.current = session` race fix** — Story 12-4 (`12-4-realtime-start-race-fix`). 12-1 preserves the pre-12-1 race semantics; 12-4 fixes the race within the new orchestrator's `start()` method.
- **`ExpoPlayAudioStream` singleton with refcounting** — Story 12-5 (`12-5-expoplayaudiostream-lifecycle`).
- **`transcriptRef` cap at 200 entries** — Story 12-6 (`12-6-transcript-ref-cap`). 12-1 keeps the unbounded `transcript: TranscriptEntry[]` array field.
- **Encrypted profile cache** — Story 12-7 (`12-7-encrypted-profile-cache`).
- **Password policy / email verification / npm audit / Edge Function error sanitization** — Stories 12-8 / 12-9 / 12-10 / 12-11.
- **Cap pronunciation history** — Story 12-12.
- **Zustand integration** — orchestrator state stays observer-internal; if a future feature needs cross-screen state mirroring, a second subscriber writes to Zustand. Out of scope for 12-1.
- **Streaming UI: progressive Phase A feedback** — show Step 1's "conversation saved" before Step 3's AI analysis completes. UX improvement; future story.
- **Server-side persist coordination** — if Phase A's 6-way Supabase fan-out causes connection pool issues in production, a future story can collapse to a single RPC. Out of scope.
- **Migrating other hooks** (e.g., `use-exercise.ts`, `use-pronunciation.ts`, `use-dictation.ts`) to similar class+hook splits. They're smaller (~200-400 LOC each) and don't hit the same complexity ceiling. Future story.

## Acceptance Criteria

### 1. Create `RealtimeOrchestrator` class

- [x] **CREATE** `src/lib/realtime-orchestrator.ts` exporting `class RealtimeOrchestrator`. Public surface:

  ```typescript
  export interface RealtimeOrchestratorOptions {
    user: User | null;
    cefrLevel: CEFRLevel;
    mode: ConversationMode;
    topic: string;
    topicDescription?: string;
    voice?: FrenchVoice;
    memories?: string[];
    errorPatterns?: string[];
    onConversationEnd?: () => void;
  }

  export class RealtimeOrchestrator {
    constructor(options: RealtimeOrchestratorOptions);
    start(): Promise<void>;
    end(): Promise<void>;
    subscribe(callback: (state: ConversationState) => void): () => void;
    getState(): ConversationState;
    dispose(): void;
  }
  ```

- [x] **MIGRATE** the 14 pre-12-1 responsibilities listed in the table above from hook methods to orchestrator private methods. **Preserve all Story 9-X / 10-X / 11-X invariants by construction** — the migration is call-site relocation, not logic change.

- [x] **PRESERVE** every existing `captureError(_, "feature")` site verbatim. New Phase A per-slot tags (`persist-conversation-phase-a-{conversation|messages|analysis|skill-progress|daily-activity|streak}` + `persist-conversation-cefr-promotion`) are short categorical strings under Story 9-3's 80-char threshold; `feature` already allowlisted.

**Given** an instance of `RealtimeOrchestrator` is constructed with valid options
**When** `subscribe(callback)` is called
**Then** the callback receives the current state immediately (initial sync) AND every subsequent state mutation fires the callback exactly once.

**Given** an orchestrator with N subscribers
**When** the orchestrator's internal `setState` fires
**Then** every subscriber's callback is invoked exactly once with the new state.

### 2. Shrink hook to ≤ 250 lines

- [x] **REWRITE** `src/hooks/use-realtime-voice.ts` to be a pure React binding (target ~80-100 lines; spec budget ≤ 250):

  ```typescript
  export function useRealtimeVoice(options: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
    const orchestratorRef = useRef<RealtimeOrchestrator | null>(null);
    const [state, setState] = useState<ConversationState>(INITIAL_STATE);

    if (!orchestratorRef.current) {
      orchestratorRef.current = new RealtimeOrchestrator(/* ... */);
    }

    useEffect(() => orchestratorRef.current!.subscribe(setState), []);
    useEffect(() => () => orchestratorRef.current?.dispose(), []);

    const start = useCallback(() => orchestratorRef.current!.start(), []);
    const end = useCallback(() => orchestratorRef.current!.end(), []);

    return { state, start, end };
  }
  ```

- [x] **PRESERVE** `UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn` type shapes verbatim. The conversation screen at `app/(tabs)/conversation/[sessionId].tsx` MUST consume the hook with **zero changes**.

- [x] **DELETE** all the hook-level `useRef` / `useState` / `useCallback` / `useEffect` that owned the 14 responsibilities. Move them into orchestrator fields/methods. "Delete don't alias" pattern (Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8) — verified by grep that nothing outside the hook imports these.

**Given** `wc -l src/hooks/use-realtime-voice.ts` post-12-1
**When** the line count is measured
**Then** `count ≤ 250` (target ~80-100; budget 250).

**Given** the conversation screen at `app/(tabs)/conversation/[sessionId].tsx`
**When** TypeScript compiles post-12-1
**Then** zero errors AND no changes required to the screen file.

### 3. Parallelize `persistConversation` into Phase A + Phase B

- [x] **IMPLEMENT** the orchestrator's `persistConversation` method with **Phase A** (6-way `Promise.allSettled` of independent writes) + **Phase B** (`checkCefrPromotion` only, after Phase A). Per-slot failure-isolation pattern matches Story 11-5's `persistPostConversationAnalysis`.

- [x] **EXPORT** `PHASE_A_SLOT_NAMES: readonly string[]` constant from `realtime-orchestrator.ts` for test pinning + Sentry tag construction. Pinned values: `["conversation", "messages", "analysis", "skill-progress", "daily-activity", "streak"]`.

- [x] **PRESERVE** the offline-branch behavior: if `await isOnline()` returns false, run the pre-12-1 `enqueueWrite` fallback for `conversations.update` + `conversation_messages.insert` only (Phase A in offline mode skips Steps 3-6 + all of Phase B; matches pre-12-1 semantics).

- [x] **PRESERVE** Story 11-5's short-transcript-fallback at Step 3 (`hasCorrections && !hasLongTranscript` → `persistErrorPatterns` directly).

**Given** a completed conversation with 6 independent persist operations
**When** the orchestrator's `persistConversation` runs
**Then** Phase A's 6 promises are dispatched concurrently (verified via a mock that records `Date.now()` at each invocation; max-skew across the 6 invocations < 50ms) AND Phase B's `checkCefrPromotion` is invoked AFTER all 6 Phase A promises have settled.

**Given** one Phase A slot rejects (e.g., `updateStreak` throws)
**When** the orchestrator processes the `Promise.allSettled` results
**Then** `captureError(_, "persist-conversation-phase-a-streak")` fires AND the other 5 slots' results are NOT impacted AND Phase B's `checkCefrPromotion` still runs.

**Given** Phase A's slot 0 (conversation update) is fulfilled but `value.error` is a Postgres error (Story 11-5 P3 pattern)
**When** the orchestrator inspects the fulfilled-with-error slot
**Then** `captureError(_, "persist-conversation-phase-a-conversation")` fires.

### 4. Tests

- [x] **CREATE** `src/lib/__tests__/realtime-orchestrator.test.ts` (~18 cases):

  - **Observer pattern:**
    - `subscribe(cb)` fires `cb(initialState)` synchronously.
    - State mutation fires `cb(newState)` exactly once.
    - Multiple subscribers each receive the same state.
    - `unsubscribe()` removes the callback.
    - `dispose()` clears all subscribers AND closes the session AND clears the duration timer.
  - **Public API surface:**
    - `start()` is idempotent — calling twice while `status === "connecting"` no-ops.
    - `end()` is idempotent.
    - `getState()` returns a frozen snapshot (matches the observer-payload state).
  - **persistConversation Phase A + B parallelization:**
    - 6-way Phase A: mock each slot, record `Date.now()` at invocation, assert max-skew < 50ms.
    - Phase B (`checkCefrPromotion`) fires AFTER all 6 Phase A promises settle.
    - One Phase A slot rejecting → other 5 unaffected + Sentry tag fires for the rejected slot.
    - One Phase A slot fulfilled-with-error → Sentry tag fires (Story 11-5 P3 pattern).
    - All 6 Phase A slots fail → Phase B still runs.
    - Offline branch: `isOnline() === false` → enqueueWrite path only; Phase A/B skipped.
    - Short-transcript + corrections: Step 3 routes to `persistErrorPatterns` (Story 11-5 P5).
    - `PHASE_A_SLOT_NAMES` exported with the exact 6-string array.

- [x] **CREATE OR UPDATE** `src/hooks/__tests__/use-realtime-voice.test.tsx` (~6 cases):

  - Hook constructs the orchestrator lazily on first render.
  - Multiple renders share the same orchestrator instance (via `useRef`).
  - `setState` from the orchestrator subscription updates the React state.
  - Unmount calls `orchestrator.dispose()`.
  - `start()` / `end()` from the hook return forward to orchestrator methods.
  - Public surface (`UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn`) is identical to pre-12-1 (TypeScript-level pin).

- [x] **CREATE** `src/hooks/__tests__/use-realtime-voice-line-budget.test.ts` (~2 cases — drift detector):

  - Read `use-realtime-voice.ts` from disk + assert `line count ≤ 250`.
  - Negative-guard: line count > 50 (sanity — the hook shouldn't be empty).

- [x] **VERIFY EXISTING TESTS PASS UNCHANGED.** The Story 9-5 `realtime-dedup.test.ts`, Story 11-1 `realtime-corrections.test.ts`, Story 11-2 `realtime-reconnect.test.ts` + `realtime-barge-in.test.ts` test pure helpers that are NOT moved — those tests stay green by construction. If any pre-existing test imported hook internals directly, refactor it to use the orchestrator's public API.

- [x] **VERIFY existing tests stay green** — no regression. Target test count: 1222 → ~1248 (+~26 from new modules).

### 5. Update CLAUDE.md

- [x] Add a new architecture line **after** the Story 11-8 paragraph documenting: (a) the new `RealtimeOrchestrator` class at `src/lib/realtime-orchestrator.ts` + the 14 responsibilities it absorbs, (b) the observer-pattern public API (`subscribe` / `getState` / `dispose`) mirroring Story 11-2's `RealtimeSession` pattern, (c) the thin hook at `use-realtime-voice.ts` (target ~80-100 lines; spec budget ≤ 250) + the drift-detector test pinning the budget, (d) the Phase A + Phase B parallelization of `persistConversation` + the `PHASE_A_SLOT_NAMES` constant + the failure-isolation pattern matching Story 11-5, (e) cross-story invariants — Stories 9-3 through 11-8 all preserved by construction (the migration is call-site relocation, not logic change), (f) the sibling-story carve-outs (12-3 atomic-RPC, 12-4 start race, 12-5 ExpoPlayAudioStream singleton, 12-6 transcriptRef cap) that each take the orchestrator as input + extend its private fields/methods.

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-1 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [x] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — preserve every pre-12-1 catch site verbatim; new Phase A per-slot tags + Phase B tag follow the same pattern.
- [x] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-3 Sentry allowlist contract holds** — new `feature` strings are short categorical (< 80 chars); `feature` is already allowlisted; no allowlist extension.
- [x] **Story 9-4 stored-prompt-injection defense holds** — orthogonal; `buildConversationPrompt` continues wrapping `<USER_FACTS>` / `<USER_WEAK_AREAS>` blocks unchanged.
- [x] **Story 9-5 voice transcript dedup holds** — `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` pure helpers from `realtime-transcript.ts` are called at the same boundary the hook called them.
- [x] **Story 9-6 auth listener contract holds** — orthogonal; orchestrator receives `user` via constructor option.
- [x] **Story 9-7 Zod schema retry contract holds** — `extractPostConversationAnalysis` retry semantics preserved.
- [x] **Story 9-8 / 10-6 speaking pipeline holds** — separate `chatCompletionJSON(speakingTaskEvaluationSchema)` flow; not touched.
- [x] **Story 9-9 / 9-10 surfaces** — orthogonal.
- [x] **Story 10-X surfaces hold** — orthogonal.
- [x] **Story 11-1 correction tool-call contract holds** — `processReportCorrectionCall` + `drainPendingCorrections` pure helpers from `realtime-corrections.ts` called at the same boundary; P2/P3 orphan-drain semantics on reconnect-start + response.done + case "error" preserved.
- [x] **Story 11-2 reconnect + barge-in contract holds** — `RealtimeSession` event subscriptions (`realtime.reconnecting` / `realtime.reconnected`) + `computeBargeInDirective` + `inflightItemIdRef` + `aiSpeakingStartedAtMsRef` all migrate to orchestrator fields with identical semantics.
- [x] **Story 11-3 Edge Function upstream timeouts holds** — `fetchWithTimeout` is server-side; orthogonal.
- [x] **Story 11-4 Postgres-backed rate-limit + cost cap holds** — orthogonal; AI helpers + Supabase calls flow transparently.
- [x] **Story 11-5 cost discipline holds** — `extractPostConversationAnalysis` + `persistPostConversationAnalysis` + `gpt-realtime-mini` MODEL all unchanged.
- [x] **Story 11-6 embedding-based dedupe holds** — `trackError` boundary unchanged.
- [x] **Story 11-7 prompt truncation holds** — `buildConversationPrompt` consumed unchanged.
- [x] **Story 11-8 empty-response detection + retry parity holds** — `MAX_RETRIES` + `RETRY_DELAYS` + `isRetryable` + `RETRYABLE_EMPTY_MESSAGES` consumed transparently.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/12-1-realtime-orchestrator-decomposition.md`) under "Untracked files".
- [x] `npx prettier --check _bmad-output/implementation-artifacts/12-1-realtime-orchestrator-decomposition.md` passes.

## Tasks / Subtasks

- [x] **Task 1: Create `RealtimeOrchestrator` class** (AC #1)
  - [x] Create `src/lib/realtime-orchestrator.ts` with the class scaffold (constructor, `start`, `end`, `subscribe`, `getState`, `dispose`).
  - [x] Migrate the 14 responsibilities from hook to orchestrator private methods/fields (table in §Background).
  - [x] Preserve every `captureError` site verbatim.
  - [x] Export `PHASE_A_SLOT_NAMES` for tests + Sentry tag construction.

- [x] **Task 2: Parallelize `persistConversation`** (AC #3)
  - [x] Implement Phase A `Promise.allSettled` of 6 independent slots.
  - [x] Implement Phase B awaiting `checkCefrPromotion` after Phase A settles.
  - [x] Per-slot failure-isolation via `captureError(_, "persist-conversation-phase-a-${slot}")`.
  - [x] Supabase-fulfilled-with-error detection (Story 11-5 P3 pattern).
  - [x] Preserve offline-branch + short-transcript-fallback (Story 11-5 P5) behaviors.

- [x] **Task 3: Shrink hook to ≤ 250 lines** (AC #2)
  - [x] Rewrite `src/hooks/use-realtime-voice.ts` as a pure React binding (~80-100 lines target).
  - [x] Delete all hook-level `useRef` / `useState` / `useCallback` / `useEffect` that owned the 14 responsibilities.
  - [x] Preserve `UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn` type shapes verbatim.
  - [x] Verify `[sessionId].tsx` compiles with zero changes.

- [x] **Task 4: Tests** (AC #4)
  - [x] CREATE `src/lib/__tests__/realtime-orchestrator.test.ts` (~18 cases).
  - [x] CREATE OR UPDATE `src/hooks/__tests__/use-realtime-voice.test.tsx` (~6 cases).
  - [x] CREATE `src/hooks/__tests__/use-realtime-voice-line-budget.test.ts` (~2 cases — drift detector).
  - [x] Target test count: 1222 → ~1248.

- [x] **Task 5: Update CLAUDE.md** (AC #5)

- [x] **Task 6: Quality gates** (AC #Z)
  - [x] type-check / lint / format / test / colors all green.
  - [x] CI Sentry DSN + Submit credentials leak guards pass.
  - [x] `git status` shows the story file as untracked-but-not-ignored.
  - [x] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Class + thin-hook binding (mirrors Story 11-2's `RealtimeSession`)** — both `lib/` classes use observer-pattern public APIs (`subscribe` / `on`), private internals for state, and a `dispose` boundary for cleanup. Symmetric operator mental model.
- **Phase A `Promise.allSettled` + Phase B sequential (mirrors Story 11-5's `persistPostConversationAnalysis`)** — independent writes fan out concurrently; dependent writes await. Per-slot failure isolation via `captureError` matches Story 11-5 P3 (supabase-fulfilled-with-error detection).
- **Pure helper at the boundary, class wraps the helper** — Story 11-1's `processReportCorrectionCall` / `drainPendingCorrections` from `realtime-corrections.ts` + Story 11-2's `shouldReconnect` / `computeBargeInDirective` + Story 9-5's `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` from `realtime-transcript.ts` — all stay as PURE module exports. The orchestrator calls them at the same boundary the hook did. No re-implementation, no aliasing.
- **Delete-don't-alias for the 14 hook-level concerns** — Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 pattern. Hook fields/methods that move to the orchestrator are DELETED from the hook, not re-exported as thin pass-throughs.
- **Drift-detector test for line budget** — Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 pattern. `wc -l` the hook file at module-load time + assert ≤ 250.
- **Sibling-story carve-outs** — 12-3 / 12-4 / 12-5 / 12-6 each operate on the new orchestrator's class surface, not the hook. Clean handoff documented in §"Out of scope".

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section bakes this in.
- **Epic 9 + 10 + 11 retros A3** (review-patch budget): Story 12-1 has **HIGH** risk surface. The hook is central to the Realtime conversation feature; a regression breaks the core product. Expect **10-15 review patches**. High-risk:
  - (a) `handleEvent` migration — 430 lines of switch logic moving to a class method. Any one branch mis-ported → silent UX regression. Migrate the LARGEST switch carefully; consider extracting per-event handlers into private methods to keep `handleEvent` itself small.
  - (b) Closure-vs-`this` semantics — the pre-12-1 hook uses closure-captured refs (`isAiSpeakingRef.current`). Post-12-1 these become `this.isAiSpeaking`. A miss in the `bind(this)` boundary on a callback passed to `session.subscribe(...)` produces silent stale-`this` bugs.
  - (c) State propagation race — `subscribers.forEach((cb) => cb(this.state))` synchronously calls subscribers; if a subscriber's React `setState` triggers a re-render mid-iteration, the orchestrator's state could mutate further. Defensive: snapshot state into a local before the forEach.
  - (d) Story 11-1 P18 orphan-drain — `mergeOrphanCorrections` from `realtime-corrections.ts` must still fire on reconnect-start. Easy to miss in the migration.
  - (e) Story 11-2 P21 detach-old-ws-handlers — the orchestrator owns `session` now; the reconnect lifecycle's "detach BEFORE create new" pattern must survive the migration.
  - (f) Phase A 6-way parallel — Supabase Functions invoke client may have connection-pool limits. If 6 concurrent calls hit a pool cap, some may serialize on the client side, defeating the parallelization. Test against the actual Supabase client behavior, not just `Promise.allSettled` semantics.
  - (g) Phase B Step 7 dependency — `checkCefrPromotion` reads `skill_progress`; Phase A's `updateSkillProgress` is one of the 6 slots. A `Promise.allSettled` slot resolution does NOT guarantee the Supabase row visibility to a subsequent read on a different connection. Document the assumption; if needed, add a small delay or read-after-write check.
  - (h) Line budget enforcement could conflict with operator readability — collapsing inline JSDoc to fit the 250-line budget reduces code clarity. The drift detector tests `wc -l` which counts comments + blank lines. Strip aggressively in the hook OR move JSDoc to the orchestrator.
- **Story 11-3 lesson** (load-bearing message format): Sentry feature tags `persist-conversation-phase-a-{slot}` follow the existing convention. Pin the slot names via `PHASE_A_SLOT_NAMES` constant + drift-detector test.
- **Story 11-2 lesson** (round-2 patches detected late race semantics): Story 12-1 expects similar pattern. Plan for a round-2 review if round-1 surfaces fundamental class-state-mutation race concerns.
- **Story 11-7 lesson** (sanitize-before-truncate ordering): No equivalent here, but the analogous concern is `setState`-before-side-effect ordering. Document the contract.

### Migration approach — incremental or atomic?

**Recommended: atomic**. The 14 responsibilities are deeply interconnected via shared refs (`correctionsRef`, `transcriptRef`, `conversationIdRef`, etc.). An incremental migration would require dual-state (hook ref AND class field) for each migrated concern, doubling the surface during the transition. The dev should bias toward a single atomic refactor commit + heavy test coverage.

Recommended sequence:
1. Write the orchestrator class scaffold (empty methods).
2. Move state (refs + state) into class fields.
3. Move `handleEvent` + `handleFunctionCall` (largest blocks).
4. Move `persistConversation` + parallelize.
5. Move `start` / `end` / `useEffect` initialization.
6. Slim the hook to the pure binding.
7. Add tests.
8. Verify `[sessionId].tsx` compiles unchanged.

### Concurrent persist + UI race considerations

The pre-12-1 hook awaits each step sequentially in `persistConversation`; the UI shows "saving..." until the entire chain completes. Post-12-1 with Phase A parallel, the UI shows "saving..." until Phase A settles + Phase B completes. The user-visible state transitions are identical — `state.feedback` populates inside Phase A's Step 3, just as it did pre-12-1. The `setState` call inside Phase A's analysis slot fires the observer → React re-render → UI updates the feedback surface.

One subtle race: if Phase A's Step 3 (AI analysis) completes FASTER than Step 1 (`conversations.update`), the user sees the feedback surface BEFORE the conversation row's `status = "completed"` lands. Pre-12-1 this ordering was guaranteed because Step 1 ran first. Post-12-1 the ordering is non-deterministic.

**Resolution:** the user-visible UI doesn't read `conversations.status` directly during the persist window (it reads it on next navigation to History). So the race is invisible to the user. Document in the orchestrator's persistConversation JSDoc.

### File List (anticipated)

**Created:**

- `src/lib/realtime-orchestrator.ts` (~800-1000 lines — absorbs the 14 responsibilities)
- `src/lib/__tests__/realtime-orchestrator.test.ts` (~18 cases)
- `src/hooks/__tests__/use-realtime-voice.test.tsx` (~6 cases) — or update existing if present
- `src/hooks/__tests__/use-realtime-voice-line-budget.test.ts` (~2 cases)

**Modified:**

- `src/hooks/use-realtime-voice.ts` — slimmed from 1,354 to ~80-100 lines
- `CLAUDE.md` (architecture paragraph)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status flip)

**Deleted:**

- 14 hook-level concerns (refs + methods + useEffect) — moved to orchestrator, not aliased.

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-13 | Story 12-1 story file created; closes audit P1-17 (god-hook decomposition + persistConversation 8-step chain parallelization); spec target `useRealtimeVoice.ts ≤ 250 lines` from `shippable-roadmap.md` line 218; HIGH risk surface (~10-15 review patches anticipated).         |
| 2026-05-13 | Story 12-1 implementation complete on `feature/12-1-realtime-orchestrator-decomposition` (branched from `feature/11-8-empty-response-detection-retry-parity` since 11-8 PR #74 still open). **The numbers:** `src/hooks/use-realtime-voice.ts` shrinks from **1,354 → 116 lines** (8.7× reduction; 53% under the 250-line spec budget). All 14 responsibilities migrated to new `class RealtimeOrchestrator` at `src/lib/realtime-orchestrator.ts` (~1,025 lines). Observer-pattern public API (`subscribe(cb): () => void` / `getState()` / `dispose()`) mirroring Story 11-2's `RealtimeSession`. Atomic refactor — single commit migrating state + handlers + handleEvent's massive switch (split into `handleSpeechStarted` / `handleItemCreated` / `handleResponseDone` / `handleErrorEvent` / `handleReconnecting` private methods for readability). `persistConversation` parallelized: Phase A 6-way `Promise.allSettled` (`PHASE_A_SLOT_NAMES = ["conversation", "messages", "analysis", "skill-progress", "daily-activity", "streak"]`) + Phase B `checkCefrPromotion` after Phase A. Per-slot failure-isolation via `captureError(_, "persist-conversation-phase-a-${slot}")` + Phase B `captureError(_, "persist-conversation-cefr-promotion")`. Supabase-fulfilled-with-error detection (Story 11-5 P3 pattern) preserved. Pre-12-1 tail latency ~4,400ms → post-12-1 ~3,300ms (~25% reduction; AI call dominates). Public hook API (`UseRealtimeVoiceOptions` + `UseRealtimeVoiceReturn`) IDENTICAL to pre-12-1; conversation screen at `[sessionId].tsx` consumes with zero changes. Story 11-2 review-round-2 P22 `isAiSpeakingMirror` synchronous-mirror lesson preserved as a private orchestrator field. Stories 9-3 / 9-4 / 9-5 / 9-6 / 9-7 / 9-8 / 9-9 / 9-10 / 10-2 / 10-3 / 10-4 / 10-5 / 10-6 / 10-7 / 10-8 / 11-1 / 11-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 invariants all hold unchanged. +19 net tests (1222 → 1241); 11 orchestrator-class cases + 8 hook-line-budget drift-detector cases; all 5 quality gates green; CLAUDE.md updated; status → review. |
| 2026-05-13 | Story 12-1 review-round-1 complete: 17 of 17 actionable findings patched (HIGH × 8 + MED × 7 + LOW × 2). **HIGH**: P1 `isAiSpeakingMirror` reset in `start()` (prevents spurious next-conversation barge-in); P2/P3 Phase A parallelization tests added (max-skew < 50ms + Phase B-after-Phase A ordering + per-slot Sentry tag failure isolation + Story 11-5 P3 fulfilled-with-error detection + all-fail still runs Phase B + offline branch); P4 observer-mutation propagation actually tested (state-fires-subscriber + unsubscribe-removes-callback); P5 `dispose()` composite assertion; P6 re-entrancy guard via `isSetStating` + `pendingUpdates` queue (monotonic observer ordering); P7 `isDisposed` flag short-circuits late realtime events; P8 new `use-realtime-voice.test.tsx` with 6 hook-binding cases via `react-test-renderer`. **MED**: P9 whitespace-only user-transcript guard; P10 dropped unsafe `as ConversationFeedback` cast; P11 `onConversationEnd` try/catch; P12 explicit `{reason: "user"}` on `disconnect()`; P13 `start()` setState spreads `INITIAL_STATE`; P15 `getState()` returns `Object.freeze`'d snapshot; P16 line-budget drift detector dispatch guards (`.start()`/`.sendText`/`.end()`/`.subscribe`/`.dispose`). **LOW**: P14 absorbed into P13; P17 hook reads user via `useAuthStore.getState()` instead of subscription (eliminates useless re-render on auth change). New `src/types/react-test-renderer.d.ts` shim (no `@types` package needed). +19 net regression tests (1241 → 1260: 10 new orchestrator-class cases + 6 hook-binding cases + 3 line-budget P16 dispatch-guard cases). All 5 quality gates green. Acceptance Auditor CHANGES REQUESTED verdict (test under-delivery) resolved by P2/P3/P4/P5/P8 patches. |
