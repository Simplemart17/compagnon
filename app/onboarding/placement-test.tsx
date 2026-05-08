import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
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
import { placementTestSchema } from "@/src/lib/schemas/ai-responses";
import { MCQCard } from "@/src/components/practice/MCQCard";
import { LEVEL_COLORS } from "@/src/lib/constants";
import { Colors, Typography } from "@/src/lib/design";
import { useSlowLoading } from "@/src/hooks/use-slow-loading";
import { CEFR_LEVELS } from "@/src/types/cefr";
import type { CEFRLevel } from "@/src/types/cefr";
import type { MCQContent } from "@/src/types/exercise";

// Placement question shape is now `z.infer<typeof placementQuestionSchema>`
// from `src/lib/schemas/ai-responses.ts`. The schema's `.preprocess()` step
// covers all of the polymorphic-options normalization (object→array,
// `correct_answer` field → `isCorrect: true` on the matching option) that
// previously required ~30 lines of hand-rolled code at this call site.
// Story 9-7.
interface PlacementQuestion {
  level: CEFRLevel;
  question: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  explanation: string;
}

/** CEFR level to question index mapping (1-indexed question numbers)
 *  Distribution: A1:3, A2:3, B1:3, B2:3, C1:2, C2:1 = 15 total */
const LEVEL_RANGES: { level: CEFRLevel; start: number; end: number }[] = [
  { level: "A1", start: 1, end: 3 },
  { level: "A2", start: 4, end: 6 },
  { level: "B1", start: 7, end: 9 },
  { level: "B2", start: 10, end: 12 },
  { level: "C1", start: 13, end: 14 },
  { level: "C2", start: 15, end: 15 },
];

const TOTAL_QUESTIONS = 15;

// `resolveIsCorrect` (15 lines, deleted by story 9-7) is replaced by the
// `placementQuestionSchema.preprocess` + `placementOptionInputSchema.transform`
// pipeline in `src/lib/schemas/ai-responses.ts`, which handles all of the
// `correct`/`is_correct`/string-vs-boolean variants declaratively.

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

const SYSTEM_PROMPT = `You are an expert French language placement test generator aligned with the TCF (Test de Connaissance du Francais) exam standards and the CEFR framework.

Generate exactly 15 multiple-choice questions. Each question MUST test a DIFFERENT linguistic competency. Vary across these categories:
- Grammar (verb conjugation, agreement, tense usage, syntax)
- Vocabulary (contextual word choice, synonyms, collocations)
- Reading comprehension (short passage with inference question)
- Pragmatics (appropriate response in social context)

Question distribution by CEFR level (15 total):

Questions 1-3: A1 level (3 questions)
  - Competencies: definite/indefinite articles, present tense of etre/avoir/aller, basic greetings and politeness, cardinal numbers, gender agreement
  - Vocabulary: top-500 frequency words only (famille, maison, manger, jour, bonjour, etc.)
  - Distractors: common beginner confusions (le/la/les mix-ups, je suis/j'ai confusion, tu/vous errors)

Questions 4-6: A2 level (3 questions)
  - Competencies: passe compose with avoir and etre (auxiliary choice), direct/indirect object pronouns, near future (aller + infinitive), prepositions of place
  - Vocabulary: top-1000 frequency words (acheter, comprendre, voyage, travail, etc.)
  - Distractors: passe compose auxiliary errors (j'ai alle vs je suis alle), pronoun placement errors, gender/number agreement mistakes

Questions 7-9: B1 level (3 questions)
  - Competencies: imparfait vs passe compose, relative pronouns (qui/que/dont/ou), conditional present, basic subjunctive after il faut que
  - Vocabulary: top-3000 frequency words, abstract nouns (experience, developpement, responsabilite)
  - Distractors: imparfait/passe compose confusion in context, wrong relative pronoun choice, conditional/future mix-ups

Questions 10-12: B2 level (3 questions)
  - Competencies: subjunctive in subordinate clauses (bien que, pour que, avant que), passive voice, concession/opposition connectors, plus-que-parfait
  - Vocabulary: top-5000 frequency words, formal register (neanmoins, en revanche, s'averer)
  - Distractors: indicative where subjunctive is needed, incorrect connector choice, register-inappropriate vocabulary

Questions 13-14: C1 level (2 questions)
  - Competencies: literary tenses (passe simple recognition), advanced syntax (mise en relief, inversion), nuanced connector usage (quoique, en depit de, force est de constater)
  - Vocabulary: academic and literary register (apprehender, corroborer, inherent)
  - Distractors: near-synonyms with subtle meaning differences, formal vs literary register confusion

Question 15: C2 level (1 question)
  - Competencies: subtle stylistic distinctions, rare grammatical forms (subjonctif plus-que-parfait, ne expletif), literary/rhetorical devices
  - Vocabulary: rare or highly specialized expressions, proverbs, double-meaning words
  - Distractors: plausible but subtly incorrect collocations, archaic vs modern usage

IMPORTANT RULES FOR DISTRACTORS:
- Every wrong answer must be a PLAUSIBLE mistake a learner at that level would actually make
- Never include obviously absurd or ungrammatical options that can be eliminated without knowing French
- For grammar questions, distractors should reflect real interference errors (L1 transfer, overgeneralization)
- The correct answer position (a/b/c/d) should be varied across questions -- do NOT always put it in the same slot

EXPLANATION REQUIREMENTS:
- Each explanation must be 1-2 sentences in English
- State WHY the correct answer is right (cite the grammar rule or usage pattern)
- Briefly note what common mistake the distractors represent

All questions and options must be written entirely in French. Explanations in English.
Each question must have exactly 4 options with exactly 1 correct answer.

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
      "explanation": "Brief explanation in English stating the rule and why distractors are wrong."
    }
  ]
}

CRITICAL: Each option object MUST have "isCorrect" as a boolean (true/false). Exactly ONE option per question must have "isCorrect": true. Do NOT use a separate "correct_answer" field.`;

// --- Level congratulation phrases ---

const LEVEL_CONGRATS: Record<CEFRLevel, { phrase: string; sub: string }> = {
  A1: {
    phrase: "Bonjour !",
    sub: "You're at the beginning of a wonderful journey.",
  },
  A2: {
    phrase: "Tr\u00e8s bien !",
    sub: "You have solid foundations to build upon.",
  },
  B1: {
    phrase: "Bravo !",
    sub: "You're a true intermediate -- half way there.",
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

/** Build a textual summary of test results for the results screen */
function buildResultsSummary(
  determined: CEFRLevel,
  wrongs: Record<CEFRLevel, number>,
  corrects: Record<CEFRLevel, number>,
  stopped: boolean
): { masteryLevel: CEFRLevel | null; struggleLevel: CEFRLevel | null; summary: string } {
  const order: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

  // Mastery = highest level with all questions correct
  let masteryLevel: CEFRLevel | null = null;
  for (const level of order) {
    const range = LEVEL_RANGES.find((r) => r.level === level);
    if (!range) continue;
    const totalAtLevel = range.end - range.start + 1;
    // Only count levels that were fully attempted
    if (corrects[level] + wrongs[level] >= totalAtLevel && wrongs[level] === 0) {
      masteryLevel = level;
    }
  }

  // Struggle = first level where 2+ errors occurred
  let struggleLevel: CEFRLevel | null = null;
  for (const level of order) {
    const attempted = corrects[level] + wrongs[level];
    if (attempted > 0 && wrongs[level] >= 2) {
      struggleLevel = level;
      break;
    }
  }

  // Build natural language summary
  let summary: string;
  if (determined === "C2") {
    summary =
      "Outstanding performance across all levels. You demonstrate near-native mastery of French.";
  } else if (determined === "C1") {
    summary = "You showed strong advanced skills. Some C2-level nuances remain to be mastered.";
  } else if (masteryLevel && struggleLevel) {
    summary = `You showed strong ${masteryLevel} skills and some ${determined} knowledge. Errors began at the ${struggleLevel} level.`;
  } else if (masteryLevel) {
    summary = `You demonstrated solid mastery at ${masteryLevel}${stopped ? ". The test stopped early to avoid unnecessary difficulty." : ` and partial ${determined} ability.`}`;
  } else {
    summary = `You showed emerging ${determined} skills. Practice will help you build a stronger foundation.`;
  }

  return { masteryLevel, struggleLevel, summary };
}

/** Status label for a level in the results screen */
function getLevelStatusLabel(
  level: CEFRLevel,
  correct: number,
  total: number,
  determined: CEFRLevel,
  masteryLevel: CEFRLevel | null,
  struggleLevel: CEFRLevel | null
): { text: string; color: string } | null {
  const order: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const levelIdx = order.indexOf(level);
  const determinedIdx = order.indexOf(determined);

  if (correct === total && total > 0) {
    return { text: "Mastered", color: Colors.success };
  }
  if (level === struggleLevel) {
    return { text: "Needs work", color: Colors.warning };
  }
  if (levelIdx > determinedIdx) {
    return null; // Not reached
  }
  if (correct > 0 && correct < total) {
    return { text: "Partial", color: Colors.accentText };
  }
  return null;
}

// --- Shimmer skeleton bar ---

interface SkeletonBarProps {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: Record<string, unknown>;
}

function SkeletonBar({ width, height, borderRadius = 6, style }: SkeletonBarProps) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: Colors.whiteAlpha15,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

// --- Loading skeleton screen ---

function LoadingSkeleton() {
  return (
    <View className="flex-1 px-5 pt-8">
      {/* Fake question text lines */}
      <SkeletonBar width="90%" height={16} style={{ marginBottom: 8 }} />
      <SkeletonBar width="70%" height={16} style={{ marginBottom: 24 }} />

      {/* Fake option cards */}
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          className="flex-row items-center rounded-xl p-[14px] mb-[10px] gap-3"
          style={{
            backgroundColor: Colors.whiteAlpha06,
            borderWidth: 1,
            borderColor: Colors.whiteAlpha08,
          }}
        >
          <SkeletonBar width={32} height={32} borderRadius={16} />
          <SkeletonBar width="70%" height={14} />
        </View>
      ))}
    </View>
  );
}

// --- Loading pulse animation ---

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
          borderColor: Colors.accent,
          backgroundColor: Colors.accent10,
          justifyContent: "center",
          alignItems: "center",
        },
        animatedStyle,
      ]}
    >
      {/* Inner ring */}
      <View
        className="w-[86px] h-[86px] rounded-[43px] justify-center items-center"
        style={{ backgroundColor: Colors.accent15 }}
      >
        <Text style={{ fontSize: Typography.display.fontSize, color: Colors.accent }}>?</Text>
      </View>
    </Animated.View>
  );
}

// --- Animated progress bar ---

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
    <View className="h-1 bg-white/20 rounded-full overflow-hidden">
      <Animated.View
        style={[
          {
            height: 4,
            backgroundColor: Colors.accent,
            borderRadius: 2,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

// --- Main component ---

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
  const isSlow = useSlowLoading(isLoading);
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

  // Track correct answers per level (for results summary)
  const [correctPerLevel, setCorrectPerLevel] = useState<Record<CEFRLevel, number>>({
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
      // The schema's `.preprocess()` handles polymorphic options shapes
      // (object-vs-array, `correct_answer` field → `isCorrect: true`).
      // Per story 9-7, we use `parseRetries: 2` to reflect the high stakes
      // of this single-shot placement test. The outer `MAX_RETRIES` loop
      // remains as an AI-quality fallback (e.g., model returns the wrong
      // CEFR distribution). Two layers, deliberately separate.
      const response = await chatCompletionJSON(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              'Generate a 15-question French placement test covering grammar, vocabulary, reading comprehension, and pragmatics. Distribute: A1(3), A2(3), B1(3), B2(3), C1(2), C2(1). Vary the correct answer position. Return JSON with a "questions" array.',
          },
        ],
        placementTestSchema,
        {
          model: "gpt-4o",
          temperature: 0.5,
          maxTokens: 4096,
          feature: "placement-test",
          parseRetries: 2,
        }
      );

      // Schema enforced 15 questions, exactly 1 correct per question, all
      // shapes well-formed. No further normalization needed — the
      // preprocess step in `placementQuestionSchema` already mapped
      // object-options to array, resolved `correct_answer` to
      // `isCorrect: true`, etc.
      //
      // The `as PlacementQuestion[]` cast is structurally safe: the schema's
      // output (verified by `z.infer<typeof placementTestSchema>` in
      // tests) matches `PlacementQuestion[]` exactly. The cast is required
      // because Zod's `preprocess + transform` chain infers the questions
      // array element as `unknown` at the `z.ZodType<T>` boundary —
      // tracked as a known Zod inference quirk for ZodEffects, not a
      // runtime correctness issue.
      setQuestions(response.questions as PlacementQuestion[]);
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

    const currentQ = questions[currentIndex];
    const isCorrect = currentQ.options.some((o) => o.id === answerId && o.isCorrect);
    const questionLevel = levelForQuestion(currentIndex + 1);

    if (isCorrect) {
      setCorrectPerLevel((prev) => ({
        ...prev,
        [questionLevel]: prev[questionLevel] + 1,
      }));
    } else {
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

  // -- Loading State --
  if (isLoading) {
    return (
      <View className="flex-1 bg-primary">
        {/* Header area with branding + pulse */}
        <View className="items-center px-8 pb-7" style={{ paddingTop: insets.top + 24 }}>
          <Text className="text-accent text-[11px] font-extrabold tracking-[2px] mb-5">
            TEST DE PLACEMENT
          </Text>

          <LoadingPulse />

          <Text
            className="text-white text-xl font-bold mt-6 text-center"
            accessibilityRole="header"
          >
            Preparing your test...
          </Text>
          <Text className="text-white/55 text-sm mt-2 text-center leading-[21px]">
            15 questions across 6 CEFR levels
          </Text>
        </View>

        {/* Skeleton preview of question card */}
        <LoadingSkeleton />
        {isSlow && (
          <Text
            style={[
              Typography.caption,
              { textAlign: "center", marginTop: 8, color: Colors.textOnDarkQuaternary },
            ]}
          >
            Taking longer than usual...
          </Text>
        )}
      </View>
    );
  }

  // -- Error State --
  if (error && questions.length === 0) {
    return (
      <View className="flex-1 bg-surface justify-center items-center px-8">
        {/* Error circle */}
        <View
          className="w-[90px] h-[90px] rounded-[45px] bg-error justify-center items-center mb-6"
          style={{
            shadowColor: Colors.error,
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Text className="text-4xl text-white font-extrabold">!</Text>
        </View>

        <Text
          className="text-xl font-bold text-primary mb-[10px] text-center"
          accessibilityRole="header"
        >
          Une erreur est survenue
        </Text>
        <Text
          className="text-sm mb-8 text-center leading-[21px]"
          style={{ color: Colors.textSecondary }}
        >
          We could not load the placement test. Please check your internet connection and try again.
        </Text>

        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="rounded-[14px] py-4 px-8"
            style={{ backgroundColor: Colors.gray100 }}
          >
            <Text className="text-base font-bold" style={{ color: Colors.primary }}>
              Retour
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => generateQuestions(0)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Retry generating placement test"
            className="bg-primary rounded-[14px] py-4 px-8"
            style={{
              shadowColor: Colors.primary,
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 5 },
              elevation: 6,
            }}
          >
            <Text className="text-white text-base font-bold">Réessayer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // -- Results Screen --
  if (testFinished) {
    const congrats = LEVEL_CONGRATS[determinedLevel];
    const levelColor = LEVEL_COLORS[determinedLevel];
    const { masteryLevel, struggleLevel, summary } = buildResultsSummary(
      determinedLevel,
      wrongPerLevel,
      correctPerLevel,
      stoppedEarly
    );

    return (
      <View className="flex-1 bg-surface">
        {/* Hero header -- navy */}
        <View
          className="bg-primary items-center px-6"
          style={{
            paddingTop: insets.top + 24,
            paddingBottom: 70,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
            shadowColor: Colors.bgDark,
            shadowOpacity: 0.3,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          }}
        >
          {/* "Votre niveau" label */}
          <Text className="text-accent text-[11px] font-extrabold tracking-[3px] mb-5">
            VOTRE NIVEAU
          </Text>

          {/* Large CEFR badge circle */}
          <View
            className="w-[100px] h-[100px] rounded-full justify-center items-center mb-[18px]"
            accessibilityLabel={`Your level is ${determinedLevel}`}
            style={{
              backgroundColor: levelColor,
              shadowColor: levelColor,
              shadowOpacity: 0.5,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 6 },
              elevation: 10,
            }}
          >
            <Text className="text-[34px] font-extrabold text-white">{determinedLevel}</Text>
          </View>

          {/* Congratulation phrase */}
          <Text
            className="text-white text-[26px] font-extrabold mb-2 text-center"
            accessibilityRole="header"
          >
            {congrats.phrase}
          </Text>
          <Text className="text-white/65 text-sm text-center leading-5">{congrats.sub}</Text>
        </View>

        {/* Scrollable results body */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingTop: 28,
            paddingHorizontal: 20,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary card */}
          <View
            className="bg-white rounded-[20px] p-5 mb-4"
            style={{
              borderWidth: 1,
              borderColor: Colors.border,
              shadowColor: Colors.primary,
              shadowOpacity: 0.07,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text
              className="text-[13px] font-extrabold text-primary tracking-[1px] mb-3"
              accessibilityRole="header"
            >
              ANALYSIS
            </Text>
            <Text
              className="text-[15px] leading-[22px] mb-[14px]"
              style={{ color: Colors.textPrimary }}
            >
              {summary}
            </Text>

            {/* Mastery / Struggle indicators */}
            <View className="flex-row gap-[10px] flex-wrap">
              {masteryLevel && (
                <View
                  className="flex-row items-center rounded-[10px] px-3 py-[7px] gap-[6px]"
                  style={{ backgroundColor: Colors.success10 }}
                >
                  <Text className="text-sm">&#10003;</Text>
                  <Text className="text-[13px] font-semibold" style={{ color: Colors.success }}>
                    {masteryLevel} mastered
                  </Text>
                </View>
              )}
              {struggleLevel && (
                <View
                  className="flex-row items-center rounded-[10px] px-3 py-[7px] gap-[6px]"
                  style={{ backgroundColor: Colors.accent10 }}
                >
                  <Text className="text-sm">&#9888;</Text>
                  <Text className="text-[13px] font-semibold" style={{ color: Colors.accentDark }}>
                    {struggleLevel} needs practice
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Performance per-level card */}
          <View
            className="bg-white rounded-[20px] p-5 mb-5"
            style={{
              borderWidth: 1,
              borderColor: Colors.border,
              shadowColor: Colors.primary,
              shadowOpacity: 0.07,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text
              className="text-[13px] font-extrabold text-primary tracking-[1px] mb-4"
              accessibilityRole="header"
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
              const statusLabel = getLevelStatusLabel(
                level,
                correct,
                questionsAnswered,
                determinedLevel,
                masteryLevel,
                struggleLevel
              );

              return (
                <View
                  key={level}
                  className="flex-row items-center justify-between py-[10px]"
                  accessibilityLabel={`${level}: ${correct} of ${questionsAnswered} correct${statusLabel ? `, ${statusLabel.text}` : ""}`}
                  style={{ borderBottomWidth: 1, borderBottomColor: Colors.gray200 }}
                >
                  <View className="flex-row items-center gap-[10px]">
                    <View
                      className="px-[10px] py-1 rounded-lg min-w-[40px] items-center"
                      style={{ backgroundColor: LEVEL_COLORS[level] }}
                    >
                      <Text className="text-white font-bold text-xs">{level}</Text>
                    </View>
                    {/* Mini progress bar */}
                    <View
                      className="w-20 h-[6px] rounded-full overflow-hidden"
                      style={{ backgroundColor: Colors.gray200 }}
                    >
                      <View
                        className="h-[6px] rounded-full"
                        style={{
                          width: `${(correct / questionsAnswered) * 100}%`,
                          backgroundColor: LEVEL_COLORS[level],
                        }}
                      />
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2">
                    {statusLabel && (
                      <Text
                        className="text-[11px] font-semibold"
                        style={{ color: statusLabel.color }}
                      >
                        {statusLabel.text}
                      </Text>
                    )}
                    <Text
                      className="text-sm font-semibold min-w-[30px] text-right"
                      style={{
                        color: correct === questionsAnswered ? Colors.success : Colors.textPrimary,
                      }}
                    >
                      {correct}/{questionsAnswered}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Error message if saving failed */}
          {error && (
            <Text className="text-error text-sm mb-3 text-center">
              Could not save your results. Tap &quot;Commencer&quot; to try again.
            </Text>
          )}
        </ScrollView>

        {/* CTA button */}
        <View
          className="absolute bottom-0 left-0 right-0 px-5 pt-4 bg-surface border-t border-black/[0.06]"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <TouchableOpacity
            onPress={handleFinish}
            disabled={isSubmitting}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={isSubmitting ? "Saving results" : "Start learning"}
            accessibilityState={{ disabled: isSubmitting }}
            className="bg-accent rounded-2xl py-[18px] items-center"
            style={{
              opacity: isSubmitting ? 0.7 : 1,
              shadowColor: Colors.accent,
              shadowOpacity: 0.35,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Text className="text-white text-[17px] font-bold tracking-wide">
              {isSubmitting ? "Saving..." : "Commencer l'apprentissage !"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // -- Question Screen --
  return (
    <View className="flex-1 bg-surface">
      {/* Header */}
      <View
        className="bg-primary px-6 pb-5"
        style={{
          paddingTop: insets.top + 16,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          shadowColor: Colors.bgDark,
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        {/* Row: label + counter */}
        <View className="flex-row justify-between items-center mb-[14px]">
          <Text
            className="text-accent text-[11px] font-extrabold tracking-[2px]"
            accessibilityRole="header"
          >
            TEST DE PLACEMENT
          </Text>
          <Text
            className="text-white/80 text-[13px] font-semibold"
            accessibilityLabel={`Question ${currentIndex + 1} of ${TOTAL_QUESTIONS}`}
          >
            Question {currentIndex + 1} of {TOTAL_QUESTIONS}
          </Text>
        </View>

        {/* Animated progress bar */}
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: TOTAL_QUESTIONS,
            now: currentIndex + 1,
          }}
        >
          <AnimatedProgressBar progress={(currentIndex + 1) / TOTAL_QUESTIONS} />
        </View>

        {/* CEFR level badge + name for current question */}
        <View
          className="mt-[14px] flex-row items-center gap-2"
          accessibilityLabel={`Level ${currentQuestionLevel}, ${CEFR_LEVELS[currentQuestionLevel].name}`}
        >
          <View
            className="px-3 py-[5px] rounded-[20px]"
            style={{ backgroundColor: LEVEL_COLORS[currentQuestionLevel] }}
          >
            <Text className="text-white font-bold text-xs">{currentQuestionLevel}</Text>
          </View>
          <Text className="text-white/55 text-xs font-medium">
            {CEFR_LEVELS[currentQuestionLevel].name}
          </Text>
        </View>
      </View>

      {/* Question card */}
      <ScrollView
        className="flex-1"
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
          className="absolute bottom-0 left-0 right-0 px-5 pt-4 bg-surface border-t border-black/[0.06]"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              stoppedEarly || currentIndex >= questions.length - 1
                ? "View results"
                : "Next question"
            }
            className="rounded-2xl py-[18px] items-center"
            style={{
              backgroundColor: stoppedEarly ? Colors.accent : Colors.primary,
              shadowColor: stoppedEarly ? Colors.accent : Colors.primary,
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Text className="text-white text-[17px] font-bold tracking-wide">
              {stoppedEarly || currentIndex >= questions.length - 1
                ? "Voir les résultats"
                : "Question suivante \u2192"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
