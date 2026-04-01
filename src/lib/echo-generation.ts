import type { CEFRLevel } from "@/src/types/cefr";
import type { EchoSentence } from "@/src/types/exercise";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { buildEchoPracticePrompt } from "@/src/lib/prompts/echo";

/** Shape returned by the AI for echo generation */
interface EchoGenerationResponse {
  sentences: EchoSentence[];
}

/** A sentence with its generated TTS audio */
export interface EchoSentenceWithAudio extends EchoSentence {
  audioBase64: string;
}

/** Result returned by generateEchoExercise */
export interface EchoExerciseResult {
  sentences: EchoSentenceWithAudio[];
  exerciseId: string;
}

const MIN_SENTENCES = 3;
const MAX_SENTENCES = 5;

/** Validate the AI response has the expected shape */
function validateEchoResponse(data: unknown): EchoGenerationResponse {
  if (!data || typeof data !== "object") {
    throw new Error("Echo response is not an object");
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.sentences) || obj.sentences.length === 0) {
    throw new Error("Echo response missing sentences array");
  }

  if (obj.sentences.length < MIN_SENTENCES || obj.sentences.length > MAX_SENTENCES) {
    throw new Error(
      `Echo response has ${obj.sentences.length} sentences, expected ${MIN_SENTENCES}-${MAX_SENTENCES}`
    );
  }

  for (const s of obj.sentences) {
    if (!s || typeof s !== "object") {
      throw new Error("Echo sentence is not an object");
    }
    const sentence = s as Record<string, unknown>;
    if (typeof sentence.sentence !== "string" || !sentence.sentence.trim()) {
      throw new Error("Echo sentence missing 'sentence' field");
    }
    if (typeof sentence.translation !== "string" || !sentence.translation.trim()) {
      throw new Error("Echo sentence missing 'translation' field");
    }
    if (typeof sentence.expectedSpelling !== "string" || !sentence.expectedSpelling.trim()) {
      throw new Error("Echo sentence missing 'expectedSpelling' field");
    }
    if (!["easy", "medium", "hard"].includes(sentence.difficulty as string)) {
      throw new Error(`Echo sentence has invalid difficulty: ${String(sentence.difficulty)}`);
    }
    if (sentence.grammarFocus !== undefined && typeof sentence.grammarFocus !== "string") {
      throw new Error("Echo sentence 'grammarFocus' must be a string if present");
    }
  }

  return data as EchoGenerationResponse;
}

/** Generate echo practice sentences with TTS audio and persist to DB */
export async function generateEchoExercise(params: {
  cefrLevel: CEFRLevel;
  userId: string;
}): Promise<EchoExerciseResult> {
  const { cefrLevel, userId } = params;

  // Generate sentences via AI
  let sentences: EchoSentence[];
  try {
    const prompt = buildEchoPracticePrompt({ cefrLevel });
    const raw = await chatCompletionJSON<unknown>(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Generate echo practice sentences." },
      ],
      { temperature: 0.4, model: "gpt-4o", maxTokens: 2048 }
    );
    ({ sentences } = validateEchoResponse(raw));
  } catch (err) {
    captureError(err, "echo-practice-generation");
    throw err;
  }

  // Generate TTS audio for each sentence — partial failures don't kill the batch
  const ttsResults = await Promise.allSettled(sentences.map((s) => generateSpeech(s.sentence)));

  const sentencesWithAudio: EchoSentenceWithAudio[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const result = ttsResults[i];
    if (result.status === "fulfilled") {
      sentencesWithAudio.push({ ...sentences[i], audioBase64: result.value });
    } else {
      captureError(result.reason, "echo-practice-tts");
    }
  }

  if (sentencesWithAudio.length === 0) {
    throw new Error("TTS generation failed for all sentences");
  }

  // Persist to exercises table — store text content only, not audio
  const { data: exercise, error: dbError } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      skill: "listening",
      cefr_level: cefrLevel,
      exercise_type: "echo",
      content: { sentences },
      completed: false,
    })
    .select("id")
    .single();

  if (dbError) {
    captureError(dbError, "echo-practice-db-insert");
    throw new Error(`Failed to save echo exercise: ${dbError.message}`);
  }

  return {
    sentences: sentencesWithAudio,
    exerciseId: exercise.id,
  };
}
