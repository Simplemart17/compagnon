/**
 * Story 12-6 — `RealtimeOrchestrator` transcript-cap integration tests.
 *
 * Pins the orchestrator's wiring of the Story 12-6 cap helpers
 * (`applyTranscriptCap` + `toMessagePayload`) at the two write sites
 * (`appendAiTranscriptEntry` + `handleItemCreated`) AND the
 * persist-time spill prepend semantics. The load-bearing assertions:
 *   (a) `state.transcript.length` NEVER exceeds `MAX_TRANSCRIPT_ENTRIES`
 *       (=200) after any number of sequential turns (the canonical P2-8
 *       closure proof).
 *   (b) Evicted entries spill to `spilledMessages` in DB-payload shape
 *       so the persist-time batch insert sees the COMPLETE conversation
 *       regardless of in-memory cap eviction.
 *   (c) The `"transcript-cap-evicted"` Sentry breadcrumb fires per
 *       eviction event (operator observability for cap-fire frequency).
 *   (d) `start()`'s reset block clears `spilledMessages` between
 *       conversations (no cross-session carryover).
 *   (e) Drift detectors pin the import + call sites + negative-guard
 *       against the legacy unbounded write pattern.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { __resetAudioStreamManagerForTests } from "../audio-stream-manager";
import { RealtimeOrchestrator, type RealtimeOrchestratorOptions } from "../realtime-orchestrator";
// Story 12-6 review-round-1 P14: import the canonical feature-tag
// constant from the cap module so test + source reference the same
// string — a typo in either site cannot silently pass tests via
// vacuous-filter drift.
import { addBreadcrumb, captureError } from "../sentry";
import { MAX_TRANSCRIPT_ENTRIES, TRANSCRIPT_CAP_FEATURE_TAG } from "../transcript-cap";

jest.mock("../sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock("../cache", () => ({
  __esModule: true,
  enqueueWrite: jest.fn(async () => undefined),
}));

jest.mock("../network", () => ({
  __esModule: true,
  isOnline: jest.fn(async () => true),
  requireNetwork: jest.fn(async () => undefined),
}));

// Capture mock for createConversationRecord — controlled per test.
const mockSingle = jest.fn(async () => ({ data: { id: "convo-cap-test" }, error: null }));

// Spy on `supabase.from("conversation_messages").insert(...)` so we can
// assert the prepend-then-tail order for the Phase A Slot 1 path.
const mockInsert = jest.fn(() => Promise.resolve({ error: null }));

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() },
    from: jest.fn((table: string) => {
      // `conversations` table is hit by createConversationRecord
      // (insert→select→single) and by the Phase A Slot 0 update.
      if (table === "conversations") {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: (...args: unknown[]) =>
                (mockSingle as unknown as (...a: unknown[]) => unknown)(...args),
            })),
          })),
          update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        };
      }
      // `conversation_messages` table — the Slot 1 batch insert path.
      if (table === "conversation_messages") {
        return {
          insert: (...args: unknown[]) => mockInsert(...(args as Parameters<typeof mockInsert>)),
        };
      }
      return { insert: jest.fn() };
    }),
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
  },
}));

jest.mock("../activity", () => ({
  __esModule: true,
  updateStreak: jest.fn(async () => undefined),
  updateSkillProgress: jest.fn(async () => undefined),
  incrementDailyActivity: jest.fn(async () => undefined),
  checkCefrPromotion: jest.fn(async () => undefined),
}));

jest.mock("../post-conversation-analysis", () => ({
  __esModule: true,
  extractPostConversationAnalysis: jest.fn(async () => ({ facts: [], errorPatterns: [] })),
  persistPostConversationAnalysis: jest.fn(async () => ({ feedback: undefined })),
}));

jest.mock("../error-tracker", () => ({
  __esModule: true,
  persistErrorPatterns: jest.fn(async () => undefined),
  trackError: jest.fn(async () => undefined),
}));

jest.mock("@mykin-ai/expo-audio-stream", () => ({
  ExpoPlayAudioStream: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setSoundConfig: jest.fn(async () => undefined),
    startRecording: jest.fn(async () => ({ subscription: { remove: jest.fn() } })),
    stopRecording: jest.fn(async () => undefined),
    playSound: jest.fn(),
    stopSound: jest.fn(async () => undefined),
    destroy: jest.fn(),
  },
}));

jest.mock("../audio-stream-manager", () => ({
  __esModule: true,
  acquireAudioStream: jest.fn(),
  releaseAudioStream: jest.fn(async () => undefined),
  __resetAudioStreamManagerForTests: jest.fn(),
}));

jest.mock("../realtime", () => ({
  RealtimeSession: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    isConnected: false,
    sendText: jest.fn(),
    sendFunctionResult: jest.fn(),
    sendRaw: jest.fn(),
    appendAudio: jest.fn(),
  })),
}));

const baseOptions: RealtimeOrchestratorOptions = {
  user: {
    id: "test-user-12-6",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01",
  } as unknown as NonNullable<RealtimeOrchestratorOptions["user"]>,
  cefrLevel: "B1",
  mode: "companion",
  topic: "daily life",
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetAudioStreamManagerForTests();
  mockSingle.mockImplementation(async () => ({ data: { id: "convo-cap-test" }, error: null }));
  mockInsert.mockImplementation(() => Promise.resolve({ error: null }));
});

// ============================================================================
// Drift detectors — load-bearing audit-P2-8 closure
// ============================================================================

const ORCHESTRATOR_PATH = join(__dirname, "..", "realtime-orchestrator.ts");
const ORCHESTRATOR_SOURCE = readFileSync(ORCHESTRATOR_PATH, "utf-8");
const ORCHESTRATOR_CODE_ONLY = ORCHESTRATOR_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  ""
);

/**
 * Extract a method body from the comment-stripped orchestrator source by
 * finding the signature substring and slicing forward until the next
 * top-level method signature. Mirrors the helper in
 * `realtime-orchestrator-audio-lifecycle.test.ts` (Story 12-5 P12 + 12-4 P10).
 */
function extractMethodBody(signatureStart: string): string {
  const idx = ORCHESTRATOR_CODE_ONLY.indexOf(signatureStart);
  if (idx < 0) {
    throw new Error(`Method signature not found: ${signatureStart}`);
  }
  const after = ORCHESTRATOR_CODE_ONLY.slice(idx + signatureStart.length);
  const nextSignatureRe = /\n {2}(?:private |protected |public |async |[a-zA-Z]+\s*\()/;
  const nextMatch = nextSignatureRe.exec(after);
  return nextMatch ? after.slice(0, nextMatch.index) : after;
}

describe("Story 12-6 — orchestrator transcript-cap drift detectors (audit P2-8 closure)", () => {
  it("Case 1: `applyTranscriptCap` import appears in `realtime-orchestrator.ts`", () => {
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(
      /import\s*\{[^}]*applyTranscriptCap[^}]*\}\s*from\s*["']@\/src\/lib\/transcript-cap["']/
    );
    expect(ORCHESTRATOR_CODE_ONLY).toMatch(
      /import\s*\{[^}]*toMessagePayload[^}]*\}\s*from\s*["']@\/src\/lib\/transcript-cap["']/
    );
  });

  it("Case 2: `applyTranscriptCap` appears INSIDE `appendAiTranscriptEntry()` body (positive guard)", () => {
    // P12 + P13 pattern: anchor the regex to the method body so a future
    // refactor that moves the cap call out of the AI-side write site
    // fails CI loudly.
    const body = extractMethodBody(
      "private appendAiTranscriptEntry(text: string, key: string): boolean {"
    );
    expect(body).toMatch(/applyTranscriptCap\(this\.transcript/);
  });

  it("Case 3: `applyTranscriptCap` appears INSIDE `handleItemCreated()` body (positive guard)", () => {
    const body = extractMethodBody(
      'private handleItemCreated(event: RealtimeEvent & { type: "conversation.item.created" }): void {'
    );
    expect(body).toMatch(/applyTranscriptCap\(this\.transcript/);
  });

  it("Case 4: negative guard — pre-12-6 `this.transcript = [...this.transcript, entry]` does NOT appear in `handleItemCreated()` body", () => {
    // This was the load-bearing unbounded-write pattern at line 977
    // before Story 12-6. Its presence in `handleItemCreated` after the
    // story would indicate the refactor was reverted.
    const body = extractMethodBody(
      'private handleItemCreated(event: RealtimeEvent & { type: "conversation.item.created" }): void {'
    );
    expect(body).not.toMatch(/this\.transcript\s*=\s*\[\s*\.\.\.this\.transcript\s*,\s*entry\s*\]/);
  });

  it("Case 5: `handleTranscriptEviction` private method exists + uses `toMessagePayload` + fires `TRANSCRIPT_CAP_FEATURE_TAG` breadcrumb (positive guard)", () => {
    const body = extractMethodBody(
      "private handleTranscriptEviction(evicted: TranscriptEntry[]): void {"
    );
    // The eviction handler MUST use `toMessagePayload` and emit the
    // canonical Sentry feature tag. Story 12-6 review-round-1 P14
    // replaced the literal `"transcript-cap-evicted"` with the imported
    // constant `TRANSCRIPT_CAP_FEATURE_TAG` — the drift detector now
    // accepts EITHER the constant identifier OR the literal string so
    // a future operator can switch back to literals without trashing
    // this assertion.
    expect(body).toMatch(/toMessagePayload\(/);
    expect(body).toMatch(
      /feature:\s*(?:TRANSCRIPT_CAP_FEATURE_TAG|["']transcript-cap-evicted["'])/
    );
  });
});

// ============================================================================
// Runtime contract — cap holds, spill works, breadcrumb fires
// ============================================================================

/**
 * Drive the orchestrator's private `handleEvent` dispatch with synthetic
 * AI-transcript-done events so we exercise the real
 * `appendAiTranscriptEntry` → `applyTranscriptCap` → `handleTranscriptEviction`
 * pipeline without standing up an OpenAI Realtime WebSocket.
 */
function dispatchAiTranscriptDone(
  orchestrator: RealtimeOrchestrator,
  itemId: string,
  text: string
): void {
  (
    orchestrator as unknown as {
      handleEvent: (event: { type: string; item_id: string; transcript: string }) => void;
    }
  ).handleEvent({
    type: "response.output_audio_transcript.done",
    item_id: itemId,
    transcript: text,
  });
}

describe("Story 12-6 — orchestrator transcript-cap runtime contract (canonical P2-8 closure)", () => {
  it("Case 6: state.transcript.length NEVER exceeds MAX_TRANSCRIPT_ENTRIES after 250 sequential AI turns", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    // Inject conversationId so `handleTranscriptEviction` can build payloads.
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";

    for (let i = 0; i < 250; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }

    const state = orchestrator.getState();
    expect(state.transcript.length).toBe(MAX_TRANSCRIPT_ENTRIES);
    // Tail-200 of the returned transcript begins with turn 50 (turns 0-49 evicted).
    expect(state.transcript[0].text).toBe("AI turn 50");
    expect(state.transcript[199].text).toBe("AI turn 249");

    orchestrator.dispose();
  });

  it("Case 7: 201st AI turn fires `transcript-cap-evicted` Sentry breadcrumb with correct shape", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";
    (addBreadcrumb as jest.Mock).mockClear();

    // 200 turns — no eviction.
    for (let i = 0; i < 200; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }
    // Filter to ONLY the transcript-cap breadcrumb (other paths also call addBreadcrumb).
    const capBreadcrumbsBefore = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === TRANSCRIPT_CAP_FEATURE_TAG
    );
    expect(capBreadcrumbsBefore).toHaveLength(0);

    // 201st turn — eviction fires.
    dispatchAiTranscriptDone(orchestrator, "item-201", "AI turn 201");

    const capBreadcrumbsAfter = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === TRANSCRIPT_CAP_FEATURE_TAG
    );
    expect(capBreadcrumbsAfter).toHaveLength(1);
    expect(capBreadcrumbsAfter[0][0]).toMatchObject({
      category: "realtime",
      level: "info",
      message: "Transcript cap eviction",
      data: {
        feature: TRANSCRIPT_CAP_FEATURE_TAG,
        evictedCount: 1,
        totalEntries: 201,
      },
    });

    orchestrator.dispose();
  });

  it("Case 8: getState().transcript is frozen (Story 12-1 P15 invariant held + cap returns new array)", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";

    // Feed 5 turns then 250 turns to exercise both identity and eviction paths.
    for (let i = 0; i < 5; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }
    const stateSmall = orchestrator.getState();
    expect(Object.isFrozen(stateSmall)).toBe(true);

    for (let i = 5; i < 250; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }
    const stateLarge = orchestrator.getState();
    expect(Object.isFrozen(stateLarge)).toBe(true);

    orchestrator.dispose();
  });

  it("Case 9: persistConversation Slot 1 inserts spilled-first + tail-last (order preserved across cap eviction)", async () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";
    // Inject conversationId so handleTranscriptEviction can build payloads.
    // (We're bypassing `start()`'s setup; persistConversation reads this private field.)

    // Feed 250 AI turns → 50 spilled + 200 live.
    for (let i = 0; i < 250; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }

    // Verify internal state pre-persist.
    const spilled = (orchestrator as unknown as { spilledMessages: { content: string }[] })
      .spilledMessages;
    expect(spilled).toHaveLength(50);
    expect(spilled[0].content).toBe("AI turn 0");
    expect(spilled[49].content).toBe("AI turn 49");

    // Drive persistConversation directly.
    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // Assert Slot 1 was called once with 250 rows in [spilled-first, tail-last] order.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedRows = (mockInsert.mock.calls[0] as unknown as { content: string }[][])[0];
    expect(insertedRows).toHaveLength(250);
    expect(insertedRows[0].content).toBe("AI turn 0");
    expect(insertedRows[49].content).toBe("AI turn 49");
    expect(insertedRows[50].content).toBe("AI turn 50");
    expect(insertedRows[249].content).toBe("AI turn 249");

    orchestrator.dispose();
  });

  it("Case 10: start() reset block clears spilledMessages between conversations (no cross-session carryover)", async () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";

    // Feed 250 turns → 50 spilled.
    for (let i = 0; i < 250; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }
    const spilledBefore = (orchestrator as unknown as { spilledMessages: unknown[] })
      .spilledMessages;
    expect(spilledBefore).toHaveLength(50);

    // Call start() — the reset block runs synchronously before any await.
    // The orchestrator's current status is "idle" so the concurrent-start
    // guard doesn't short-circuit. We don't need the await to complete;
    // we just need the synchronous reset block to run.
    void orchestrator.start();
    // The reset is synchronous (runs before the first `await` in start()).
    const spilledAfter = (orchestrator as unknown as { spilledMessages: unknown[] })
      .spilledMessages;
    expect(spilledAfter).toHaveLength(0);

    orchestrator.dispose();
  });
});

describe("Story 12-6 — orchestrator transcript-cap mixed user + AI turns", () => {
  it("Case 11: mixed user+AI turns also evict (handleItemCreated participates in cap)", () => {
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";

    // Alternate AI + user turns up to 250 entries total — both paths
    // through `applyTranscriptCap`. The user path goes via handleEvent
    // → handleItemCreated.
    const dispatchUserItem = (text: string): void => {
      (
        orchestrator as unknown as {
          handleEvent: (event: {
            type: string;
            item: { role: string; content: { type: string; transcript: string }[] };
          }) => void;
        }
      ).handleEvent({
        type: "conversation.item.created",
        item: { role: "user", content: [{ type: "input_audio", transcript: text }] },
      });
    };

    for (let i = 0; i < 125; i++) {
      dispatchAiTranscriptDone(orchestrator, `ai-${i}`, `AI turn ${i}`);
      dispatchUserItem(`user turn ${i}`);
    }

    const state = orchestrator.getState();
    // 250 entries total → 50 evicted, 200 remain.
    expect(state.transcript.length).toBe(MAX_TRANSCRIPT_ENTRIES);

    // Verify the spill buffer contains both AI + user entries from the
    // first 50 turns (in interleaved insertion order).
    const spilled = (
      orchestrator as unknown as { spilledMessages: { role: string; content: string }[] }
    ).spilledMessages;
    expect(spilled).toHaveLength(50);
    expect(spilled.some((m) => m.role === "user")).toBe(true);
    expect(spilled.some((m) => m.role === "assistant")).toBe(true);

    // Story 12-6 review-round-1 P7: explicit FIFO ordering assertion.
    // The interleaved insertion order was [ai-0, user-0, ai-1, user-1,
    // ..., ai-24, user-24] for the first 50 entries (the 25 oldest
    // turns each contributing 2 entries). Verify the spill buffer
    // preserves that exact order — a future refactor that sorts
    // spilled entries by role or by some other key would silently
    // break the persist-time chronological ordering.
    const expectedInterleaved: { role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i < 25; i++) {
      expectedInterleaved.push({ role: "assistant", content: `AI turn ${i}` });
      expectedInterleaved.push({ role: "user", content: `user turn ${i}` });
    }
    expect(spilled.map((m) => ({ role: m.role, content: m.content }))).toEqual(expectedInterleaved);

    orchestrator.dispose();
  });
});

// ============================================================================
// Story 12-6 review-round-1 P5 — null-conversationId silent-data-loss
// ============================================================================

describe("Story 12-6 review-round-1 P5 — null-conversationId eviction routes through captureError", () => {
  it("Case 12: 201st turn with null conversationId fires captureError + no breadcrumb (data-loss path is visible to operators)", () => {
    // Pre-P1 the eviction handler returned silently on null
    // `conversationId`, dropping evicted entries from memory AND
    // never pushing them to `spilledMessages` AND emitting no
    // breadcrumb. Post-P1 the data loss routes through `captureError`
    // so operators can see it in Sentry.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    // Explicitly leave conversationId === null (no injection).
    (addBreadcrumb as jest.Mock).mockClear();
    (captureError as jest.Mock).mockClear();

    // Drive the orchestrator past the 200-entry boundary into the
    // eviction path WITHOUT setting conversationId first.
    for (let i = 0; i < 201; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }

    // captureError was called exactly once with the canonical context tag.
    expect((captureError as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    const matchingCalls = (captureError as jest.Mock).mock.calls.filter(
      (call) => call[1] === "transcript-cap-eviction-no-convo-id"
    );
    expect(matchingCalls).toHaveLength(1);
    expect(matchingCalls[0][0]).toBeInstanceOf(Error);
    expect((matchingCalls[0][0] as Error).message).toMatch(
      /Transcript eviction with null conversationId/
    );
    expect(matchingCalls[0][2]).toMatchObject({ evictedCount: 1 });

    // The transcript-cap-evicted breadcrumb did NOT fire (eviction
    // short-circuited before the spill loop).
    const capBreadcrumbs = (addBreadcrumb as jest.Mock).mock.calls.filter(
      (call) =>
        (call[0] as { data?: { feature?: string } }).data?.feature === TRANSCRIPT_CAP_FEATURE_TAG
    );
    expect(capBreadcrumbs).toHaveLength(0);

    // spilledMessages is empty (no payloads pushed since conversationId was null).
    const spilled = (
      orchestrator as unknown as { spilledMessages: { role: string; content: string }[] }
    ).spilledMessages;
    expect(spilled).toHaveLength(0);

    orchestrator.dispose();
  });

  it("Case 12b: empty-string conversationId also routes through captureError (belt-and-suspenders for the empty-string falsy edge)", () => {
    // Empty string passes the pre-patch `!this.conversationId` falsy
    // guard AND also fails the FK constraint at DB insert time.
    // Post-P1 the explicit `=== ""` check catches it.
    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "";
    (captureError as jest.Mock).mockClear();

    for (let i = 0; i < 201; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }

    const matchingCalls = (captureError as jest.Mock).mock.calls.filter(
      (call) => call[1] === "transcript-cap-eviction-no-convo-id"
    );
    expect(matchingCalls).toHaveLength(1);

    orchestrator.dispose();
  });
});

// ============================================================================
// Story 12-6 review-round-1 P6 — start-reset drift detector
// ============================================================================

describe("Story 12-6 review-round-1 P6 — start() resets spilledMessages BEFORE any await (drift detector)", () => {
  it("Case 13: `this.spilledMessages = []` appears BEFORE the first `await` in start() (source-string drift detector)", () => {
    // Pre-P6 the Case 10 runtime test asserted the reset is
    // synchronous-before-await but relied on race-by-luck — if a
    // future refactor placed an `await` (e.g., a permission check)
    // before the reset block, the test would pass via ordering luck
    // rather than logic. This source-string drift detector reads the
    // orchestrator source from disk and pins the syntactic invariant.
    const startBody = extractMethodBody("async start(): Promise<void> {");
    // Find the first `await` keyword in the body.
    const firstAwaitIdx = startBody.search(/\bawait\b/);
    // Find the assignment that clears spilledMessages.
    const resetIdx = startBody.search(/this\.spilledMessages\s*=\s*\[\]/);
    expect(resetIdx).toBeGreaterThan(-1);
    expect(firstAwaitIdx).toBeGreaterThan(-1);
    // The reset MUST land before the first await.
    expect(resetIdx).toBeLessThan(firstAwaitIdx);
  });
});

// ============================================================================
// Story 12-6 review-round-1 P13 — offline-queue path with spill
// ============================================================================

describe("Story 12-6 review-round-1 P13 — offline-queue path with spill (AC #2 BDD #2)", () => {
  it("Case 14: offline branch iterates 250 enqueueWrite calls with spilled-first/tail-last ordering", async () => {
    // AC #2 BDD #2: "the offline-queue path (if network unavailable)
    // iterates 250 `enqueueWrite` calls in the same order [spilled-
    // first, tail-last]." Pre-P13 this BDD was uncovered.

    // Flip the isOnline mock to false so persistConversation enters
    // the offline-queue branch instead of the Phase A online path.
    const networkMock = jest.requireMock("../network") as {
      isOnline: jest.Mock;
      requireNetwork: jest.Mock;
    };
    networkMock.isOnline.mockResolvedValueOnce(false);

    // Capture every enqueueWrite payload so we can verify ordering.
    const cacheMock = jest.requireMock("../cache") as { enqueueWrite: jest.Mock };
    cacheMock.enqueueWrite.mockClear();

    const orchestrator = new RealtimeOrchestrator(baseOptions);
    (orchestrator as unknown as { conversationId: string }).conversationId = "convo-cap-test";

    // Feed 250 AI turns → 50 spilled + 200 live.
    for (let i = 0; i < 250; i++) {
      dispatchAiTranscriptDone(orchestrator, `item-${i}`, `AI turn ${i}`);
    }

    await (
      orchestrator as unknown as { persistConversation: (d: number) => Promise<void> }
    ).persistConversation(60);

    // Filter to ONLY conversation_messages inserts (Slot 1 + offline path).
    const messageWrites = cacheMock.enqueueWrite.mock.calls.filter(
      (call) => (call[0] as { table: string }).table === "conversation_messages"
    );
    // 250 message-insert calls + 1 conversation-update call = 251 total,
    // but we filter to just the 250 message calls.
    expect(messageWrites).toHaveLength(250);

    // Ordering: payload[0..49] are the spilled (AI turns 0-49), payload
    // [50..249] are the live tail (AI turns 50-249).
    const contents = messageWrites.map(
      (call) => (call[0] as { payload: { content: string } }).payload.content
    );
    expect(contents[0]).toBe("AI turn 0");
    expect(contents[49]).toBe("AI turn 49");
    expect(contents[50]).toBe("AI turn 50");
    expect(contents[249]).toBe("AI turn 249");

    orchestrator.dispose();
  });
});
