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
}

interface AnimatedMessageProps {
  entry: TranscriptEntry;
  shouldAnimate: boolean;
}

/** Strip the Correction Report section from AI text for clean display */
function getDisplayText(text: string): string {
  const dividerIndex = text.indexOf("---\n");
  if (dividerIndex > 0) {
    return text.substring(0, dividerIndex).trim();
  }
  return text;
}

const AnimatedMessage = React.memo(function AnimatedMessage({
  entry,
  shouldAnimate,
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

      {/* Corrections below AI messages */}
      {entry.role === "assistant" && entry.corrections && entry.corrections.length > 0 && (
        <View className="mt-1.5">
          <CorrectionBubble corrections={entry.corrections} compact />
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

export function TranscriptView({ transcript, pendingAiText, isAiSpeaking }: TranscriptViewProps) {
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

  const renderItem = useCallback(
    ({ item, index }: { item: TranscriptEntry; index: number }) => (
      <AnimatedMessage entry={item} shouldAnimate={index >= animateFromIndex.current} />
    ),
    []
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

  return (
    <FlatList
      ref={flatListRef}
      data={transcript}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListFooterComponent={renderFooter}
      className="flex-1"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      showsVerticalScrollIndicator={false}
    />
  );
}
