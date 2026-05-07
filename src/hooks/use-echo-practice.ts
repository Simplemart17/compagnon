/**
 * Echo Practice Hook
 *
 * Manages a multi-step echo practice exercise: listen → speak → type.
 * Each sentence is scored on listening comprehension, pronunciation, and spelling.
 * Follows the same patterns as useDictation for state management and error handling.
 */

import { useState, useCallback, useRef, useMemo } from "react";

import { useAuthStore } from "@/src/store/auth-store";
import { useAudioPlayer } from "@/src/hooks/use-audio-player";
import { usePronunciation } from "@/src/hooks/use-pronunciation";
import type { UsePronunciationReturn } from "@/src/hooks/use-pronunciation";
import { compareSentences, analyzeErrorPatterns } from "@/src/hooks/use-dictation";
import type { WordResult, SentenceResult } from "@/src/hooks/use-dictation";
import { generateEchoExercise } from "@/src/lib/echo-generation";
import type { EchoSentenceWithAudio } from "@/src/lib/echo-generation";
import { generateSpeech } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { updateStreak, updateSkillProgress, incrementDailyActivity } from "@/src/lib/activity";
import { extractErrorsFromCorrections } from "@/src/lib/error-tracker";
import { captureError } from "@/src/lib/sentry";
import { classifyError } from "@/src/lib/error-messages";
import { hapticLight, hapticSuccess, hapticError } from "@/src/lib/haptics";
import type { CEFRLevel } from "@/src/types/cefr";
import type { PronunciationResult } from "@/src/lib/pronunciation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EchoPracticeScreenState =
  | "idle"
  | "generating"
  | "listen"
  | "speak"
  | "type"
  | "checking"
  | "results";

export interface EchoPracticeSentenceResult {
  sentence: EchoSentenceWithAudio;
  pronunciationResult: PronunciationResult | null;
  spellingResult: { wordResults: WordResult[]; accuracy: number; isFullyCorrect: boolean };
  listeningScore: number;
  pronunciationScore: number;
  spellingScore: number;
}

export interface UseEchoPracticeReturn {
  // State
  screenState: EchoPracticeScreenState;
  sentences: EchoSentenceWithAudio[];
  currentIndex: number;
  currentSentence: EchoSentenceWithAudio | null;
  userInput: string;
  sentenceResults: EchoPracticeSentenceResult[];
  currentPronunciationResult: PronunciationResult | null;
  generateError: string | null;
  offlineFallback: boolean;
  hasPlayed: boolean;
  isSavingResults: boolean;
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  pronunciation: UsePronunciationReturn;

  // Computed
  overallAccuracy: number;
  fullyCorrectCount: number;
  errorPatterns: string[];
  sentenceCount: number;
  getElapsedMinutes: () => number;

  // Actions
  setUserInput: (text: string) => void;
  generateExercise: () => Promise<void>;
  playSentence: (speed?: number) => Promise<void>;
  advanceToSpeak: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  advanceToType: () => void;
  checkSpelling: () => void;
  nextSentence: () => Promise<void>;
  skipSentence: () => void;
  tryAgain: () => void;
  clearOfflineFallback: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEchoPractice(): UseEchoPracticeReturn {
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const audioPlayer = useAudioPlayer();
  const pronunciation = usePronunciation();

  // State
  const [screenState, setScreenState] = useState<EchoPracticeScreenState>("idle");
  const [sentences, setSentences] = useState<EchoSentenceWithAudio[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [sentenceResults, setSentenceResults] = useState<EchoPracticeSentenceResult[]>([]);
  const [currentPronunciationResult, setCurrentPronunciationResult] =
    useState<PronunciationResult | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);

  // Refs
  const startTimeRef = useRef<number>(Date.now());
  const isGeneratingRef = useRef(false);
  const exerciseIdRef = useRef<string | null>(null);
  const slowAudioCacheRef = useRef<Map<number, string>>(new Map());
  const sentenceResultsRef = useRef<EchoPracticeSentenceResult[]>([]);
  sentenceResultsRef.current = sentenceResults;

  const currentSentence = sentences[currentIndex] ?? null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const generateExercise = useCallback(async () => {
    if (isGeneratingRef.current || !user?.id) return;
    isGeneratingRef.current = true;

    setScreenState("generating");
    setGenerateError(null);
    setOfflineFallback(false);
    setSentences([]);
    setCurrentIndex(0);
    setUserInput("");
    setSentenceResults([]);
    setCurrentPronunciationResult(null);
    setHasPlayed(false);
    slowAudioCacheRef.current.clear();
    startTimeRef.current = Date.now();

    try {
      const result = await generateEchoExercise({ cefrLevel, userId: user.id });
      setSentences(result.sentences);
      exerciseIdRef.current = result.exerciseId;
      setScreenState("listen");
    } catch (err) {
      captureError(err, "echo-practice-generate");
      const classified = classifyError(err, "Could not generate exercise. Please try again.");
      if (classified.category === "network") {
        setOfflineFallback(true);
        setGenerateError(null);
      } else {
        setGenerateError(classified.message);
      }
      setScreenState("idle");
      hapticError();
    } finally {
      isGeneratingRef.current = false;
    }
  }, [cefrLevel, user?.id]);

  const playSentence = useCallback(
    async (speed: number = 1.0) => {
      if (!currentSentence) return;

      try {
        if (speed === 1.0) {
          // Use pre-generated audio
          await audioPlayer.playFromBase64(currentSentence.audioBase64, "mp3");
        } else {
          // Slow speed — generate on-demand, cache in ref
          let slowBase64 = slowAudioCacheRef.current.get(currentIndex);
          if (!slowBase64) {
            slowBase64 = await generateSpeech(currentSentence.sentence, {
              speed: 0.75,
            });
            slowAudioCacheRef.current.set(currentIndex, slowBase64);
          }
          await audioPlayer.playFromBase64(slowBase64, "mp3");
        }
        setHasPlayed(true);
        hapticLight();
      } catch (err) {
        captureError(err, "echo-practice-listen");
        hapticError();
      }
    },
    [currentSentence, currentIndex, audioPlayer]
  );

  const advanceToSpeak = useCallback(() => {
    if (!hasPlayed) return;
    setScreenState("speak");
    hapticLight();
  }, [hasPlayed]);

  const startRecording = useCallback(async () => {
    try {
      setCurrentPronunciationResult(null);
      await pronunciation.startAssessment();
    } catch (err) {
      captureError(err, "echo-practice-speak");
    }
  }, [pronunciation]);

  const stopRecording = useCallback(async () => {
    if (!currentSentence) return;
    try {
      const result = await pronunciation.finishAssessment(currentSentence.sentence);
      if (result) {
        setCurrentPronunciationResult(result);
      }
      // If result is null, pronunciation hook already sets its own error state
    } catch (err) {
      captureError(err, "echo-practice-speak");
    }
  }, [pronunciation, currentSentence]);

  const advanceToType = useCallback(() => {
    if (!currentPronunciationResult) return;
    setScreenState("type");
    hapticLight();
  }, [currentPronunciationResult]);

  const checkSpelling = useCallback(() => {
    if (
      screenState !== "type" ||
      !currentSentence ||
      !currentPronunciationResult ||
      userInput.trim().length === 0
    )
      return;

    const spellingResult = compareSentences(currentSentence.expectedSpelling, userInput.trim());

    const result: EchoPracticeSentenceResult = {
      sentence: currentSentence,
      pronunciationResult: currentPronunciationResult,
      spellingResult,
      listeningScore: currentPronunciationResult.accuracyScore,
      pronunciationScore: currentPronunciationResult.overallScore,
      spellingScore: spellingResult.accuracy,
    };

    setSentenceResults((prev) => [...prev, result]);
    setScreenState("checking");

    if (result.listeningScore > 80 && result.pronunciationScore > 80 && result.spellingScore > 80) {
      hapticSuccess();
    } else {
      hapticLight();
    }
  }, [screenState, currentSentence, currentPronunciationResult, userInput]);

  const nextSentence = useCallback(async () => {
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setUserInput("");
      setHasPlayed(false);
      setCurrentPronunciationResult(null);
      setScreenState("listen");
      hapticLight();
    } else {
      // Last sentence — save results
      setIsSavingResults(true);
      setScreenState("results");
      hapticSuccess();

      if (user?.id) {
        try {
          // Read from ref to avoid stale closure — checkSpelling may have
          // appended the last result after this callback was memoized
          const allResults = [...sentenceResultsRef.current];
          const count = allResults.length;
          const avgListening =
            count > 0
              ? Math.round(allResults.reduce((sum, r) => sum + r.listeningScore, 0) / count)
              : 0;
          const avgPronunciation =
            count > 0
              ? Math.round(allResults.reduce((sum, r) => sum + r.pronunciationScore, 0) / count)
              : 0;
          const avgSpelling =
            count > 0
              ? Math.round(allResults.reduce((sum, r) => sum + r.spellingScore, 0) / count)
              : 0;
          const now = Date.now();
          const elapsed = Math.max(1, Math.round((now - startTimeRef.current) / 60000));
          const overallScore = Math.round((avgListening + avgPronunciation + avgSpelling) / 3);
          const timeSpentSeconds = Math.round((now - startTimeRef.current) / 1000);

          await Promise.all([
            updateSkillProgress(user.id, "listening", avgListening, elapsed),
            updateSkillProgress(user.id, "speaking", avgPronunciation, elapsed),
            incrementDailyActivity(user.id, { minutes: elapsed, exercises: 1 }),
            updateStreak(user.id),
          ]);

          // Update exercise record
          if (exerciseIdRef.current) {
            await supabase
              .from("exercises")
              .update({
                completed: true,
                score: overallScore,
                time_spent_seconds: timeSpentSeconds,
                completed_at: new Date().toISOString(),
              })
              .eq("id", exerciseIdRef.current);
          }

          // Error pattern tracking — batch spelling + pronunciation errors
          try {
            const spellingCorrections = allResults.flatMap((r) =>
              r.spellingResult.wordResults
                .filter((wr) => wr.status !== "correct")
                .map((wr) => ({
                  original: wr.typed ?? "(missing)",
                  corrected: wr.word,
                  explanation: wr.status === "missing" ? "Word was missed" : "Spelling error",
                  category: "vocabulary",
                }))
            );

            const pronunciationCorrections = allResults.flatMap((r) => {
              if (!r.pronunciationResult) return [];
              return r.pronunciationResult.words
                .filter((w) => w.errorType !== "None")
                .map((w) => ({
                  original: w.errorType === "Omission" ? "(omitted)" : w.word,
                  corrected: w.word,
                  explanation: `Pronunciation ${w.errorType.toLowerCase()}: ${w.word}`,
                  category: "pronunciation",
                }));
            });

            const allCorrections = [...spellingCorrections, ...pronunciationCorrections];
            if (allCorrections.length > 0) {
              await extractErrorsFromCorrections(user.id, allCorrections);
            }
          } catch (err) {
            // Error tracking failures must not block results
            captureError(err, "echo-practice-error-tracking");
          }
        } catch (err) {
          captureError(err, "echo-practice-save-results");
        } finally {
          setIsSavingResults(false);
        }
      } else {
        setIsSavingResults(false);
      }
    }
  }, [currentIndex, sentences.length, user?.id]);

  const skipSentence = useCallback(() => {
    if (!currentSentence) return;

    const result: EchoPracticeSentenceResult = {
      sentence: currentSentence,
      pronunciationResult: null,
      spellingResult: { wordResults: [], accuracy: 0, isFullyCorrect: false },
      listeningScore: 0,
      pronunciationScore: 0,
      spellingScore: 0,
    };

    setSentenceResults((prev) => [...prev, result]);
    setScreenState("checking");
    hapticLight();
  }, [currentSentence]);

  const tryAgain = useCallback(() => {
    setSentences([]);
    setSentenceResults([]);
    setCurrentIndex(0);
    setUserInput("");
    setHasPlayed(false);
    setCurrentPronunciationResult(null);
    slowAudioCacheRef.current.clear();
    exerciseIdRef.current = null;
    void generateExercise();
  }, [generateExercise]);

  const clearOfflineFallback = useCallback(() => {
    setOfflineFallback(false);
  }, []);

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const overallAccuracy = useMemo(() => {
    if (sentenceResults.length === 0) return 0;
    const total = sentenceResults.reduce(
      (sum, r) => sum + r.listeningScore + r.pronunciationScore + r.spellingScore,
      0
    );
    return Math.round(total / (sentenceResults.length * 3));
  }, [sentenceResults]);

  const fullyCorrectCount = useMemo(() => {
    return sentenceResults.filter(
      (r) => r.listeningScore > 80 && r.pronunciationScore > 80 && r.spellingScore > 80
    ).length;
  }, [sentenceResults]);

  const errorPatterns = useMemo(() => {
    // Convert EchoPracticeSentenceResult[] to SentenceResult[] for analyzeErrorPatterns
    const asSentenceResults: SentenceResult[] = sentenceResults.map((r) => ({
      original: r.sentence.expectedSpelling,
      translation: r.sentence.translation,
      userInput: "",
      wordResults: r.spellingResult.wordResults,
      accuracy: r.spellingScore,
      isFullyCorrect: r.spellingResult.isFullyCorrect,
    }));
    return analyzeErrorPatterns(asSentenceResults);
  }, [sentenceResults]);

  const getElapsedMinutes = useCallback(() => {
    return Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000));
  }, []);

  return {
    screenState,
    sentences,
    currentIndex,
    currentSentence,
    userInput,
    sentenceResults,
    currentPronunciationResult,
    generateError,
    offlineFallback,
    hasPlayed,
    isSavingResults,
    audioPlayer,
    pronunciation,
    overallAccuracy,
    fullyCorrectCount,
    errorPatterns,
    sentenceCount: sentences.length,
    getElapsedMinutes,
    setUserInput,
    generateExercise,
    playSentence,
    advanceToSpeak,
    startRecording,
    stopRecording,
    advanceToType,
    checkSpelling,
    nextSentence,
    skipSentence,
    tryAgain,
    clearOfflineFallback,
  };
}
