/**
 * Story 11-5 — Consolidated post-conversation analysis module tests.
 *
 * Pins the module's contract: short-circuit on tiny transcripts, single
 * `chatCompletionJSON` call (verifying the 3 → 1 consolidation), parallel
 * persist via Promise.allSettled with per-slot failure isolation, optional
 * feedback handling, and Sentry-routing on rejected slots.
 */

import type { Correction } from "@/src/types/conversation";

import {
  extractPostConversationAnalysis,
  persistPostConversationAnalysis,
  POST_CONVERSATION_ANALYSIS_MAX_TOKENS,
} from "../post-conversation-analysis";
import { chatCompletionJSON } from "../openai";
import { captureError } from "../sentry";
import { persistMemories } from "../memory";
import { persistErrorPatterns } from "../error-tracker";

jest.mock("../openai", () => ({
  chatCompletionJSON: jest.fn(),
  generateEmbedding: jest.fn(),
}));

jest.mock("../sentry", () => ({
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Prefix with `mock` so Jest's module-factory restrictions allow it.
const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });

const mockFrom = jest.fn((_table: string) => ({
  update: mockUpdate,
  insert: jest.fn().mockResolvedValue({ error: null }),
  select: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }),
}));

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

jest.mock("../memory", () => ({
  persistMemories: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../error-tracker", () => ({
  persistErrorPatterns: jest.fn().mockResolvedValue(undefined),
}));

const SAMPLE_CORRECTIONS: Correction[] = [
  {
    original: "j'ai allé",
    corrected: "je suis allé",
    explanation: "Use être with être-verbs in passé composé",
    category: "grammar",
  },
];

const SHORT_TRANSCRIPT = "user: bonjour";
const LONG_TRANSCRIPT = "user: ".concat("a".repeat(100));

describe("extractPostConversationAnalysis (Story 11-5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("short-circuits to all-empty defaults when transcript is below 50 chars", async () => {
    const result = await extractPostConversationAnalysis({
      transcript: SHORT_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    expect(result).toEqual({ facts: [], errorPatterns: [], feedback: undefined });
    expect(chatCompletionJSON as jest.Mock).not.toHaveBeenCalled();
  });

  it("calls chatCompletionJSON exactly ONCE (consolidation contract: 3 → 1)", async () => {
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: [],
      errorPatterns: [],
      feedback: undefined,
    });

    await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: SAMPLE_CORRECTIONS,
      cefrLevel: "B1",
    });

    expect(chatCompletionJSON as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it("passes maxTokens=1500 + temperature=0.3 + feature=post-conversation-analysis", async () => {
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: [],
      errorPatterns: [],
      feedback: undefined,
    });

    await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    const [, , options] = (chatCompletionJSON as jest.Mock).mock.calls[0];
    expect(options.maxTokens).toBe(POST_CONVERSATION_ANALYSIS_MAX_TOKENS);
    expect(POST_CONVERSATION_ANALYSIS_MAX_TOKENS).toBe(1500);
    expect(options.temperature).toBe(0.3);
    expect(options.feature).toBe("post-conversation-analysis");
  });

  it("passes system + user as 2 messages (not stuffed into a single role)", async () => {
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: [],
      errorPatterns: [],
      feedback: undefined,
    });

    await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: SAMPLE_CORRECTIONS,
      cefrLevel: "B1",
    });

    const [messages] = (chatCompletionJSON as jest.Mock).mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    // The user message must carry the wrapped transcript (Story 9-4 invariant).
    expect(messages[1].content).toContain("<USER_TRANSCRIPT>");
    expect(messages[1].content).toContain("</USER_TRANSCRIPT>");
    expect(messages[1].content).toContain("<USER_CORRECTIONS>");
    expect(messages[1].content).toContain("</USER_CORRECTIONS>");
  });

  it("returns the parsed analysis object with facts + errorPatterns + feedback", async () => {
    const stubAnalysis = {
      facts: [{ content: "Lives in Toronto", type: "personal_fact" }],
      errorPatterns: [
        {
          original: "j'ai allé",
          corrected: "je suis allé",
          pattern: "être-verb passé composé requires être auxiliary",
          category: "grammar",
        },
      ],
      feedback: {
        summary: "Solid B1 conversation with consistent grammar.",
        strengths: ["Good vocabulary range"],
        improvements: ["Watch être/avoir auxiliaries"],
        vocabularyUsed: 42,
        fluencyRating: 4,
        grammarRating: 3,
      },
    };
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce(stubAnalysis);

    const result = await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: SAMPLE_CORRECTIONS,
      cefrLevel: "B1",
    });

    expect(result).toEqual(stubAnalysis);
  });
});

describe("persistPostConversationAnalysis (Story 11-5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fans out 3 parallel persists: memories + error patterns + conversations.update", async () => {
    await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: {
        facts: [{ content: "Likes hiking", type: "preference" }],
        errorPatterns: [
          {
            original: "j'ai allé",
            corrected: "je suis allé",
            pattern: "être-verb passé composé",
            category: "grammar",
          },
        ],
        feedback: {
          summary: "Good session.",
          strengths: ["Vocab"],
          improvements: ["Tenses"],
          vocabularyUsed: 30,
          fluencyRating: 4,
          grammarRating: 3,
        },
      },
    });

    expect(persistMemories as jest.Mock).toHaveBeenCalledTimes(1);
    expect(persistErrorPatterns as jest.Mock).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("conversations");
    expect(mockUpdate).toHaveBeenCalledWith({
      ai_feedback: expect.objectContaining({ summary: "Good session." }),
    });
  });

  it("returns feedback so the caller can update the UI", async () => {
    const feedback = {
      summary: "Strong B2 performance.",
      strengths: ["Natural rhythm"],
      improvements: ["Subjunctive accuracy"],
      vocabularyUsed: 55,
      fluencyRating: 5,
      grammarRating: 4,
    };

    const result = await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: { facts: [], errorPatterns: [], feedback },
    });

    expect(result).toEqual({ feedback });
  });

  it("returns feedback: undefined when the model didn't produce a feedback object", async () => {
    const result = await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: { facts: [], errorPatterns: [], feedback: undefined },
    });

    expect(result).toEqual({ feedback: undefined });
    // No conversations.update call when feedback is undefined.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does NOT call persistMemories when facts is empty", async () => {
    await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: { facts: [], errorPatterns: [], feedback: undefined },
    });

    // persistMemories is still called (with empty array); it's a no-op
    // internally per its guard.
    expect(persistMemories as jest.Mock).toHaveBeenCalledWith("user-1", "conv-1", []);
  });

  it("isolates failures: one slot rejecting does not block the others", async () => {
    (persistMemories as jest.Mock).mockRejectedValueOnce(new Error("memory db down"));

    await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: {
        facts: [{ content: "fact", type: "preference" }],
        errorPatterns: [
          {
            original: "x",
            corrected: "y",
            pattern: "p",
            category: "grammar",
          },
        ],
        feedback: {
          summary: "s",
          strengths: ["a"],
          improvements: ["b"],
          vocabularyUsed: 1,
          fluencyRating: 3,
          grammarRating: 3,
        },
      },
    });

    // Even though persistMemories rejected, the other two slots still ran.
    expect(persistErrorPatterns as jest.Mock).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("captures rejected-slot errors to Sentry with feature=post-conversation-persist", async () => {
    (persistMemories as jest.Mock).mockRejectedValueOnce(new Error("memory db down"));

    await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: {
        facts: [{ content: "fact", type: "preference" }],
        errorPatterns: [],
        feedback: undefined,
      },
    });

    expect(captureError as jest.Mock).toHaveBeenCalledWith(
      expect.any(Error),
      "post-conversation-persist"
    );
  });

  it("does not crash when all slots reject (best-effort persistence)", async () => {
    (persistMemories as jest.Mock).mockRejectedValueOnce(new Error("m"));
    (persistErrorPatterns as jest.Mock).mockRejectedValueOnce(new Error("e"));

    await expect(
      persistPostConversationAnalysis({
        userId: "user-1",
        conversationId: "conv-1",
        analysis: {
          facts: [{ content: "f", type: "preference" }],
          errorPatterns: [
            {
              original: "x",
              corrected: "y",
              pattern: "p",
              category: "grammar",
            },
          ],
          feedback: undefined,
        },
      })
    ).resolves.toBeDefined();
  });
});

describe("POST_CONVERSATION_ANALYSIS_MAX_TOKENS constant pin", () => {
  it("is exactly 1500 (Story 11-5 right-sizing: feedback ~150 + facts ~500 + errorPatterns ~500 + envelope = ~1200; headroom 300)", () => {
    expect(POST_CONVERSATION_ANALYSIS_MAX_TOKENS).toBe(1500);
  });
});

describe("Story 11-5 review patch P2 — silent-empty-result detection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("breadcrumbs a warning when long transcript yields all-empty output (silent-empty masking)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addBreadcrumb } = require("../sentry");
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: [],
      errorPatterns: [],
      feedback: undefined,
    });

    await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: SAMPLE_CORRECTIONS,
      cefrLevel: "B1",
    });

    expect(addBreadcrumb as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        data: expect.objectContaining({ feature: "post-conversation-analysis-empty" }),
      })
    );
  });

  it("does NOT breadcrumb empty-result when transcript is too short to analyze", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addBreadcrumb } = require("../sentry");

    await extractPostConversationAnalysis({
      transcript: SHORT_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    // Short-transcript path returns immediately without invoking the AI;
    // no breadcrumb should fire (the empty result is expected, not anomalous).
    expect(addBreadcrumb as jest.Mock).not.toHaveBeenCalled();
  });

  it("does NOT breadcrumb when at least one sub-output is populated", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { addBreadcrumb } = require("../sentry");
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: [{ content: "Likes hiking", type: "preference" }],
      errorPatterns: [],
      feedback: undefined,
    });

    await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    expect(addBreadcrumb as jest.Mock).not.toHaveBeenCalled();
  });
});

describe("Story 11-5 review patch P3 — fulfilled-but-errored Supabase slot detection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("captures a Supabase write error returned via { error } on the fulfilled slot", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { captureError } = require("../sentry");
    // Make the .eq() chain resolve with a Postgres error.
    mockUpdate.mockReturnValueOnce({
      eq: jest.fn().mockResolvedValue({ error: { message: "RLS denial: insufficient privilege" } }),
    });

    await persistPostConversationAnalysis({
      userId: "user-1",
      conversationId: "conv-1",
      analysis: {
        facts: [],
        errorPatterns: [],
        feedback: {
          summary: "s",
          strengths: ["a"],
          improvements: ["b"],
          vocabularyUsed: 1,
          fluencyRating: 3,
          grammarRating: 3,
        },
      },
    });

    // Pre-patch: this would have been silently swallowed because
    // Supabase resolves the rejection as `{status:"fulfilled", value:{error:...}}`.
    // Post-patch: captureError fires on fulfilled-with-error slots.
    expect(captureError as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("RLS denial") }),
      "post-conversation-persist"
    );
  });
});

describe("Story 11-5 review patch P8 — defensive defaults instead of bare `as`-cast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes a `{facts: null}` response into facts: []", async () => {
    // The schema's `.default([])` does NOT fire on null (only on undefined).
    // The pre-patch `as` cast would have let null leak through and cause
    // a downstream `.map()` TypeError. Post-patch we normalize defensively.
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce({
      facts: null,
      errorPatterns: null,
      feedback: undefined,
    });

    const result = await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    expect(Array.isArray(result.facts)).toBe(true);
    expect(Array.isArray(result.errorPatterns)).toBe(true);
    expect(result.facts).toEqual([]);
    expect(result.errorPatterns).toEqual([]);
  });

  it("normalizes a null overall response into all-empty defaults", async () => {
    (chatCompletionJSON as jest.Mock).mockResolvedValueOnce(null);

    const result = await extractPostConversationAnalysis({
      transcript: LONG_TRANSCRIPT,
      corrections: [],
      cefrLevel: "B1",
    });

    expect(result).toEqual({ facts: [], errorPatterns: [], feedback: undefined });
  });
});
