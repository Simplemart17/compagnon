/**
 * Correction Bubble Component
 *
 * Shows "You said X -> A native would say Y" with tap for explanation.
 * Dark-mode card design with animated entry.
 */

import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Reanimated, {
  SlideInLeft,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { Correction } from "@/src/types/conversation";
import type { CEFRLevel } from "@/src/types/cefr";
import {
  defaultCorrectionExplanationLanguage,
  hasEnglishExplanation,
  selectCorrectionExplanation,
  type CorrectionExplanationLanguage,
} from "@/src/lib/realtime-corrections";
import { Colors, Radii, Typography, skillTint } from "@/src/lib/design";

interface CorrectionBubbleProps {
  corrections: Correction[];
  compact?: boolean;
  variant?: "default" | "sideNote";
  /** Story 18-2: drives the CEFR-adaptive default explanation language
   * (A1-A2 → English, B1+ → French). Omitted / not-yet-hydrated → French
   * (the default re-derives when the prop arrives — review R1). */
  cefrLevel?: CEFRLevel;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  grammar: { bg: skillTint(Colors.error, 0.2), text: Colors.error, label: "Grammar" },
  pronunciation: {
    bg: skillTint(Colors.correctionPronunciation, 0.2),
    text: Colors.correctionPronunciationText,
    label: "Pronunciation",
  },
  vocabulary: { bg: Colors.accent20, text: Colors.accent, label: "Vocabulary" },
  register: { bg: skillTint(Colors.success, 0.2), text: Colors.success, label: "Register" },
};

/** Animation timing constant — architectural contract from Epic 3 */
const SIDE_NOTE_DURATION = 200;

export const CorrectionBubble = React.memo(function CorrectionBubble({
  corrections,
  compact = false,
  variant = "default",
  cefrLevel,
}: CorrectionBubbleProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  // Story 18-2 review R1: store only the user's EXPLICIT choice; DERIVE the
  // effective language from override ?? CEFR default. A lazy useState
  // initializer froze the default at mount — a bubble mounted before the
  // profile hydrated locked the wrong language for its whole life. Derived
  // form self-corrects when cefrLevel arrives, and the user's tap always
  // wins.
  const [langOverride, setLangOverride] = useState<CorrectionExplanationLanguage | null>(null);
  const explanationLang = langOverride ?? defaultCorrectionExplanationLanguage(cefrLevel);

  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (corrections.length > 0) {
      opacity.value = withTiming(1, { duration: 300 });
      translateY.value = withSpring(0, { stiffness: 220, damping: 24 });
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(30, { duration: 200 });
    }
  }, [corrections.length, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (corrections.length === 0) return null;

  // compact mode shows at most 2 corrections
  const visibleCorrections = compact ? corrections.slice(0, 2) : corrections;

  const categoryStyles = CATEGORY_STYLES;

  if (variant === "sideNote") {
    return (
      <Reanimated.View entering={SlideInLeft.duration(SIDE_NOTE_DURATION)}>
        {visibleCorrections.map((correction, index) => {
          const catStyle = categoryStyles[correction.category] ?? categoryStyles.grammar;
          const isExpanded = expandedIndex === index;

          return (
            <SideNoteItem
              key={`${correction.original}-${index}`}
              correction={correction}
              catStyle={catStyle}
              isExpanded={isExpanded}
              onToggle={() => setExpandedIndex(isExpanded ? null : index)}
              isLast={index === visibleCorrections.length - 1}
              explanationLang={explanationLang}
              onToggleLanguage={setLangOverride}
            />
          );
        })}
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View style={animStyle}>
      <View
        className="rounded-2xl border p-3.5"
        style={{
          backgroundColor: skillTint(Colors.surfaceWhite, 0.09),
          borderColor: Colors.accent30,
        }}
      >
        {/* Top accent marker */}
        <View
          className="mb-2.5 h-[3px] w-10 self-center rounded-sm"
          style={{ backgroundColor: skillTint(Colors.accent, 0.7) }}
        />

        {/* Section label */}
        <Text
          className="mb-2 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: skillTint(Colors.accent, 0.75) }}
        >
          Companion noticed
        </Text>

        {visibleCorrections.map((correction, index) => {
          const catStyle = categoryStyles[correction.category] ?? categoryStyles.grammar;
          const isExpanded = expandedIndex === index;

          return (
            <View
              key={`${correction.original}-${index}`}
              style={{
                marginBottom: index < visibleCorrections.length - 1 ? 10 : 0,
              }}
            >
              {/* Review R1: the touchable is the HEADER only \u2014 expanded
                  content lives in a SIBLING view so the FR/EN toggle's
                  touchables aren't flattened into this accessible parent
                  (iOS VoiceOver cannot reach nested touchables). */}
              <TouchableOpacity
                onPress={() => setExpandedIndex(isExpanded ? null : index)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Correction: "${correction.original}" should be "${correction.corrected}"`}
                accessibilityHint={
                  isExpanded ? "Tap to collapse explanation" : "Tap for explanation"
                }
                accessibilityState={{ expanded: isExpanded }}
              >
                {/* Category badge */}
                <View className="mb-1.5 flex-row items-center">
                  <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: catStyle.bg }}>
                    <Text className="text-[9px] font-semibold" style={{ color: catStyle.text }}>
                      {catStyle.label}
                    </Text>
                  </View>
                </View>

                {/* Original -> Corrected */}
                <View className="flex-row flex-wrap items-center">
                  <Text className="text-sm italic" style={{ color: Colors.correctionOriginal }}>
                    {correction.original}
                  </Text>
                  <Text
                    className="mx-2 text-[13px]"
                    style={{ color: skillTint(Colors.surfaceWhite, 0.3) }}
                  >
                    {"\u2192"}
                  </Text>
                  <Text className="text-sm font-bold text-success">{correction.corrected}</Text>
                </View>

                {!isExpanded && (
                  <Text
                    className="mt-1 text-[10px]"
                    style={{ color: skillTint(Colors.surfaceWhite, 0.25) }}
                  >
                    Tap for explanation
                  </Text>
                )}
              </TouchableOpacity>

              {/* Expanded explanation (Story 18-2 bilingual). Toggle ABOVE
                  the text so a long explanation can never push it out of
                  reach (review R1). */}
              {isExpanded && (
                <View>
                  {hasEnglishExplanation(correction) && (
                    <ExplanationLanguageToggle
                      language={explanationLang}
                      onToggle={setLangOverride}
                    />
                  )}
                  <Text
                    className="mt-1.5 text-xs italic leading-[18px]"
                    style={{ color: skillTint(Colors.surfaceWhite, 0.55) }}
                  >
                    {selectCorrectionExplanation(correction, explanationLang)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Reanimated.View>
  );
});

/**
 * Story 18-2: FR/EN pill toggle for the correction explanation. Rendered
 * only when the correction carries an English explanation (post-18-2
 * corrections); nested inside the expandable touchable — inner touchables
 * win in RN, so tapping a pill never collapses the correction.
 */
const ExplanationLanguageToggle = React.memo(function ExplanationLanguageToggle({
  language,
  onToggle,
}: {
  language: CorrectionExplanationLanguage;
  onToggle: (lang: CorrectionExplanationLanguage) => void;
}) {
  return (
    <View className="mt-1.5 flex-row">
      {(["fr", "en"] as const).map((lang) => {
        const active = language === lang;
        return (
          <TouchableOpacity
            key={lang}
            onPress={() => onToggle(lang)}
            activeOpacity={0.7}
            // Review R1: visual pills are small; hitSlop extends the touch
            // target toward the 44pt convention so a miss-tap can't land on
            // surrounding content.
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={
              lang === "fr" ? "Show explanation in French" : "Show explanation in English"
            }
            accessibilityState={{ selected: active }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: Radii.chip,
              marginRight: 6,
              minWidth: 32,
              alignItems: "center",
              backgroundColor: active ? Colors.accent20 : skillTint(Colors.surfaceWhite, 0.08),
            }}
          >
            <Text
              style={{
                fontSize: Typography.label.fontSize,
                fontWeight: "700",
                color: active ? Colors.accent : skillTint(Colors.surfaceWhite, 0.45),
              }}
            >
              {lang.toUpperCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

/** SideNote correction item — lighter amber left-border card */
interface SideNoteItemProps {
  correction: Correction;
  catStyle: { bg: string; text: string; label: string };
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
  explanationLang: CorrectionExplanationLanguage;
  onToggleLanguage: (lang: CorrectionExplanationLanguage) => void;
}

const SideNoteItem = React.memo(function SideNoteItem({
  correction,
  catStyle,
  isExpanded,
  onToggle,
  isLast,
  explanationLang,
  onToggleLanguage,
}: SideNoteItemProps) {
  const heightAnim = useSharedValue(isExpanded ? 1 : 0);

  useEffect(() => {
    heightAnim.value = withTiming(isExpanded ? 1 : 0, { duration: SIDE_NOTE_DURATION });
  }, [isExpanded, heightAnim]);

  const expandStyle = useAnimatedStyle(() => ({
    opacity: heightAnim.value,
    maxHeight: heightAnim.value * 500,
  }));

  return (
    <View
      style={{
        borderLeftWidth: 3,
        borderLeftColor: Colors.accent,
        borderTopRightRadius: Radii.button,
        borderBottomRightRadius: Radii.button,
        backgroundColor: skillTint(Colors.accent, 0.08),
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginBottom: isLast ? 0 : 6,
        minHeight: 44,
      }}
    >
      {/* Review R1: touchable = header only; expanded content is a SIBLING
          so the FR/EN toggle stays reachable by VoiceOver (nested
          touchables inside an accessible parent are flattened on iOS). */}
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Correction: "${correction.original}" should be "${correction.corrected}"`}
        accessibilityHint={
          isExpanded
            ? "Double-tap to collapse correction details"
            : "Double-tap to expand correction details"
        }
        accessibilityState={{ expanded: isExpanded }}
      >
        {/* Collapsed: badge + one-liner + tap hint */}
        <View className="flex-row flex-wrap items-center">
          <View className="mr-1.5 rounded px-1.5 py-0.5" style={{ backgroundColor: catStyle.bg }}>
            <Text className="text-[9px] font-semibold" style={{ color: catStyle.text }}>
              {catStyle.label}
            </Text>
          </View>
          <Text
            style={{
              fontSize: Typography.caption.fontSize,
              color: Colors.correctionOriginal,
              fontStyle: "italic",
            }}
          >
            {correction.original}
          </Text>
          <Text
            style={{
              fontSize: Typography.caption.fontSize,
              color: skillTint(Colors.surfaceWhite, 0.3),
              marginHorizontal: 4,
            }}
          >
            {"\u2192"}
          </Text>
          <Text
            style={{
              fontSize: Typography.caption.fontSize,
              fontWeight: "700",
              color: Colors.success,
            }}
          >
            {correction.corrected}
          </Text>
        </View>

        {/* Tap for details hint */}
        {!isExpanded && (
          <Text
            style={{
              fontSize: Typography.label.fontSize,
              color: Colors.textOnDarkMuted,
              marginTop: 2,
            }}
          >
            Tap for details
          </Text>
        )}
      </TouchableOpacity>

      {/* Expanded: explanation (Story 18-2 bilingual). Toggle ABOVE the
          text so a long explanation can never clip it past the animated
          maxHeight (review R1); collapsed state hides the subtree from
          screen readers (always-mounted for the animation). */}
      <Reanimated.View
        style={[{ overflow: "hidden" }, expandStyle]}
        accessibilityElementsHidden={!isExpanded}
        importantForAccessibility={isExpanded ? "auto" : "no-hide-descendants"}
      >
        {hasEnglishExplanation(correction) && (
          <ExplanationLanguageToggle language={explanationLang} onToggle={onToggleLanguage} />
        )}
        <Text
          style={{
            fontSize: Typography.caption.fontSize,
            color: skillTint(Colors.surfaceWhite, 0.55),
            fontStyle: "italic",
            lineHeight: 18,
            marginTop: 4,
          }}
        >
          {selectCorrectionExplanation(correction, explanationLang)}
        </Text>
      </Reanimated.View>
    </View>
  );
});
