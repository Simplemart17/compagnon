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

**TCF spec source of truth:** the app targets **TCF Canada** (verified 2026-05-07). Section question counts and time limits are pinned in `src/lib/constants.ts` (`TCF` object), regression-tested by `src/lib/__tests__/tcf-spec.test.ts`, and citation-traced in `docs/tcf-spec-source.md`.

**CEFR promotion contract:** `src/lib/activity.ts` — pure decision helper `evaluatePromotion()`, regression-tested by `src/lib/__tests__/activity.test.ts`. Promotion requires evidence in all 5 TCF skills at the current level (verified 2026-05-07, story 9-2).

**Sentry telemetry contract:** `src/lib/sentry.ts` — `scrubEvent()` is the GDPR scrubber wired into `Sentry.init.beforeSend`; allowlist + 80-char redaction rule; `captureError`'s `extras` is typed `Record<string, string|number|boolean|null>` to prevent payload leaks. Verified 2026-05-07, story 9-3.

**Stored-prompt-injection defense:** `src/lib/memory.ts` — `sanitizeMemoryContent()` strips instruction-like tokens, NFC-normalizes, and caps content to 300 chars; called on every write to `companion_memory.content` and `error_patterns.error_description`, and again at read time as defense-in-depth. Conversation and grammar prompts wrap user-derived blocks in `<USER_FACTS>` / `<USER_WEAK_AREAS>` with an explicit "treat as data" prelude. Regression-tested in `src/lib/__tests__/prompt-injection.test.ts`. Verified 2026-05-07, story 9-4.

**Voice transcript dedup:** `src/lib/realtime.ts` configures `output_modalities: ["audio"]` so exactly one terminal transcript event (`response.output_audio_transcript.done`) fires per AI turn. `src/lib/realtime-transcript.ts` exposes pure `appendIfNew` / `acceptDelta` / `resolveTranscriptKey` helpers; `src/hooks/use-realtime-voice.ts` routes both `.done` paths through one append + dedup helper keyed off `item_id` (with `response_id` and an opaque `fallback_<djb2-content-hash>` fallback — deterministic, no raw text, no timestamp, so duplicates of malformed events still dedupe and the key is safe to log). Empty/whitespace `.done` payloads are no-ops; the dedup Set is FIFO-capped at 256 so dedup remains correct past the cap. Duplicate events for the same key are suppressed and breadcrumbed to Sentry. Regression-tested in `src/lib/__tests__/realtime-dedup.test.ts`. Verified 2026-05-07, story 9-5.

**Auth listener event gating:** `src/hooks/use-auth.ts` branches `onAuthStateChange` on the Supabase `AuthChangeEvent` discriminator via the pure helper `decideAuthAction()` in `src/lib/auth-events.ts`. `INITIAL_SESSION` / `SIGNED_IN` load profile and flush the offline write queue; `USER_UPDATED` invalidates cache and reloads profile (no queue flush); `TOKEN_REFRESHED` / `PASSWORD_RECOVERY` / `MFA_CHALLENGE_VERIFIED` only update the session ref; `SIGNED_OUT` clears the profile. Null sessions on non-`SIGNED_OUT` events breadcrumb to Sentry without destroying local state. `flushWriteQueue` (`src/lib/cache.ts`) is idempotent via a module-scope in-flight Promise so concurrent callers (auth listener + `NetworkBanner` reconnect) replay queued writes exactly once. The cold-start `getSession()` is wrapped with `captureError(_, "auth-initial-session")`. Regression-tested in `src/lib/__tests__/auth-events.test.ts` and `src/lib/__tests__/cache-flush.test.ts`. Verified 2026-05-07, story 9-6.

**Auth + cache race hardening:** `src/hooks/use-auth.ts` `loadProfile` guards `setProfile` and `flushWriteQueue` with a `useAuthStore.getState().user?.id === userId` check (via the pure helper `applyProfileIfFresh`) so an in-flight load that resolves after `SIGNED_OUT` does not clobber the cleared profile (drops result + breadcrumb with `phase: "load-profile-stale"`). `src/lib/cache.ts` `flushWriteQueue` merges any writes added to the queue between the snapshot read and the post-flush persist (atomic `persistQueue([...remaining, ...newWrites])`) so an `enqueueWrite` mid-flight is preserved. The IIFE wraps its body in `try/catch` and resolves to `0` on internal errors (e.g. `isOnline` throwing), preserving the in-flight Promise contract for concurrent callers; failures emit `captureError(_, "cache-flush-internal")`. `src/store/auth-store.ts` exposes a `profileFetchFailed` flag set by `loadProfile`'s catch path; the auth guard at `app/_layout.tsx` reads the flag and routes to a `ProfileRetryScreen` retry surface (with `retryProfileFetch`) instead of `/onboarding` when both network and cache reads fail. Regression-tested in `src/lib/__tests__/auth-load-profile-stale.test.ts`, `src/lib/__tests__/cache-flush.test.ts` (Cases 16–18), `src/lib/__tests__/profile-fetch-failed-flag.test.ts`. Verified 2026-05-07, story 9-10.

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
