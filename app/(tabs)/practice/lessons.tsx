/**
 * Curriculum lesson list — Story 19-2 (lesson engine, slice 1).
 *
 * The learner's "what do I do today" surface for the Epic 19 spine: units
 * in pedagogical order, each lesson a ListItemCard with completion state
 * and a highlighted resume pointer (the first uncompleted spine lesson).
 * Unlock gating via the promotion engine is a later 19.2 slice — every
 * shipped lesson is tappable in slice 1.
 */

import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import { Icon } from "@/src/components/common/Icon";
import { ListItemCard } from "@/src/components/common/ListItemCard";
import { CURRICULUM_UNITS } from "@/src/lib/curriculum";
import { getCompletedLessonIds, nextLessonForUser } from "@/src/lib/lesson-progress";
import { Colors } from "@/src/lib/design";
import { useAuthStore } from "@/src/store/auth-store";

export default function LessonsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  // Refetch on focus so a lesson completed via the conversation flow shows
  // its checkmark when the learner returns.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (user?.id) {
        void getCompletedLessonIds(user.id).then((ids) => {
          if (active) setCompletedIds(ids);
        });
      }
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  const resumeLesson = nextLessonForUser(completedIds);

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <Text className="text-[13px] mb-4" style={{ color: Colors.gray700 }}>
        Lessons build on each other — each one ends with a conversation that practices exactly what
        you just learned.
      </Text>

      {CURRICULUM_UNITS.map((unit) => (
        <View key={unit.id} className="mb-6">
          <Text className="text-lg font-bold text-primary" accessibilityRole="header">
            {unit.titleEn}
          </Text>
          <Text className="text-[13px] mb-3" style={{ color: Colors.gray500 }}>
            {unit.titleFr} · {unit.level}
          </Text>

          <View className="gap-3">
            {[...unit.lessons]
              .sort((a, b) => a.order - b.order)
              .map((lesson, index) => {
                const completed = completedIds.has(lesson.id);
                const isNext = resumeLesson?.id === lesson.id;
                return (
                  <ListItemCard
                    key={lesson.id}
                    titlePrimary={lesson.canDoEn}
                    titleSecondary={lesson.canDoFr}
                    description={lesson.grammarTarget}
                    leftStripColor={completed ? Colors.success : isNext ? Colors.accent : undefined}
                    rightContent={
                      completed ? (
                        <Icon
                          name="check-circle"
                          size={20}
                          color={Colors.success}
                          accessibilityLabel="Completed"
                        />
                      ) : isNext ? (
                        <View className="bg-accent/25 rounded-full px-2 py-0.5">
                          <Text className="text-[10px] font-bold" style={{ color: Colors.accent }}>
                            NEXT
                          </Text>
                        </View>
                      ) : undefined
                    }
                    delay={index * 80}
                    onPress={() =>
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed-routes lag for the new dynamic route
                      router.push(`/(tabs)/practice/lesson/${lesson.id}` as any)
                    }
                    accessibilityLabel={`Lesson ${lesson.order}: ${lesson.canDoEn}. ${
                      completed ? "Completed." : isNext ? "Up next." : ""
                    }`}
                    accessibilityHint="Double tap to open this lesson"
                  />
                );
              })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
