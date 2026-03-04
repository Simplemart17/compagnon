/**
 * Conversation Transcript View
 *
 * Displays the scrollable transcript of the voice conversation.
 * Shows user messages, AI responses, and inline corrections.
 * Each new message entry animates in from its side.
 */

import { useRef, useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { TranscriptEntry } from "@/src/hooks/use-realtime-voice";

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

function AnimatedMessage({ entry, shouldAnimate }: AnimatedMessageProps) {
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
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: isUser ? "rgba(245,166,35,0.6)" : "rgba(255,255,255,0.4)",
          marginBottom: 3,
          textAlign: isUser ? "right" : "left",
        }}
      >
        {isUser ? "Vous" : "Compagnon"}
      </Text>

      {/* Bubble */}
      <View
        style={{
          maxWidth: isUser ? 280 : 295,
          backgroundColor: isUser ? "rgba(245,166,35,0.22)" : "rgba(255,255,255,0.1)",
          borderRadius: 20,
          borderTopRightRadius: isUser ? 6 : 20,
          borderTopLeftRadius: isUser ? 20 : 6,
          borderWidth: 1,
          borderColor: isUser ? "rgba(245,166,35,0.35)" : "rgba(255,255,255,0.12)",
          paddingHorizontal: 14,
          paddingVertical: 11,
        }}
      >
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: isUser ? "#FFFFFF" : "rgba(255,255,255,0.92)",
            fontStyle: isUser ? "italic" : "normal",
          }}
        >
          {entry.role === "assistant" ? getDisplayText(entry.text) : entry.text}
        </Text>
      </View>

      {/* Corrections below AI messages */}
      {entry.role === "assistant" && entry.corrections && entry.corrections.length > 0 && (
        <View style={{ marginTop: 6 }}>
          <CorrectionBubble corrections={entry.corrections} compact theme="dark" />
        </View>
      )}
    </Reanimated.View>
  );
}

function TypingIndicator() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={{ alignSelf: "flex-start" }}>
      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 3,
        }}
      >
        Compagnon
      </Text>
      <View
        style={{
          backgroundColor: "rgba(255,255,255,0.1)",
          borderRadius: 20,
          borderTopLeftRadius: 6,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
          paddingHorizontal: 16,
          paddingVertical: 14,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: "rgba(255,255,255,0.7)",
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
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 3,
        }}
      >
        Compagnon
      </Text>
      <View
        style={{
          backgroundColor: "rgba(255,255,255,0.1)",
          borderRadius: 20,
          borderTopLeftRadius: 6,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
          paddingHorizontal: 14,
          paddingVertical: 11,
        }}
      >
        <Text style={{ fontSize: 15, color: "rgba(255,255,255,0.92)", lineHeight: 22 }}>
          {text}
          <Text style={{ color: cursorVisible ? "#F5A623" : "transparent" }}>|</Text>
        </Text>
      </View>
    </View>
  );
}

export function TranscriptView({ transcript, pendingAiText, isAiSpeaking }: TranscriptViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const prevLengthRef = useRef(transcript.length);

  // Track which entries are "new" (should animate in)
  const animateFromIndex = useRef(transcript.length);

  useEffect(() => {
    if (transcript.length > prevLengthRef.current) {
      animateFromIndex.current = prevLengthRef.current;
    }
    prevLengthRef.current = transcript.length;
  }, [transcript.length]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript.length, pendingAiText]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      showsVerticalScrollIndicator={false}
    >
      {transcript.map((entry, index) => (
        <AnimatedMessage
          key={entry.id}
          entry={entry}
          shouldAnimate={index >= animateFromIndex.current}
        />
      ))}

      {/* Streaming AI text with blinking cursor */}
      {pendingAiText.length > 0 && <PendingAiBubble text={pendingAiText} />}

      {/* Typing dots when AI is speaking but no text yet */}
      {isAiSpeaking && pendingAiText.length === 0 && <TypingIndicator />}
    </ScrollView>
  );
}
