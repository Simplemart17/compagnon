/**
 * OpenAI / Azure per-model pricing (Story 11-4 / audit P1-10 spend-cap portion).
 *
 * Rates are cost in USD-cents per 1,000 tokens (or per-minute for whisper-1,
 * per-character for Azure TTS). Cents stored as floating-point because
 * sub-cent precision matters at scale — callers ceil to integer at the
 * ledger boundary.
 *
 * REFRESH QUARTERLY. OpenAI + Azure publish pricing changes via blog posts.
 * If a rate here is stale, cost-tracking under-counts (we pay more than we
 * record), which means the daily cap catches users LATER than it should
 * (the operator's cost-bill exceeds the ledger's recorded total). Refresh
 * by visiting:
 *   - https://openai.com/api/pricing/
 *   - https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
 *
 * Last refresh: 2026-05-12.  Next refresh due: 2026-08-12.
 *
 * Story 11.5 will read the same MODEL_RATES table for per-call maxTokens
 * right-sizing — so this module is the single source of truth for both
 * "how much will this call cost" (pre-flight estimate) and "how much did
 * this call actually cost" (post-flight ledger record).
 */

/** Per-model token rates in USD-cents per 1,000 tokens. */
export interface ModelRate {
  inputCentsPer1KTokens: number;
  outputCentsPer1KTokens: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  // Chat models (OpenAI pricing as of 2026-05-12).
  // $2.50/1M input → 0.25¢/1K input; $10.00/1M output → 1.00¢/1K output.
  "gpt-4o": { inputCentsPer1KTokens: 0.25, outputCentsPer1KTokens: 1.0 },

  // $0.15/1M input → 0.015¢/1K input; $0.60/1M output → 0.06¢/1K output.
  "gpt-4o-mini": { inputCentsPer1KTokens: 0.015, outputCentsPer1KTokens: 0.06 },

  // Embeddings. $0.02/1M tokens → 0.002¢/1K. No output tokens.
  "text-embedding-3-small": { inputCentsPer1KTokens: 0.002, outputCentsPer1KTokens: 0 },

  // Realtime (audio) models — expensive because audio tokens are dense.
  // $32/1M input → 3.2¢/1K; $64/1M output → 6.4¢/1K.
  "gpt-realtime": { inputCentsPer1KTokens: 3.2, outputCentsPer1KTokens: 6.4 },

  // Realtime mini (Story 11.5 will switch free tier to this).
  // $10/1M input → 1.0¢/1K; $20/1M output → 2.0¢/1K.
  "gpt-realtime-mini": { inputCentsPer1KTokens: 1.0, outputCentsPer1KTokens: 2.0 },
};

/** Whisper transcription is priced per audio minute, not per token.
 * $0.006/min → 0.6¢/min. */
export const WHISPER_CENTS_PER_MINUTE = 0.6;

/** Azure TTS is priced per character. $16/1M chars → 0.0016¢/char. */
export const AZURE_TTS_CENTS_PER_CHAR = 0.0016;

/** Azure speech recognition (pronunciation-assess) is $1/hour audio.
 * 100¢ / 60min ≈ 1.667¢/min. */
export const AZURE_SPEECH_CENTS_PER_MINUTE = 100 / 60;

/**
 * Estimate the cents cost of a chat-completion call BEFORE the upstream
 * fetch. Pessimistic: assumes maxTokens is fully consumed by output (real
 * calls usually consume less). Unknown models fall back to gpt-4o rates
 * (over-estimate is safer than under-estimate for a cap-pre-check).
 *
 * Returns fractional cents; callers should ceil to integer for ledger ops.
 */
export function estimateChatCostCents(
  model: string,
  inputTokens: number,
  maxOutputTokens: number
): number {
  const rate = MODEL_RATES[model] ?? MODEL_RATES["gpt-4o"];
  return (
    (inputTokens * rate.inputCentsPer1KTokens) / 1000 +
    (maxOutputTokens * rate.outputCentsPer1KTokens) / 1000
  );
}

/**
 * Compute the ACTUAL cents cost of a chat-completion call from the OpenAI
 * response usage object (`{ prompt_tokens, completion_tokens }`). Called
 * AFTER a successful upstream call, before recording to daily_cost_ledger.
 *
 * Returns fractional cents; callers should ceil to integer.
 */
export function actualChatCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rate = MODEL_RATES[model] ?? MODEL_RATES["gpt-4o"];
  return (
    (promptTokens * rate.inputCentsPer1KTokens) / 1000 +
    (completionTokens * rate.outputCentsPer1KTokens) / 1000
  );
}

/** Estimate TTS cost from input character count. */
export function estimateTtsCostCents(inputCharCount: number): number {
  return inputCharCount * AZURE_TTS_CENTS_PER_CHAR;
}

/** Estimate Whisper cost from approximate audio-duration minutes. */
export function estimateWhisperCostCents(audioDurationMinutes: number): number {
  return audioDurationMinutes * WHISPER_CENTS_PER_MINUTE;
}

/** Estimate Azure pronunciation/speech-recognition cost from approximate audio-duration minutes. */
export function estimateAzureSpeechCostCents(audioDurationMinutes: number): number {
  return audioDurationMinutes * AZURE_SPEECH_CENTS_PER_MINUTE;
}
