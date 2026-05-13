import type { CEFRLevel } from "@/src/types/cefr";
import type { EchoSentence } from "@/src/types/exercise";
import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import { buildEchoPracticePrompt } from "@/src/lib/prompts/echo";
import { echoGenerationSchema } from "@/src/lib/schemas/ai-responses";

/** A sentence with its generated TTS audio */
export interface EchoSentenceWithAudio extends EchoSentence {
  audioBase64: string;
}

/** Result returned by generateEchoExercise */
export interface EchoExerciseResult {
  sentences: EchoSentenceWithAudio[];
  exerciseId: string;
}

/** Generate echo practice sentences with TTS audio and persist to DB */
export async function generateEchoExercise(params: {
  cefrLevel: CEFRLevel;
  userId: string;
}): Promise<EchoExerciseResult> {
  const { cefrLevel, userId } = params;

  // Generate sentences via AI — Zod schema enforces 3-5 sentences with the
  // required shape (replaces hand-rolled `validateEchoResponse`, story 9-7).
  let sentences: EchoSentence[];
  try {
    const prompt = buildEchoPracticePrompt({ cefrLevel });
    const result = await chatCompletionJSON(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Generate echo practice sentences." },
      ],
      echoGenerationSchema,
      // Story 11-5: right-sized for 4 echo segments × prompt + correction + explanation.
      { temperature: 0.4, model: "gpt-4o", maxTokens: 1200, feature: "echo-generation" }
    );
    sentences = result.sentences;
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
