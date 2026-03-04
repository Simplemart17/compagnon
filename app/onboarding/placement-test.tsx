import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";

import { useAuth } from "@/src/hooks/use-auth";
import { useAuthStore } from "@/src/store/auth-store";
import { captureError } from "@/src/lib/sentry";
import { chatCompletionJSON } from "@/src/lib/openai";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { LEVEL_COLORS } from "@/src/lib/constants";
import type { CEFRLevel } from "@/src/types/cefr";
import type { MCQContent } from "@/src/types/exercise";

/** Shape of a single placement question returned by the AI */
interface PlacementQuestion {
  level: CEFRLevel;
  question: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  explanation: string;
}

/** Shape of the full AI response */
interface PlacementResponse {
  questions: PlacementQuestion[];
}

/** CEFR level to question index mapping (1-indexed question numbers) */
const LEVEL_RANGES: { level: CEFRLevel; start: number; end: number }[] = [
  { level: "A1", start: 1, end: 2 },
  { level: "A2", start: 3, end: 5 },
  { level: "B1", start: 6, end: 8 },
  { level: "B2", start: 9, end: 11 },
  { level: "C1", start: 12, end: 14 },
  { level: "C2", start: 15, end: 15 },
];

const TOTAL_QUESTIONS = 15;

/** Resolve isCorrect from various AI response formats */
function resolveIsCorrect(option: Record<string, unknown>): boolean {
  // Direct boolean
  if (typeof option.isCorrect === "boolean") return option.isCorrect;
  if (typeof option.correct === "boolean") return option.correct;
  if (typeof option.is_correct === "boolean") return option.is_correct;

  // String "true"/"false"
  if (typeof option.isCorrect === "string") return option.isCorrect.toLowerCase() === "true";
  if (typeof option.correct === "string") return option.correct.toLowerCase() === "true";
  if (typeof option.is_correct === "string") return option.is_correct.toLowerCase() === "true";

  return false;
}

/** Determine the CEFR level for a given 1-indexed question number */
function levelForQuestion(questionNumber: number): CEFRLevel {
  for (const range of LEVEL_RANGES) {
    if (questionNumber >= range.start && questionNumber <= range.end) {
      return range.level;
    }
  }
  return "C2";
}

/** Previous level (for fallback when user fails at a level) */
function previousLevel(level: CEFRLevel): CEFRLevel {
  const order: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = order.indexOf(level);
  return idx > 0 ? order[idx - 1] : "A1";
}

const SYSTEM_PROMPT = `You are a French language placement test generator for the TCF (Test de Connaissance du Français) exam.

Generate exactly 15 multiple-choice questions testing French grammar and vocabulary.
The questions MUST increase in difficulty following CEFR levels:
- Questions 1-2: A1 level (basic greetings, articles, simple present tense)
- Questions 3-5: A2 level (past tense, object pronouns, everyday vocabulary)
- Questions 6-8: B1 level (subjunctive basics, relative pronouns, conditional)
- Questions 9-11: B2 level (complex subjunctive, passive voice, nuanced vocabulary)
- Questions 12-14: C1 level (literary tenses, advanced syntax, idiomatic expressions)
- Question 15: C2 level (subtle stylistic distinctions, rare grammatical forms)

Each question must have exactly 4 options with exactly 1 correct answer.
All questions and options must be in French. Explanations in English.

You MUST respond with this EXACT JSON structure:
{
  "questions": [
    {
      "question": "The question text in French",
      "options": [
        { "id": "a", "text": "Option text", "isCorrect": false },
        { "id": "b", "text": "Option text", "isCorrect": true },
        { "id": "c", "text": "Option text", "isCorrect": false },
        { "id": "d", "text": "Option text", "isCorrect": false }
      ],
      "explanation": "Explanation in English"
    }
  ]
}

CRITICAL: Each option object MUST have "isCorrect" as a boolean (true/false). Exactly ONE option per question must have "isCorrect": true. Do NOT use a separate "correct_answer" field.`;

// ─── Level congratulation phrases ────────────────────────────────────────────

const LEVEL_CONGRATS: Record<CEFRLevel, { phrase: string; sub: string }> = {
  A1: {
    phrase: "Bonjour !",
    sub: "You're at the beginning of a wonderful journey.",
  },
  A2: {
    phrase: "Très bien !",
    sub: "You have solid foundations to build upon.",
  },
  B1: {
    phrase: "Bravo !",
    sub: "You're a true intermediate — half way there.",
  },
  B2: {
    phrase: "Excellent !",
    sub: "You command French with impressive fluency.",
  },
  C1: {
    phrase: "Magnifique !",
    sub: "You speak French at an advanced academic level.",
  },
  C2: {
    phrase: "Parfait !",
    sub: "You have near-native mastery of the French language.",
  },
};

// ─── Loading pulse animation ──────────────────────────────────────────────────

function LoadingPulse() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: 120,
          height: 120,
          borderRadius: 60,
          borderWidth: 3,
          borderColor: "#F5A623",
          backgroundColor: "rgba(245,166,35,0.1)",
          justifyContent: "center",
          alignItems: "center",
        },
        animatedStyle,
      ]}
    >
      {/* Inner ring */}
      <View
        style={{
          width: 86,
          height: 86,
          borderRadius: 43,
          backgroundColor: "rgba(245,166,35,0.15)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    </Animated.View>
  );
}

// ─── Animated progress bar ────────────────────────────────────────────────────

interface ProgressBarProps {
  progress: number; // 0 to 1
}

function AnimatedProgressBar({ progress }: ProgressBarProps) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(progress, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%` as `${number}%`,
  }));

  return (
    <View
      style={{
        height: 4,
        backgroundColor: "rgba(255,255,255,0.2)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={[
          {
            height: 4,
            backgroundColor: "#F5A623",
            borderRadius: 2,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function PlacementTestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useAuth();
  const user = useAuthStore((s) => s.user);

  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testFinished, setTestFinished] = useState(false);
  const [determinedLevel, setDeterminedLevel] = useState<CEFRLevel>("A1");

  // Track wrong answers per level
  const [wrongPerLevel, setWrongPerLevel] = useState<Record<CEFRLevel, number>>({
    A1: 0,
    A2: 0,
    B1: 0,
    B2: 0,
    C1: 0,
    C2: 0,
  });

  // Whether the test was stopped early due to 2+ wrong at a level
  const [stoppedEarly, setStoppedEarly] = useState(false);

  // Generate questions on mount
  useEffect(() => {
    void generateQuestions(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateQuestions(attempt: number) {
    const MAX_RETRIES = 2;
    setIsLoading(true);
    setError(null);
    try {
      const response = await chatCompletionJSON<PlacementResponse>(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              'Generate a 15-question French placement test. Return JSON with a "questions" array.',
          },
        ],
        {
          model: "gpt-4o",
          temperature: 0.8,
          maxTokens: 4096,
        }
      );

      if (!response.questions || response.questions.length === 0) {
        throw new Error("No questions received from AI");
      }

      // Normalize: ensure every question has options as an array of {id, text, isCorrect}
      const normalized = response.questions.map((q) => {
        const raw = q as Record<string, unknown>;
        let opts: { id: string; text: string; isCorrect: boolean }[] = [];
        const rawOpts: unknown = q.options;

        // If options is an object like {a: "text", ...}, convert to array
        if (rawOpts && typeof rawOpts === "object" && !Array.isArray(rawOpts)) {
          opts = Object.entries(rawOpts as Record<string, unknown>).map(([key, val]) => ({
            id: key,
            text:
              typeof val === "string"
                ? val
                : (((val as Record<string, unknown>)?.text as string) ?? String(val)),
            isCorrect: false, // will be resolved below
          }));
        } else if (Array.isArray(rawOpts)) {
          // Ensure each option has the required shape
          opts = rawOpts.map((o: Record<string, unknown>, oi: number) => ({
            id:
              (o.id as string) ??
              (o.label as string)?.toLowerCase() ??
              String.fromCharCode(97 + oi),
            text:
              (o.text as string) ??
              (o.label as string) ??
              (o.value as string) ??
              (typeof o === "string" ? o : String(o)),
            isCorrect: resolveIsCorrect(o),
          }));
        }

        // If no option is marked correct, check for a question-level correct answer field
        // GPT often returns: correct_answer, answer, correctAnswer, correct, correctOption
        const hasCorrect = opts.some((o) => o.isCorrect === true);
        if (!hasCorrect && opts.length > 0) {
          const correctId = String(
            raw.correct_answer ??
              raw.answer ??
              raw.correctAnswer ??
              raw.correct ??
              raw.correctOption ??
              raw.correct_option ??
              ""
          )
            .toLowerCase()
            .trim();

          if (correctId) {
            opts = opts.map((o) => ({
              ...o,
              isCorrect: o.id === correctId || o.text === correctId,
            }));
          }

          // If still no correct option found, try matching by index (e.g., correctAnswer: 0)
          if (!opts.some((o) => o.isCorrect)) {
            const correctIdx = raw.correct_answer ?? raw.correctAnswer ?? raw.answer;
            if (typeof correctIdx === "number" && correctIdx >= 0 && correctIdx < opts.length) {
              opts[correctIdx].isCorrect = true;
            }
          }
        }

        return { ...q, options: opts };
      });

      // Validate: every question must have exactly 1 correct answer
      const valid = normalized.every(
        (q) => q.options.filter((o: { isCorrect: boolean }) => o.isCorrect).length === 1
      );
      if (!valid) {
        console.warn(
          "[placement-test] Some questions have 0 or >1 correct answers — retrying generation"
        );
        throw new Error("Invalid question format received. Retrying...");
      }

      setQuestions(normalized);
    } catch (err: unknown) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[placement-test] Attempt ${attempt + 1} failed, retrying...`);
        return generateQuestions(attempt + 1);
      }
      captureError(err, "placement-test", { attempt });
      const message = err instanceof Error ? err.message : "Failed to generate questions";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  /** Calculate final CEFR level based on wrong answers per level */
  const calculateLevel = useCallback(
    (
      wrongs: Record<CEFRLevel, number>,
      stopped: boolean,
      stoppedAtLevel?: CEFRLevel
    ): CEFRLevel => {
      const order: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

      if (stopped && stoppedAtLevel) {
        return previousLevel(stoppedAtLevel);
      }

      let highestPassed: CEFRLevel = "A1";
      for (const level of order) {
        if (wrongs[level] < 2) {
          highestPassed = level;
        } else {
          break;
        }
      }
      return highestPassed;
    },
    []
  );

  function handleSelect(answerId: string) {
    if (showResult) return;
    setSelectedAnswer(answerId);
    setShowResult(true);

    const currentQuestion = questions[currentIndex];
    const isCorrect = currentQuestion.options.some((o) => o.id === answerId && o.isCorrect);

    if (!isCorrect) {
      const questionLevel = levelForQuestion(currentIndex + 1);
      const updatedWrongs = {
        ...wrongPerLevel,
        [questionLevel]: wrongPerLevel[questionLevel] + 1,
      };
      setWrongPerLevel(updatedWrongs);

      if (updatedWrongs[questionLevel] >= 2) {
        setStoppedEarly(true);
        const level = calculateLevel(updatedWrongs, true, questionLevel);
        setDeterminedLevel(level);
      }
    }
  }

  async function handleNext() {
    if (stoppedEarly || currentIndex >= questions.length - 1) {
      if (!stoppedEarly) {
        const level = calculateLevel(wrongPerLevel, false);
        setDeterminedLevel(level);
      }
      setTestFinished(true);
      return;
    }

    setCurrentIndex((prev) => prev + 1);
    setSelectedAnswer(null);
    setShowResult(false);
  }

  async function handleFinish() {
    if (!user) return;

    setIsSubmitting(true);
    try {
      const { error: updateError } = await updateProfile({
        current_cefr_level: determinedLevel,
        onboarding_completed: true,
      });

      if (updateError) {
        throw updateError;
      }

      router.replace("/(tabs)/home");
    } catch (err: unknown) {
      captureError(err, "placement-test-save");
      // PostgrestError is not an Error instance but has a message property
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to save results";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Convert the current question to MCQContent for the MCQCard component
  const currentQuestion: MCQContent | null =
    questions.length > 0 && currentIndex < questions.length
      ? {
          question: questions[currentIndex].question,
          options: questions[currentIndex].options,
          explanation: questions[currentIndex].explanation,
        }
      : null;

  const currentQuestionLevel = questions.length > 0 ? levelForQuestion(currentIndex + 1) : "A1";

  const answeredCount = currentIndex + (showResult ? 1 : 0);

  // ── Loading State ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#1E3A5F",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 32,
        }}
      >
        {/* Layered dark overlay at top for depth */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 200,
            backgroundColor: "rgba(13,34,64,0.4)",
          }}
          pointerEvents="none"
        />

        <Text
          style={{
            color: "#F5A623",
            fontSize: 18,
            fontWeight: "800",
            letterSpacing: 2,
            marginBottom: 32,
          }}
        >
          Compagnon
        </Text>

        <LoadingPulse />

        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 22,
            fontWeight: "700",
            marginTop: 32,
            textAlign: "center",
          }}
        >
          Génération du test...
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 14,
            marginTop: 10,
            textAlign: "center",
            lineHeight: 21,
          }}
        >
          Notre IA génère des questions personnalisées{"\n"}pour déterminer votre niveau de
          français.
        </Text>
      </View>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────────
  if (error && questions.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F5F5F0",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 32,
        }}
      >
        {/* Error circle */}
        <View
          style={{
            width: 90,
            height: 90,
            borderRadius: 45,
            backgroundColor: "#FF3B30",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 24,
            shadowColor: "#FF3B30",
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Text style={{ fontSize: 36, color: "#FFFFFF", fontWeight: "800" }}>!</Text>
        </View>

        <Text
          style={{
            fontSize: 20,
            fontWeight: "700",
            color: "#1E3A5F",
            marginBottom: 10,
            textAlign: "center",
          }}
        >
          Une erreur est survenue
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: "#666666",
            marginBottom: 32,
            textAlign: "center",
            lineHeight: 21,
          }}
        >
          {error}
        </Text>

        <TouchableOpacity
          onPress={() => generateQuestions(0)}
          activeOpacity={0.85}
          style={{
            backgroundColor: "#1E3A5F",
            borderRadius: 14,
            paddingVertical: 16,
            paddingHorizontal: 40,
            shadowColor: "#1E3A5F",
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 5 },
            elevation: 6,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Results Screen ───────────────────────────────────────────────────────────
  if (testFinished) {
    const congrats = LEVEL_CONGRATS[determinedLevel];
    const levelColor = LEVEL_COLORS[determinedLevel];

    return (
      <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
        {/* Hero header — navy */}
        <View
          style={{
            backgroundColor: "#1E3A5F",
            paddingTop: insets.top + 24,
            paddingBottom: 70,
            alignItems: "center",
            paddingHorizontal: 24,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
            shadowColor: "#0D2240",
            shadowOpacity: 0.3,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          }}
        >
          {/* "Votre niveau" label */}
          <Text
            style={{
              color: "#F5A623",
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 3,
              marginBottom: 20,
            }}
          >
            VOTRE NIVEAU
          </Text>

          {/* Large CEFR badge circle */}
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: levelColor,
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 18,
              shadowColor: levelColor,
              shadowOpacity: 0.5,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 6 },
              elevation: 10,
            }}
          >
            <Text style={{ fontSize: 34, fontWeight: "800", color: "#FFFFFF" }}>
              {determinedLevel}
            </Text>
          </View>

          {/* Congratulation phrase */}
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 26,
              fontWeight: "800",
              marginBottom: 8,
              textAlign: "center",
            }}
          >
            {congrats.phrase}
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 14,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {congrats.sub}
          </Text>
        </View>

        {/* Scrollable results body */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 28,
            paddingHorizontal: 20,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Performance summary card */}
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 20,
              padding: 20,
              borderWidth: 1,
              borderColor: "#E0E0CE",
              shadowColor: "#1E3A5F",
              shadowOpacity: 0.07,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
              marginBottom: 20,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "800",
                color: "#1E3A5F",
                letterSpacing: 1,
                marginBottom: 16,
              }}
            >
              PERFORMANCE PAR NIVEAU
            </Text>

            {(["A1", "A2", "B1", "B2", "C1", "C2"] as CEFRLevel[]).map((level) => {
              const range = LEVEL_RANGES.find((r) => r.level === level);
              if (!range) return null;
              const totalAtLevel = range.end - range.start + 1;
              const questionsAnswered = Math.min(
                totalAtLevel,
                Math.max(0, answeredCount - range.start + 1)
              );
              if (questionsAnswered <= 0) return null;
              const wrong = wrongPerLevel[level];
              const correct = questionsAnswered - wrong;

              return (
                <View
                  key={level}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: "#F0F0EA",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View
                      style={{
                        backgroundColor: LEVEL_COLORS[level],
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        minWidth: 40,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
                        {level}
                      </Text>
                    </View>
                    {/* Mini progress bar */}
                    <View
                      style={{
                        width: 80,
                        height: 6,
                        backgroundColor: "#F0F0EA",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${(correct / questionsAnswered) * 100}%`,
                          height: 6,
                          backgroundColor: LEVEL_COLORS[level],
                          borderRadius: 3,
                        }}
                      />
                    </View>
                  </View>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: correct === questionsAnswered ? "#34C759" : "#333333",
                    }}
                  >
                    {correct}/{questionsAnswered}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Error message if saving failed */}
          {error && (
            <Text
              style={{
                color: "#FF3B30",
                fontSize: 14,
                marginBottom: 12,
                textAlign: "center",
              }}
            >
              {error}
            </Text>
          )}
        </ScrollView>

        {/* CTA button */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 16,
            paddingTop: 16,
            backgroundColor: "#F5F5F0",
            borderTopWidth: 1,
            borderTopColor: "rgba(0,0,0,0.06)",
          }}
        >
          <TouchableOpacity
            onPress={handleFinish}
            disabled={isSubmitting}
            activeOpacity={0.85}
            style={{
              backgroundColor: "#F5A623",
              borderRadius: 16,
              paddingVertical: 18,
              alignItems: "center",
              opacity: isSubmitting ? 0.7 : 1,
              shadowColor: "#F5A623",
              shadowOpacity: 0.35,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 17,
                  fontWeight: "700",
                  letterSpacing: 0.3,
                }}
              >
                Commencer l&apos;apprentissage !
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Question Screen ──────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: "#F5F5F0" }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: "#1E3A5F",
          paddingTop: insets.top + 16,
          paddingHorizontal: 24,
          paddingBottom: 20,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          shadowColor: "#0D2240",
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        {/* Row: label + counter */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              color: "#F5A623",
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 2,
            }}
          >
            TEST DE PLACEMENT
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.8)",
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {currentIndex + 1} / {TOTAL_QUESTIONS}
          </Text>
        </View>

        {/* Animated progress bar */}
        <AnimatedProgressBar progress={(currentIndex + 1) / TOTAL_QUESTIONS} />

        {/* CEFR level badge for current question */}
        <View style={{ marginTop: 14 }}>
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: LEVEL_COLORS[currentQuestionLevel],
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 12 }}>
              {currentQuestionLevel}
            </Text>
          </View>
        </View>
      </View>

      {/* Question card */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: showResult ? 100 : 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {currentQuestion && (
          <MCQCard
            question={currentQuestion}
            selectedAnswer={selectedAnswer}
            showResult={showResult}
            onSelect={handleSelect}
          />
        )}
      </ScrollView>

      {/* Next / Finish button */}
      {showResult && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 16,
            paddingTop: 16,
            backgroundColor: "#F5F5F0",
            borderTopWidth: 1,
            borderTopColor: "rgba(0,0,0,0.06)",
          }}
        >
          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.85}
            style={{
              backgroundColor: stoppedEarly ? "#F5A623" : "#1E3A5F",
              borderRadius: 16,
              paddingVertical: 18,
              alignItems: "center",
              shadowColor: stoppedEarly ? "#F5A623" : "#1E3A5F",
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 17,
                fontWeight: "700",
                letterSpacing: 0.3,
              }}
            >
              {stoppedEarly || currentIndex >= questions.length - 1
                ? "Voir les résultats"
                : "Question suivante →"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
