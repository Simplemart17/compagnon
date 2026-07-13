/**
 * Story 13-4 — `useMockTestGeneration` hook (audit P2-6 closure).
 *
 * Replaces the pre-13-4 serial `for (const section of sections)` loop in
 * `app/(tabs)/mock-test/[testId].tsx:298-368` with `Promise.allSettled`
 * parallel per-section AI generation. Per-section settle fires setState
 * immediately so the screen can transition to `"active"` and render
 * section 1 as soon as ITS promise resolves — while section 2 finishes
 * generating in parallel.
 *
 * Single chokepoint for: per-section AI generation + resume detection
 * + DB INSERT on first-section-ready (single-fire guard) + DB UPDATE on
 * subsequent-section-ready (fire-and-forget) + all-failed signal.
 *
 * Pre-13-4 pipeline:
 *   for section of sections:
 *     await chatCompletionJSON(prompt, mockTestSectionSchema)
 *   if all failed: Alert
 *   else: INSERT mock_tests row + setState active
 *   → ~12-20s blocked-on-Σ-section-latencies before first-question-tappable
 *
 * Post-13-4 pipeline:
 *   for section of sections (in parallel via Promise.allSettled):
 *     fire chatCompletionJSON(prompt, mockTestSectionSchema)
 *     on per-section settle: setState questions[section] + sectionStatus[section]
 *   when sectionStatus[sections[0]] flips "pending" → "ready":
 *     fire INSERT mock_tests row (single-fire via insertFiredRef)
 *     screen consumes firstSectionReady signal → transitions to "active"
 *   when sectionStatus[N>0] flips → "ready":
 *     fire-and-forget UPDATE mock_tests SET questions = ...
 *   if all sections settle as "failed":
 *     allFailed → true (screen renders Alert)
 *   → ~6-10s = max section latency to first-question-tappable
 *
 * Closes audit P2-6 at `_bmad-output/planning-artifacts/shippable-roadmap.md` § 1.
 * Story 12-1 Phase A `Promise.allSettled` precedent.
 * Story 12-9 mountedRef + Story 12-5 single-fire-ref patterns applied.
 * Story 13-3 content-key memoization on the `sectionsKey` effect dep.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chatCompletionJSON, generateSpeech } from "@/src/lib/openai";
import { mockTestSectionSchema } from "@/src/lib/schemas/ai-responses";
import { buildMockTestPrompt } from "@/src/lib/prompts/mock-test";
import { TCF_QCM_SECTIONS, type QcmSection } from "@/src/lib/tcf";
import { supabase } from "@/src/lib/supabase";
import { captureError } from "@/src/lib/sentry";
import type { MCQContent } from "@/src/types/exercise";
import type { CEFRLevel } from "@/src/types/cefr";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-section AI generation status. */
export type MockTestSectionStatus = "pending" | "ready" | "failed";

/** Shape of the resume payload returned when a saved in-progress test exists. */
export interface MockTestResumeData {
  /** The `mock_tests.id` of the resumed row — flows into `activeTestId`. */
  activeTestId: string;
  /** Whether the saved state is corrupt (no valid questions) — screen renders an Alert. */
  corrupt: boolean;
  /** Saved questions per section (filtered to current Section union). */
  resumedQuestions: Record<QcmSection, MCQContent[]>;
  /** Clamped `currentSectionIndex` against the current sections array. */
  savedSectionIndex: number;
  /** Clamped `currentQuestionIndex`. */
  savedQuestionIndex: number;
  /** Time remaining after subtracting elapsed-since-save + clamping to spec max. */
  adjustedTimeRemaining: number;
  /** Saved answer key → answerId map. */
  savedAnswers: Record<string, string>;
  /** Saved answered-question keys (for the `answeredQuestions: Set<string>` state). */
  savedAnsweredQuestions: string[];
}

export interface UseMockTestGenerationOptions {
  /** Ordered list of QCM sections that make up this test run. */
  sections: readonly QcmSection[];
  /** Target CEFR level passed to the AI prompt builder. */
  cefrLevel: CEFRLevel;
  /**
   * The raw `testId` route param — `"full"` for the multi-section run, or
   * a single-section key (`"listening"` / `"reading"`). Used for the
   * `mock_tests.test_type` column.
   */
  testIdParam: string;
  /** When false the hook short-circuits and stays in the initial pending state. */
  enabled: boolean;
}

export interface UseMockTestGenerationReturn {
  /** Per-section question arrays. Empty array means pending or failed. */
  questions: Record<QcmSection, MCQContent[]>;
  /** Per-section generation status. */
  sectionStatus: Record<QcmSection, MockTestSectionStatus>;
  /** True when sectionStatus[sections[0]] === "ready" (screen transitions to "active"). */
  firstSectionReady: boolean;
  /** True when every section is "ready". */
  allReady: boolean;
  /** True when any section is "failed". */
  anyFailed: boolean;
  /** True when every section is "failed" (screen renders "Could not load test" Alert). */
  allFailed: boolean;
  /** The `mock_tests.id` of the in-progress row (insert-on-first-ready OR resume). */
  activeTestId: string | null;
  /** Non-null when a saved in-progress test is being resumed. */
  resumeData: MockTestResumeData | null;
  /** Re-fires generation for any sections currently in `"failed"` status. */
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The mutable question shape produced by the prompt + passage-map merge. */
type MutableQuestion = {
  question: string;
  passage?: string;
  passageId?: string;
  audioBase64?: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  explanation: string;
};

/** Pure helper — initial state shape for `questions`. */
function initialQuestions(): Record<QcmSection, MCQContent[]> {
  return { listening: [], reading: [] };
}

/** Pure helper — initial state shape for `sectionStatus`. */
function initialSectionStatus(
  sections: readonly QcmSection[]
): Record<QcmSection, MockTestSectionStatus> {
  // Default both keys of the closed QcmSection union to "pending".
  const status: Record<QcmSection, MockTestSectionStatus> = {
    listening: "pending",
    reading: "pending",
  };
  // Belt-and-suspenders for any future union extension.
  for (const s of sections) status[s] = "pending";
  return status;
}

/**
 * Generate one section's questions. Returns the merged-questions array or
 * throws. Pre-13-4 lines 308-360 body lifted byte-faithful: same prompt
 * builder, same temperature, same maxTokens, same passage-map merge, same
 * `mock-test-undercount` Sentry tag. Only the LOOP wrapping changes
 * (serial → parallel).
 */
async function generateOneSection(
  section: QcmSection,
  cefrLevel: CEFRLevel
): Promise<MCQContent[]> {
  const prompt = buildMockTestPrompt({
    section,
    targetLevel: cefrLevel,
    questionCount: TCF_QCM_SECTIONS[section].questions,
  });

  const result = await chatCompletionJSON(
    [{ role: "system", content: prompt }],
    mockTestSectionSchema,
    // 39-question sections + passages emit ~6,000–7,500 output tokens; the
    // pre-fix 4096 cap truncated JSON mid-array, producing "Unexpected end of
    // input" parse failures. gpt-4o supports up to 16,384 output tokens.
    { temperature: 0.4, maxTokens: 12000, feature: `mock-test-${section}` }
  );

  const questions = result.questions.map((q) => ({ ...q })) as MutableQuestion[];

  if (result.passages && result.passages.length > 0) {
    const passageMap = new Map(result.passages.map((p) => [p.id, p.text]));
    for (const q of questions) {
      if (q.passageId && !q.passage) {
        q.passage = passageMap.get(q.passageId) ?? undefined;
      }
    }
  }

  // Domain-level undercount alert (pre-13-4 byte-faithful at lines 347-360).
  const expected = TCF_QCM_SECTIONS[section].questions;
  if (questions.length < Math.ceil(expected * 0.5)) {
    captureError(
      new Error(`Section ${section}: only ${questions.length}/${expected} questions generated`),
      "mock-test-undercount"
    );
  }

  // Listening-only: generate TTS audio for each unique passage in parallel.
  // Without this, the mock-test screen renders questions with no audio context
  // — users see "What did the speaker say?" with nothing to listen to. We
  // dedupe by passage TEXT (not passageId, since some questions ship with an
  // inline `passage` and no passageId), use Promise.allSettled so a single TTS
  // failure doesn't sink the whole section, and silently fall through to a
  // text-only "Show transcript" fallback on the rendering side for any
  // question whose audio generation rejected.
  if (section === "listening") {
    await attachListeningAudio(questions);
  }

  return questions as MCQContent[];
}

/**
 * Strip `audioBase64` from every question before persisting to the
 * `mock_tests.questions` JSONB column. Each base64 string is ~100-200KB
 * per passage; an unstripped section would bloat the row to several MB and
 * inflate Supabase storage + every subsequent SELECT. The audio is
 * regenerated on resume via `attachListeningAudio` (called by the resume
 * effect).
 */
function stripAudioBase64ForPersist(
  questions: Record<QcmSection, MCQContent[]>
): Record<QcmSection, MCQContent[]> {
  const result: Record<QcmSection, MCQContent[]> = {
    listening: questions.listening.map(({ audioBase64: _ignored, ...rest }) => rest),
    reading: questions.reading.map(({ audioBase64: _ignored, ...rest }) => rest),
  };
  return result;
}

/**
 * Generate TTS audio for each unique listening passage in parallel and
 * attach the resulting base64 string to every question that shares that
 * passage. Failures are captured to Sentry but do not propagate — the
 * listening section is still playable text-only via the transcript
 * fallback.
 */
async function attachListeningAudio(questions: MutableQuestion[]): Promise<void> {
  const uniquePassages = new Set<string>();
  for (const q of questions) {
    if (q.passage && q.passage.trim().length > 0) uniquePassages.add(q.passage);
  }
  if (uniquePassages.size === 0) return;

  const passageList = Array.from(uniquePassages);
  const ttsResults = await Promise.allSettled(
    passageList.map((text) => generateSpeech(text, { speed: 1.0 }))
  );

  const audioByPassage = new Map<string, string>();
  ttsResults.forEach((res, idx) => {
    if (res.status === "fulfilled") {
      audioByPassage.set(passageList[idx], res.value);
    } else {
      captureError(res.reason, "mock-test-listening-tts", {
        passageIndex: idx,
        totalPassages: passageList.length,
      });
    }
  });

  for (const q of questions) {
    if (q.passage && audioByPassage.has(q.passage)) {
      q.audioBase64 = audioByPassage.get(q.passage);
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMockTestGeneration(
  options: UseMockTestGenerationOptions
): UseMockTestGenerationReturn {
  const { sections, cefrLevel, testIdParam, enabled } = options;

  // Story 13-3 review-round-1 P2: content-key memoization defeats fresh-
  // reference-per-render re-fires. The `sections` array is computed inline
  // in the screen (`testId === "full" ? [...ALL_QCM_SECTIONS] : [testId]`),
  // so every parent render produces a fresh array reference even when
  // contents are byte-identical. Keying the effect on `sectionsKey` (a
  // content string) makes the dep stable.
  const sectionsKey = useMemo(() => sections.join(","), [sections]);

  const [questions, setQuestions] = useState<Record<QcmSection, MCQContent[]>>(initialQuestions);
  const [sectionStatus, setSectionStatus] = useState<Record<QcmSection, MockTestSectionStatus>>(
    () => initialSectionStatus(sections)
  );
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [resumeData, setResumeData] = useState<MockTestResumeData | null>(null);
  // Bumped each time `retry()` runs so the effect re-fires; preserves the
  // `enabled`/`sectionsKey`/`cefrLevel`/`testIdParam` deps as content-stable.
  const [retryCounter, setRetryCounter] = useState(0);

  // Refs — must be declared before any effect that reads them so the
  // closure capture is the same const binding throughout the file.
  const mountedRef = useRef(true);
  const insertFiredRef = useRef(false);
  const activeTestIdRef = useRef<string | null>(null);
  // Latest questions snapshot for the UPDATE path. setState commits AFTER
  // the per-section .then continuation runs, so we maintain the snapshot
  // here to read the post-settle questions blob synchronously.
  const questionsSnapshotRef = useRef<Record<QcmSection, MCQContent[]>>(initialQuestions());
  // Latest sectionStatus snapshot — used by the generation effect to skip
  // sections already in "ready" (post-retry partial-success case).
  const sectionStatusSnapshotRef = useRef<Record<QcmSection, MockTestSectionStatus>>(
    initialSectionStatus(sections)
  );

  // Lifecycle: mountedRef.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Story 13-4 review-round-1 P2 — snapshot-ref staleness cluster.
  // Pre-patch the 3 refs (questionsSnapshotRef, sectionStatusSnapshotRef,
  // activeTestIdRef) were mirrored via `useEffect` which runs AFTER the
  // setState commit. When two sections settled in quick succession, the
  // second settle read STALE ref values — symptoms: section-2 UPDATE
  // dropped because activeTestIdRef.current was null; INSERT payload
  // missing section data; retry filter excluding/including wrong sections.
  // Post-patch every setState site below ALSO updates the corresponding
  // ref SYNCHRONOUSLY (same statement) — the lagging useEffects are
  // deleted. Matches Story 11-2 review-round-2 P22 / Story 12-1 P22
  // sync-mirror invariant for cross-closure reads.

  // Main effect — resume detection FIRST, then parallel generation.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      const userId = (await supabase.auth.getSession()).data.session?.user?.id;
      if (!mountedRef.current || cancelled) return;

      // ---- Resume detection (first call ONLY — skip on retry) ----
      // `retryCounter === 0` ⇒ initial mount; > 0 ⇒ user pressed retry,
      // which means we already tried (and possibly resumed); proceed
      // straight to generation.
      const isFirstAttempt = retryCounter === 0;
      if (isFirstAttempt && userId) {
        const { data: existing } = await supabase
          .from("mock_tests")
          .select("*")
          .eq("user_id", userId)
          .eq("test_type", testIdParam) // L2: redundant ternary removed
          .eq("status", "in_progress")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!mountedRef.current || cancelled) return;

        if (existing?.questions && existing?.section_scores?.answers) {
          try {
            const saved = existing.section_scores as {
              answers?: Record<string, string>;
              currentSectionIndex?: number;
              currentQuestionIndex?: number;
              timeRemaining?: number;
              savedAt?: number;
              answeredQuestions?: string[];
            };
            const rawQuestions = (existing.questions ?? {}) as Record<string, MCQContent[]>;

            // Filter to the current Section union (pre-13-4 lines 230-233).
            const resumedQuestions: Record<QcmSection, MCQContent[]> = {
              listening: Array.isArray(rawQuestions.listening) ? rawQuestions.listening : [],
              reading: Array.isArray(rawQuestions.reading) ? rawQuestions.reading : [],
            };

            const hasValidQuestions = sections.some(
              (s) => Array.isArray(resumedQuestions[s]) && resumedQuestions[s].length > 0
            );
            if (!hasValidQuestions) {
              // Story 13-4 P2: sync mirror BEFORE setState so cross-closure
              // reads see the latest value even before React commits.
              activeTestIdRef.current = existing.id;
              setResumeData({
                activeTestId: existing.id,
                corrupt: true,
                resumedQuestions,
                savedSectionIndex: 0,
                savedQuestionIndex: 0,
                adjustedTimeRemaining: 0,
                savedAnswers: {},
                savedAnsweredQuestions: [],
              });
              setActiveTestId(existing.id);
              return;
            }

            const safeSectionIndex = Math.min(
              Math.max(0, saved.currentSectionIndex ?? 0),
              sections.length - 1
            );

            const expectedTotalSeconds =
              sections.reduce((sum, s) => sum + TCF_QCM_SECTIONS[s].minutes, 0) * 60;
            let adjustedTimeRemaining = saved.timeRemaining ?? 0;
            if (saved.savedAt && adjustedTimeRemaining > 0) {
              const elapsedSeconds = Math.floor((Date.now() - saved.savedAt) / 1000);
              adjustedTimeRemaining = Math.max(0, adjustedTimeRemaining - elapsedSeconds);
            }
            adjustedTimeRemaining = Math.min(adjustedTimeRemaining, expectedTotalSeconds);

            // Block the INSERT-on-first-ready path — we already have a row.
            insertFiredRef.current = true;
            activeTestIdRef.current = existing.id; // P2 sync mirror
            setActiveTestId(existing.id);
            setResumeData({
              activeTestId: existing.id,
              corrupt: false,
              resumedQuestions,
              savedSectionIndex: safeSectionIndex,
              savedQuestionIndex: Math.max(0, saved.currentQuestionIndex ?? 0),
              adjustedTimeRemaining,
              savedAnswers: saved.answers ?? {},
              savedAnsweredQuestions: saved.answeredQuestions ?? [],
            });
            // Mark resumed-section status as "ready" so consumers' allReady
            // / firstSectionReady semantics reflect a fully-loaded test.
            const sectionStatusAfterResume: Record<QcmSection, MockTestSectionStatus> = {
              listening: resumedQuestions.listening.length > 0 ? "ready" : "pending",
              reading: resumedQuestions.reading.length > 0 ? "ready" : "pending",
            };
            questionsSnapshotRef.current = resumedQuestions; // P2 sync mirror
            sectionStatusSnapshotRef.current = sectionStatusAfterResume; // P2 sync mirror
            setQuestions(resumedQuestions);
            setSectionStatus(sectionStatusAfterResume);

            // Listening audio is intentionally stripped from `mock_tests.questions`
            // before persist to avoid multi-MB row bloat — so a resumed row will
            // always have empty `audioBase64`. Regenerate it in the background so
            // the user reaches the listening section with playable audio. Fire-
            // and-forget; failures fall through to the text-only transcript
            // fallback in the rendering layer.
            if (
              resumedQuestions.listening.length > 0 &&
              resumedQuestions.listening.some((q) => !q.audioBase64)
            ) {
              void (async () => {
                const mutable = resumedQuestions.listening.map((q) => ({ ...q }));
                await attachListeningAudio(mutable);
                if (!mountedRef.current || cancelled) return;
                const merged = {
                  ...questionsSnapshotRef.current,
                  listening: mutable as MCQContent[],
                };
                questionsSnapshotRef.current = merged;
                setQuestions(merged);
              })();
            }

            // Story 13-4 review-round-1 P16 — partial-resume generation.
            // Pre-patch a legacy row with e.g. `listening: [items], reading: []`
            // was accepted by hasValidQuestions (only one section needs data)
            // BUT the early return below short-circuited generation, leaving
            // the empty section perpetually "pending" forever. Post-patch we
            // only short-circuit when EVERY section is "ready"; otherwise
            // fall through to the generation block which filters out the
            // already-ready sections via `sectionStatusSnapshotRef.current`.
            const allResumedReady = sections.every((s) => sectionStatusAfterResume[s] === "ready");
            if (allResumedReady) return; // True short-circuit only when full resume.
            // Else fall through — generation block handles the missing sections.
          } catch (err) {
            captureError(err, "mock-test-resume");
            if (!mountedRef.current || cancelled) return;
            activeTestIdRef.current = existing.id; // P2 sync mirror
            setResumeData({
              activeTestId: existing.id,
              corrupt: true,
              resumedQuestions: initialQuestions(),
              savedSectionIndex: 0,
              savedQuestionIndex: 0,
              adjustedTimeRemaining: 0,
              savedAnswers: {},
              savedAnsweredQuestions: [],
            });
            setActiveTestId(existing.id);
            return;
          }
        }
      }

      // ---- Parallel generation via Promise.allSettled ----
      // Each section's per-call settle fires setState IMMEDIATELY so the
      // consumer's `firstSectionReady` flips as soon as the first promise
      // resolves, NOT after both settle. The outer await is only there for
      // completeness; every state mutation happens inside the per-section
      // .then/.catch chain.
      //
      // Skip sections that are already "ready" — this covers the post-retry
      // partial-success case (Story 13-4 AC #1, retry() preserves successful
      // sections and only re-fires failed ones).
      const sectionsToGenerate = sections.filter(
        (s) => sectionStatusSnapshotRef.current[s] !== "ready"
      );

      await Promise.allSettled(
        sectionsToGenerate.map(async (section) => {
          try {
            const sectionQuestions = await generateOneSection(section, cefrLevel);
            if (!mountedRef.current || cancelled) return;

            // P2 sync mirrors — update refs IMMEDIATELY so the next per-section
            // settle reads the latest snapshot, not the post-React-commit
            // value that the lagging useEffect mirror used to provide.
            const newQuestions = {
              ...questionsSnapshotRef.current,
              [section]: sectionQuestions,
            };
            const newSectionStatus = {
              ...sectionStatusSnapshotRef.current,
              [section]: "ready" as MockTestSectionStatus,
            };
            questionsSnapshotRef.current = newQuestions;
            sectionStatusSnapshotRef.current = newSectionStatus;
            setQuestions(newQuestions);
            setSectionStatus(newSectionStatus);

            // Single-fire INSERT-on-first-ready guard. Two concurrent first-
            // section settles cannot both fire INSERT because we flip the
            // ref BEFORE the await dispatches.
            if (!insertFiredRef.current && userId) {
              insertFiredRef.current = true;

              // Capture snapshot AT INSERT TIME so we can detect whether a
              // sibling section settled during our await — see the follow-up
              // UPDATE below.
              const insertPayload = newQuestions;

              try {
                const { data: newTest, error: insertError } = await supabase
                  .from("mock_tests")
                  .insert({
                    // L2: dropped redundant `testIdParam === "full" ? "full" : testIdParam` ternary.
                    user_id: userId,
                    test_type: testIdParam,
                    // Strip audioBase64 to avoid bloating the JSONB row to
                    // several MB; the resume effect regenerates it via
                    // attachListeningAudio.
                    questions: stripAudioBase64ForPersist(insertPayload),
                    status: "in_progress",
                  })
                  .select("id")
                  .single();

                if (insertError) captureError(insertError, "mock-test-section-update");
                if (!mountedRef.current || cancelled) return;
                if (newTest) {
                  activeTestIdRef.current = newTest.id; // P2 sync mirror
                  setActiveTestId(newTest.id);

                  // Story 13-4 review-round-1 P2 (parallel-resolve race fix).
                  // If a sibling section settled while our INSERT was in
                  // flight, it skipped its own UPDATE branch because
                  // `activeTestIdRef.current` was null at the time. The
                  // sibling DID update `questionsSnapshotRef` synchronously
                  // (P2 sync mirror), so the latest snapshot now contains
                  // BOTH sections' data while our INSERT payload only had
                  // the first. Detect the drift + fire a single follow-up
                  // UPDATE to reconcile. (Fire-and-forget; failure logged
                  // but doesn't block the user-facing flow.)
                  if (questionsSnapshotRef.current !== insertPayload) {
                    const followUpPayload = questionsSnapshotRef.current;
                    const targetId = newTest.id;
                    void (async () => {
                      try {
                        const { error } = await supabase
                          .from("mock_tests")
                          .update({ questions: stripAudioBase64ForPersist(followUpPayload) })
                          .eq("id", targetId);
                        if (error) captureError(error, "mock-test-section-update");
                      } catch (err) {
                        captureError(err, "mock-test-section-update");
                      }
                    })();
                  }
                }
              } catch (err) {
                captureError(err, "mock-test-section-update");
              }
            } else if (activeTestIdRef.current && userId) {
              // Subsequent-section UPDATE — fire-and-forget; failure logged
              // but does NOT block the user-facing flow.
              const targetTestId = activeTestIdRef.current;
              void (async () => {
                try {
                  const { error } = await supabase
                    .from("mock_tests")
                    .update({ questions: stripAudioBase64ForPersist(newQuestions) })
                    .eq("id", targetTestId);
                  if (error) captureError(error, "mock-test-section-update");
                } catch (err) {
                  captureError(err, "mock-test-section-update");
                }
              })();
            }
          } catch (err) {
            captureError(err, `mock-test-generate-${section}`);
            if (!mountedRef.current || cancelled) return;
            const newSectionStatus = {
              ...sectionStatusSnapshotRef.current,
              [section]: "failed" as MockTestSectionStatus,
            };
            sectionStatusSnapshotRef.current = newSectionStatus; // P2 sync mirror
            setSectionStatus(newSectionStatus);
          }
        })
      );
    })();

    return () => {
      cancelled = true;
    };
    // sectionsKey is the content-stable dep (Story 13-3 P2). retryCounter
    // re-fires the effect on retry. cefrLevel + testIdParam + enabled all
    // need to be tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-key memoization
  }, [enabled, sectionsKey, cefrLevel, testIdParam, retryCounter]);

  const retry = useCallback(() => {
    if (!mountedRef.current) return;
    // Story 13-4 review-round-1 P15 — setState calls inside another
    // setState's updater function is the React anti-pattern (Strict
    // Mode warns; double-invocation breaks invariants). Pre-patch
    // `setActiveTestId(null)` lived inside `setResumeData((prev) => ...)`.
    // Post-patch: capture corrupt decision synchronously from the latest
    // `resumeData` closure value (useCallback dep added), then run each
    // setState as its own statement.
    const wasCorrupt = resumeData?.corrupt === true;

    // Reset failed → pending; ready stays ready (preserves partial success).
    const newSectionStatus = { ...sectionStatusSnapshotRef.current };
    for (const s of sections) {
      if (newSectionStatus[s] === "failed") newSectionStatus[s] = "pending";
    }
    sectionStatusSnapshotRef.current = newSectionStatus; // P2 sync mirror
    setSectionStatus(newSectionStatus);

    if (wasCorrupt) {
      // Corrupt-resume recovery: clear the row id + the insert-fired guard
      // so the next effect run treats this as a fresh INSERT.
      insertFiredRef.current = false;
      activeTestIdRef.current = null; // P2 sync mirror
      setActiveTestId(null);
      setResumeData(null);
    }

    setRetryCounter((n) => n + 1);
  }, [sections, resumeData]);

  const firstSectionReady = sections.length > 0 && sectionStatus[sections[0]] === "ready";
  const allReady = sections.length > 0 && sections.every((s) => sectionStatus[s] === "ready");
  const anyFailed = sections.some((s) => sectionStatus[s] === "failed");
  const allFailed = sections.length > 0 && sections.every((s) => sectionStatus[s] === "failed");

  return {
    questions,
    sectionStatus,
    firstSectionReady,
    allReady,
    anyFailed,
    allFailed,
    activeTestId,
    resumeData,
    retry,
  };
}
