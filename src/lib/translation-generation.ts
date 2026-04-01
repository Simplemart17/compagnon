import type { CEFRLevel } from "@/src/types/cefr";
import { CEFR_ORDER } from "@/src/types/cefr";
import type {
  TranslationContent,
  TranslationEvaluation,
  TranslationSentence,
} from "@/src/types/exercise";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { requireNetwork } from "@/src/lib/network";
import {
  buildTranslationPrompt,
  buildTranslationEvaluationPrompt,
} from "@/src/lib/prompts/translation";

/** Shape returned by the AI for translation generation */
interface TranslationGenerationResponse {
  mode: "translation" | "paraphrasing";
  sentences: TranslationSentence[];
}

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

/** Validate the AI response has the expected shape */
function validateTranslationResponse(data: unknown): TranslationGenerationResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Translation response is not an object");
  }

  const obj = data as Record<string, unknown>;

  if (obj.mode !== "translation" && obj.mode !== "paraphrasing") {
    throw new Error(`Translation response has invalid mode: ${String(obj.mode)}`);
  }

  if (!Array.isArray(obj.sentences) || obj.sentences.length === 0) {
    throw new Error("Translation response missing sentences array");
  }

  if (obj.sentences.length < MIN_SENTENCES || obj.sentences.length > MAX_SENTENCES) {
    throw new Error(
      `Translation response has ${obj.sentences.length} sentences, expected ${MIN_SENTENCES}-${MAX_SENTENCES}`
    );
  }

  for (const s of obj.sentences) {
    if (!s || typeof s !== "object") {
      throw new Error("Translation sentence is not an object");
    }
    const sentence = s as Record<string, unknown>;
    if (typeof sentence.source !== "string" || !sentence.source.trim()) {
      throw new Error("Translation sentence missing 'source' field");
    }
    if (typeof sentence.target !== "string" || !sentence.target.trim()) {
      throw new Error("Translation sentence missing 'target' field");
    }
    if (typeof sentence.explanation !== "string" || !sentence.explanation.trim()) {
      throw new Error("Translation sentence missing 'explanation' field");
    }
    if (
      typeof sentence.difficulty !== "string" ||
      !CEFR_ORDER.includes(sentence.difficulty as CEFRLevel)
    ) {
      throw new Error(
        `Translation sentence has invalid difficulty: ${String(sentence.difficulty)}, expected a CEFR level`
      );
    }
    if (typeof sentence.grammarFocus !== "string" || !sentence.grammarFocus.trim()) {
      throw new Error("Translation sentence missing 'grammarFocus' field");
    }
  }

  return data as TranslationGenerationResponse;
}

/** Validate the AI evaluation response */
function validateEvaluationResponse(data: unknown): TranslationEvaluation {
  if (!data || typeof data !== "object") {
    throw new Error("Evaluation response is not an object");
  }

  const obj = data as Record<string, unknown>;

  for (const dim of ["accuracy", "fluency", "naturalness"] as const) {
    const d = obj[dim] as Record<string, unknown> | undefined;
    if (!d || typeof d !== "object") {
      throw new Error(`Evaluation response missing '${dim}' dimension`);
    }
    if (typeof d.score !== "number" || d.score < 0 || d.score > 100) {
      throw new Error(`Evaluation '${dim}' score must be 0-100, got ${String(d.score)}`);
    }
    if (typeof d.feedback !== "string" || !d.feedback.trim()) {
      throw new Error(`Evaluation '${dim}' missing feedback`);
    }
  }

  if (typeof obj.overallScore !== "number" || obj.overallScore < 0 || obj.overallScore > 100) {
    // Will be recomputed by caller as weighted average
    (obj as Record<string, unknown>).overallScore = -1;
  }

  return data as TranslationEvaluation;
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

  // Generate sentences via AI
  let content: TranslationContent;
  try {
    const prompt = buildTranslationPrompt({ cefrLevel, sentenceCount });
    const raw = await chatCompletionJSON<unknown>(
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
      { temperature: 0.4, model: "gpt-4o", maxTokens: 2048 }
    );
    const validated = validateTranslationResponse(raw);
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
    const raw = await chatCompletionJSON<unknown>(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Evaluate this translation." },
      ],
      { temperature: 0.4, model: "gpt-4o", maxTokens: 2048 }
    );

    const evaluation = validateEvaluationResponse(raw);

    // Compute overallScore if not provided, out of range, or invalid
    if (
      typeof evaluation.overallScore !== "number" ||
      evaluation.overallScore < 0 ||
      evaluation.overallScore > 100
    ) {
      evaluation.overallScore = Math.round(
        evaluation.accuracy.score * 0.4 +
          evaluation.fluency.score * 0.3 +
          evaluation.naturalness.score * 0.3
      );
    }

    // Attach context to the evaluation
    evaluation.expectedTranslation = params.expectedTarget;
    evaluation.userTranscription = params.userTranscription;

    return evaluation;
  } catch (err) {
    captureError(err, "translation-evaluation");
    throw err;
  }
}
