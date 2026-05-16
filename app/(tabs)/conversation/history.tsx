/**
 * Conversation History Screen
 *
 * Displays past conversations with topic, date, duration,
 * corrections count, and CEFR level. Tapping a conversation
 * shows the full transcript.
 *
 * Features:
 * - Search bar to filter conversations by topic name or date
 * - Transcript modal with in-text search, match highlighting,
 *   match count, and up/down navigation between matches
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Modal,
  Platform,
} from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/store/auth-store";
import { captureError } from "@/src/lib/sentry";
import { LEVEL_COLORS } from "@/src/lib/constants";
import { Colors, Typography } from "@/src/lib/design";
import { useDebounce } from "@/src/hooks/use-debounce";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { SkeletonBar } from "@/src/components/common/SkeletonBar";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationRecord {
  id: string;
  topic: string;
  cefr_level: string;
  duration_seconds: number | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  ai_feedback: {
    summary?: string;
    fluencyRating?: number;
    grammarRating?: number;
  } | null;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  corrections:
    | {
        original: string;
        corrected: string;
        explanation: string;
      }[]
    | null;
}

/** A single match position within the transcript */
interface TranscriptMatch {
  /** Index of the message in the messages array */
  messageIndex: number;
  /** Character start index within that message's content */
  charStart: number;
  /** Character end index within that message's content */
  charEnd: number;
}

// ---------------------------------------------------------------------------
// Skeleton loading
// ---------------------------------------------------------------------------

function SkeletonCard() {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Reanimated.View
      style={[
        {
          marginHorizontal: 16,
          marginBottom: 10,
          borderRadius: 16,
          padding: 16,
          backgroundColor: Colors.surfaceWhite,
        },
      ]}
    >
      <Reanimated.View style={animStyle}>
        <View className="h-4 w-3/5 rounded-md mb-2" style={{ backgroundColor: Colors.gray200 }} />
        <View className="h-3 w-2/5 rounded-md mb-3" style={{ backgroundColor: Colors.gray200 }} />
        <View className="h-3 w-4/5 rounded-md" style={{ backgroundColor: Colors.gray200 }} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function ModalSafeArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-surface"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {children}
    </View>
  );
}

function HistoryLoadingSkeleton({ isSlow }: { isSlow: boolean }) {
  return (
    <View className="flex-1 bg-surface pt-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <SkeletonCard key={i} />
      ))}
      {isSlow && (
        <Text style={[Typography.caption, { textAlign: "center", marginTop: 8 }]}>
          Taking longer than usual...
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Formats a date string for search matching.
 * Returns multiple representations so the user can type
 * "today", "yesterday", "Jan 5", "2026", etc.
 */
const dateSearchTokens = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  if (diffDays === 0) parts.push("today");
  if (diffDays === 1) parts.push("yesterday");

  parts.push(
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  );
  parts.push(
    date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  );

  return parts.join(" ");
};

/**
 * Build an array of TranscriptMatch objects from messages and a query.
 */
function buildTranscriptMatches(msgs: ConversationMessage[], query: string): TranscriptMatch[] {
  if (query.length === 0) return [];

  const lowerQuery = query.toLowerCase();
  const matches: TranscriptMatch[] = [];

  msgs.forEach((msg, msgIdx) => {
    const lowerContent = msg.content.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerContent.length) {
      const idx = lowerContent.indexOf(lowerQuery, searchFrom);
      if (idx === -1) break;

      matches.push({
        messageIndex: msgIdx,
        charStart: idx,
        charEnd: idx + query.length,
      });

      searchFrom = idx + 1;
    }
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Renders message text with highlighted search matches.
 */
function HighlightedText({
  content,
  matches,
  activeMatchIndex,
  globalOffset,
  textColor,
}: {
  content: string;
  matches: TranscriptMatch[];
  activeMatchIndex: number;
  globalOffset: number;
  textColor: string;
}) {
  if (matches.length === 0) {
    return (
      <Text
        style={{ fontSize: Typography.bodySecondary.fontSize, color: textColor, lineHeight: 20 }}
      >
        {content}
      </Text>
    );
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, localIdx) => {
    // Text before the match
    if (match.charStart > cursor) {
      segments.push(<Text key={`pre-${localIdx}`}>{content.slice(cursor, match.charStart)}</Text>);
    }

    const isActive = globalOffset + localIdx === activeMatchIndex;

    segments.push(
      <Text
        key={`match-${localIdx}`}
        style={{
          backgroundColor: isActive ? Colors.accent : Colors.accent20,
          color: isActive ? Colors.textOnDark : textColor,
          borderRadius: 2,
          fontWeight: isActive ? "700" : "400",
        }}
      >
        {content.slice(match.charStart, match.charEnd)}
      </Text>
    );

    cursor = match.charEnd;
  });

  // Text after last match
  if (cursor < content.length) {
    segments.push(<Text key="post">{content.slice(cursor)}</Text>);
  }

  return (
    <Text style={{ fontSize: Typography.bodySecondary.fontSize, color: textColor, lineHeight: 20 }}>
      {segments}
    </Text>
  );
}

/**
 * Story 13-5: extracted bubble component (React.memo) so the FlatList row
 * pool re-renders only when a bubble's own props change — NOT on every
 * parent re-render. Pre-13-5 the inline `messages.map(msg => <View>)` block
 * re-created 500+ React elements on every parent render (search state
 * change, modal open, etc.). Post-13-5 the per-row memoization combined
 * with the `extraData` content-key memo bounds FlatList's re-render budget.
 */
/** @internal — exported for unit testing only (Story 13-5 P2-7 closure). */
export interface BubbleProps {
  msg: ConversationMessage;
  msgMatches: { matches: TranscriptMatch[]; globalOffset: number } | undefined;
  activeMatchIdx: number;
}

/**
 * Story 13-5 review-round-1 P1: custom `arePropsEqual` for Bubble's
 * `React.memo`. Pre-patch the default shallow comparison flipped on every
 * search keystroke because `matchesByMessage.get(index)` returns a fresh
 * `{matches, globalOffset}` object reference on each Map rebuild — every
 * visible Bubble re-rendered on every keystroke despite the underlying
 * content being identical. Post-patch the comparator hashes `msgMatches`
 * by content (length + globalOffset + first/last match positions) and
 * short-circuits `activeMatchIdx` changes that don't cross this bubble's
 * match range. The audit win's "per-row memoization" claim becomes
 * load-bearing instead of partially defeated.
 *
 * @internal — exported for unit testing only.
 */
export function bubblePropsEqual(prev: BubbleProps, next: BubbleProps): boolean {
  // msg identity differs → always re-render (different message).
  if (prev.msg !== next.msg) return false;

  // msgMatches existence asymmetry → re-render.
  if (!prev.msgMatches !== !next.msgMatches) return false;

  // Both have msgMatches: compare by content hash.
  if (prev.msgMatches && next.msgMatches) {
    const p = prev.msgMatches;
    const n = next.msgMatches;
    if (p.matches.length !== n.matches.length) return false;
    if (p.globalOffset !== n.globalOffset) return false;
    if (p.matches.length > 0) {
      const pFirst = p.matches[0];
      const nFirst = n.matches[0];
      const pLast = p.matches[p.matches.length - 1];
      const nLast = n.matches[n.matches.length - 1];
      if (pFirst.charStart !== nFirst.charStart) return false;
      if (pFirst.charEnd !== nFirst.charEnd) return false;
      if (pLast.charStart !== nLast.charStart) return false;
      if (pLast.charEnd !== nLast.charEnd) return false;
    }
  }

  // activeMatchIdx changed — re-render ONLY if THIS bubble contains
  // either the previous or the next active match. Otherwise the change
  // is invisible to this row and we skip.
  if (prev.activeMatchIdx !== next.activeMatchIdx) {
    const containsActive = (idx: number, m: BubbleProps["msgMatches"]): boolean => {
      if (!m || m.matches.length === 0) return false;
      return idx >= m.globalOffset && idx < m.globalOffset + m.matches.length;
    };
    if (
      containsActive(prev.activeMatchIdx, prev.msgMatches) ||
      containsActive(next.activeMatchIdx, next.msgMatches)
    ) {
      return false;
    }
  }

  return true;
}

/** @internal — exported for unit testing only (Story 13-5 P2-7 closure). */
export const Bubble = React.memo(function Bubble({ msg, msgMatches, activeMatchIdx }: BubbleProps) {
  const isUser = msg.role === "user";
  return (
    <View
      className="mb-3"
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
      }}
    >
      <View
        className="rounded-2xl p-3"
        style={{
          backgroundColor: isUser ? Colors.primary : Colors.surfaceWhite,
          borderTopRightRadius: isUser ? 4 : 16,
          borderTopLeftRadius: isUser ? 16 : 4,
          borderWidth: isUser ? 0 : 1,
          borderColor: Colors.border,
        }}
      >
        {msgMatches ? (
          <HighlightedText
            content={msg.content}
            matches={msgMatches.matches}
            activeMatchIndex={activeMatchIdx}
            globalOffset={msgMatches.globalOffset}
            textColor={isUser ? Colors.textOnDark : Colors.textPrimary}
          />
        ) : (
          <Text
            className="text-sm leading-5"
            style={{ color: isUser ? Colors.textOnDark : Colors.textPrimary }}
          >
            {msg.content}
          </Text>
        )}
      </View>
      {/* Corrections — bounded by Story 11-1 MAX_PENDING_CORRECTIONS = 50 */}
      {msg.corrections && msg.corrections.length > 0 && (
        <View
          className="rounded-[10px] p-2.5 mt-1 border"
          style={{
            backgroundColor: Colors.accent10,
            borderColor: Colors.accent30,
          }}
        >
          {msg.corrections.map((c, i) => (
            <Text key={i} className="text-xs leading-[17px]" style={{ color: Colors.gray700 }}>
              &quot;{c.original}&quot; {"→"} &quot;{c.corrected}&quot;
              {c.explanation ? ` (${c.explanation})` : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}, bubblePropsEqual);
// Story 13-5 review-round-1 L2: explicit displayName so React DevTools +
// crash stacks show "Bubble" instead of "Memo(Bubble)" / "Anonymous".
Bubble.displayName = "Bubble";

/**
 * Story 13-5 review-round-1 P3 + P9: pure FlatList scrollToIndex-failure
 * retry helper extracted from the component for direct unit testing.
 *
 * Pre-patch the component's `onScrollToIndexFailed` callback retried
 * unboundedly: scrollToOffset(0) → setTimeout → retry → fail → setTimeout
 * → ... infinite loop for permanently-invalid indices (race scenarios,
 * out-of-range from a stale transcriptMatches closure). Post-patch the
 * helper caps retries at `maxRetries` (default 2) and clamps the target
 * index to `info.highestMeasuredFrameIndex` (RN-docs recommended pattern
 * — FlatList knows that's the largest index it has data dimensions for).
 *
 * Also closes P9 (test gap): the runtime test can now drive the REAL
 * helper instead of a replicated copy.
 *
 * @internal — exported for unit testing only.
 */
export interface ScrollIndexFailureContext {
  /** Called synchronously to jump to top before retry. */
  scrollToOffset: (opts: { offset: number; animated: boolean }) => void;
  /** Called in the retry setTimeout to attempt the clamped scroll. */
  scrollToIndex: (opts: { index: number; viewPosition: number; animated: boolean }) => void;
  /** Persists retry count across multiple failure events in the same chain. */
  retryCountRef: { current: number };
  /** Story 12-9 pattern — setTimeout callback bails when unmounted. */
  mountedRef: { current: boolean };
  /** P4: persists the timer id so the cleanup effect can clear it on unmount. */
  timeoutRef: { current: ReturnType<typeof setTimeout> | null };
  /** Cap; default 2. */
  maxRetries?: number;
  /** Override for testing; default 100ms. */
  delayMs?: number;
}

export function handleScrollIndexFailure(
  info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number },
  ctx: ScrollIndexFailureContext
): void {
  const maxRetries = ctx.maxRetries ?? 2;
  const delayMs = ctx.delayMs ?? 100;

  if (ctx.retryCountRef.current >= maxRetries) {
    // P3: budget exhausted — give up + Sentry breadcrumb so operators
    // can spot a wedged search-jump in prod telemetry.
    captureError(
      new Error(
        `history scroll-to-index exhausted after ${ctx.retryCountRef.current} retries (target=${info.index}, measured=${info.highestMeasuredFrameIndex})`
      ),
      "history-scroll-to-index-exhausted"
    );
    ctx.retryCountRef.current = 0;
    return;
  }
  ctx.retryCountRef.current += 1;

  // P3: clamp the target index to highestMeasuredFrameIndex so we don't
  // retry an index FlatList demonstrably can't reach. Pre-patch the
  // identical info.index re-fired indefinitely.
  const safeIndex = Math.max(0, Math.min(info.index, info.highestMeasuredFrameIndex));

  ctx.scrollToOffset({ offset: 0, animated: false });
  if (ctx.timeoutRef.current) clearTimeout(ctx.timeoutRef.current);
  ctx.timeoutRef.current = setTimeout(() => {
    ctx.timeoutRef.current = null;
    if (!ctx.mountedRef.current) return;
    ctx.scrollToIndex({ index: safeIndex, viewPosition: 0.1, animated: true });
  }, delayMs);
}

/**
 * Story 13-5: stable-identity `ListEmptyComponent` for the transcript
 * FlatList. Extracted at module-level so FlatList doesn't re-instantiate
 * the element identity on every render.
 *
 * @internal — exported for unit testing only (Story 13-5 P2-7 closure).
 */
export function EmptyTranscriptText() {
  return (
    <Text className="text-sm text-center mt-10" style={{ color: Colors.textTertiary }}>
      This conversation{"'"}s transcript is not available yet.{"\n"}It may still be processing.
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Main Screen Component
// ---------------------------------------------------------------------------

export default function ConversationHistoryScreen() {
  const router = useRouter();
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const user = useAuthStore((s) => s.user);

  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // History list search
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const isSlow = useSlowLoading(isLoading);

  // Transcript modal
  const [selectedConvo, setSelectedConvo] = useState<ConversationRecord | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Transcript search
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const debouncedTranscriptSearch = useDebounce(transcriptSearch, 300);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  // Story 13-5: FlatList ref replaces the pre-13-5 ScrollView ref. Search-
  // jump-to-match calls `scrollToIndex({index, viewPosition: 0.1})` directly
  // via this ref (the pre-13-5 `messageLayoutMap` ref + `onLayout` callback
  // mechanism are DELETED — closes audit P2-7).
  const transcriptScrollRef = useRef<FlatList<ConversationMessage>>(null);
  // Story 13-5 mountedRef guard for the `onScrollToIndexFailed` setTimeout
  // fallback (Story 12-9 pattern) — defends against setState-after-unmount
  // when the user closes the modal between the failure event and the retry.
  // Story 13-5 review-round-1 L1: `useRef(true)` initializes once at hook
  // creation, so the in-effect re-assignment is redundant + dev-only
  // StrictMode-cleanup-then-remount window incorrectly toggled the ref
  // false→true; effect body now ONLY tracks cleanup.
  const mountedRef = useRef(true);
  // Story 13-5 review-round-1 P3 + P4: retry budget + timeout-cleanup for
  // the `onScrollToIndexFailed` fallback chain. Without the budget,
  // permanently-invalid indices (race scenarios) loop infinitely:
  // scrollToOffset → setTimeout → retry → fail → setTimeout → ...
  // Without timeout-cleanup, modal unmount leaks the timer (RN may warn).
  const scrollIndexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollIndexRetryCountRef = useRef(0);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (scrollIndexTimeoutRef.current) {
        clearTimeout(scrollIndexTimeoutRef.current);
        scrollIndexTimeoutRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, topic, cefr_level, duration_seconds, status, completed_at, created_at, ai_feedback"
        )
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(50);

      if (error) {
        captureError(error, "fetch-conversation-history");
        return;
      }

      setConversations((data ?? []) as ConversationRecord[]);
    } catch (err) {
      captureError(err, "fetch-conversation-history");
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchConversations().finally(() => setIsLoading(false));
  }, [fetchConversations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  const openTranscript = useCallback(async (convo: ConversationRecord) => {
    setSelectedConvo(convo);
    setLoadingMessages(true);
    setTranscriptSearch("");
    setActiveMatchIdx(0);
    // Story 13-5: `messageLayoutMap.current.clear()` removed along with the
    // pre-13-5 ref + onLayout mechanism. FlatList scrollToIndex takes the
    // message INDEX directly; per-row y-positions are no longer needed.

    try {
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("id, role, content, corrections")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true });

      if (error) {
        captureError(error, "fetch-conversation-messages");
      }

      setMessages((data ?? []) as ConversationMessage[]);
    } catch (err) {
      captureError(err, "fetch-conversation-messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const closeTranscript = useCallback(() => {
    setSelectedConvo(null);
    setTranscriptSearch("");
    setActiveMatchIdx(0);
  }, []);

  // Auto-open transcript when navigated with ?highlight=conversationId
  const highlightHandled = useRef(false);
  useEffect(() => {
    if (!highlight || highlightHandled.current || conversations.length === 0) return;
    const target = conversations.find((c) => c.id === highlight);
    if (target) {
      highlightHandled.current = true;
      void openTranscript(target);
    }
  }, [highlight, conversations, openTranscript]);

  // ---------------------------------------------------------------------------
  // Filtered conversation list
  // ---------------------------------------------------------------------------

  const filteredConversations = useMemo(() => {
    if (debouncedSearch.trim().length === 0) return conversations;

    const query = debouncedSearch.toLowerCase().trim();

    return conversations.filter((convo) => {
      const topic = (convo.topic ?? "").toLowerCase();
      const dateTokens = dateSearchTokens(convo.completed_at ?? convo.created_at).toLowerCase();

      return topic.includes(query) || dateTokens.includes(query);
    });
  }, [conversations, debouncedSearch]);

  // ---------------------------------------------------------------------------
  // Transcript search matches
  // ---------------------------------------------------------------------------

  const transcriptMatches = useMemo(
    () => buildTranscriptMatches(messages, debouncedTranscriptSearch.trim()),
    [messages, debouncedTranscriptSearch]
  );

  // Reset active match index when matches change
  useEffect(() => {
    setActiveMatchIdx(0);
  }, [transcriptMatches]);

  /**
   * Build a per-message match mapping for efficient rendering:
   * messageIndex -> { matches: TranscriptMatch[], globalOffset: number }
   */
  const matchesByMessage = useMemo(() => {
    const map = new Map<number, { matches: TranscriptMatch[]; globalOffset: number }>();

    let offset = 0;
    let currentMsgIdx = -1;
    let currentMatches: TranscriptMatch[] = [];

    transcriptMatches.forEach((m) => {
      if (m.messageIndex !== currentMsgIdx) {
        if (currentMsgIdx >= 0 && currentMatches.length > 0) {
          map.set(currentMsgIdx, {
            matches: currentMatches,
            globalOffset: offset,
          });
          offset += currentMatches.length;
        }
        currentMsgIdx = m.messageIndex;
        currentMatches = [];
      }
      currentMatches.push(m);
    });

    // Flush last group
    if (currentMsgIdx >= 0 && currentMatches.length > 0) {
      map.set(currentMsgIdx, {
        matches: currentMatches,
        globalOffset: offset,
      });
    }

    return map;
  }, [transcriptMatches]);

  /**
   * Scroll to the message containing the active match.
   *
   * Story 13-5: rewired from `scrollTo({y})` + `messageLayoutMap` lookup to
   * the FlatList `scrollToIndex({index, viewPosition})` API. `viewPosition:
   * 0.1` puts the target row ~10% from the viewport top — preserves the
   * pre-13-5 `y - 80` offset semantics. `onScrollToIndexFailed` handles the
   * off-screen-not-yet-measured fallback per RN docs pattern.
   *
   * Story 13-5 review-round-1 P2 + P3: clamp `match.messageIndex` against
   * `messages.length - 1` defensively (fetch-race window where stale
   * `transcriptMatches` closure references an out-of-range index would
   * otherwise emit "scrollToIndex out of range" warning + no-op). Also
   * reset the retry-budget counter on each fresh user-initiated scroll so
   * a previous exhaustion doesn't poison the next attempt.
   */
  const scrollToActiveMatch = useCallback(
    (matchIdx: number) => {
      if (transcriptMatches.length === 0) return;

      const safeIdx = Math.max(0, Math.min(matchIdx, transcriptMatches.length - 1));
      const match = transcriptMatches[safeIdx];
      if (!match) return;

      // P2: clamp the target message index against the current messages
      // length. The fetch-race window where `transcriptMatches` lags the
      // `messages` reload would otherwise produce out-of-range indices.
      if (messages.length === 0) return;
      const targetIndex = Math.max(0, Math.min(match.messageIndex, messages.length - 1));

      // P3: reset retry budget — this is a fresh user-initiated scroll.
      scrollIndexRetryCountRef.current = 0;
      transcriptScrollRef.current?.scrollToIndex({
        index: targetIndex,
        viewPosition: 0.1,
        animated: true,
      });
    },
    [transcriptMatches, messages.length]
  );

  /**
   * Story 13-5: variable-row-height + `scrollToIndex` failure handler.
   * When the target row is off-screen + below the currently-mounted
   * window, FlatList can't compute the destination offset and fires this
   * event. Delegates to the pure `handleScrollIndexFailure` helper which
   * implements the RN-docs recommended fallback (scroll-to-top + setTimeout
   * retry) PLUS a retry budget (P3) + index clamp to
   * highestMeasuredFrameIndex + timeout-cleanup via `timeoutRef` (P4)
   * + `mountedRef` guard (Story 12-9 pattern).
   */
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      const ref = transcriptScrollRef.current;
      if (!ref) return;
      handleScrollIndexFailure(info, {
        scrollToOffset: (opts) => ref.scrollToOffset(opts),
        scrollToIndex: (opts) => ref.scrollToIndex(opts),
        retryCountRef: scrollIndexRetryCountRef,
        mountedRef,
        timeoutRef: scrollIndexTimeoutRef,
      });
    },
    []
  );

  const goToNextMatch = useCallback(() => {
    if (transcriptMatches.length === 0) return;
    const nextIdx = (activeMatchIdx + 1) % transcriptMatches.length;
    setActiveMatchIdx(nextIdx);
    scrollToActiveMatch(nextIdx);
  }, [activeMatchIdx, transcriptMatches.length, scrollToActiveMatch]);

  const goToPrevMatch = useCallback(() => {
    if (transcriptMatches.length === 0) return;
    const prevIdx = (activeMatchIdx - 1 + transcriptMatches.length) % transcriptMatches.length;
    setActiveMatchIdx(prevIdx);
    scrollToActiveMatch(prevIdx);
  }, [activeMatchIdx, transcriptMatches.length, scrollToActiveMatch]);

  // ---------------------------------------------------------------------------
  // Story 13-5: FlatList virtualization helpers for the transcript modal
  // ---------------------------------------------------------------------------

  /**
   * Stable-identity key extractor — empty dep array keeps it identity-stable
   * across re-renders so FlatList doesn't invalidate its key cache.
   */
  const transcriptKeyExtractor = useCallback((item: ConversationMessage) => item.id, []);

  /**
   * Per-row renderer. `useCallback` deps are the LOAD-BEARING search-state
   * signals: re-create only when `matchesByMessage` or `activeMatchIdx`
   * change. The `Bubble` component is `React.memo`'d so unchanged rows
   * skip re-render even when this callback identity changes.
   */
  const renderBubble = useCallback(
    ({ item, index }: { item: ConversationMessage; index: number }) => {
      const msgMatches = matchesByMessage.get(index);
      return <Bubble msg={item} msgMatches={msgMatches} activeMatchIdx={activeMatchIdx} />;
    },
    [matchesByMessage, activeMatchIdx]
  );

  /**
   * Story 13-3 review-round-1 P2 content-key memoization for FlatList's
   * `extraData` prop. Pre-13-5 a fresh array/object identity per render
   * would invalidate FlatList's per-row React.memo equality checks even
   * when content was identical. Joining the 3 search-state inputs into a
   * primitive string gives a stable identity per (search, matchIdx,
   * length) tuple — FlatList re-runs `renderItem` for visible rows only
   * when the tuple actually changed.
   *
   * The `messages.length` axis is cheap insurance against a future
   * "reload conversation messages" feature; the search-state axes drive
   * the actual highlight re-renders.
   */
  const historyExtraDataKey = useMemo(
    () => `${debouncedTranscriptSearch}|${activeMatchIdx}|${messages.length}`,
    [debouncedTranscriptSearch, activeMatchIdx, messages.length]
  );

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return <HistoryLoadingSkeleton isSlow={isSlow} />;
  }

  // ---------------------------------------------------------------------------
  // Empty state (no conversations at all)
  // ---------------------------------------------------------------------------

  if (conversations.length === 0) {
    return (
      <View className="flex-1 bg-surface justify-center items-center p-6">
        <Text className="text-[64px] mb-4">{"\uD83D\uDCAC"}</Text>
        <Text className="text-[22px] font-bold text-primary mb-2">Your conversations await!</Text>
        <Text className="text-sm text-center leading-5 mb-6" style={{ color: Colors.gray700 }}>
          Have your first chat with Companion{"\n"}and it will show up here for review.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Start a conversation"
          accessibilityHint="Double tap to go back and start a new conversation"
          className="bg-primary rounded-xl px-6 py-3.5"
        >
          <Text className="text-white text-[15px] font-bold">Start a Conversation</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderConversation = ({ item }: { item: ConversationRecord }) => {
    const levelColor = LEVEL_COLORS[item.cefr_level as CEFRLevel] ?? Colors.gray500;

    return (
      <TouchableOpacity
        onPress={() => openTranscript(item)}
        accessibilityRole="button"
        accessibilityLabel={`Conversation: ${item.topic || "Free conversation"}, ${formatDate(item.completed_at ?? item.created_at)}, duration ${formatDuration(item.duration_seconds)}`}
        accessibilityHint="Double tap to view conversation transcript"
        className="bg-white rounded-2xl p-4 mx-4 mb-2.5 border border-surface-300"
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-base font-bold text-primary" numberOfLines={1}>
              {item.topic}
            </Text>
            <Text className="text-xs mt-1" style={{ color: Colors.textTertiary }}>
              {formatDate(item.completed_at ?? item.created_at)} {"\u00B7"}{" "}
              {formatDuration(item.duration_seconds)}
            </Text>
          </View>
          <View className="rounded-lg px-2 py-1" style={{ backgroundColor: levelColor }}>
            <Text className="text-[11px] font-bold text-white">{item.cefr_level}</Text>
          </View>
        </View>

        {/* Feedback summary if available */}
        {item.ai_feedback?.summary && (
          <Text
            className="text-[13px] mt-2 leading-[18px]"
            style={{ color: Colors.gray700 }}
            numberOfLines={2}
          >
            {item.ai_feedback.summary}
          </Text>
        )}

        {/* Ratings */}
        {item.ai_feedback?.fluencyRating && (
          <View className="flex-row gap-4 mt-2">
            <Text className="text-[11px] text-success">
              Fluency {item.ai_feedback.fluencyRating}/5
            </Text>
            <Text className="text-[11px]" style={{ color: Colors.accentText }}>
              Grammar {item.ai_feedback.grammarRating}/5
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <View className="flex-1 bg-surface">
      {/* Search bar for conversation list */}
      <View className="px-4 pt-3 pb-2">
        <View
          className="flex-row items-center bg-white rounded-xl border border-surface-300 px-3"
          style={{ minHeight: 44 }}
        >
          <Text className="text-base mr-2" style={{ color: Colors.textTertiary }}>
            {"\uD83D\uDD0D"}
          </Text>
          <TextInput
            style={{
              flex: 1,
              fontSize: Typography.body.fontSize,
              color: Colors.textPrimary,
              paddingVertical: Platform.OS === "ios" ? 10 : 6,
            }}
            placeholder="Search conversations..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search conversations"
            accessibilityHint="Filter conversations by topic or date"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              accessibilityHint="Double tap to clear the search field"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{
                minWidth: 44,
                minHeight: 44,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <View
                className="w-5 h-5 rounded-full justify-center items-center"
                style={{ backgroundColor: Colors.gray400 }}
              >
                <Text
                  style={{
                    fontSize: Typography.label.fontSize,
                    color: Colors.surfaceWhite,
                    fontWeight: "700",
                    lineHeight: 13,
                  }}
                >
                  {"\u2715"}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Conversation list or "No results" */}
      {filteredConversations.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-base mb-1" style={{ color: Colors.textTertiary }}>
            {"\uD83D\uDD0D"}
          </Text>
          <Text className="text-base font-semibold mb-1" style={{ color: Colors.textSecondary }}>
            No results
          </Text>
          <Text className="text-[13px] text-center" style={{ color: Colors.textTertiary }}>
            No conversations match &quot;{debouncedSearch}&quot;
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredConversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        />
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Transcript Modal                                                     */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        visible={!!selectedConvo}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeTranscript}
      >
        <ModalSafeArea>
          {/* Modal header */}
          <View
            className="flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: Colors.border }}
          >
            <View className="flex-1">
              <Text className="text-[17px] font-bold text-primary" numberOfLines={1}>
                {selectedConvo?.topic}
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: Colors.textTertiary }}>
                {selectedConvo?.completed_at ? formatDate(selectedConvo.completed_at) : ""}{" "}
                {"\u00B7"} {formatDuration(selectedConvo?.duration_seconds ?? null)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={closeTranscript}
              accessibilityRole="button"
              accessibilityLabel="Close transcript"
              accessibilityHint="Double tap to close the transcript and return to history"
              className="bg-surface-300 w-11 h-11 rounded-full justify-center items-center"
            >
              <Text className="text-base font-bold" style={{ color: Colors.gray700 }}>
                {"\u2715"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Transcript search bar */}
          <View
            className="px-4 py-2"
            style={{ borderBottomWidth: 1, borderBottomColor: Colors.border }}
          >
            <View
              className="flex-row items-center bg-white rounded-[10px] border border-surface-300 px-2.5"
              style={{ minHeight: 40 }}
            >
              <Text className="text-sm mr-1.5" style={{ color: Colors.textTertiary }}>
                {"\uD83D\uDD0D"}
              </Text>
              <TextInput
                style={{
                  flex: 1,
                  fontSize: Typography.bodySecondary.fontSize,
                  color: Colors.textPrimary,
                  paddingVertical: Platform.OS === "ios" ? 8 : 4,
                }}
                placeholder="Search in transcript..."
                placeholderTextColor={Colors.textTertiary}
                value={transcriptSearch}
                onChangeText={setTranscriptSearch}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search in transcript"
                accessibilityHint="Search through conversation messages"
              />

              {/* Match count + navigation (shown when there is a search query) */}
              {debouncedTranscriptSearch.trim().length > 0 && (
                <View className="flex-row items-center gap-1">
                  <Text
                    className="text-xs font-semibold mr-1"
                    style={{
                      color: transcriptMatches.length > 0 ? Colors.textSecondary : Colors.error,
                    }}
                    accessibilityLabel={`${transcriptMatches.length} matches found`}
                  >
                    {transcriptMatches.length > 0
                      ? `${activeMatchIdx + 1}/${transcriptMatches.length}`
                      : "0"}
                  </Text>

                  <TouchableOpacity
                    onPress={goToPrevMatch}
                    disabled={transcriptMatches.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Previous match"
                    accessibilityHint="Double tap to go to the previous search match"
                    accessibilityState={{ disabled: transcriptMatches.length === 0 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    className="w-7 h-7 rounded-md justify-center items-center"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      backgroundColor:
                        transcriptMatches.length > 0 ? Colors.primary8 : Colors.gray200,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: Typography.bodySecondary.fontSize,
                        fontWeight: "700",
                        color: transcriptMatches.length > 0 ? Colors.primary : Colors.gray400,
                      }}
                    >
                      {"\u2303"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={goToNextMatch}
                    disabled={transcriptMatches.length === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Next match"
                    accessibilityHint="Double tap to go to the next search match"
                    accessibilityState={{ disabled: transcriptMatches.length === 0 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    className="w-7 h-7 rounded-md justify-center items-center"
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      backgroundColor:
                        transcriptMatches.length > 0 ? Colors.primary8 : Colors.gray200,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: Typography.bodySecondary.fontSize,
                        fontWeight: "700",
                        color: transcriptMatches.length > 0 ? Colors.primary : Colors.gray400,
                        transform: [{ rotate: "180deg" }],
                      }}
                    >
                      {"\u2303"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Clear transcript search */}
              {transcriptSearch.length > 0 && (
                <TouchableOpacity
                  onPress={() => setTranscriptSearch("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear transcript search"
                  accessibilityHint="Double tap to clear the transcript search field"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{
                    marginLeft: 6,
                    minWidth: 44,
                    minHeight: 44,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <View
                    className="w-[18px] h-[18px] rounded-full justify-center items-center"
                    style={{ backgroundColor: Colors.gray400 }}
                  >
                    <Text
                      style={{
                        fontSize: Typography.tiny.fontSize,
                        color: Colors.surfaceWhite,
                        fontWeight: "700",
                        lineHeight: 12,
                      }}
                    >
                      {"\u2715"}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Messages */}
          {loadingMessages ? (
            <View className="flex-1 px-4 pt-5">
              {[1, 2, 3, 4].map((i) => {
                const isRight = i % 2 === 1;
                return (
                  <View
                    key={i}
                    className="mb-3"
                    style={{
                      alignSelf: isRight ? "flex-end" : "flex-start",
                      maxWidth: "82%",
                    }}
                  >
                    <SkeletonBar
                      width={isRight ? 200 : 240}
                      height={i === 2 ? 56 : 44}
                      style={{ borderRadius: 16 }}
                    />
                  </View>
                );
              })}
            </View>
          ) : (
            // Story 13-5: ScrollView+messages.map REPLACED with virtualized
            // FlatList (closes audit P2-7). 500-message conversation: from
            // ~3-8s JS-thread stall on open + ~500 mounted bubbles to
            // ~150-300ms + ~10-20 mounted bubbles. Search-jump-to-match
            // rewired from scrollTo({y}) to scrollToIndex({index,
            // viewPosition: 0.1}) + onScrollToIndexFailed fallback.
            <FlatList
              ref={transcriptScrollRef}
              className="flex-1"
              data={messages}
              keyExtractor={transcriptKeyExtractor}
              renderItem={renderBubble}
              extraData={historyExtraDataKey}
              ListEmptyComponent={EmptyTranscriptText}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              windowSize={10}
              maxToRenderPerBatch={10}
              removeClippedSubviews={true}
              onScrollToIndexFailed={handleScrollToIndexFailed}
            />
          )}
        </ModalSafeArea>
      </Modal>
    </View>
  );
}
