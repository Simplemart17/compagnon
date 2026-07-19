/**
 * Story 20-4 — speaking honesty (v2-vision-roadmap Epic 20).
 *
 * The Expression Orale evaluator scores from a Whisper TRANSCRIPT, which
 * normalizes pronunciation — a mispronounced word is transcribed as the
 * intended word. Pre-20-4 the rubric's dimension 1 instructed the model to
 * score "articulation clarity, intonation, rhythm, liaison" — signals a
 * transcript structurally cannot carry, so the model hallucinated a
 * plausible-looking pronunciation score. Post-20-4 dimension 1 is scoped to
 * transcript-observable fluency/coherence only, the results screen discloses
 * the gap (with a pointer to the Azure phoneme-level Pronunciation Practice
 * surface), and the conversation feedback sheet labels its numbers as
 * practice metrics.
 *
 * Why not "route the exam audio through Azure" (the roadmap's original
 * clause): Azure pronunciation assessment caps at ~30s of audio on the
 * short-audio REST endpoint, is unsupported on fast transcription, and the
 * speaking tasks record up to 5.5 min of AAC (Azure REST needs PCM WAV; the
 * Deno Edge runtime cannot transcode). Disclosure + honest dimension scoping
 * is the feasible truth at this architecture tier; full-audio assessment
 * needs the Azure streaming SDK (native module) — filed as a follow-up.
 *
 * Drift discipline: comment-stripped source reads (Story 12-2 P12) + paired
 * POSITIVE/NEGATIVE pins (Story 13-2 P11).
 */

import { readFileSync } from "fs";
import { join } from "path";

import { buildSpeakingEvaluatorPrompt } from "@/src/lib/prompts/speaking";

function readSrc(rel: string): string {
  const raw = readFileSync(join(__dirname, "../../..", rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** A rendered evaluator prompt (runtime output, not source). */
const PROMPT = buildSpeakingEvaluatorPrompt({
  cefrLevel: "B1",
  taskNumber: 1,
  taskInstruction: "Présentez-vous.",
  transcript: "Bonjour, je m'appelle Marie et j'habite à Montréal depuis deux ans.",
});

describe("Story 20-4 — evaluator prompt honesty (runtime output pins)", () => {
  it("dimension 1 is Fluency & Coherence, scoped to transcript-observable signals", () => {
    expect(PROMPT).toContain("### 1. Fluency & Coherence (0-20)");
    expect(PROMPT).toContain("transcript-observable signals ONLY");
    // The publisher-category mapping is disclosed, not hidden.
    expect(PROMPT).toContain("Prononciation/Fluidité");
  });

  it("the honesty contract block tells the model what it structurally cannot hear", () => {
    expect(PROMPT).toContain("## What You Can and Cannot Observe");
    expect(PROMPT).toMatch(/MUST NOT infer, guess, or invent pronunciation quality/);
    // Feedback-surface guard: strengths/improvements/corrections must not
    // carry invented pronunciation commentary.
    expect(PROMPT).toMatch(
      /Never mention pronunciation, accent, articulation, or intonation in strengths, improvements, or corrections/
    );
  });

  it("NEGATIVE: the pre-20-4 unhearable-signal bullets are gone from the rubric", () => {
    const rubricStart = PROMPT.indexOf("## Evaluation Rubric");
    const rubric = PROMPT.slice(rubricStart);
    expect(rubricStart).toBeGreaterThan(-1);
    expect(rubric).not.toContain("Articulation clarity, intonation, rhythm");
    expect(rubric).not.toContain("Liaison and elision when appropriate");
    expect(rubric).not.toContain("### 1. Pronunciation & Fluency");
  });

  it("R1: NO unhearable-signal words ANYWHERE outside the honesty-contract block — across all 3 tasks", () => {
    // Review round 1 caught TASK_RUBRIC_FOCUS[1] still demanding "natural
    // conversational rhythm" in the '## Evaluation Task' section, ABOVE the
    // rubric slice the original negative pin scanned. This case removes the
    // blind spot: strip the contract block (which names the signals in order
    // to FORBID them), then scan the ENTIRE remaining prompt — for every
    // task number, since the rubric-focus line varies per task.
    const UNHEARABLE =
      /\brhythm\b|\bintonation\b|\barticulation\b|\bliaison\b|\belision\b|\bpronunciation\b/i;
    for (const taskNumber of [1, 2, 3] as const) {
      const prompt = buildSpeakingEvaluatorPrompt({
        cefrLevel: "B1",
        taskNumber,
        taskInstruction: "Présentez-vous.",
        transcript: "Bonjour, je m'appelle Marie.",
      });
      const contractStart = prompt.indexOf("## What You Can and Cannot Observe");
      const contractEnd = prompt.indexOf("## Evaluation Task");
      expect(contractStart).toBeGreaterThan(-1);
      expect(contractEnd).toBeGreaterThan(contractStart);
      const outsideContract = prompt.slice(0, contractStart) + prompt.slice(contractEnd);
      // NOTE: \bpronunciation\b does NOT match the camelCase field name
      // "pronunciationFluencyScore" (no word boundary before "Fluency") or
      // the French category label "Prononciation" (different spelling).
      const match = outsideContract.match(UNHEARABLE);
      expect(match?.[0] ?? null).toBeNull();
    }
  });

  it("storage compatibility: the JSON field name pronunciationFluencyScore is unchanged, with numeric placeholder", () => {
    // Renaming the field would break speakingTaskEvaluationSchema + every
    // stored mock_tests.section_scores JSONB row (Story 10-6 forward-only
    // persistence rule). R1: the placeholder must stay the sibling-uniform
    // "<0-20>" — prose inside the JSON example risks a string-typed emission
    // that burns a Story 9-7 schema retry.
    expect(PROMPT).toContain('"pronunciationFluencyScore": <0-20>,');
  });

  // The composite-formula literal is pinned by speaking.test.ts (its owner
  // suite) — deliberately NOT duplicated here (R1: double-maintenance for
  // zero added protection; both pins fail together on the same string).
});

describe("Story 20-4 — user-facing disclosure drift pins", () => {
  it("results screen: speaking tests disclose the pronunciation gap + link to Pronunciation Practice", () => {
    const src = readSrc("app/(tabs)/mock-test/results.tsx");
    expect(src).toMatch(/results\.testType === "speaking"/);
    expect(src).toContain("pronunciation is not scored from exam recordings");
    expect(src).toMatch(/practice\/pronunciation/);
  });

  it("R1: results screen renders speaking on the 0-20 publisher scale, not /699", () => {
    // Speaking composites are 0-20 (Story 10-2 computeSpeakingScore0to20);
    // pre-R1 the score ring hardcoded "/ 699", colored 16/20 as failing red
    // via the 0-699 bands, and rendered a nonsense distance-to-C1 card —
    // directly beneath the 20-4 honesty note.
    const src = readSrc("app/(tabs)/mock-test/results.tsx");
    expect(src).toMatch(/isSpeakingScale \? 20 : 699/);
    expect(src).toMatch(/\{scoreDenominator\}/);
    // Distance-to-C1 is meaningless on a 0-20 scale.
    expect(src).toMatch(/!isSpeakingScale && distanceToC1 > 0/);
    // NEGATIVE: no hardcoded /699 remains in the score ring or section bar.
    expect(src).not.toMatch(/\/ 699\s*</);
    expect(src).not.toMatch(/tcfScore \/ 699/);
  });

  it("conversation feedback sheet: metrics are labeled as practice, not exam", () => {
    const src = readSrc("app/(tabs)/conversation/[sessionId].tsx");
    expect(src).toContain("Practice metrics from this conversation — not an exam speaking score.");
  });

  it("speaking-score.ts documents the fluency-practice-heuristic semantics (raw source read — the contract lives in the JSDoc)", () => {
    const raw = readFileSync(join(__dirname, "../../..", "src/lib/speaking-score.ts"), "utf8");
    expect(raw).toContain("FLUENCY-PRACTICE heuristic");
    expect(raw).toContain("NOT a pronunciation or exam-grade speaking");
  });
});
