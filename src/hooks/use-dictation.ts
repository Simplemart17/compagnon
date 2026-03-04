/**
 * Dictation Exercise Hook
 *
 * Manages dictation exercise state: sentence generation, audio playback,
 * word comparison, result tracking, and activity logging.
 */

import { useState, useCallback, useRef, useMemo } from "react";

import { useAuthStore } from "@/src/store/auth-store";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { useAudioPlayer } from "@/src/hooks/use-audio-player";
import { updateStreak, updateSkillProgress, incrementDailyActivity } from "@/src/lib/activity";
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from "@/src/lib/haptics";
import { captureError } from "@/src/lib/sentry";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DictationScreenState = "idle" | "generating" | "active" | "checking" | "results";
export type DifficultyTag = "easy" | "medium" | "hard";

export interface DictationSentence {
  sentence: string;
  translation: string;
  difficulty: DifficultyTag;
}

interface DictationSet {
  sentences: DictationSentence[];
}

/** Result of comparing a single word */
export interface WordResult {
  word: string;
  status: "correct" | "missing" | "wrong";
  /** The user's typed word, if status is "wrong" */
  typed?: string;
}

/** Result for a single sentence */
export interface SentenceResult {
  original: string;
  translation: string;
  userInput: string;
  wordResults: WordResult[];
  accuracy: number;
  isFullyCorrect: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENTENCE_COUNT = 5;

// ---------------------------------------------------------------------------
// Word Comparison Algorithm
// ---------------------------------------------------------------------------

/**
 * Normalize a string for comparison purposes:
 * - Lowercase
 * - Remove common French punctuation
 * - Normalize accents for comparison (remove diacritics)
 * - Trim whitespace
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[.,;:!?'"()\-\u2013\u2014\u00AB\u00BB\u2018\u2019\u201C\u201D]/g, "")
    .trim();
}

/** Split text into normalized word tokens */
function tokenize(text: string): string[] {
  return normalizeForComparison(text)
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Compare the user's typed text against the original sentence.
 * Returns per-word results and an overall accuracy score.
 */
export function compareSentences(
  original: string,
  userInput: string
): {
  wordResults: WordResult[];
  accuracy: number;
  isFullyCorrect: boolean;
} {
  const originalWords = original
    .replace(/[.,;:!?'"()\-\u2013\u2014\u00AB\u00BB\u2018\u2019\u201C\u201D]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const originalTokens = tokenize(original);
  const userTokens = tokenize(userInput);

  const wordResults: WordResult[] = [];
  let correctCount = 0;

  for (let i = 0; i < originalTokens.length; i++) {
    const displayWord = originalWords[i] ?? originalTokens[i];

    if (i >= userTokens.length) {
      wordResults.push({ word: displayWord, status: "missing" });
    } else if (originalTokens[i] === userTokens[i]) {
      wordResults.push({ word: displayWord, status: "correct" });
      correctCount++;
    } else {
      wordResults.push({
        word: displayWord,
        status: "wrong",
        typed:
          userInput
            .replace(/[.,;:!?'"()\-\u2013\u2014\u00AB\u00BB\u2018\u2019\u201C\u201D]/g, "")
            .trim()
            .split(/\s+/)[i] ?? userTokens[i],
      });
    }
  }

  const totalWords = originalTokens.length;
  const accuracy = totalWords > 0 ? Math.round((correctCount / totalWords) * 100) : 0;
  const isFullyCorrect = correctCount === totalWords;

  return { wordResults, accuracy, isFullyCorrect };
}

/**
 * Analyze common error patterns across all sentence results.
 * Returns a list of human-readable observations.
 */
export function analyzeErrorPatterns(results: SentenceResult[]): string[] {
  const patterns: string[] = [];

  let totalMissing = 0;
  let totalWrong = 0;
  const wrongWords: string[] = [];

  for (const r of results) {
    for (const wr of r.wordResults) {
      if (wr.status === "missing") totalMissing++;
      if (wr.status === "wrong") {
        totalWrong++;
        wrongWords.push(wr.word.toLowerCase());
      }
    }
  }

  if (totalMissing > 2) {
    patterns.push(
      "You often miss words at the end of sentences. Try listening to the full sentence before typing."
    );
  }

  const articles = ["le", "la", "les", "un", "une", "des", "du", "de", "l'", "d'"];
  const missedArticles = wrongWords.filter((w) => articles.includes(normalizeForComparison(w)));
  if (missedArticles.length >= 2) {
    patterns.push(
      "You often miss or mistype articles (le, la, les, un, une, des). Pay close attention to small words."
    );
  }

  const prepositions = ["a", "au", "aux", "en", "dans", "sur", "sous", "avec", "pour", "par"];
  const missedPreps = wrongWords.filter((w) => prepositions.includes(normalizeForComparison(w)));
  if (missedPreps.length >= 2) {
    patterns.push(
      "Prepositions are tricky. Listen carefully for short connecting words like 'dans', 'sur', 'avec'."
    );
  }

  if (totalWrong > totalMissing && totalWrong >= 3) {
    patterns.push(
      "Several words were close but not quite right. Try using the slow playback to catch each syllable."
    );
  }

  if (patterns.length === 0 && (totalMissing > 0 || totalWrong > 0)) {
    patterns.push(
      "Keep practicing! Regular dictation exercises will sharpen your listening comprehension."
    );
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDictationReturn {
  // State
  screenState: DictationScreenState;
  sentences: DictationSentence[];
  currentIndex: number;
  currentSentence: DictationSentence | null;
  userInput: string;
  sentenceResults: SentenceResult[];
  generateError: string | null;
  isPlayingAudio: boolean;
  audioError: string | null;
  hasPlayed: boolean;
  isSavingResults: boolean;
  audioPlayer: ReturnType<typeof useAudioPlayer>;

  // Computed
  overallAccuracy: number;
  fullyCorrectCount: number;
  errorPatterns: string[];
  sentenceCount: number;
  getElapsedMinutes: () => number;

  // Actions
  setUserInput: (text: string) => void;
  generateSentences: () => Promise<void>;
  playSentence: (speed?: number) => Promise<void>;
  checkAnswer: () => void;
  skipSentence: () => void;
  nextSentence: () => Promise<void>;
  tryAgain: () => void;
}

export function useDictation(): UseDictationReturn {
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const cefrLevel = (profile?.current_cefr_level ?? "A1") as CEFRLevel;

  const audioPlayer = useAudioPlayer();

  const [screenState, setScreenState] = useState<DictationScreenState>("idle");
  const [sentences, setSentences] = useState<DictationSentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [sentenceResults, setSentenceResults] = useState<SentenceResult[]>([]);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isSavingResults, setIsSavingResults] = useState(false);

  const startTimeRef = useRef<number>(Date.now());
  const speechCacheRef = useRef<Map<number, string>>(new Map());

  const currentSentence = sentences[currentIndex] ?? null;

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const generateSentencesAction = useCallback(async () => {
    setScreenState("generating");
    setGenerateError(null);
    setSentences([]);
    setCurrentIndex(0);
    setUserInput("");
    setSentenceResults([]);
    setHasPlayed(false);
    speechCacheRef.current.clear();
    startTimeRef.current = Date.now();

    try {
      const result = await chatCompletionJSON<DictationSet>(
        [
          {
            role: "system",
            content:
              "You are a French language teacher creating dictation exercises. " +
              `Generate exactly ${SENTENCE_COUNT} French sentences appropriate for CEFR level ${cefrLevel}. ` +
              "Each sentence should be 5-15 words long, using natural everyday French. " +
              'Return JSON with a single key "sentences" containing an array of objects, ' +
              'each with keys: "sentence" (the French text), "translation" (English translation), ' +
              'and "difficulty" (one of: "easy", "medium", "hard"). ' +
              "Include a mix of difficulties. Use proper French punctuation and accents in the sentences. " +
              "Make sure sentences cover different topics and vocabulary.",
          },
          {
            role: "user",
            content: `Generate ${SENTENCE_COUNT} ${cefrLevel}-level French dictation sentences.`,
          },
        ],
        { temperature: 0.8 }
      );

      if (!result.sentences || result.sentences.length === 0) {
        throw new Error("No sentences generated");
      }

      setSentences(result.sentences.slice(0, SENTENCE_COUNT));
      setScreenState("active");
    } catch (err) {
      captureError(err, "dictation-generation");
      setGenerateError(err instanceof Error ? err.message : "Failed to generate sentences");
      setScreenState("idle");
      hapticError();
    }
  }, [cefrLevel]);

  const playSentence = useCallback(
    async (speed: number = 1.0) => {
      if (!currentSentence || isPlayingAudio) return;

      setIsPlayingAudio(true);
      setAudioError(null);

      try {
        let base64 = speed === 1.0 ? speechCacheRef.current.get(currentIndex) : undefined;

        if (!base64) {
          base64 = await generateSpeech(currentSentence.sentence, {
            voice: "nova",
            speed,
          });
          if (speed === 1.0) {
            speechCacheRef.current.set(currentIndex, base64);
          }
        }

        await audioPlayer.playFromBase64(base64, "mp3");
        setHasPlayed(true);
        hapticLight();
      } catch (err) {
        captureError(err, "dictation-tts");
        setAudioError(err instanceof Error ? err.message : "Failed to play audio");
        hapticError();
      } finally {
        setIsPlayingAudio(false);
      }
    },
    [currentSentence, currentIndex, isPlayingAudio, audioPlayer]
  );

  const checkAnswer = useCallback(() => {
    if (!currentSentence || userInput.trim().length === 0) return;

    hapticMedium();

    const { wordResults, accuracy, isFullyCorrect } = compareSentences(
      currentSentence.sentence,
      userInput.trim()
    );

    const result: SentenceResult = {
      original: currentSentence.sentence,
      translation: currentSentence.translation,
      userInput: userInput.trim(),
      wordResults,
      accuracy,
      isFullyCorrect,
    };

    setSentenceResults((prev) => [...prev, result]);
    setScreenState("checking");

    if (isFullyCorrect) {
      hapticSuccess();
    } else {
      hapticError();
    }
  }, [currentSentence, userInput]);

  const skipSentence = useCallback(() => {
    if (!currentSentence) return;

    const { wordResults, accuracy, isFullyCorrect } = compareSentences(
      currentSentence.sentence,
      userInput.trim() || " "
    );

    setSentenceResults((prev) => [
      ...prev,
      {
        original: currentSentence.sentence,
        translation: currentSentence.translation,
        userInput: userInput.trim() || "(skipped)",
        wordResults,
        accuracy,
        isFullyCorrect,
      },
    ]);
    setScreenState("checking");
    hapticLight();
  }, [currentSentence, userInput]);

  const nextSentence = useCallback(async () => {
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setUserInput("");
      setHasPlayed(false);
      setAudioError(null);
      setScreenState("active");
      hapticLight();
    } else {
      setIsSavingResults(true);
      setScreenState("results");
      hapticSuccess();

      if (user?.id) {
        try {
          const allResults = sentenceResults;
          const avg =
            allResults.length > 0
              ? Math.round(allResults.reduce((sum, r) => sum + r.accuracy, 0) / allResults.length)
              : 0;
          const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 60000));

          await Promise.all([
            updateSkillProgress(user.id, "listening", avg, elapsed),
            incrementDailyActivity(user.id, { minutes: elapsed, exercises: 1 }),
            updateStreak(user.id),
          ]);
        } catch (err) {
          captureError(err, "dictation-save-results");
        }
      }
      setIsSavingResults(false);
    }
  }, [currentIndex, sentences.length, sentenceResults, user?.id]);

  const tryAgain = useCallback(() => {
    setSentences([]);
    setSentenceResults([]);
    setCurrentIndex(0);
    setUserInput("");
    setHasPlayed(false);
    setAudioError(null);
    speechCacheRef.current.clear();
    void generateSentencesAction();
  }, [generateSentencesAction]);

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const overallAccuracy = useMemo(() => {
    if (sentenceResults.length === 0) return 0;
    return Math.round(
      sentenceResults.reduce((sum, r) => sum + r.accuracy, 0) / sentenceResults.length
    );
  }, [sentenceResults]);

  const fullyCorrectCount = useMemo(() => {
    return sentenceResults.filter((r) => r.isFullyCorrect).length;
  }, [sentenceResults]);

  const errorPatterns = useMemo(() => {
    return analyzeErrorPatterns(sentenceResults);
  }, [sentenceResults]);

  /** Compute elapsed minutes since exercise start (not memoized — reads current time) */
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
    generateError,
    isPlayingAudio,
    audioError,
    hasPlayed,
    isSavingResults,
    audioPlayer,
    overallAccuracy,
    fullyCorrectCount,
    errorPatterns,
    sentenceCount: SENTENCE_COUNT,
    getElapsedMinutes,
    setUserInput,
    generateSentences: generateSentencesAction,
    playSentence,
    checkAnswer,
    skipSentence,
    nextSentence,
    tryAgain,
  };
}
