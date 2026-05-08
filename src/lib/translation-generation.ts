import type { CEFRLevel } from "@/src/types/cefr";
import type { TranslationContent, TranslationEvaluation } from "@/src/types/exercise";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { requireNetwork } from "@/src/lib/network";
import {
  buildTranslationPrompt,
  buildTranslationEvaluationPrompt,
} from "@/src/lib/prompts/translation";
import {
  translationGenerationSchema,
  translationEvaluationSchema,
} from "@/src/lib/schemas/ai-responses";

/** Result returned by generateTranslationExercise */
export interface TranslationExerciseResult {
  exerciseId: string;
  content: TranslationContent;
  audioData: Map<number, string>; // index → base64 audio
}

const CEFR_LEVELS_PARAPHRASING: CEFRLevel[] = ["B2", "C1", "C2"];
const MIN_SENTENCES = 3;
const MAX_SENTENCES = 10;

/** Determine exercise mode from CEFR level */
function getModeForLevel(cefrLevel: CEFRLevel): "translation" | "paraphrasing" {
  return CEFR_LEVELS_PARAPHRASING.includes(cefrLevel) ? "paraphrasing" : "translation";
}

/** Generate translation exercise sentences with TTS audio and persist to DB */
export async function generateTranslationExercise(params: {
  cefrLevel: CEFRLevel;
  userId: string;
  sentenceCount?: number;
}): Promise<TranslationExerciseResult> {
  const { cefrLevel, userId } = params;
  const sentenceCount = Math.min(MAX_SENTENCES, Math.max(MIN_SENTENCES, params.sentenceCount ?? 5));
  const mode = getModeForLevel(cefrLevel);

  await requireNetwork();

  // Generate sentences via AI — Zod schema enforces shape (replaces hand-rolled
  // `validateTranslationResponse`, story 9-7).
  let content: TranslationContent;
  try {
    const prompt = buildTranslationPrompt({ cefrLevel, sentenceCount });
    const validated = await chatCompletionJSON(
      [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            mode === "paraphrasing"
              ? "Generate French paraphrasing exercise sentences."
              : "Generate English-to-French translation exercise sentences.",
        },
      ],
      translationGenerationSchema,
      {
        temperature: 0.4,
        model: "gpt-4o",
        maxTokens: 2048,
        feature: "translation-generation",
      }
    );
    // Enforce mode matches what we requested — don't trust AI's mode field
    content = { mode, sentences: validated.sentences };
  } catch (err) {
    captureError(err, "translation-generation");
    throw err;
  }

  // Generate TTS audio for each source sentence — partial failures don't kill the batch
  // A1-B1: English TTS (source is English)
  // B2+: French TTS (source is French for paraphrasing)
  const ttsResults = await Promise.allSettled(
    content.sentences.map((s) => generateSpeech(s.source))
  );

  const audioData = new Map<number, string>();
  for (let i = 0; i < content.sentences.length; i++) {
    const result = ttsResults[i];
    if (result.status === "fulfilled") {
      audioData.set(i, result.value);
    } else {
      captureError(result.reason, "translation-tts");
    }
  }

  if (audioData.size === 0) {
    throw new Error("TTS generation failed for all sentences");
  }

  // Persist to exercises table — store text content only, not audio
  const { data: exercise, error: dbError } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      skill: "speaking",
      cefr_level: cefrLevel,
      exercise_type: "translation",
      content: { mode: content.mode, sentences: content.sentences },
      completed: false,
    })
    .select("id")
    .single();

  if (dbError) {
    captureError(dbError, "translation-db-insert");
    throw new Error(`Failed to save translation exercise: ${dbError.message}`);
  }

  return {
    exerciseId: exercise.id,
    content,
    audioData,
  };
}

/** Evaluate a user's spoken translation/paraphrase against the expected target */
export async function evaluateTranslation(params: {
  source: string;
  expectedTarget: string;
  userTranscription: string;
  cefrLevel: CEFRLevel;
  mode: "translation" | "paraphrasing";
}): Promise<TranslationEvaluation> {
  if (!params.userTranscription.trim()) {
    throw new Error("Cannot evaluate empty transcription — no speech was detected");
  }

  await requireNetwork();

  try {
    const prompt = buildTranslationEvaluationPrompt(params);
    const validated = await chatCompletionJSON(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Evaluate this translation." },
      ],
      translationEvaluationSchema,
      {
        temperature: 0.4,
        model: "gpt-4o",
        maxTokens: 2048,
        feature: "translation-evaluation",
      }
    );

    // Compute overallScore if the model omitted it (schema marks it optional);
    // weighted-average from the dimensions matches the existing domain rule.
    const overallScore =
      typeof validated.overallScore === "number"
        ? validated.overallScore
        : Math.round(
            validated.accuracy.score * 0.4 +
              validated.fluency.score * 0.3 +
              validated.naturalness.score * 0.3
          );

    // Attach caller-side context. The schema marks these optional; the
    // consumer-facing `TranslationEvaluation` type narrows them to required.
    return {
      ...validated,
      overallScore,
      expectedTranslation: params.expectedTarget,
      userTranscription: params.userTranscription,
    };
  } catch (err) {
    captureError(err, "translation-evaluation");
    throw err;
  }
}
