# Supabase Deployment Guide

Step-by-step guide to deploy the Companion app's Supabase backend.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`brew install supabase/tap/supabase`)
- A Supabase project created at [supabase.com](https://supabase.com)
- OpenAI API key
- Azure Speech Service key and region

---

## 1. Link Your Project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is the part of your Supabase URL after `https://` and before `.supabase.co`.

---

## 2. Enable the pgvector Extension

In the Supabase dashboard:

1. Go to **Database → Extensions**
2. Search for `vector`
3. Enable it

This is required for the companion memory feature.

---

## 3. Run Database Migrations

```bash
supabase db push
```

This applies both migrations in order:

- `001_initial_schema.sql` — all tables, RLS policies, auth trigger
- `002_memory_functions.sql` — `match_memories()` pgvector function

---

## 4. Set Edge Function Secrets

```bash
supabase secrets set \
  OPENAI_API_KEY=sk-your-openai-key \
  AZURE_SPEECH_KEY=your-azure-speech-key \
  AZURE_SPEECH_REGION=westeurope
```

These are only accessible inside Edge Functions — never exposed to the client.

---

## 5. Deploy Edge Functions

```bash
supabase functions deploy ai-proxy
supabase functions deploy realtime-session
supabase functions deploy pronunciation-assess
```

Verify they deployed successfully:

```bash
supabase functions list
```

---

## 6. Configure Client Environment

Copy `.env.example` to `.env.local` and fill in:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
```

The anon key is safe to include in the client — all data is protected by Row-Level Security.

---

## Tables Overview

| Table                   | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `profiles`              | User data, CEFR level, streaks, onboarding flag |
| `skill_progress`        | Per-skill scores and practice history           |
| `conversations`         | Voice practice sessions                         |
| `conversation_messages` | Transcript with corrections                     |
| `exercises`             | AI-generated MCQ and writing exercises          |
| `vocabulary`            | Spaced repetition word list (SM-2)              |
| `mock_tests`            | TCF test sessions                               |
| `mock_test_answers`     | Individual question answers                     |
| `daily_activity`        | Streak tracking and analytics                   |
| `companion_memory`      | Vector embeddings for personalized memory       |
| `error_patterns`        | Recurring mistakes for micro-drill targeting    |

All tables have Row-Level Security enforcing `auth.uid() = user_id`.

---

## Edge Functions Overview

| Function               | Purpose                                  | Rate Limit          |
| ---------------------- | ---------------------------------------- | ------------------- |
| `ai-proxy`             | Proxies OpenAI chat, TTS, and embeddings | 30 req/min per user |
| `realtime-session`     | Issues ephemeral WebSocket tokens        | 10 req/min per user |
| `pronunciation-assess` | Proxies Azure Speech assessment          | 20 req/min per user |

---

## Verify Deployment

Test that everything is working:

```bash
# Check Edge Functions are reachable (requires a valid JWT)
curl -s https://your-project.supabase.co/functions/v1/ai-proxy \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"action":"chat","messages":[{"role":"user","content":"Hello"}]}'
```
