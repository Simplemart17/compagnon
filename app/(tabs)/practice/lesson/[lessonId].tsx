/**
 * Lesson player — Story 19-2 (lesson engine, slice 1: teach → apply).
 *
 * Renders the teach step (can-do outcome + grammar focus + EN/FR
 * explanations) and the lesson's vocabulary, then hands off to the
 * apply-in-conversation step: the conversation screen receives the
 * lesson's scenario (title as topic, promptSeed as prompt context,
 * goalEn as the SessionGoalChip override) and marks the lesson complete
 * when the session ends. The guided-drill middle step (exercise engine
 * scoped to the grammar target) is the next 19.2 slice.
 */

import { useCallback, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { Icon } from "@/src/components/common/Icon";
import { getLesson, getUnitForLesson } from "@/src/lib/curriculum";
import { getCompletedLessonIds } from "@/src/lib/lesson-progress";
import { Colors } from "@/src/lib/design";
import { useAuthStore } from "@/src/store/auth-store";

export default function LessonPlayerScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const rawLessonId = Array.isArray(lessonId) ? lessonId[0] : lessonId;
  const lesson = rawLessonId ? getLesson(rawLessonId) : undefined;
  const unit = rawLessonId ? getUnitForLesson(rawLessonId) : undefined;

  // Review R1: the feedback sheet's Close lands BACK ON THIS SCREEN — it
  // must acknowledge completion (pre-R1 the player looked untouched after
  // the conversation: unchanged CTA + a caption still promising completion,
  // so learners re-ran lessons or doubted they counted). Refetch on focus.
  const [completed, setCompleted] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user?.id && rawLessonId) {
        void getCompletedLessonIds(user.id).then((ids) => {
          if (active) setCompleted(ids.has(rawLessonId));
        });
      }
      return () => {
        active = false;
      };
    }, [user?.id, rawLessonId])
  );

  if (!lesson || !unit) {
    return (
      <View className="flex-1 bg-surface items-center justify-center p-6">
        <Text className="text-base font-bold text-primary mb-2">Lesson not found</Text>
        <Text className="text-[13px] text-center mb-4" style={{ color: Colors.gray700 }}>
          This lesson isn&apos;t in the current curriculum. It may arrive in an app update.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="bg-primary rounded-full px-6 py-3"
        >
          <Text className="text-white font-bold">Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const startConversation = () => {
    router.push(
      `/(tabs)/conversation/${encodeURIComponent(
        lesson.conversationScenario.titleFr
      )}?mode=companion&lessonId=${encodeURIComponent(lesson.id)}`
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: `Lesson ${lesson.order}` }} />
      <ScrollView
        className="flex-1 bg-surface"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      >
        {/* Can-do outcome */}
        <Text className="text-[13px]" style={{ color: Colors.gray500 }}>
          {unit.titleEn} · {unit.level}
        </Text>
        <Text className="text-xl font-bold text-primary mt-1" accessibilityRole="header">
          {lesson.canDoEn}
        </Text>
        <Text className="text-[15px] italic mt-1 mb-4" style={{ color: Colors.gray700 }}>
          {lesson.canDoFr}
        </Text>

        {/* Grammar focus */}
        <View className="bg-white rounded-2xl p-4 border border-surface-300 mb-3">
          <View className="flex-row items-center gap-2 mb-2">
            <Icon name="file-text" size={16} color={Colors.accent} />
            <Text className="text-[13px] font-bold text-primary">Grammar focus</Text>
          </View>
          <Text className="text-[14px]" style={{ color: Colors.gray700 }}>
            {lesson.grammarTarget}
          </Text>
        </View>

        {/* Teach step */}
        <View className="bg-white rounded-2xl p-4 border border-surface-300 mb-3">
          <Text className="text-[14px] leading-[21px]" style={{ color: Colors.gray700 }}>
            {lesson.teachEn}
          </Text>
          <View className="bg-accent/10 rounded-xl p-3 mt-3">
            <Text className="text-[14px] leading-[21px] text-primary">{lesson.teachFr}</Text>
          </View>
        </View>

        {/* Vocabulary */}
        <View className="bg-white rounded-2xl p-4 border border-surface-300 mb-4">
          <View className="flex-row items-center gap-2 mb-3">
            <Icon name="book" size={16} color={Colors.accent} />
            <Text className="text-[13px] font-bold text-primary">
              Vocabulary ({lesson.vocab.length})
            </Text>
          </View>
          {lesson.vocab.map((item, i) => (
            <View
              key={item.fr}
              className={`flex-row justify-between py-2 ${
                i < lesson.vocab.length - 1 ? "border-b border-surface-200" : ""
              }`}
            >
              <Text className="text-[14px] font-semibold text-primary flex-shrink pr-3">
                {item.fr}
              </Text>
              <Text
                className="text-[14px] text-right flex-shrink"
                style={{ color: Colors.gray500 }}
              >
                {item.en}
              </Text>
            </View>
          ))}
        </View>

        {/* Completed banner (Review R1: the post-conversation landing spot
            must acknowledge the completion) */}
        {completed && (
          <View
            className="flex-row items-center justify-center gap-2 bg-white rounded-2xl p-3 border border-surface-300 mb-3"
            accessible
            accessibilityRole="text"
            accessibilityLabel="Lesson completed"
          >
            <Icon name="check-circle" size={18} color={Colors.success} />
            <Text className="text-[14px] font-bold" style={{ color: Colors.success }}>
              Lesson completed
            </Text>
          </View>
        )}

        {/* Apply in conversation — the step that closes the loop */}
        <TouchableOpacity
          onPress={startConversation}
          accessibilityRole="button"
          accessibilityLabel={`${completed ? "Practice again" : "Practice in conversation"}: ${lesson.conversationScenario.goalEn}`}
          accessibilityHint="Double tap to start a voice conversation practicing this lesson"
          className="bg-primary rounded-2xl p-4 flex-row items-center justify-center gap-2"
        >
          <Icon name="mic" size={18} color={Colors.surfaceWhite} />
          <Text className="text-white text-[15px] font-bold">
            {completed ? "Practice again" : "Practice in conversation"}
          </Text>
        </TouchableOpacity>
        <Text className="text-[12px] text-center mt-2" style={{ color: Colors.gray500 }}>
          {completed
            ? `${lesson.conversationScenario.goalEn} — already completed; practice as often as you like.`
            : `${lesson.conversationScenario.goalEn} — finish the conversation (a few exchanges) to complete this lesson.`}
        </Text>
      </ScrollView>
    </>
  );
}
