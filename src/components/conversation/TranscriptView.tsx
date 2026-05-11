/**
 * Conversation Transcript View
 *
 * Displays the virtualized, scrollable transcript of the voice conversation.
 * Shows user messages, AI responses, and inline corrections.
 * Each new message entry animates in from its side.
 * Uses FlatList for virtualization to keep long conversations performant.
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { View, Text, FlatList } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { TranscriptEntry } from "@/src/hooks/use-realtime-voice";
import { Colors, skillTint } from "@/src/lib/design";

import { CorrectionBubble } from "./CorrectionBubble";

interface TranscriptViewProps {
  transcript: TranscriptEntry[];
  pendingAiText: string;
  isAiSpeaking: boolean;
  condensed?: boolean;
}

interface AnimatedMessageProps {
  entry: TranscriptEntry;
  shouldAnimate: boolean;
  condensed?: boolean;
  /** Corrections from the following AI message, to render below this user message in sideNote mode */
  sideNoteCorrections?: TranscriptEntry["corrections"];
  /** Whether sideNote corrections should be visible (hidden while AI is speaking for latest turn) */
  showSideNoteCorrections?: boolean;
}

/**
 * Strip the Correction Report section from AI text for clean display in
 * chat bubbles. The Correction Report is rendered separately via
 * `CorrectionBubble` side-notes; showing it inline duplicates the content.
 *
 * Post-Story-11-1: corrections arrive via the `report_correction` Realtime
 * tool-call (Story 11-1) instead of being embedded as text. New post-11-1
 * assistant turns will never trigger any of the sentinels below — the
 * model has no instruction to emit a Correction Report text block in its
 * audio response. The sentinel-based stripper is retained ONLY for:
 *   - In-flight pre-11-1 conversations rendered before the prompt update
 *     fully propagates (rare during the deploy window).
 *   - Historical conversation messages stored in `conversation_messages`
 *     before Story 11-1 shipped (rendered via the conversation history
 *     screen at `app/(tabs)/conversation/history.tsx`).
 *
 * The strip logic is therefore a forward-compat / backward-compat shim,
 * not a load-bearing parser.
 *
 * Pre-Story-10-7 history: the Correction Report was preceded by a `---\n`
 * horizontal-rule divider. Story 10-7 removed the `---` rules from the
 * prompt (§8.4 emoji + markdown drop); the AI then emitted the Correction
 * Report as plain-text lines with the `"User said" → "Correct form"
 * (explanation)` shape followed by a `Tip:` line. We anchor on whichever
 * of these legacy sentinels appears first:
 *   - a `"..." → "..." (...)` correction line (the shape the deleted
 *     pre-11-1 `parseCorrections` regex used to extract)
 *   - a leading `No corrections.` line (the empty-error branch)
 *   - a leading `Tip:` line (the trailing tip when no correction line
 *     precedes it)
 *
 * Falls back to the pre-10-7 `---\n` divider for the oldest stored
 * transcripts.
 */
function getDisplayText(text: string): string {
  // Story 10-7 sentinels — find the first occurrence of any of them.
  const sentinels: number[] = [];
  // Correction-line shape: match the start of a `"X" → "Y" (Z)` line.
  const correctionLineMatch = text.match(/(^|\n)"[^"]+"\s*→\s*"[^"]+"\s*\(/);
  if (correctionLineMatch && correctionLineMatch.index !== undefined) {
    sentinels.push(correctionLineMatch.index + correctionLineMatch[1].length);
  }
  // No-corrections sentinel on its own line
  const noCorrectionsIdx = text.search(/(^|\n)No corrections\./);
  if (noCorrectionsIdx >= 0) {
    sentinels.push(noCorrectionsIdx === 0 ? 0 : noCorrectionsIdx + 1);
  }
  // Tip: sentinel on its own line
  const tipIdx = text.search(/(^|\n)Tip:\s/);
  if (tipIdx >= 0) {
    sentinels.push(tipIdx === 0 ? 0 : tipIdx + 1);
  }
  // Legacy pre-10-7 `---\n` divider — keeps historic messages strippable.
  const legacyDividerIdx = text.indexOf("---\n");
  if (legacyDividerIdx > 0) {
    sentinels.push(legacyDividerIdx);
  }

  if (sentinels.length === 0) return text;
  const cut = Math.min(...sentinels);
  if (cut <= 0) return text;
  return text.substring(0, cut).trimEnd();
}

const AnimatedMessage = React.memo(function AnimatedMessage({
  entry,
  shouldAnimate,
  condensed = false,
  sideNoteCorrections,
  showSideNoteCorrections = true,
}: AnimatedMessageProps) {
  const isUser = entry.role === "user";

  const opacity = useSharedValue(shouldAnimate ? 0 : 1);
  const translateX = useSharedValue(shouldAnimate ? (isUser ? 24 : -24) : 0);

  useEffect(() => {
    if (shouldAnimate) {
      opacity.value = withTiming(1, { duration: 260 });
      translateX.value = withSpring(0, { stiffness: 220, damping: 24 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Reanimated.View style={[{ alignSelf: isUser ? "flex-end" : "flex-start" }, animStyle]}>
      {/* Role label */}
      <Text
        className="mb-0.5 text-[10px] font-bold"
        style={{
          color: isUser ? skillTint(Colors.accent, 0.6) : skillTint(Colors.surfaceWhite, 0.4),
          textAlign: isUser ? "right" : "left",
        }}
      >
        {isUser ? "Vous" : "Compagnon"}
      </Text>

      {/* Bubble */}
      <View
        className="rounded-[20px] border px-3.5 py-[11px]"
        style={{
          maxWidth: isUser ? 280 : 295,
          backgroundColor: isUser ? Colors.bubbleUser : Colors.bubbleAi,
          borderTopRightRadius: isUser ? 6 : 20,
          borderTopLeftRadius: isUser ? 20 : 6,
          borderColor: isUser ? Colors.bubbleUserBorder : Colors.bubbleAiBorder,
        }}
      >
        <Text
          className="text-[15px] leading-[22px]"
          style={{
            color: isUser ? Colors.surfaceWhite : skillTint(Colors.surfaceWhite, 0.92),
            fontStyle: isUser ? "italic" : "normal",
          }}
        >
          {entry.role === "assistant" ? getDisplayText(entry.text) : entry.text}
        </Text>
      </View>

      {/* Default variant: corrections below AI messages */}
      {!condensed &&
        entry.role === "assistant" &&
        entry.corrections &&
        entry.corrections.length > 0 && (
          <View className="mt-1.5">
            <CorrectionBubble corrections={entry.corrections} compact />
          </View>
        )}

      {/* Condensed/sideNote variant: corrections below user messages */}
      {condensed &&
        isUser &&
        showSideNoteCorrections &&
        sideNoteCorrections &&
        sideNoteCorrections.length > 0 && (
          <View className="mt-1.5" style={{ alignSelf: "flex-start" }}>
            <CorrectionBubble corrections={sideNoteCorrections} compact variant="sideNote" />
          </View>
        )}
    </Reanimated.View>
  );
});

function TypingIndicator() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <View className="self-start">
      <Text
        className="mb-0.5 text-[10px] font-bold"
        style={{ color: skillTint(Colors.surfaceWhite, 0.4) }}
      >
        Compagnon
      </Text>
      <View
        className="flex-row items-center gap-1.5 rounded-[20px] border px-4 py-3.5"
        style={{
          backgroundColor: Colors.bubbleAi,
          borderTopLeftRadius: 6,
          borderColor: Colors.bubbleAiBorder,
        }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: Colors.textOnDarkSecondary,
              opacity: activeIndex === i ? 1 : 0.25,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function PendingAiBubble({ text }: { text: string }) {
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "82%" }}>
      <Text
        className="mb-0.5 text-[10px] font-bold"
        style={{ color: skillTint(Colors.surfaceWhite, 0.4) }}
      >
        Compagnon
      </Text>
      <View
        className="rounded-[20px] border px-3.5 py-[11px]"
        style={{
          backgroundColor: Colors.bubbleAi,
          borderTopLeftRadius: 6,
          borderColor: Colors.bubbleAiBorder,
        }}
      >
        <Text
          className="text-[15px] leading-[22px]"
          style={{ color: skillTint(Colors.surfaceWhite, 0.92) }}
        >
          {text}
          <Text style={{ color: cursorVisible ? Colors.accent : "transparent" }}>|</Text>
        </Text>
      </View>
    </View>
  );
}

/** Fixed height for condensed mode — architectural contract from Epic 3 (Story 3.3 allocates 160px) */
const CONDENSED_HEIGHT = 160;

export function TranscriptView({
  transcript,
  pendingAiText,
  isAiSpeaking,
  condensed = false,
}: TranscriptViewProps) {
  const flatListRef = useRef<FlatList<TranscriptEntry>>(null);
  const prevLengthRef = useRef(transcript.length);

  // Track which entries are "new" (should animate in)
  const animateFromIndex = useRef(transcript.length);

  useEffect(() => {
    if (transcript.length > prevLengthRef.current) {
      animateFromIndex.current = prevLengthRef.current;
    }
    prevLengthRef.current = transcript.length;
  }, [transcript.length]);

  // Auto-scroll to bottom on new entries or pending AI text changes
  useEffect(() => {
    if (transcript.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [transcript.length, pendingAiText]);

  const keyExtractor = useCallback((item: TranscriptEntry) => item.id, []);

  // Use refs to avoid capturing transcript/isAiSpeaking in renderItem closure (preserves FlatList memoization)
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const isAiSpeakingRef = useRef(isAiSpeaking);
  isAiSpeakingRef.current = isAiSpeaking;

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptEntry; index: number }) => {
      // In condensed mode, attach corrections from the following AI message to the user message
      let sideNoteCorrections: TranscriptEntry["corrections"] | undefined;
      let showSideNoteCorrections = true;

      if (condensed && item.role === "user") {
        const currentTranscript = transcriptRef.current;
        // Look ahead for the next AI message's corrections
        const nextEntry = currentTranscript[index + 1];
        if (nextEntry?.role === "assistant" && nextEntry.corrections?.length) {
          sideNoteCorrections = nextEntry.corrections;
        }
        // Gate latest user message corrections on isAiSpeaking
        const lastUserIdx = currentTranscript.reduce(
          (acc, e, i) => (e.role === "user" ? i : acc),
          -1
        );
        if (index === lastUserIdx) {
          showSideNoteCorrections = !isAiSpeakingRef.current;
        }
      }

      return (
        <AnimatedMessage
          entry={item}
          shouldAnimate={index >= animateFromIndex.current}
          condensed={condensed}
          sideNoteCorrections={sideNoteCorrections}
          showSideNoteCorrections={showSideNoteCorrections}
        />
      );
    },
    [condensed]
  );

  /** Footer renders streaming AI text and typing indicator below the list */
  const renderFooter = useCallback(() => {
    const showPending = pendingAiText.length > 0;
    const showTyping = isAiSpeaking && pendingAiText.length === 0;

    if (!showPending && !showTyping) return null;

    return (
      <View className="mt-3">
        {showPending && <PendingAiBubble text={pendingAiText} />}
        {showTyping && <TypingIndicator />}
      </View>
    );
  }, [pendingAiText, isAiSpeaking]);

  const flatList = (
    <FlatList
      ref={flatListRef}
      data={transcript}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      extraData={condensed ? `${transcript.length}-${isAiSpeaking}` : transcript.length}
      ListFooterComponent={renderFooter}
      className={condensed ? undefined : "flex-1"}
      style={condensed ? { flex: 1 } : undefined}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      showsVerticalScrollIndicator={false}
    />
  );

  if (condensed) {
    return <View style={{ height: CONDENSED_HEIGHT }}>{flatList}</View>;
  }

  return flatList;
}
