/**
 * Pronunciation Assessment Client
 *
 * Routes through Supabase Edge Function for secure Azure Speech API access.
 */

import { supabase } from "./supabase";

/** Phoneme-level score from Azure */
export interface PhonemeScore {
  phoneme: string;
  accuracyScore: number;
  nbestPhoneme?: string;
}

/** Word-level pronunciation score */
export interface WordScore {
  word: string;
  accuracyScore: number;
  errorType: "None" | "Mispronunciation" | "Omission" | "Insertion";
  phonemes: PhonemeScore[];
}

/** Complete pronunciation assessment result */
export interface PronunciationResult {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  prosodyScore: number;
  overallScore: number;
  words: WordScore[];
  weakPhonemes: PhonemeScore[];
}

/**
 * Assess pronunciation of a given text against recorded audio.
 *
 * @param audioBase64 - Base64-encoded WAV audio (16kHz, 16-bit, mono)
 * @param referenceText - The French text the user was trying to say
 */
export async function assessPronunciation(
  audioBase64: string,
  referenceText: string
): Promise<PronunciationResult> {
  const { data, error } = await supabase.functions.invoke("pronunciation-assess", {
    body: { referenceText, audioBase64 },
  });

  if (error) throw new Error(`Pronunciation assessment error: ${error.message}`);
  if (data?.error) throw new Error(`Azure error: ${data.error}`);

  return parsePronunciationResult(data);
}

interface AzurePhoneme {
  Phoneme: string;
  PronunciationAssessment?: { AccuracyScore?: number; NBestPhonemes?: { Phoneme: string }[] };
}

interface AzureWord {
  Word: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
  Phonemes?: AzurePhoneme[];
}

interface AzureNBest {
  PronunciationAssessment?: {
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    ProsodyScore?: number;
    PronScore?: number;
  };
  Words?: AzureWord[];
}

interface AzurePronunciationResult {
  NBest?: AzureNBest[];
}

/** Parse Azure's response into our cleaner format */
function parsePronunciationResult(azureResult: AzurePronunciationResult): PronunciationResult {
  const nBest = azureResult.NBest?.[0];
  if (!nBest) {
    return {
      accuracyScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      prosodyScore: 0,
      overallScore: 0,
      words: [],
      weakPhonemes: [],
    };
  }

  const assessment = nBest.PronunciationAssessment ?? {};

  const words: WordScore[] = (nBest.Words ?? []).map((w: AzureWord) => ({
    word: w.Word,
    accuracyScore: w.PronunciationAssessment?.AccuracyScore ?? 0,
    errorType: (w.PronunciationAssessment?.ErrorType ?? "None") as WordScore["errorType"],
    phonemes: (w.Phonemes ?? []).map((p: AzurePhoneme) => ({
      phoneme: p.Phoneme,
      accuracyScore: p.PronunciationAssessment?.AccuracyScore ?? 0,
      nbestPhoneme: p.PronunciationAssessment?.NBestPhonemes?.[0]?.Phoneme,
    })),
  }));

  const weakPhonemes: PhonemeScore[] = [];
  for (const word of words) {
    for (const phoneme of word.phonemes) {
      if (phoneme.accuracyScore < 60) {
        weakPhonemes.push(phoneme);
      }
    }
  }

  return {
    accuracyScore: assessment.AccuracyScore ?? 0,
    fluencyScore: assessment.FluencyScore ?? 0,
    completenessScore: assessment.CompletenessScore ?? 0,
    prosodyScore: assessment.ProsodyScore ?? assessment.PronScore ?? 0,
    overallScore: assessment.PronScore ?? 0,
    words,
    weakPhonemes,
  };
}

/**
 * Identify the most problematic French sounds for this user
 * from a list of pronunciation results.
 */
export function identifyWeakSounds(
  results: PronunciationResult[]
): { phoneme: string; avgScore: number; count: number }[] {
  const phonemeStats: Record<string, { total: number; count: number }> = {};

  for (const result of results) {
    for (const word of result.words) {
      for (const phoneme of word.phonemes) {
        if (!phonemeStats[phoneme.phoneme]) {
          phonemeStats[phoneme.phoneme] = { total: 0, count: 0 };
        }
        phonemeStats[phoneme.phoneme].total += phoneme.accuracyScore;
        phonemeStats[phoneme.phoneme].count += 1;
      }
    }
  }

  return Object.entries(phonemeStats)
    .map(([phoneme, stats]) => ({
      phoneme,
      avgScore: stats.total / stats.count,
      count: stats.count,
    }))
    .filter((s) => s.avgScore < 70 && s.count >= 3)
    .sort((a, b) => a.avgScore - b.avgScore);
}
