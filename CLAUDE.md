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
  - `progress-store.ts` — per-skill progress, daily activity, streaks

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
