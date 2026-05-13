# Story 12.4: Fix `RealtimeOrchestrator.start()` Race — Assign `this.session = session` BEFORE `await session.connect()`

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Companion app operator whose `RealtimeOrchestrator.start()` method at [`src/lib/realtime-orchestrator.ts:1234-1237`](src/lib/realtime-orchestrator.ts#L1234-L1237) constructs a new `RealtimeSession`, registers the event handler, awaits `connect()`, and only THEN assigns the instance to `this.session` — meaning the assignment `this.session = session` happens AFTER `await session.connect()` resolves — and the `connect()` call goes through `establishConnection()` at [`src/lib/realtime.ts:229-346`](src/lib/realtime.ts#L229-L346) which (a) refreshes the Supabase session, (b) calls the `realtime-session` Edge Function to mint an ephemeral token, (c) opens a new WebSocket, (d) installs `ws.onmessage` which routes incoming Realtime API events through `this.emit(data)` to the registered handler, (e) on `ws.onopen` calls `configureSession()` (which sends `session.update` to OpenAI triggering OpenAI to respond with `session.updated` and potentially `conversation.item.created` etc.), THEN (f) `resolve()`s the connect Promise — meaning between (e) and the orchestrator's `this.session = session` assignment on line 1237 there are 1-2 microtask hops during which (i) the WebSocket is OPEN, (ii) `ws.onmessage` is wired, (iii) OpenAI's `session.updated` ack (and potentially other early events like response.done if a very fast turn occurred during configure) could fire, (iv) `handleEvent` runs and may reference `this.session` for downstream effects — `this.session?.sendFunctionResult(...)` at [`realtime-orchestrator.ts:436`](src/lib/realtime-orchestrator.ts#L436) (Story 11-1 tool-call ack), [`:451`](src/lib/realtime-orchestrator.ts#L451), [`:453`](src/lib/realtime-orchestrator.ts#L453), [`:457`](src/lib/realtime-orchestrator.ts#L457), [`:461`](src/lib/realtime-orchestrator.ts#L461), [`:483`](src/lib/realtime-orchestrator.ts#L483), [`:498`](src/lib/realtime-orchestrator.ts#L498), [`:518`](src/lib/realtime-orchestrator.ts#L518), [`:520`](src/lib/realtime-orchestrator.ts#L520), [`:524`](src/lib/realtime-orchestrator.ts#L524) (9 sites — silently no-op if `this.session === null`, leaving OpenAI's server waiting forever for an ack that never comes → tool-call hang) and `this.session?.sendRaw(...)` at [`:718-720`](src/lib/realtime-orchestrator.ts#L718-L720) (Story 11-2 barge-in `response.cancel` + `conversation.item.truncate`) and `this.session?.appendAudio(...)` at [`:399`](src/lib/realtime-orchestrator.ts#L399) (audio streaming) — all of which use the optional-chaining `?.` operator so they FAIL SILENTLY when `this.session` is null (no exception, no Sentry breadcrumb, no log) instead of doing the right thing, AND audit finding **P2-21** at [`shippable-roadmap.md` line 99](_bmad-output/planning-artifacts/shippable-roadmap.md) names this exactly: "Race in `useRealtimeVoice.start` — `sessionRef.current = session` is set after `await connect()`; events arriving in the await window see null ref — `src/hooks/use-realtime-voice.ts:682-688`" (the file path is pre-Story-12-1; post-12-1 the orchestrator decomposition migrated the same structural bug verbatim to `realtime-orchestrator.ts:1234-1237`) AND the Epic 12.4 deliverable at [`shippable-roadmap.md` line 207](_bmad-output/planning-artifacts/shippable-roadmap.md) describes the fix: "Fix `useRealtimeVoice.start` race — assign `sessionRef.current = session` before `connect()`; queue events arriving during connect. **Covers P2-21.**", AND the race window is small (~microseconds between `resolve()` and the orchestrator's continuation) but **deterministically observable** in three plausible production scenarios: (1) **slow CPU / busy main thread** — React Native's main thread is busy (e.g., navigation transition, list rerender), the microtask queue drains slowly, the WebSocket's `onmessage` callback runs while the orchestrator's `await session.connect()` continuation is still queued behind UI tasks; (2) **fast OpenAI response** — `configureSession()` sends `session.update` synchronously in `ws.onopen`; the network round-trip to OpenAI's Realtime API + OpenAI's response time can be as low as 30-50ms on the same continent; if `start()` is called immediately after a previous conversation ended (warm TCP/TLS connection pooling), the `session.updated` ack can land before the orchestrator's microtask continuation; (3) **Story 11-2 reconnect interaction** — `attemptReconnect()` at [`src/lib/realtime.ts:444-490`](src/lib/realtime.ts#L444-L490) re-runs `establishConnection()` on the same `this.session` instance — but the orchestrator's reconnect path is the same `await session.connect()` shape; if a reconnect interleaves with a `start()` call AND the orchestrator's `this.session` was nullified somewhere, the same race applies (audit-spec'd fix narrows to `start()` only; reconnect is Story 11-2's territory and already has `realtime.reconnecting` / `realtime.reconnected` lifecycle events that the orchestrator handles synchronously — see Story 12-1 review-round-1 P22 synchronous `isAiSpeakingMirror` mirror, the same pattern applied to session reference would close any reconnect race too), AND **Story 12-1's review-round-1 patches already established the pattern**: P22 made `isAiSpeakingMirror` synchronously consistent with `state.isAiSpeaking` because barge-in detection needed an event-time-accurate read; same architectural lesson applies to `this.session` — it must be event-time-accurate (populated BEFORE the WS opens) so handlers can read it without race risk, AND **Story 11-2's review-round-2 P26** at [`src/lib/realtime.ts:328-338`](src/lib/realtime.ts#L328-L338) already validates that early-assignment defenses are correct (`intentionallyDisconnected` flag is set by `disconnect({ reason: "user" })` and checked inside `ws.onopen` BEFORE `configureSession` runs — same kind of "set state before async resolution" guard), AND the **fail-loud-on-Sentry-breadcrumb principle** (Story 9-3 + Story 11-4 fail-OPEN policy) means a silent `this.session?.foo()` no-op is the WRONG response to a real bug — every silent path should emit an info-level breadcrumb (`feature: "orchestrator-session-null-on-event"`) so operators can spot frequency in prod telemetry.

I want (a) **`this.session = session` to be assigned BEFORE `await session.connect()` runs** at [`src/lib/realtime-orchestrator.ts:1234-1237`](src/lib/realtime-orchestrator.ts#L1234-L1237) — the new order is `const session = new RealtimeSession(config); this.session = session; session.on(this.handleEvent); try { await session.connect(); } catch (err) { this.session = null; throw err; }` — so any event firing during the await window sees a populated `this.session` reference and `handleEvent`'s 11 `this.session?.` call sites resolve to the correct method calls rather than silently no-op-ing; (b) **a catch-path cleanup that clears `this.session = null` on connect failure** so a failed connect doesn't leave a half-initialized session reference around (the existing catch at [`:1252-1256`](src/lib/realtime-orchestrator.ts#L1252-L1256) sets `state.status: "error"` but does NOT clear `this.session`; post-12-4 it must); (c) **a defensive Sentry breadcrumb** at every `this.session?.foo()` call site that fires when `this.session === null` — surface telemetry on how often the bug occurred PRE-12-4 (helps measure the fix's impact) AND catch any future regression where a new race appears (e.g., new event handler dispatched before `start()` completes); a single helper `safeSessionCall<T>(method: (s: RealtimeSession) => T, context: string): T | undefined` collapses the 11 call sites into a uniform pattern with a single Sentry breadcrumb point; (d) **`session.on(this.handleEvent)` is kept BEFORE `await session.connect()`** — this is already correct in the pre-12-4 code; the fix is purely about `this.session = session` ordering, not handler registration ordering (registering AFTER connect would lose any messages arriving between WS-open and `on()` registration; before is correct, just need the session-ref ordering to match); (e) **the orchestrator's `start()` catch path clears `this.session` AND resets the synchronous mirrors** (e.g., `this.isAiSpeakingMirror = false`, `this.responseInFlight = false`) so a connect-failure-then-retry sequence starts clean — Story 12-1 review-round-1 P1 established the reset-mirrors-on-start pattern; the catch is the complementary cleanup; (f) **regression tests** cover: (i) **drift detector** reading `realtime-orchestrator.ts` from disk + asserting `this.session = session` appears BEFORE `await session.connect()` in the source (positive guard + negative guard against the pre-12-4 wrong order coming back via future refactor), (ii) **runtime race test** that mocks `RealtimeSession.connect()` to take 2 microtask ticks to resolve AND fires a mock event via the registered `handleEvent` DURING the await, then asserts the orchestrator's `this.session` is non-null at the moment the event is handled — the assertion is via a spy on `handleEvent` that captures `this.session` at invocation time, (iii) **connect-failure cleanup test** that mocks `RealtimeSession.connect()` to reject and asserts `this.session === null` after the rejection (no orphaned reference), (iv) **session-null breadcrumb test** that mocks `this.session = null` (post-disconnect or pre-connect) and dispatches a tool-call event through `handleEvent`, then asserts a Sentry breadcrumb fired with `feature: "orchestrator-session-null-on-event"` + the right `context` tag, (v) **safeSessionCall helper unit test** in isolation: call with non-null session → executes method + returns result; call with null session → breadcrumb fires + returns undefined; (vi) **Story 11-1 tool-call path regression** — confirm the 9 `sendFunctionResult` call sites still work end-to-end via the new helper (no missed sends), (vii) **Story 11-2 barge-in path regression** — confirm `sendRaw({type:"response.cancel"})` + `sendRaw({type:"conversation.item.truncate"})` still fire correctly via the new helper, (viii) **Story 12-1 Phase A invariants preserved** — the existing 11 cases in `realtime-orchestrator.test.ts` stay green by construction, (ix) **public surface unchanged** — `useRealtimeVoice` hook tests stay green; orchestrator's public API (`start` / `end` / `sendText` / `subscribe` / `getState` / `dispose`) is bit-identical pre- and post-12-4,

so that **audit finding P2-21 closes architecturally** (the race window for early-event-arrival is structurally impossible because `this.session` is populated before any WebSocket message can fire); **the Story 11-1 tool-call hang scenario is structurally impossible** (a `report_correction` / `save_vocabulary` / `note_error_pattern` invocation that arrives during the connect window now resolves correctly because `this.session?.sendFunctionResult(...)` resolves to the populated reference); **the Story 11-2 barge-in path's correctness window starts earlier** (the user can interrupt the AI's very first utterance because `this.session?.sendRaw({type:"response.cancel"})` no longer no-ops); **the silent-no-op failure mode is replaced with observable Sentry breadcrumbs** so a future regression that re-introduces a similar race is detectable in prod telemetry — Story 9-3's Sentry allowlist contract preserves the `feature` field (the new tag `"orchestrator-session-null-on-event"` is a short categorical string under the 80-char redaction threshold; one new feature tag); **Story 9-3 / 9-4 / 9-5 / 9-6 / 9-7 / 9-8 / 9-9 / 9-10 / 10-X / 11-1 (tool-call protocol) / 11-2 (reconnect + barge-in) / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 (orchestrator) / 12-2 (auth bootstrap) / 12-3 (atomic RPCs) invariants all hold by construction** — the change is contained to 3 lines of `start()` body + 1 new helper + 11 call-site updates that all preserve the prior optional-chaining semantics in the "successful happy path" (when `this.session` is populated, behavior is bit-identical), AND the cross-story dependencies hold by construction: Story 12-1's `RealtimeOrchestrator` class structure unchanged, Story 11-2's `RealtimeSession` API unchanged, Story 11-1's tool-call ack via `sendFunctionResult` unchanged (now routes through `safeSessionCall`), Story 12-1's per-event handlers (`handleSpeechStarted` / `handleItemCreated` / `handleResponseDone` / `handleErrorEvent` / `handleReconnecting`) unchanged structurally — only the call-site wrapper changes.

## Background — Why This Story Exists

### What audit finding P2-21 owns to this story

[`shippable-roadmap.md` line 99](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "P2-21 — Race in `useRealtimeVoice.start` — `sessionRef.current = session` is set after `await connect()`; events arriving in the await window see null ref — `src/hooks/use-realtime-voice.ts:682-688`"

Epic 12.4 deliverable at [line 207](_bmad-output/planning-artifacts/shippable-roadmap.md):

> "Fix `useRealtimeVoice.start` race — assign `sessionRef.current = session` before `connect()`; queue events arriving during connect. **Covers P2-21.**"

> **Note:** The file path in P2-21 is pre-Story-12-1. Post-12-1, the god-hook decomposition migrated this bug verbatim to `src/lib/realtime-orchestrator.ts:1234-1237`. Story 12-4 fixes the post-12-1 location.

### Current state — the race

Pre-12-4 [`src/lib/realtime-orchestrator.ts:1234-1237`](src/lib/realtime-orchestrator.ts#L1234-L1237):

```typescript
const session = new RealtimeSession(config);
session.on(this.handleEvent);
await session.connect();
this.session = session;
```

The race window:

```
t=0:  new RealtimeSession(config)
t=1:  session.on(this.handleEvent)
t=2:  await session.connect() starts
       ├── refreshSession (HTTP)
       ├── invoke realtime-session Edge Function (HTTP)
       ├── new WebSocket(...) constructed
       ├── ws.onopen fires → configureSession() → sends session.update
       │   ├── OpenAI receives session.update
       │   ├── OpenAI sends session.updated back
       │   ├── ws.onmessage fires → emit(data) → handleEvent
       │   │   └── handleEvent references this.session → NULL ← BUG
       │   └── …
       └── ws.onopen → resolve() ← connect's Promise resolves
t=3:  (microtask flush) await continuation
t=4:  this.session = session ← too late
```

### The 11 `this.session?.` call sites

Verified via `grep -n "this\.session" src/lib/realtime-orchestrator.ts`:

| Line | Method | Caller / Purpose |
|---|---|---|
| `:399` | `this.session?.appendAudio(...)` | Audio streaming chunk dispatch |
| `:436` | `this.session?.sendFunctionResult(callId, ...)` | `save_vocabulary` missing-fields ack (Story 11-1) |
| `:451` | `this.session?.sendFunctionResult(callId, ...)` | `save_vocabulary` failed-save ack |
| `:453` | `this.session?.sendFunctionResult(callId, ...)` | `save_vocabulary` saved ack |
| `:457` | `this.session?.sendFunctionResult(callId, ...)` | `note_error_pattern` missing-fields ack |
| `:461` | `this.session?.sendFunctionResult(callId, ...)` | `note_error_pattern` noted ack |
| `:483` | `this.session?.sendFunctionResult(callId, ...)` | `report_correction` invalid-shape ack |
| `:498` | `this.session?.sendFunctionResult(callId, ...)` | `report_correction` recorded ack |
| `:518` | `this.session?.sendFunctionResult(callId, ...)` | Tool-call generic result-message ack |
| `:520` | `this.session?.sendFunctionResult(callId, ...)` | Tool-call unknown-function ack |
| `:524` | `this.session?.sendFunctionResult(callId, ...)` | Tool-call failed-handler ack |
| `:718` | `this.session?.sendRaw({type:"response.cancel"})` | Story 11-2 barge-in cancel |
| `:720` | `this.session?.sendRaw({type:"conversation.item.truncate"})` | Story 11-2 barge-in truncate |

(13 actual sites; 11 in tool-call paths + 2 in barge-in.) Plus `this.session.sendText(...)` at `:1274` and `this.session?.disconnect(...)` at `:303` / `:1292` (4 more — total 17). Only the 13 inside `handleEvent`-reachable paths suffer the race.

### 12-4 fix — `this.session = session` before await

```
t=0:  new RealtimeSession(config)
t=1:  this.session = session             ← assigned EARLY
t=2:  session.on(this.handleEvent)
t=3:  try {
        await session.connect()
        ├── ws.onopen → resolve()
        │   └── if ws.onmessage fires here, handleEvent sees populated this.session ✓
      } catch (err) {
        this.session = null               ← cleanup on failure
        throw err
      }
```

Plus a `safeSessionCall` helper that uniformly wraps the 13 call sites + emits a Sentry breadcrumb when `this.session === null` so the silent-no-op failure mode becomes observable.

### Why "queue events" was deemed out of scope

The spec roadmap line 207 mentions "queue events arriving during connect" as a secondary fix. Two reasons this is out of scope:

1. **The early-assign fix closes the race completely.** Events arriving during the await window see a populated `this.session` — no queue needed.
2. **The events that arrive in the race window are mostly `session.updated` confirmations** that `handleEvent` ignores via the switch's default case. A queue would add complexity for marginal benefit. A future story can add the queue if a real production event-loss scenario is observed via Sentry telemetry.

### Threat / failure model — what cannot happen post-story

After this story:

1. **Tool-call hang via early `report_correction`** — Story 11-1's `report_correction` tool-call invocation that arrives DURING the connect window now resolves correctly because `this.session?.sendFunctionResult(...)` resolves to the populated reference. OpenAI no longer waits forever for a function ack.

2. **Barge-in miss on first AI utterance** — Story 11-2's `response.cancel` + `conversation.item.truncate` dispatched in `handleSpeechStarted` no longer no-ops if the user interrupts the AI's very first words.

3. **Silent-no-op replaced with observable breadcrumbs** — every `this.session?.method()` call site routes through `safeSessionCall` which emits a Sentry breadcrumb when `this.session === null`. Future regressions are detectable in prod telemetry.

4. **Connect-failure cleanup** — `this.session = null` is set in the catch path so a failed `start()` doesn't leave a half-initialized reference around. A retry-after-failure sequence starts clean.

5. **`isAiSpeakingMirror` reset on connect failure** — Story 12-1 review-round-1 P1 reset mirrors on `start()` entry; 12-4 extends this to the catch path so failure-then-retry preserves the invariant.

6. **Story 9-3 Sentry allowlist contract preserved** — one new feature tag `"orchestrator-session-null-on-event"` (short categorical, < 80 chars). No new extras keys.

7. **Story 11-1 / 11-2 / 12-1 invariants preserved by construction** — all 11 / 2 / 11 cases respectively continue to pass without change. The wrapper is a transparent pass-through when `this.session` is non-null.

8. **Public surface unchanged** — `useRealtimeVoice` hook compiles + runs unchanged. `RealtimeOrchestrator` constructor + `start` / `end` / `sendText` / `subscribe` / `getState` / `dispose` shapes verbatim.

9. **No queue added** — events arriving during the (now-narrower) async window dispatch through `handleEvent` immediately; the early-assignment closes the race. Queue is deferred.

10. **Drift detector pins the assign-before-await invariant** — a future refactor that swaps the order trips CI.

### Out of scope for this story (delegated elsewhere)

- **Event queueing during the connect await window** — not load-bearing per the threat-model analysis above; can be added as a follow-up Epic 12.X if production telemetry reveals event-loss frequency above background noise.
- **Audio-streaming `appendAudio` race** — line `:399` `this.session?.appendAudio` is reached from `ExpoPlayAudioStream`'s push callback; Story 12-5 owns the audio singleton lifecycle.
- **Reconnect-path session-ref consistency** — Story 11-2's reconnect uses `this.session` (same instance), but `attemptReconnect` doesn't change the orchestrator's reference. Out of scope; flagged for cross-check during review.
- **Dispose-race scenarios** — `disconnect({reason:"user"})` then `start()` racing is a separate concern; current Story 12-1 review-round-1 P25 already guards against `start()` during `reconnecting`. Out of scope here.
- **`sendText` from outside `handleEvent`** — the public `sendText` call site at `:1261` reads `this.session?.isConnected` before dispatching; the existing guard is sufficient. Out of scope.

## Acceptance Criteria

### 1. Reorder `this.session = session` to BEFORE `await session.connect()`

- [ ] **UPDATE** [`src/lib/realtime-orchestrator.ts:1234-1237`](src/lib/realtime-orchestrator.ts#L1234-L1237) — the new sequence is:

  ```typescript
  const session = new RealtimeSession(config);
  this.session = session;            // Story 12-4: populate ref BEFORE any event fires
  session.on(this.handleEvent);
  try {
    await session.connect();
  } catch (err) {
    this.session = null;             // cleanup on failure
    this.isAiSpeakingMirror = false; // reset synchronous mirrors
    this.responseInFlight = false;
    throw err;
  }
  ```

- [ ] **PRESERVE** the existing outer `try/catch` at [`:1144-1256`](src/lib/realtime-orchestrator.ts#L1144-L1256) — it still owns the `state.status = "error"` write + `captureError(_, "realtime-voice-connection")` Sentry tag. The new inner try/catch is purely for `this.session = null` cleanup.
- [ ] **PRESERVE** the `session.on(this.handleEvent)` registration BEFORE `await session.connect()` — events arriving during the await still flow through the handler.

**Given** `RealtimeOrchestrator.start()` is called
**When** the WebSocket opens and OpenAI sends `session.updated` BEFORE the orchestrator's `await session.connect()` continuation runs
**Then** `handleEvent` is invoked AND `this.session` is non-null at invocation time (the early-assign closes the race).

### 2. Introduce `safeSessionCall` helper

- [ ] **CREATE** a private method on `RealtimeOrchestrator`:

  ```typescript
  /**
   * Story 12-4: uniform wrapper for the 13 `this.session?.method()` call sites
   * inside `handleEvent`-reachable paths. When `this.session === null` (race
   * with `start()` / `dispose()` / `disconnect()`), the method is skipped AND
   * a Sentry breadcrumb fires so the silent-no-op failure mode is observable.
   *
   * Pre-12-4 the call sites used `this.session?.method()` which silently
   * no-op'd. Audit P2-21 closes architecturally; this wrapper is the
   * post-fix telemetry hook.
   */
  private safeSessionCall<T>(
    fn: (session: RealtimeSession) => T,
    context: string
  ): T | undefined {
    if (this.session === null) {
      addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "orchestrator-session-null-on-event",
        data: { context },
      });
      return undefined;
    }
    return fn(this.session);
  }
  ```

- [ ] **MIGRATE** the 13 `this.session?.foo(...)` call sites inside `handleEvent`-reachable paths to `this.safeSessionCall(s => s.foo(...), "context-tag")`:
  - 11 `sendFunctionResult` sites in `handleFunctionCall` + sub-handlers → `context: "tool-call-{kind}"` (e.g., `tool-call-save-vocabulary`, `tool-call-note-error-pattern`, `tool-call-report-correction`).
  - 2 `sendRaw` sites in barge-in path (`:718`, `:720`) → `context: "barge-in-cancel"` / `"barge-in-truncate"`.
  - 1 `appendAudio` site at `:399` → `context: "audio-stream"`.
- [ ] **DO NOT MIGRATE** sites at `:303` (`dispose` path) / `:1261` / `:1274` (`sendText`) / `:1292` (`end` path) — these are public-API entry points where the race doesn't apply (called from React event handlers, not from `handleEvent`).

**Given** a tool-call event arrives via `handleEvent` AND `this.session === null` (race or post-dispose)
**When** `handleFunctionCall` dispatches `safeSessionCall(s => s.sendFunctionResult(...), "tool-call-X")`
**Then** an info breadcrumb fires with `feature: "orchestrator-session-null-on-event"` AND `data.context: "tool-call-X"` AND the function returns undefined (no-op preserved).

### 3. Sentry allowlist + breadcrumb data

- [ ] **VERIFY** `"orchestrator-session-null-on-event"` is allowed by the `feature` allowlist contract (Story 9-3) — short categorical, < 80 chars, no PII.
- [ ] **VERIFY** the `context` extras key is allowlisted at [`src/lib/sentry.ts:SENTRY_EXTRAS_ALLOWLIST`](src/lib/sentry.ts) — `context` is ALREADY in the allowlist per Story 9-3.
- [ ] **NO new allowlist keys** required.

### 4. Tests

- [ ] **CREATE** `src/lib/__tests__/realtime-orchestrator-session-race.test.ts` (~10 cases):

  - **Drift detector × 2:**
    - Reads `realtime-orchestrator.ts` from disk + asserts `this.session = session` appears BEFORE `await session.connect()` (positive guard).
    - Asserts no `this.session = session` appears AFTER `await session.connect()` (negative guard against the pre-12-4 pattern returning).

  - **Connect-failure cleanup × 2:**
    - Mock `RealtimeSession.connect()` to reject; assert `this.session === null` after the failure (no orphan reference).
    - Same scenario, assert `this.isAiSpeakingMirror === false` and `this.responseInFlight === false` (synchronous mirror reset).

  - **`safeSessionCall` helper × 3:**
    - Non-null session: calls the inner method + returns its result; no breadcrumb fires.
    - Null session: emits the `addBreadcrumb` with `category: "realtime"`, `level: "warning"`, `message: "orchestrator-session-null-on-event"`, `data.context: <context>` + returns undefined.
    - Throwing inner method: bubbles the exception (helper is a pass-through for thrown errors; only null-guards the session reference).

  - **Race regression × 1:**
    - Mock `RealtimeSession.connect()` to take 2 microtask ticks; fire a synthetic event via the captured `handleEvent` reference DURING the await; assert `handleEvent` reads non-null `this.session` at invocation time (proves the early-assign fix works).

  - **Story 11-1 / 11-2 paths preserved × 2:**
    - `handleFunctionCall("report_correction", ...)` with non-null session → `sendFunctionResult` is called via the helper (pass-through).
    - `handleSpeechStarted` with `isAiSpeakingMirror === true` → `sendRaw({type:"response.cancel"})` is called via the helper.

- [ ] **VERIFY existing tests stay green:**
  - `src/lib/__tests__/realtime-orchestrator.test.ts` — 11 existing cases (Story 12-1).
  - `src/hooks/__tests__/use-realtime-voice.test.tsx` — 6 hook-binding cases (Story 12-1 P8).
  - `src/lib/__tests__/realtime-corrections.test.ts` — orphan-drain cases (Story 11-1).
  - `src/lib/__tests__/realtime-barge-in.test.ts` — barge-in directive cases (Story 11-2).
  - `src/lib/__tests__/realtime-reconnect.test.ts` — reconnect schedule cases (Story 11-2).

- [ ] **Target test count:** 1333 → ~1343 (+~10 from the new race-fix test file).

### 5. Update CLAUDE.md

- [ ] Add a new architecture line **after** the Story 12-3 paragraph documenting: (a) the pre-12-4 race (`this.session = session` after `await connect()`), (b) the post-12-4 fix (assign before await + catch-path cleanup), (c) the `safeSessionCall` helper + breadcrumb telemetry, (d) the 13 migrated call sites, (e) the new feature tag `"orchestrator-session-null-on-event"` in the Sentry allowlist, (f) cross-story invariants (Story 11-1 tool-call protocol / Story 11-2 reconnect+barge-in / Story 12-1 orchestrator structure all preserved by construction).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 12-4 does NOT introduce or modify any `.github/workflows/*.yml` file.

### Z. Polish Requirements

- [ ] **All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry`** — preserve the existing `"realtime-voice-connection"` tag in the outer catch; the new inner catch in `start()` rethrows (the outer catch handles).
- [ ] **All colors use `Colors.*` design tokens** — N/A (no UI changes).
- [ ] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [ ] **CI Sentry DSN + Submit credentials leak guards** in `ci.yml` continue to pass.
- [ ] **Story 9-3 Sentry allowlist contract holds** — one new `feature` string (`"orchestrator-session-null-on-event"`); no new extras keys.
- [ ] **Story 11-1 tool-call protocol holds** — 11 `sendFunctionResult` sites migrated to the helper with no behavior change in the happy path.
- [ ] **Story 11-2 reconnect + barge-in contracts hold** — 2 `sendRaw` sites migrated to the helper; reconnect path doesn't change `this.session` reference (orthogonal).
- [ ] **Story 12-1 orchestrator structure holds** — `PHASE_A_SLOT_NAMES`, `INITIAL_STATE`, public API, observer pattern, synchronous-mirror invariants all unchanged.
- [ ] **Story 12-2 auth bootstrap orthogonal** — no shared state.
- [ ] **Story 12-3 atomic RPCs orthogonal** — no shared state.

### Story File Self-Check (run after writing this file)

- [ ] `git status` lists this story file under "Untracked files".
- [ ] `npx prettier --check _bmad-output/implementation-artifacts/12-4-realtime-start-race-fix.md` passes.

## Tasks / Subtasks

- [ ] **Task 1: Reorder `this.session = session`** (AC #1)
  - [ ] Move `this.session = session` to BEFORE `await session.connect()`.
  - [ ] Wrap `await session.connect()` in an inner try/catch.
  - [ ] On connect failure: `this.session = null` + reset synchronous mirrors + rethrow.

- [ ] **Task 2: Introduce `safeSessionCall` helper + migrate 13 call sites** (AC #2)
  - [ ] Add private `safeSessionCall<T>(fn, context)` method.
  - [ ] Migrate the 11 `sendFunctionResult` sites with per-tool `context` tags.
  - [ ] Migrate the 2 barge-in `sendRaw` sites.
  - [ ] Migrate the 1 `appendAudio` site.
  - [ ] Do NOT migrate `dispose` / `sendText` / `end` public-API sites.

- [ ] **Task 3: Sentry allowlist verification** (AC #3)
  - [ ] Verify `feature: "orchestrator-session-null-on-event"` is < 80 chars (it is — 36 chars).
  - [ ] Verify `context` extras key is allowlisted (it is — Story 9-3).

- [ ] **Task 4: Tests** (AC #4)
  - [ ] CREATE `src/lib/__tests__/realtime-orchestrator-session-race.test.ts` (~10 cases).
  - [ ] Run existing test suite + verify Story 12-1 / 11-1 / 11-2 cases stay green.

- [ ] **Task 5: Update CLAUDE.md** (AC #5)

- [ ] **Task 6: Quality gates** (AC #Z)
  - [ ] type-check / lint / format / test / colors all green.
  - [ ] CI Sentry DSN + Submit credentials leak guards pass.
  - [ ] `git status` shows the story file as untracked-but-not-ignored.
  - [ ] `npx prettier --check` on the story file passes.

## Dev Notes

### Architecture pattern alignment

- **Early-assign-before-await** — mirrors Story 12-2's review-round-1 P1 sentinel pattern (`bootstrapState` set BEFORE `onAuthStateChange`) and Story 11-2's review-round-2 P26 (`intentionallyDisconnected` flag checked inside `ws.onopen` BEFORE `configureSession`). Synchronously-consistent state references across async boundaries.
- **Cleanup-on-failure** — mirrors Story 12-2's review-round-1 P7 try/catch on `onAuthStateChange` install (degrade to no-op teardown). Story 12-1 review-round-1 P11 wraps `onConversationEnd` callback in try/catch. Same pattern.
- **Wrapper-with-breadcrumb for silent-no-op detection** — new pattern but consistent with Story 9-3's "always observable, never silent" principle. The 13 call sites previously failed silently; the wrapper makes them observable without changing the silent-from-the-method-perspective semantics.
- **Drift detector reading source from disk** — Story 11-3 / 11-4 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 pattern.
- **No event queue** — keeps the change minimal. A queue is defensive but not load-bearing; can be added as a follow-up if telemetry reveals event-loss frequency.

### Pulling forward lessons from prior stories

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Self-Check section included.
- **Epic 9 + 10 + 11 + 12-1 + 12-2 + 12-3 retros A3** (review-patch budget): Story 12-4 is a SMALL story compared to 12-1/12-2/12-3. The diff is ~30 lines in orchestrator + ~10 lines in 1 test file. Expect **4-6 review patches**. Risk surfaces:
  - (a) `safeSessionCall` is a method on the orchestrator instance, so `this.session` is captured at call time (correct semantics) — but if it's called inside a closure that captured `this` early, it should still see the post-12-4 populated reference. Verify with the race regression test.
  - (b) The 13 call-site migration is mechanical — each `this.session?.method(args)` becomes `this.safeSessionCall(s => s.method(args), "tag")`. Lint should catch any typos.
  - (c) The `context` tags must be unique enough to be useful in Sentry: `tool-call-save-vocabulary` vs `tool-call-note-error-pattern` vs `tool-call-report-correction` vs `tool-call-generic-{kind}`. Don't over-categorize (Sentry sampling).
  - (d) Drift detector regex should pin BOTH the early-assign AND the lack of late-assign. Pre-12-4: `await session\.connect\(\);\s+this\.session = session` (late-assign pattern). Post-12-4: `this\.session = session;\s+session\.on\(this\.handleEvent\);\s+try \{\s+await session\.connect\(\)` (early-assign pattern). Negative + positive both pinned.
  - (e) The new test file's mock of `RealtimeSession.connect()` taking "2 microtask ticks" needs to be deterministic. Use `await Promise.resolve(); await Promise.resolve();` or `setTimeout(0)` carefully — Story 11-8 review-round-1 P4 reminds us that `setTimeout` shims can leak across test files; scope mocks to `beforeEach`.

- **Story 12-1 lesson** (synchronous mirrors for event-time-accurate reads): The pattern applies — `this.session` IS the event-time-accurate session reference; the early-assign closes the same kind of write-after-async-boundary gap that motivated Story 12-1's `isAiSpeakingMirror`.
- **Story 11-2 lesson** (`intentionallyDisconnected` flag): The same kind of "set state synchronously, check it in async callbacks" pattern.

### Anticipated File List

**Created:**

- `src/lib/__tests__/realtime-orchestrator-session-race.test.ts` (~10 Jest cases)

**Modified:**

- `src/lib/realtime-orchestrator.ts` — reorder `this.session = session` + add `safeSessionCall` helper + migrate 13 call sites
- `CLAUDE.md` — Story 12-4 architecture paragraph
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status flip

**Deleted:**

- The 13 pre-12-4 `this.session?.foo(...)` direct-optional-chaining call sites inside `handleEvent`-reachable paths (replaced with `this.safeSessionCall(...)` invocations; not aliased — Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 "delete don't alias" pattern).

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-13 | Story 12-4 story file created; closes audit P2-21 (race in `RealtimeOrchestrator.start()` where `this.session = session` is assigned after `await session.connect()` and early events see null ref); SMALL risk surface (~30-line orchestrator edit + 1 new test file); ~4-6 review patches anticipated per Epic 9/10/11/12 retro budget. Cross-story dependencies: Story 11-1 tool-call protocol, Story 11-2 barge-in, Story 12-1 orchestrator structure — all preserved by construction. |
