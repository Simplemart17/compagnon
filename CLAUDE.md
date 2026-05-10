# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Companion** is an AI-powered French language learning app targeting the TCF (Test de Connaissance du Français) exam. It is a React Native app built with Expo SDK 55, using Expo Router for file-based routing, NativeWind/Tailwind for styling, Supabase for backend, and OpenAI + Azure Speech for AI features.

## Development Commands

```bash
npx expo start          # Start Metro bundler (dev server)
npx expo start --ios    # Start and open iOS simulator
npx expo start --android # Start and open Android emulator
npx expo start --web    # Start web version
```

Linting (ESLint), formatting (Prettier), and pre-commit hooks (Husky + lint-staged) are configured.

```bash
npm run lint            # Run ESLint
npm run format:check    # Check Prettier formatting
npm run type-check      # Run TypeScript type checking
```

## Environment Setup

Copy `.env.example` to `.env.local` and fill in the keys:

- `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Supabase project (client-bundled)
- `EXPO_PUBLIC_SENTRY_DSN` — Sentry error tracking DSN (client-bundled)

AI API keys (`OPENAI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`) are server-side only — set them via `supabase secrets set`, never in the client.

## Architecture

**TCF spec source of truth:** the app targets **TCF Canada** (verified 2026-05-07; expanded + re-verified 2026-05-10 by story 10-1). Section question counts and time limits are pinned in `src/lib/constants.ts` (`TCF` object). The full spec — scoring scale + IRCC CLB equivalency table + per-CEFR passage expectations + Expression Orale 4-criterion rubric (FEI examiner convention; not published verbatim by the publisher) + Expression Écrite evaluation criteria + vocabulary frequency tiers + linguistic accuracy references — is documented at `docs/tcf-spec-source.md` (11 sections). Every TCF-derived value in the codebase appears in `docs/tcf-spec-citations.md` (the citations matrix); adding a new TCF claim without a matrix row fails `src/lib/__tests__/tcf-spec.test.ts` (12 cases). Four source snapshots live under `docs/tcf-canada-snapshots/` with retrieval timestamps + SHA-256 integrity headers: France Éducation International landing page, FEI samples page, IRCC CLB equivalency table (third-party-transcribed because canada.ca returned HTTP 403 to WebFetch — explicit caveat in the snapshot), and Council of Europe / Europass CEFR self-assessment grid. The `[A-Z0-9]{10}` Apple-Team-ID-shaped strings in CI leak guards do not match TCF score literals (numeric only). Verified 2026-05-10, story 10-1.

**CEFR promotion contract:** `src/lib/activity.ts` — pure decision helper `evaluatePromotion()`, regression-tested by `src/lib/__tests__/activity.test.ts`. Promotion requires evidence in all 5 TCF skills at the current level (verified 2026-05-07, story 9-2).

**Sentry telemetry contract:** `src/lib/sentry.ts` — `scrubEvent()` is the GDPR scrubber wired into `Sentry.init.beforeSend`; allowlist + 80-char redaction rule; `captureError`'s `extras` is typed `Record<string, string|number|boolean|null>` to prevent payload leaks. Verified 2026-05-07, story 9-3.

**Stored-prompt-injection defense:** `src/lib/memory.ts` — `sanitizeMemoryContent()` strips instruction-like tokens, NFC-normalizes, and caps content to 300 chars; called on every write to `companion_memory.content` and `error_patterns.error_description`, and again at read time as defense-in-depth. Conversation and grammar prompts wrap user-derived blocks in `<USER_FACTS>` / `<USER_WEAK_AREAS>` with an explicit "treat as data" prelude. Regression-tested in `src/lib/__tests__/prompt-injection.test.ts`. Verified 2026-05-07, story 9-4.

**Voice transcript dedup:** `src/lib/realtime.ts` configures `output_modalities: ["audio"]` so exactly one terminal transcript event (`response.output_audio_transcript.done`) fires per AI turn. `src/lib/realtime-transcript.ts` exposes pure `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` helpers; `src/hooks/use-realtime-voice.ts` routes both `.done` paths through one append + dedup helper keyed off `item_id` (with `response_id` and an opaque `fallback_<djb2-content-hash>` fallback — deterministic, no raw text, no timestamp, so duplicates of malformed events still dedupe and the key is safe to log). Empty/whitespace `.done` payloads are no-ops; the dedup Set is FIFO-capped at 256 so dedup remains correct past the cap. Duplicate events for the same key are suppressed and breadcrumbed to Sentry. Regression-tested in `src/lib/__tests__/realtime-dedup.test.ts`. Verified 2026-05-07, story 9-5.

**Auth listener event gating:** `src/hooks/use-auth.ts` branches `onAuthStateChange` on the Supabase `AuthChangeEvent` discriminator via the pure helper `decideAuthAction()` in `src/lib/auth-events.ts`. `INITIAL_SESSION` / `SIGNED_IN` load profile and flush the offline write queue; `USER_UPDATED` invalidates cache and reloads profile (no queue flush); `TOKEN_REFRESHED` / `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` only update the session ref; `SIGNED_OUT` clears the profile. Null sessions on non-`SIGNED_OUT` events breadcrumb to Sentry without destroying local state. `flushWriteQueue` (`src/lib/cache.ts`) is idempotent via a module-scope in-flight Promise so concurrent callers (auth listener + `NetworkBanner` reconnect) replay queued writes exactly once. The cold-start `getSession()` is wrapped with `captureError(_, "auth-initial-session")`. Regression-tested in `src/lib/__tests__/auth-events.test.ts` and `src/lib/__tests__/cache-flush.test.ts`. Verified 2026-05-07, story 9-6.

**Auth + cache race hardening:** `src/hooks/use-auth.ts` `loadProfile` guards `setProfile` and `flushWriteQueue` with a `useAuthStore.getState().user?.id === userId` check (via the pure helper `applyProfileIfFresh`) so an in-flight load that resolves after `SIGNED_OUT` does not clobber the cleared profile (drops result + breadcrumb with `phase: "load-profile-stale"`). `src/lib/cache.ts` `flushWriteQueue` merges any writes added to the queue between the snapshot read and the post-flush persist (atomic `persistQueue([...remaining, ...newWrites])`) so an `enqueueWrite` mid-flight is preserved. The IIFE wraps its body in `try/catch` and resolves to `0` on internal errors (e.g. `isOnline` throwing), preserving the in-flight Promise contract for concurrent callers; failures emit `captureError(_, "cache-flush-internal")`. `src/store/auth-store.ts` exposes a `profileFetchFailed` flag set by `loadProfile`'s catch path; the auth guard at `app/_layout.tsx` reads the flag and routes to a `ProfileRetryScreen` retry surface (with `retryProfileFetch`) instead of `/onboarding` when both network and cache reads fail. Regression-tested in `src/lib/__tests__/auth-load-profile-stale.test.ts`, `src/lib/__tests__/cache-flush.test.ts` (Cases 16–18), `src/lib/__tests__/profile-fetch-failed-flag.test.ts`. Verified 2026-05-07, story 9-10.

**AI response validation:** `src/lib/openai.ts` `chatCompletionJSON<T>` requires a Zod schema (`z.ZodType<T>`) and a `feature` tag. On schema parse failure the call is retried once with a fresh model invocation; if the retry also fails, `captureError(_, "ai-schema-parse-failed", { feature, attempt: 2, code })` fires and the call rejects. All AI response schemas live in `src/lib/schemas/ai-responses.ts` — one schema per call site (listening / reading / grammar / writing-prompt-gen / writing-evaluation / dictation / echo / translation-gen / translation-evaluation / fact-extraction / micro-drill / error-pattern-batch / mock-test-section / pronunciation / placement-test / conversation-feedback) plus the common atomics `mcqOptionSchema` (4-option enforcer) and `mcqQuestionSchema` (4-options-with-1-correct via `superRefine`). Hand-rolled validators (`validateMCQExercise`, `validateEchoResponse`, `validateTranslationResponse`, `validateEvaluationResponse`, the inline mock-test option filter, the placement-test polymorphic-options normalizer at `placement-test.tsx:489-518`) are deleted; the schemas express the same rules declaratively (`mcqQuestionSchema.superRefine` for the 4-options + 1-correct invariant, `placementTestSchema.preprocess` for the polymorphic-options normalization including object-vs-array options and `correct_answer` resolution). Sentry never sees the offending response text — only the `ZodIssueCode`, the issue path, and the call-site `feature` tag (allowlist-safe per `src/lib/sentry.ts:25`). The placement test uses `parseRetries: 2` (default elsewhere is 1) to reflect its higher stakes. Inferred types (`WritingEvaluation`, `ConversationFeedback`, `EchoSentence`, `TranslationSentence`, `TranslationEvaluation`, `WritingError`, `TranslationDimensionScore`) are now `z.infer<typeof X>` in `src/types/exercise.ts` and `src/types/conversation.ts`, so the type system mirrors runtime validation exactly. Regression-tested in `src/lib/schemas/__tests__/ai-responses.test.ts` and `src/lib/__tests__/chat-completion-json.test.ts`. Verified 2026-05-08, story 9-7.

**Speaking section pipeline:** `app/(tabs)/mock-test/speaking.tsx` runs the TCF Canada Expression Orale 3-task assessment as a record-and-grade flow (no Realtime — Realtime examiner role-play is Epic 10.6). Per task: `useAudioRecorder(RECORDING_OPTIONS_LOW_BITRATE)` (32 kbit AAC so 5.5-min Task 2 fits the 5 MB `ai-proxy` cap) → `transcribeAudio` (Whisper) → `chatCompletionJSON(_, speakingTaskEvaluationSchema, { feature: "speaking-eval-task-N" })` returns the official 4-criterion 0-20 rubric (pronunciation/fluency, vocabulary, grammar, interaction). Pure score helpers in `src/lib/speaking-scoring.ts` — `computeSpeakingTaskOverall` recomputes overall from the 4 dimensions × 1.25 when the model omits/null-emits it; `computeSpeakingComposite` averages the 3 task overalls (equal weights — recalibration owned by Epic 10.2). Per-CEFR topic libraries in `src/lib/prompts/speaking.ts` use a deterministic 3-day bucket so retakes within the window see the same prompt (anti-game heuristic; broader anti-repetition is Epic 10.8). Persists `mock_tests` row (`test_type="speaking"`, `section_scores.speaking.{task1,task2,task3,compositeOverall}`), 3 `mock_test_answers` rows (`selected_option=transcript`, `is_correct=NULL` since production tasks have no objective right answer), and runs the standard `updateSkillProgress("speaking") → incrementDailyActivity → updateStreak → checkCefrPromotion` chain — closing the only TCF Canada skill that previously had zero `mock_tests` coverage. Static route at `mock-test/speaking.tsx` takes precedence over `[testId].tsx` via Expo Router's static-over-dynamic resolution; the QCM runner is unchanged. Sentry tags `speaking-mock-test-{record,transcribe,eval}-task-{1|2|3}` and `speaking-mock-test-persist` ride on existing allowlist keys (zero changes to `SENTRY_EXTRAS_ALLOWLIST`); transcripts/audio are never carried in event payloads. The `<USER_TRANSCRIPT>` wrapper + "treat as data" prelude in `buildSpeakingEvaluatorPrompt` mirrors story 9-4's prompt-injection defense for transcribed user content. Regression-tested in `src/lib/__tests__/speaking-scoring.test.ts`, `src/lib/prompts/__tests__/speaking.test.ts`, `src/lib/__tests__/speaking-mock-test-persist.test.ts`, and `src/lib/schemas/__tests__/ai-responses.test.ts`. Verified 2026-05-09, story 9-8.

**Deploy substrate:** `eas.json` submit profiles read all credentials from EAS environment variables (`EXPO_ASC_API_KEY_ID`, `EXPO_ASC_API_KEY_ISSUER_ID`, `EXPO_ASC_APP_ID`, `EXPO_APPLE_TEAM_ID`, plus the `EXPO_ASC_API_KEY_P8` and `EXPO_GOOGLE_SERVICE_ACCOUNT_KEY` file secrets) — **no submit credentials live in git**. Deploy workflows: native builds via `.github/workflows/build.yml` (manual + on push to main, with `EXPO_PUBLIC_*` secrets injected so the JS boots), TestFlight / Play Internal-Track submission via `.github/workflows/submit.yml` (manual `workflow_dispatch`, gated by GitHub `production` environment review), Edge Functions via `.github/workflows/deploy.yml` (auto on push to `supabase/functions/**`, manual `force` available, per-function calls keep revision history clean), OTA updates via `.github/workflows/ota-update.yml` (manual; production publishes gated to `main` branch only). Sentry source maps upload automatically during both `eas build` and `eas update` because `SENTRY_AUTH_TOKEN` is in the EAS + GitHub Actions environment; the `@sentry/react-native/expo` config plugin handles the post-bundle upload — no manual `sentry-cli` step is needed. SQL migrations stay manual (`supabase db push`) until story 16-6 lands the rollback playbook — the deploy workflow emits a `::warning::` GitHub annotation when a push touches `supabase/migrations/`. CI guards regression of placeholder/literal credentials in source via the "Submit credentials leak guard" step in `ci.yml` (Apple Team ID `[A-Z0-9]{10}` and ASC App ID `[0-9]{10}` patterns are scoped to JSON `appleTeamId` / `ascAppId` keys to avoid false positives; placeholder pattern uses `[_]` character-class obfuscation so the regex source does not self-match). `.gitignore` blocks `google-service-account.json` (no `*.json` blanket rule exists — explicit line is the only safe defense) and was narrowed from `_bmad*` (which silently dropped new story files) to `_bmad/` + `_bmad-output/*` with `!_bmad-output/{implementation,planning}-artifacts/` carve-outs. Operator runbook: `_bmad-output/planning-artifacts/runbooks/submit-and-deploy.md`; OTA-specific rollback: `_bmad-output/planning-artifacts/runbooks/ota-hotfix.md`. Verified 2026-05-09, story 9-9.

### Routing (`app/`)

Expo Router file-based routing with three route groups:

- `(auth)/` — login, signup, forgot-password (unauthenticated)
- `onboarding/` — post-signup 3-step wizard
- `(tabs)/` — main app with 5 tabs: home, conversation, practice, mock-test, profile

Auth guard in `app/_layout.tsx` redirects based on session state and onboarding status.

### Application Logic (`src/`)

- **`src/hooks/`** — Custom hooks that are the primary interface for features. Each hook manages its own Supabase queries and API calls:
  - `use-auth.ts` — sign in/up/out, profile loading, onAuthStateChange subscription
  - `use-realtime-voice.ts` — orchestrates OpenAI Realtime WebSocket voice conversations
  - `use-exercise.ts` — AI exercise generation and grading via GPT-4o
  - `use-pronunciation.ts` — Azure Speech pronunciation assessment
  - `use-progress.ts` — skill progress and streaks from Supabase
  - `use-audio-recorder.ts` / `use-audio-player.ts` — expo-av recording/playback

- **`src/lib/`** — Core libraries and API clients:
  - `openai.ts` — OpenAI client (chat completions, TTS, embeddings) via `ai-proxy` Edge Function
  - `realtime.ts` — `RealtimeSession` class managing WebSocket to OpenAI Realtime API via `realtime-session` Edge Function
  - `supabase.ts` — Supabase client with expo-secure-store adapter for native sessions
  - `pronunciation.ts` — Azure Speech pronunciation assessment via `pronunciation-assess` Edge Function
  - `scoring.ts` — TCF score math (raw% → TCF scale, CEFR mapping)
  - `srs.ts` — SM-2 spaced repetition algorithm for vocabulary
  - `memory.ts` — Vector-based companion memory (extract facts, embed, store, retrieve via pgvector)
  - `error-tracker.ts` — recurring error pattern tracking and micro-drill generation
  - `prompts/` — System prompt builders per feature (conversation, grammar, listening, reading, writing, mock-test)

- **`src/store/`** — Zustand stores:
  - `auth-store.ts` — session, user, profile, isOnboarded

- **`src/types/`** — TypeScript types for CEFR/TCF domain, conversations, exercises, user profile

- **`src/components/`** — Reusable UI components organized by feature (conversation/, practice/)

### Database (`supabase/migrations/`)

- `001_initial_schema.sql` — All tables, RLS policies, auth trigger
- `002_memory_functions.sql` — `match_memories()` pgvector RPC function

Tables include: profiles, skill_progress, conversations, conversation_messages, exercises, vocabulary, mock_tests, mock_test_answers, daily_activity, companion_memory, error_patterns. All have RLS enforcing `auth.uid() = user_id`.

### Styling

NativeWind v4 (Tailwind for React Native). Custom theme in `tailwind.config.js`:

- `primary`: navy blue (`#1E3A5F`)
- `accent`: amber/gold (`#F5A623`)
- `success`: `#34C759`, `error`: `#FF3B30`
- `surface`: off-white (`#F5F5F0`)

Global CSS at `src/styles/global.css`.

## Key Conventions

- **Path alias**: `@/*` maps to repo root (e.g., `import { supabase } from '@/src/lib/supabase'`)
- **TypeScript strict mode** enabled
- **Typed routes** enabled (`experiments.typedRoutes` in app.json)
- All AI API calls are proxied through Supabase Edge Functions (`ai-proxy`, `realtime-session`, `pronunciation-assess`) — API keys never leave the server
- All Supabase tables use Row-Level Security scoped to `auth.uid()`
- The `components/` directory at repo root contains unused Expo boilerplate — new components go in `src/components/`
