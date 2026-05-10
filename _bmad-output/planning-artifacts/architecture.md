---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: "complete"
completedAt: "2026-03-24"
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/project-context.md
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/data-models.md
  - docs/api-contracts.md
  - docs/development-guide.md
  - docs/source-tree-analysis.md
  - docs/deployment-guide.md
  - docs/component-inventory.md
workflowType: "architecture"
project_name: "companion"
user_name: "Simplemart"
date: "2026-03-24"
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

60 functional requirements across 11 domains, plus 8 planned Phase 2 requirements. The requirements span three architectural tiers:

| Tier                     | Domains                                                                                               | Architectural Impact                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Real-time AI**         | Voice conversations (FR7-15), Pronunciation (FR22-24)                                                 | WebSocket management, audio streaming, parallel async processing, state machines |
| **AI-generated content** | Exercises (FR16-21), Dictation (FR25-27), Mock tests (FR28-32), Phase 2 translation/echo              | Request-response AI proxy, JSON validation, structured prompt engineering        |
| **Data persistence**     | Progress (FR37-42), Vocabulary/SRS (FR33-36), Profile (FR43-47), History (FR48-49), Offline (FR50-52) | Supabase CRUD with RLS, caching with TTL, offline write queue, vector search     |

Cross-domain flows are the primary architectural challenge: voice conversations trigger memory extraction, error tracking, skill progress updates, streak tracking, and feedback generation — spanning all three tiers in a single user interaction.

**Non-Functional Requirements:**

34 NFRs organized into 6 categories driving architectural decisions:

| Category                       | Key Constraints                                                                          | Architectural Driver                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Performance** (NFR1-7)       | Voice < 2s, exercises < 5s, 60fps, cached data < 500ms                                   | Parallel async, FlatList virtualization, Reanimated, AsyncStorage caching |
| **Security** (NFR8-15)         | Server-side keys, RLS on all tables, JWT validation, rate limits, no PII in logs         | Edge Function proxy layer, Supabase RLS, expo-secure-store                |
| **Accessibility** (NFR16-20)   | Labels, 44pt targets, WCAG AA, Dynamic Type, skeletons                                   | Manual a11y on all components, system fonts, skeleton loading pattern     |
| **Integration** (NFR21-25)     | Retry with backoff, graceful degradation, session expiry, network detection, write queue | Retry logic in openai.ts, network.ts checks, cache.ts write queue         |
| **Reliability** (NFR26-30)     | 99.5% Edge Functions, zero data loss, mock test resume, back-press guards, Sentry        | Error boundaries, data integrity patterns, BackHandler guards             |
| **Content Quality** (NFR31-34) | Temperature 0.4, MCQ validation, 13+ content, TCF distribution                           | Validation functions, prompt engineering, structural checks               |

**Scale & Complexity:**

- Primary domain: Mobile application with AI-powered backend services
- Complexity level: Medium-High
- Architectural components: ~45 (36 screens, 10 hooks, 4 Edge Functions, 15+ library modules, 6 prompt builders, 7 shared components)

### Technical Constraints & Dependencies

| Constraint                                | Source                | Impact                                                              |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| Expo SDK 55 managed workflow              | Framework choice      | Pins dependency versions; no native module linking without prebuild |
| Supabase Edge Functions (Deno runtime)    | Backend platform      | ESM imports via `esm.sh`, `Deno.env.get()`, no Node.js modules      |
| Single Zustand store (auth only)          | Architecture decision | All feature state is hook-local; no new global stores               |
| NativeWind v4 (className, not StyleSheet) | Styling constraint    | Dynamic styles via inline `style` with design tokens                |
| No test framework                         | Quality strategy      | TypeScript strict + ESLint zero-warnings + Prettier replace tests   |
| OpenAI Realtime API (WebSocket)           | Voice feature         | Ephemeral token model, server VAD, PCM16 24kHz audio format         |
| Azure Speech Services (fr-FR)             | Pronunciation         | Phoneme-level assessment, specific audio format requirements        |
| pgvector (1536 dimensions)                | Memory feature        | text-embedding-3-small model, HNSW index, cosine similarity         |

### Cross-Cutting Concerns Identified

| Concern                            | Affected Components                                      | Current Implementation                                                            |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Authentication & Authorization** | All screens, all hooks, all Edge Functions, all tables   | Supabase Auth + RLS + JWT validation + expo-secure-store                          |
| **Error Handling & Reporting**     | All hooks, all screens, all Edge Functions               | `captureError()` → Sentry with context tags, ErrorBoundary component              |
| **Offline Resilience**             | Profile, skills, activity, vocabulary, network detection | `cache.ts` TTL cache + write queue + `NetworkBanner` flush                        |
| **Design System Consistency**      | All screens, all components                              | `design.ts` tokens (Colors, Typography, Spacing, Radii, Shadows)                  |
| **Accessibility**                  | All interactive elements                                 | Manual `accessibilityRole/Label/Hint`, 44pt targets, WCAG AA contrast             |
| **Rate Limiting**                  | All Edge Functions                                       | Sliding window in-memory limiter per user per function                            |
| **AI Content Validation**          | Exercise generation, mock tests                          | MCQ validation (4 options, 1 correct), temperature constraints, structural checks |
| **Network-Aware Operations**       | All AI calls, realtime connections                       | `requireNetwork()` before API calls, retry with backoff                           |

## Starter Template Evaluation

### Primary Technology Domain

**Mobile application (React Native / Expo)** with AI-powered Supabase backend — identified from existing codebase and project requirements.

### Starter Options Considered

This is a **brownfield project** with a fully implemented MVP. The technology stack was established during initial development using `create-expo-app` with the Expo SDK 55 managed workflow. No starter template evaluation is needed — the architectural foundation is already in production.

### Established Foundation: Expo SDK 55 Managed Workflow

**Rationale:** The existing codebase serves as the architectural foundation. All technology decisions are implemented, tested via CI, and ready for app store submission. Future development extends this foundation rather than replacing it.

**Initialization (historical):**

```bash
npx create-expo-app companion --template blank-typescript
```

**Architectural Decisions Established by Foundation:**

**Language & Runtime:**

- TypeScript 5.9 with strict mode, `jsxImportSource: "nativewind"`
- Path alias `@/*` → repo root via `tsconfig.json`
- Expo SDK 55 manages dependency version pinning

**Styling Solution:**

- NativeWind v4 (`className` for static, inline `style` for dynamic)
- Custom design token system (`src/lib/design.ts`) — Colors, Typography, Spacing, Radii, Shadows
- Tailwind theme in `tailwind.config.js` (primary/accent/surface palette)

**Build Tooling:**

- Metro bundler with NativeWind + Sentry plugins
- EAS Build (development/preview/production profiles)
- Babel preset: `babel-preset-expo` + NativeWind

**Quality Gates (replaces testing framework):**

- TypeScript strict mode (zero errors)
- ESLint 9 flat config (zero warnings, `--max-warnings 0`)
- Prettier 3.8 (double quotes, 2-space, 100 char, trailing commas)
- Husky + lint-staged pre-commit enforcement
- GitHub Actions CI: type-check + lint + format:check + migration validation

**Code Organization:**

- `app/` — Expo Router file-based routing (3 route groups: auth, onboarding, tabs)
- `src/hooks/` — Feature hooks (primary abstraction layer)
- `src/lib/` — Libraries, API clients, utilities, prompt builders
- `src/components/{feature}/` — Shared UI components
- `src/store/` — Single Zustand auth store
- `src/types/` — Domain TypeScript types
- `supabase/functions/` — Edge Functions (Deno runtime)
- `supabase/migrations/` — SQL schema evolution

**Development Experience:**

- Metro hot reload via `npx expo start`
- EAS development builds for simulator/device testing
- Sentry error monitoring in all environments
- No test runner — quality enforced via static analysis gates

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Already Established — MVP):**

All critical architectural decisions are in place. The brownfield codebase has a production-ready foundation with established patterns across all five decision categories.

**Important Decisions (Phase 2 — Decide When Development Begins):**

| Decision                            | Category       | Trigger                                         |
| ----------------------------------- | -------------- | ----------------------------------------------- |
| Push notification token storage     | Data           | When notification engine development starts     |
| Echo Practice data model            | Data           | When multi-skill exercise development starts    |
| "Practice Now" computation strategy | API            | When tutor-directed practice development starts |
| Rate limiter persistence            | Infrastructure | When user base exceeds ~1000 DAU                |
| Background job scheduler            | Infrastructure | When data retention policy enforcement begins   |

**Deferred Decisions (Phase 3+):**

| Decision                                    | Category    | Trigger                              |
| ------------------------------------------- | ----------- | ------------------------------------ |
| Monetization infrastructure (subscriptions) | Data + API  | When subscription model is finalized |
| Multi-exam content architecture             | Data        | When DELF/DALF support is scoped     |
| Institutional/B2B multi-tenancy             | Data + Auth | When B2B tier is pursued             |

### Data Architecture

| Decision               | Choice                                     | Version                                         | Rationale                                                                                                                     |
| ---------------------- | ------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Database**           | Supabase PostgreSQL + pgvector             | Supabase JS 2.99                                | Unified auth, database, Edge Functions, and vector search in one platform                                                     |
| **Data modeling**      | Relational with JSONB for flexible content | PostgreSQL 15+                                  | Structured tables for entities (profiles, exercises), JSONB for AI-generated content (questions, evaluations, corrections)    |
| **Data validation**    | Application-level + DB constraints         | —                                               | CHECK constraints for enums (CEFR levels, skills, modes), UNIQUE constraints for deduplication, AI output validation in hooks |
| **Migration approach** | Timestamped SQL files, append-only         | `supabase db push`                              | 5 migrations applied sequentially; never modify applied migrations                                                            |
| **Caching strategy**   | AsyncStorage with TTL + write queue        | `@react-native-async-storage/async-storage` 2.2 | Profile 4h, skills 30m, activity 15m, vocabulary 2h; offline SRS via write queue                                              |
| **Vector search**      | pgvector HNSW index, cosine similarity     | pgvector (1536 dims)                            | text-embedding-3-small embeddings, threshold 0.7, top 10 results                                                              |

**Phase 2 Data Growth Strategy:**

- **New exercise types** (translation, echo): Extend existing `exercises` table using `exercise_type` discriminator + `content` JSONB. No new tables unless the data shape diverges fundamentally.
- **Push tokens**: New `device_tokens` table with RLS (`auth.uid() = user_id`), UNIQUE on (user_id, token).
- **"Practice Now"**: Client-side aggregation first (query skills + errors + SRS due counts). Migrate to server-side pre-computation only if latency exceeds 500ms.

### Authentication & Security

| Decision                       | Choice                                                      | Rationale                                                                            |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Authentication**             | Supabase Auth (email/password)                              | Integrated with RLS, handles JWT lifecycle, token refresh                            |
| **Authorization**              | Row-Level Security on all tables                            | `auth.uid() = user_id` on every table; no application-level auth checks needed       |
| **Token storage**              | expo-secure-store (native keychain/keystore)                | Secure by default; not in AsyncStorage                                               |
| **API key security**           | Server-side only in Edge Function secrets                   | `supabase secrets set`; never in client bundle                                       |
| **JWT validation**             | Every Edge Function validates via `supabase.auth.getUser()` | Consistent pattern across all 4 functions                                            |
| **Model allowlists**           | Hardcoded in Edge Functions                                 | Prevents unauthorized model usage via proxy                                          |
| **Rate limiting**              | In-memory sliding window per user per function              | 30/min (ai-proxy), 10/min (realtime), 20/min (pronunciation), 1/min (account-delete) |
| **SECURITY DEFINER functions** | `SET search_path = public` on all                           | Prevents search_path injection                                                       |

**Phase 2 Security Growth:**

- Rate limiter persistence: Evaluate Redis or Supabase table-backed limiter when cold-start resets become problematic at scale.
- Notification permissions: Follow expo-notifications permission model; no additional auth changes needed.

### API & Communication Patterns

| Decision                   | Choice                                            | Rationale                                                                                |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **API pattern**            | Supabase Edge Functions (Deno) as proxy layer     | Single deployment target; secrets management built in                                    |
| **Communication protocol** | HTTPS (Edge Functions) + WebSocket (Realtime API) | REST-like for request/response; WebSocket for full-duplex voice                          |
| **Error handling**         | Structured error codes (`ErrorCode` enum)         | `AUTH_MISSING`, `RATE_LIMITED`, `UPSTREAM_ERROR`, etc. — consistent across all functions |
| **Error response format**  | `{ error, code, retryAfter? }`                    | Machine-parseable codes + human-readable messages                                        |
| **Retry strategy**         | Client-side exponential backoff (2 retries)       | Retryable: network/timeout/5xx/429. Non-retryable: auth/validation                       |
| **API documentation**      | `docs/api-contracts.md`                           | Request/response schemas for all 4 Edge Functions                                        |
| **CORS**                   | `Access-Control-Allow-Origin: *`                  | Required for Supabase client invocations                                                 |

**Phase 2 API Growth:**

- Notifications: New `notification-register` Edge Function (separate concern from AI proxy). Handles token registration and preference updates.
- No API versioning needed yet — single client consuming all endpoints.

### Frontend Architecture

| Decision                   | Choice                                                        | Rationale                                                                         |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Architecture pattern**   | Hook-driven feature architecture                              | Screens are thin UI wrappers; hooks own state + API calls + side effects          |
| **State management**       | Zustand (auth only) + hook-local state                        | Single global store; feature state stays in hooks via `useState`/`useRef`         |
| **Routing**                | Expo Router file-based with typed routes                      | 3 route groups: `(auth)/`, `onboarding/`, `(tabs)/`                               |
| **Component architecture** | `React.memo` + named functions + props interfaces             | Shared components in `src/components/{feature}/`; screen sub-components inline    |
| **Styling**                | NativeWind v4 `className` + inline `style` with design tokens | Static layout via Tailwind utilities; dynamic via `Colors`/`Typography`/`Spacing` |
| **Animations**             | react-native-reanimated 4.2 shared values                     | Spring/timing transitions; never RN built-in `Animated`                           |
| **Lists**                  | FlatList with virtualization                                  | Never ScrollView + `.map()` for dynamic lists                                     |
| **Loading states**         | Skeleton animations                                           | Never spinners                                                                    |

**Phase 2 Frontend Growth:**

- Echo Practice: Dedicated `use-echo-practice.ts` hook (new exercise type with distinct multi-step flow). Do not generalize `useExercise` — keep it focused on single-step MCQ/writing.
- Component promotion: Promote `StatTile`, `ActivityBar`, `SkillCard` to `src/components/common/` only when Phase 2 screens actually reuse them. No speculative extraction.

### Infrastructure & Deployment

| Decision               | Choice                                                        | Rationale                                                     |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| **Hosting**            | Supabase (backend) + EAS (mobile builds)                      | Unified backend; managed build service                        |
| **CI/CD**              | GitHub Actions (`ci.yml` + `build.yml`)                       | Quality gates on push/PR; EAS builds on merge to main         |
| **Environment config** | `.env.local` (client) + `supabase secrets` (server)           | Clear separation; no secrets in client bundle                 |
| **Monitoring**         | Sentry (`@sentry/react-native` ~7.11)                         | Error tracking with context tags across all screens and hooks |
| **Build profiles**     | Development (simulator), Preview (device), Production (store) | EAS manages signing, versioning, and distribution             |

**Phase 2 Infrastructure Growth:**

- Background jobs: `pg_cron` extension in Supabase for data retention cleanup and inactive account warnings. No external scheduler needed — keeps infrastructure in one platform.
- Scaling: Supabase handles database scaling. Edge Function cold starts are the primary latency concern; monitor and optimize as user base grows.

### Decision Impact Analysis

**Implementation Sequence (Phase 2):**

1. **Notification Engine** — New Edge Function + device_tokens table + expo-notifications. Independent of other features.
2. **Echo Practice** — New hook + new screen + exercises table extension. Uses existing audio infrastructure.
3. **Speech-to-Speech Translation** — New hook + new screen + exercises table extension + new prompt builder. Highest complexity.
4. **"Practice Now"** — Client-side aggregation first. Depends on having sufficient user data from features 1-3.

**Cross-Component Dependencies:**

| Decision                  | Depends On                       | Affects                                             |
| ------------------------- | -------------------------------- | --------------------------------------------------- |
| Push notification tokens  | Supabase Auth (user_id FK)       | Notification delivery, streak alerts, SRS reminders |
| Echo Practice data model  | Existing exercises table schema  | Skill progress tracking, error pattern detection    |
| Rate limiter persistence  | User volume growth metrics       | All Edge Functions                                  |
| Background jobs (pg_cron) | Supabase plan supporting pg_cron | Data retention, inactive account policy             |

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5 areas where AI agents could make different choices, all now resolved with explicit patterns.

### Naming Patterns

**Database Naming Conventions (SQL):**

All SQL identifiers use `snake_case`. This is non-negotiable.

| Element      | Convention                                             | Example                                                         |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| Tables       | `snake_case`, plural                                   | `device_tokens`, `error_patterns`, `mock_test_answers`          |
| Columns      | `snake_case`                                           | `user_id`, `created_at`, `cefr_level`, `next_review`            |
| Foreign keys | `<referenced_table_singular>_id`                       | `user_id`, `conversation_id`, `mock_test_id`                    |
| Indexes      | `idx_<table>_<columns>`                                | `idx_vocabulary_user_review`, `idx_conversations_status`        |
| Constraints  | `<table>_<column>_check` or `<table>_<columns>_unique` | UNIQUE(user_id, skill), CHECK IN (A1, A2, ...)                  |
| Functions    | `snake_case` verb phrase                               | `handle_new_user()`, `match_memories()`, `cleanup_stale_data()` |
| Triggers     | `on_<table>_<event>`                                   | `on_auth_users_created`, `on_daily_activity_upsert`             |

**JSONB Field Naming (inside SQL JSONB columns):**

JSONB keys use `camelCase` — matching the TypeScript types that produce and consume them.

| Context          | Convention         | Example                                         |
| ---------------- | ------------------ | ----------------------------------------------- |
| JSONB field keys | `camelCase`        | `fluencyRating`, `grammarScore`, `overallScore` |
| JSONB arrays     | `camelCase` plural | `strengths`, `improvements`, `connectorsUsed`   |

**Code Naming (TypeScript):**

| Element                        | Convention               | Example                                                 |
| ------------------------------ | ------------------------ | ------------------------------------------------------- |
| Files (screens/routes)         | kebab-case               | `placement-test.tsx`, `[sessionId].tsx`                 |
| Files (components)             | PascalCase               | `MCQCard.tsx`, `AudioWaveform.tsx`                      |
| Files (hooks/lib/types/stores) | kebab-case               | `use-exercise.ts`, `error-tracker.ts`                   |
| Components                     | PascalCase               | `TranscriptView`, `CorrectionBubble`                    |
| Hooks                          | `use<Feature>` camelCase | `useExercise`, `useRealtimeVoice`                       |
| Functions                      | camelCase                | `buildGrammarPrompt`, `captureError`                    |
| Types/Interfaces               | PascalCase               | `CEFRLevel`, `WritingEvaluation`                        |
| Hook return types              | `Use<Feature>Return`     | `UseExerciseReturn`, `UseDictationReturn`               |
| Props interfaces               | `<Component>Props`       | `MCQCardProps`, `ScoreCardProps`                        |
| Constants                      | UPPER_SNAKE_CASE         | `CACHE_KEYS`, `SKILL_LABELS`, `LEVEL_COLORS`            |
| Prompt builders                | `build<Feature>Prompt`   | `buildGrammarExercisePrompt`, `buildConversationPrompt` |

### Edge Function Structure Pattern

Every new Edge Function must follow this exact structure:

```typescript
/**
 * <Function Name> Edge Function
 *
 * <One-line description.>
 * <Key security/architectural note.>
 *
 * Rate limited to N requests per minute.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { errorResponse, parseUpstreamError } from "../_shared/errors.ts";

// --- Constants ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const RATE_LIMIT = { requests: N, windowSeconds: 60 };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 2. Verify environment variables
    // 3. Authenticate user via JWT
    // 4. Rate limiting via checkRateLimit()
    // 5. Parse and validate request body
    // 6. Business logic
    // 7. Return success response with corsHeaders + X-RateLimit-Remaining
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse({ code: "INTERNAL_ERROR", message, status: 500, corsHeaders });
  }
});
```

**Mandatory elements:** JSDoc header, `_shared/` imports, CORS preflight, env var verification, JWT auth, rate limiting, try/catch with `errorResponse()`, `corsHeaders` on every response.

### Hook vs Library Function Boundary

| Use a hook (`src/hooks/`) when                                   | Use a library function (`src/lib/`) when     |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Feature has UI state driving screen rendering                    | Function is stateless — input in, output out |
| Needs React lifecycle (useEffect, useCallback, useRef)           | Reusable across multiple hooks               |
| Orchestrates multiple library calls in user interaction sequence | Pure algorithm or API client wrapper         |
| Owns a screen-level state machine                                | Doesn't need React context                   |

**Decision rule:** If you need `useState` or `useRef`, it's a hook. If you don't, it's a library function.

### AI Prompt Builder Conventions

**File structure:** One exported `build<Feature>Prompt(params): string` per file, with private `Record<CEFRLevel, string>` maps for level-specific content.

**Temperature and model conventions:**

| Content Type                     | Temperature | Model        | maxTokens |
| -------------------------------- | ----------- | ------------ | --------- |
| Exercise generation (MCQ)        | 0.4         | gpt-4o       | 2048      |
| Writing evaluation               | 0.4         | gpt-4o       | 2048      |
| Mock test generation             | 0.4         | gpt-4o       | 4096      |
| Error/fact extraction            | 0.2         | gpt-4o       | 2048      |
| Conversation (realtime)          | 0.7         | gpt-realtime | —         |
| Translation evaluation (Phase 2) | 0.4         | gpt-4o       | 2048      |
| Echo practice scoring (Phase 2)  | 0.4         | gpt-4o       | 2048      |

**Rule:** Scoring/generation = 0.4. Extraction = 0.2. Conversation = 0.7. No exceptions without documenting the reason.

### Screen State Machine Pattern

All screens with multi-phase flows must define states as a discriminated union type with a single `screenState` variable.

**Standard state vocabulary:**

| State        | Meaning                                        | UI Pattern                    |
| ------------ | ---------------------------------------------- | ----------------------------- |
| `idle`       | Waiting for user to initiate                   | Start/generate button visible |
| `generating` | AI is generating content                       | Skeleton animation            |
| `connecting` | WebSocket/network connection in progress       | Branded connection animation  |
| `active`     | User is engaged with the exercise/conversation | Primary interaction UI        |
| `checking`   | Evaluating user's submission                   | Brief loading indicator       |
| `results`    | Showing outcome/feedback                       | Score, feedback, next actions |
| `error`      | Recoverable error occurred                     | Error message + retry + back  |

**Rules:**

- State type must be exported: `export type <Feature>ScreenState = "idle" | "generating" | ...`
- Use the subset of standard states that applies — not every screen needs every state
- Transitions go forward only, except `error → idle` (retry) and `results → idle` (new exercise)
- `generating` always renders skeleton animations, never spinners
- `error` always offers both "Retry" and "Back" actions

**Existing implementations:**

| Screen             | States                                            |
| ------------------ | ------------------------------------------------- |
| Dictation          | `idle → generating → active → checking → results` |
| Voice conversation | `idle → connecting → active → results`            |
| Mock test          | `idle → generating → active → results`            |
| Exercises          | `idle → generating → active → checking → results` |

### Enforcement Guidelines

**All AI Agents MUST:**

1. Run `npm run type-check && npm run lint && npm run format:check` before considering implementation complete
2. Use only constants from `@/src/lib/design.ts` — never hardcode hex values
3. Follow the Edge Function template exactly for new server-side functions
4. Define a `<Feature>ScreenState` type for any new multi-phase screen
5. Place stateless logic in `src/lib/`, stateful feature logic in `src/hooks/`
6. Use temperature 0.4 for generation/scoring, 0.2 for extraction, 0.7 for conversation

**Pattern Enforcement:**

- **Automated:** ESLint, TypeScript strict, Prettier, pre-commit hooks
- **Convention-based:** Database naming, Edge Function structure, state machine pattern, hook/library boundary enforced by `project-context.md`
- **Update process:** New patterns added to `project-context.md` and this architecture document

## Project Structure & Boundaries

### Complete Project Directory Structure

```
companion/
├── .github/
│   └── workflows/
│       ├── ci.yml                          # Quality gates: type-check, lint, format, migrations
│       └── build.yml                       # EAS build automation (iOS/Android)
│
├── app/                                    # Expo Router — file-based routing (36 screens)
│   ├── _layout.tsx                         # Root layout: auth guard, Sentry init, splash
│   ├── index.tsx                           # Entry redirect → /(tabs)/home
│   ├── +not-found.tsx                      # 404 fallback
│   │
│   ├── (auth)/                             # Unauthenticated routes [FR1-3, FR6]
│   │   ├── _layout.tsx
│   │   ├── login.tsx                       # FR2: Sign in
│   │   ├── signup.tsx                      # FR1: Create account
│   │   ├── forgot-password.tsx             # FR3: Password reset
│   │   ├── privacy-policy.tsx              # FR6: Privacy policy
│   │   └── terms.tsx                       # FR6: Terms of service
│   │
│   ├── onboarding/                         # Post-signup wizard [FR4-5]
│   │   ├── _layout.tsx
│   │   ├── index.tsx                       # FR4: 3-step wizard
│   │   └── placement-test.tsx              # FR5: 15-question placement test
│   │
│   └── (tabs)/                             # Main app — 5 bottom tabs
│       ├── _layout.tsx                     # Tab navigator
│       │
│       ├── home/
│       │   ├── _layout.tsx
│       │   └── index.tsx                   # FR37-42: Dashboard, stats, quick actions
│       │
│       ├── conversation/                   # [FR7-15, FR48-49]
│       │   ├── _layout.tsx
│       │   ├── index.tsx                   # FR7-8: Topic/mode selection
│       │   ├── [sessionId].tsx             # FR9-15: Live voice session
│       │   └── history.tsx                 # FR48-49: Past conversations
│       │
│       ├── practice/                       # [FR16-27]
│       │   ├── _layout.tsx
│       │   ├── index.tsx                   # Practice hub with skill cards
│       │   ├── listening.tsx               # FR16-17: Listening MCQ
│       │   ├── reading.tsx                 # FR16-17: Reading comprehension
│       │   ├── writing.tsx                 # FR18-19: Writing evaluation
│       │   ├── grammar.tsx                 # FR16-17, FR20: Grammar + micro-drills
│       │   ├── vocabulary.tsx              # FR33-36: SRS flashcards
│       │   ├── pronunciation.tsx           # FR22-24: Phoneme assessment
│       │   ├── dictation.tsx               # FR25-27: Listen-and-type
│       │   ├── translation.tsx             # [Phase 2] FR53-55: Speech-to-speech
│       │   └── echo.tsx                    # [Phase 2] FR56-57: Echo practice
│       │
│       ├── mock-test/                      # [FR28-32]
│       │   ├── _layout.tsx
│       │   ├── index.tsx                   # FR28-29: Test selection
│       │   ├── [testId].tsx                # FR31-32: Active test + resume
│       │   └── results.tsx                 # FR30: Score breakdown
│       │
│       └── profile/                        # [FR43-47]
│           ├── _layout.tsx
│           ├── index.tsx                   # FR43: Stats, skills, CEFR chart, errors
│           ├── settings.tsx                # FR44-47: Edit profile, export, delete
│           ├── privacy-policy.tsx          # FR6: Privacy policy
│           └── terms.tsx                   # FR6: Terms of service
│
├── src/                                    # Application logic
│   ├── hooks/                              # Feature hooks (stateful, own React lifecycle)
│   │   ├── use-auth.ts                     # FR1-3: Auth lifecycle, profile caching
│   │   ├── use-realtime-voice.ts           # FR9-15: Voice conversation orchestrator
│   │   ├── use-exercise.ts                 # FR16-21: Exercise generation + grading
│   │   ├── use-dictation.ts                # FR25-27: Dictation exercise flow
│   │   ├── use-pronunciation.ts            # FR22-24: Azure pronunciation wrapper
│   │   ├── use-progress.ts                 # FR37-42: Skills, streaks, activity (cached)
│   │   ├── use-cefr-history.ts             # FR41: CEFR progression timeline
│   │   ├── use-audio-player.ts             # Shared audio playback + WAV header
│   │   ├── use-audio-recorder.ts           # Shared audio recording (PCM16/AAC)
│   │   ├── use-debounce.ts                 # Generic value debounce utility
│   │   ├── use-echo-practice.ts            # [Phase 2] FR56-57: Multi-step echo flow
│   │   └── use-translation.ts              # [Phase 2] FR53-55: Translation exercise
│   │
│   ├── lib/                                # Libraries (stateless, reusable)
│   │   ├── openai.ts                       # OpenAI client via ai-proxy Edge Function
│   │   ├── realtime.ts                     # RealtimeSession WebSocket manager
│   │   ├── supabase.ts                     # Supabase client + expo-secure-store
│   │   ├── pronunciation.ts                # Azure Speech client via Edge Function
│   │   ├── scoring.ts                      # TCF score math + CEFR mapping
│   │   ├── srs.ts                          # SM-2 spaced repetition algorithm
│   │   ├── memory.ts                       # pgvector memory extract + retrieve
│   │   ├── error-tracker.ts                # Error pattern tracking + micro-drill gen
│   │   ├── activity.ts                     # Streak, skill progress, CEFR promotion
│   │   ├── cache.ts                        # AsyncStorage TTL cache + write queue
│   │   ├── network.ts                      # Connectivity check utility
│   │   ├── haptics.ts                      # Haptic feedback wrappers
│   │   ├── sentry.ts                       # Error reporting utility
│   │   ├── design.ts                       # Design system tokens
│   │   ├── constants.ts                    # TCF specs, topics, skill labels
│   │   ├── wav.ts                          # WAV header generation for PCM audio
│   │   └── prompts/                        # AI system prompt builders
│   │       ├── conversation.ts             # 3 conversation modes
│   │       ├── grammar.ts                  # Grammar exercise generation
│   │       ├── listening.ts                # Listening exercise generation
│   │       ├── reading.ts                  # Reading exercise + click-to-explain
│   │       ├── writing.ts                  # Writing evaluation rubric
│   │       ├── mock-test.ts                # TCF mock test sections
│   │       ├── translation.ts              # [Phase 2] Translation evaluation
│   │       └── echo.ts                     # [Phase 2] Echo practice scoring
│   │
│   ├── components/                         # Shared UI components
│   │   ├── common/
│   │   │   ├── NetworkBanner.tsx            # FR51: Offline indicator + queue flush
│   │   │   └── ErrorBoundary.tsx            # Error boundary with Sentry
│   │   ├── conversation/
│   │   │   ├── TranscriptView.tsx           # Virtualized transcript (FlatList)
│   │   │   ├── CorrectionBubble.tsx         # Expandable correction cards
│   │   │   └── AudioWaveform.tsx            # 7-bar animated equalizer
│   │   ├── practice/
│   │   │   ├── MCQCard.tsx                  # Multiple choice question
│   │   │   └── ScoreCard.tsx                # Exercise results display
│   │   └── profile/
│   │       └── cefr-progression-chart.tsx   # Animated CEFR timeline
│   │
│   ├── store/
│   │   └── auth-store.ts                    # Zustand: session, user, profile
│   │
│   ├── types/
│   │   ├── cefr.ts                          # CEFRLevel, TCFSkill, CEFR_LEVELS
│   │   ├── exercise.ts                      # MCQContent, WritingEvaluation
│   │   ├── conversation.ts                  # Conversation, Correction, Topic
│   │   └── user.ts                          # UserProfile, SkillProgress
│   │
│   └── styles/
│       └── global.css                       # Tailwind directives
│
├── supabase/
│   ├── functions/                           # Edge Functions (Deno runtime)
│   │   ├── _shared/
│   │   │   ├── errors.ts                    # ErrorCode type, errorResponse()
│   │   │   └── rate-limit.ts                # Sliding window rate limiter
│   │   ├── ai-proxy/index.ts                # Chat/TTS/embedding proxy
│   │   ├── realtime-session/index.ts        # Ephemeral Realtime tokens
│   │   ├── pronunciation-assess/index.ts    # Azure Speech proxy
│   │   ├── account-delete/index.ts          # GDPR deletion
│   │   ├── notification-register/index.ts   # [Phase 2] Push token registration
│   │   └── deno.json                        # Deno configuration
│   ├── migrations/                          # SQL schema evolution (append-only)
│   │   ├── 20260301000000_initial_schema.sql
│   │   ├── 20260301000001_memory_functions.sql
│   │   ├── 20260301000002_production_fixes.sql
│   │   ├── 20260303000000_triggers_indexes_cleanup.sql
│   │   └── 20260303000001_security_fixes.sql
│   └── README.md                            # Deployment guide
│
├── assets/                                  # Static assets
│   ├── fonts/
│   └── images/
│
├── docs/                                    # Project documentation
│   ├── index.md
│   ├── project-overview.md
│   ├── architecture.md
│   ├── data-models.md
│   ├── api-contracts.md
│   ├── component-inventory.md
│   ├── development-guide.md
│   ├── deployment-guide.md
│   └── source-tree-analysis.md
│
├── store/                                   # App Store / Play Store metadata
│   ├── ios-metadata.md
│   └── android-metadata.md
│
├── _bmad-output/                            # Planning artifacts
│   ├── planning-artifacts/
│   │   ├── prd.md
│   │   ├── ux-design-specification.md
│   │   └── architecture.md
│   └── project-context.md
│
├── CLAUDE.md                                # AI agent project instructions
├── SUBMISSION_CHECKLIST.md                   # App store submission steps
├── app.json                                 # Expo config
├── eas.json                                 # EAS build profiles
├── tailwind.config.js                       # NativeWind theme
├── tsconfig.json                            # TypeScript strict + path aliases
├── eslint.config.js                         # ESLint flat config
├── metro.config.js                          # Metro + NativeWind + Sentry
├── babel.config.js                          # Babel presets
├── .prettierrc                              # Prettier config
├── .env.example                             # Environment template
└── package.json                             # Dependencies + lint-staged
```

### Architectural Boundaries

**Layer Boundary (strict, one-directional):**

```
Screen (app/) → Hook (src/hooks/) → Library (src/lib/) → Edge Function (supabase/functions/) → External API
```

| Boundary                       | Rule                                                             | Violation Example                                           |
| ------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Screens → Hooks                | Screens call hooks only; never import from `src/lib/` directly   | Screen calling `chatCompletion()` directly                  |
| Hooks → Libraries              | Hooks call library functions; never call Edge Functions directly | Hook using `supabase.functions.invoke()` instead of wrapper |
| Libraries → Edge Functions     | Library functions use `supabase.functions.invoke()`              | `openai.ts` calling `api.openai.com` directly               |
| Edge Functions → External APIs | Edge Functions own API keys and proxy requests                   | —                                                           |

**Exception:** `src/lib/supabase.ts` is imported by both hooks and screens for direct Supabase data queries (RLS-protected CRUD operations).

**Data Boundary:**

| Boundary                     | What Can Cross                    | What Cannot Cross                   |
| ---------------------------- | --------------------------------- | ----------------------------------- |
| Client → Edge Function       | JWT token, request parameters     | API keys, service role key          |
| Edge Function → External API | API keys, validated parameters    | User JWT, Supabase credentials      |
| Hook → Supabase (direct)     | User data queries (RLS-protected) | Admin operations, unscoped queries  |
| AsyncStorage cache           | Serialized JSON with TTL metadata | Auth tokens (use expo-secure-store) |

**State Boundary:**

| Scope             | Manager                        | Access Pattern                     |
| ----------------- | ------------------------------ | ---------------------------------- |
| Global auth state | `auth-store.ts` (Zustand)      | Any component via `useAuthStore()` |
| Feature state     | Hook-local `useState`/`useRef` | Screen that calls the hook         |
| Cached data       | `cache.ts` (AsyncStorage)      | Hooks via `cacheWithFallback()`    |
| Offline writes    | `cache.ts` write queue         | NetworkBanner flushes on reconnect |

### Requirements to Structure Mapping

| FR Category             | Screen(s)                | Hook                 | Library                                        | Edge Function          | DB Table(s)                                                                    |
| ----------------------- | ------------------------ | -------------------- | ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| Auth (FR1-6)            | `(auth)/*`               | `use-auth`           | `supabase.ts`                                  | —                      | `profiles`                                                                     |
| Onboarding (FR4-5)      | `onboarding/*`           | `use-exercise`       | `prompts/grammar.ts`                           | `ai-proxy`             | `profiles`                                                                     |
| Voice (FR7-15)          | `conversation/*`         | `use-realtime-voice` | `realtime.ts`, `memory.ts`, `error-tracker.ts` | `realtime-session`     | `conversations`, `conversation_messages`, `companion_memory`, `error_patterns` |
| Exercises (FR16-21)     | `practice/*`             | `use-exercise`       | `openai.ts`, `prompts/*`                       | `ai-proxy`             | `exercises`, `skill_progress`                                                  |
| Pronunciation (FR22-24) | `practice/pronunciation` | `use-pronunciation`  | `pronunciation.ts`                             | `pronunciation-assess` | —                                                                              |
| Dictation (FR25-27)     | `practice/dictation`     | `use-dictation`      | `openai.ts`                                    | `ai-proxy`             | `exercises`, `error_patterns`                                                  |
| Mock Tests (FR28-32)    | `mock-test/*`            | Screen-local         | `openai.ts`, `scoring.ts`                      | `ai-proxy`             | `mock_tests`, `mock_test_answers`                                              |
| Vocabulary (FR33-36)    | `practice/vocabulary`    | Screen-local         | `srs.ts`, `cache.ts`                           | —                      | `vocabulary`                                                                   |
| Progress (FR37-42)      | `home`, `profile`        | `use-progress`       | `activity.ts`, `cache.ts`                      | —                      | `skill_progress`, `daily_activity`                                             |
| Profile (FR43-47)       | `profile/*`              | `use-auth`           | `supabase.ts`                                  | `account-delete`       | `profiles`                                                                     |
| History (FR48-49)       | `conversation/history`   | Screen-local         | `supabase.ts`                                  | —                      | `conversations`, `conversation_messages`                                       |
| Offline (FR50-52)       | All screens              | —                    | `cache.ts`, `network.ts`                       | —                      | AsyncStorage                                                                   |

**Phase 2 Mapping:**

| Feature                 | Screen                     | Hook                   | Prompt Builder           | Edge Function                 |
| ----------------------- | -------------------------- | ---------------------- | ------------------------ | ----------------------------- |
| Translation (FR53-55)   | `practice/translation.tsx` | `use-translation.ts`   | `prompts/translation.ts` | `ai-proxy` (existing)         |
| Echo Practice (FR56-57) | `practice/echo.tsx`        | `use-echo-practice.ts` | `prompts/echo.ts`        | `ai-proxy` (existing)         |
| Notifications (FR58-60) | Settings additions         | —                      | —                        | `notification-register` (new) |

### Cross-Cutting Concerns Mapping

| Concern            | Files Involved                                                                       |
| ------------------ | ------------------------------------------------------------------------------------ |
| **Authentication** | `app/_layout.tsx`, `use-auth.ts`, `auth-store.ts`, `supabase.ts`, all Edge Functions |
| **Error handling** | `sentry.ts`, `ErrorBoundary.tsx`, every hook, every Edge Function (`errors.ts`)      |
| **Offline**        | `cache.ts`, `network.ts`, `NetworkBanner.tsx`, `use-progress.ts`, `vocabulary.tsx`   |
| **Design tokens**  | `design.ts`, `constants.ts`, `tailwind.config.js`, `global.css`                      |
| **Accessibility**  | Every interactive component (`accessibilityRole/Label/Hint`)                         |
| **Haptics**        | `haptics.ts`, MCQCard, ScoreCard, conversation, exercise screens                     |

### Integration Points

**External Integrations:**

| External Service           | Integration Point                    | Protocol          |
| -------------------------- | ------------------------------------ | ----------------- |
| OpenAI Chat/TTS/Embeddings | `ai-proxy` Edge Function             | HTTPS REST        |
| OpenAI Realtime API        | `realtime.ts` → WebSocket            | WSS               |
| Azure Speech Services      | `pronunciation-assess` Edge Function | HTTPS REST        |
| Supabase Auth              | `supabase.ts` client                 | HTTPS (GoTrue)    |
| Supabase Database          | `supabase.ts` client                 | HTTPS (PostgREST) |
| Sentry                     | `sentry.ts` → `@sentry/react-native` | HTTPS             |
| expo-notifications         | [Phase 2] → `notification-register`  | HTTPS             |

**Data Flow (voice conversation — most complex):**

```
User taps "Start" on [sessionId].tsx
  → useRealtimeVoice.start()
    → [parallel] retrieveMemories() → ai-proxy → OpenAI embeddings → match_memories() RPC
    → [parallel] getTopErrors() → error_patterns table
    → [parallel] RealtimeSession.connect() → realtime-session → ephemeral token
    → WebSocket opens → session.update with system prompt
    → Audio loop: expo-audio-stream → PCM16 → WebSocket → AI response
  → User taps "End"
    → Save conversation + messages to Supabase
    → [parallel] extractAndStoreMemories() → companion_memory insert
    → [parallel] extractErrorsFromCorrections() → error_patterns upsert
    → [parallel] generateFeedback() → conversations.ai_feedback update
    → updateStreak() + updateSkillProgress() + incrementDailyActivity()
    → Feedback sheet renders
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility: PASS**

- Expo SDK 55 + React Native 0.83 + React 19.2 + TypeScript 5.9 — version-pinned and tested
- NativeWind v4 + Tailwind + Metro — compatible via babel preset and metro config
- Supabase JS 2.99 + Edge Functions (Deno) — same ecosystem, shared auth model
- react-native-reanimated 4.2 + Expo SDK 55 — compatible via managed workflow
- No contradictory decisions found

**Pattern Consistency: PASS**

- Naming conventions consistent with existing codebase (verified against 67 project-context rules)
- Edge Function template matches all 4 existing functions
- Hook vs library boundary matches all 10 existing hooks
- State machine pattern matches all 4 existing screen implementations
- Temperature conventions match all 6 existing prompt builders

**Structure Alignment: PASS**

- Project tree matches actual codebase with Phase 2 growth points marked
- Layer boundary matches every existing data flow
- State boundaries match implementation
- No structural contradictions

### Requirements Coverage Validation

**Functional Requirements: 60/60 PASS**

| FR Range | Category                    | Status                          |
| -------- | --------------------------- | ------------------------------- |
| FR1-6    | Auth & Onboarding           | Covered                         |
| FR7-15   | Voice Conversations         | Covered                         |
| FR16-21  | Structured Exercises        | Covered                         |
| FR22-24  | Pronunciation               | Covered                         |
| FR25-27  | Dictation                   | Covered                         |
| FR28-32  | Mock Tests                  | Covered                         |
| FR33-36  | Vocabulary/SRS              | Covered                         |
| FR37-42  | Progress & Analytics        | Covered                         |
| FR43-47  | Profile & Settings          | Covered                         |
| FR48-49  | Conversation History        | Covered                         |
| FR50-52  | Offline & Resilience        | Covered                         |
| FR53-57  | Phase 2 (Translation, Echo) | Planned — growth points defined |
| FR58-60  | Phase 2 (Notifications)     | Planned — growth points defined |

**Non-Functional Requirements: 34/34 PASS**

| NFR Range | Category        | Status                                                        |
| --------- | --------------- | ------------------------------------------------------------- |
| NFR1-7    | Performance     | Covered (FlatList, Reanimated, cache, parallel async)         |
| NFR8-15   | Security        | Covered (server-side keys, RLS, JWT, rate limits, allowlists) |
| NFR16-20  | Accessibility   | Covered (a11y labels, 44pt targets, WCAG AA, skeletons)       |
| NFR21-25  | Integration     | Covered (retry, degradation, network detection, write queue)  |
| NFR26-30  | Reliability     | Covered (error boundaries, BackHandler, Sentry, resume)       |
| NFR31-34  | Content Quality | Covered (temperature 0.4, MCQ validation, TCF distribution)   |

### Implementation Readiness Validation

**Decision Completeness: PASS** — All technology versions documented, 5 decision categories specified, Phase 2 triggers defined.

**Structure Completeness: PASS** — Full annotated project tree, all Phase 2 growth points marked, 7 external integrations mapped.

**Pattern Completeness: PASS** — 5 conflict points resolved, Edge Function template (8 mandatory elements), state machine (7 standard states), prompt conventions (temperature/model table).

### Gap Analysis Results

**Critical Gaps: None**

**Important Gaps (non-blocking):**

| Gap                                  | Resolution                                                     |
| ------------------------------------ | -------------------------------------------------------------- |
| Animation tokens not centralized     | Add to `design.ts` when Phase 2 animated components are built  |
| No formal data migration testing     | CI validates SQL syntax; add local dev testing when team grows |
| Memory management UI not architected | Architect when Phase 3 scoping begins                          |

### Architecture Completeness Checklist

- [x] Project context analyzed (67 rules, 11 input documents)
- [x] Scale and complexity assessed (Medium-High, ~45 components)
- [x] Technical constraints identified (8 hard constraints)
- [x] Cross-cutting concerns mapped (8 concerns)
- [x] Critical decisions documented with versions (5 categories)
- [x] Technology stack fully specified (15+ technologies)
- [x] Integration patterns defined (7 external services)
- [x] Naming conventions established (SQL, JSONB, TypeScript)
- [x] Structure patterns defined (Edge Function template, hook/library boundary)
- [x] Process patterns documented (state machines, prompt conventions)
- [x] Complete directory structure with FR mapping
- [x] Component boundaries established (4 layer boundaries)
- [x] Requirements coverage verified (60 FRs + 34 NFRs)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — brownfield project with established, working patterns validated against comprehensive documentation.

**Key Strengths:**

- Complete FR/NFR coverage with no gaps
- Clear layer boundaries prevent cross-cutting confusion
- Patterns derived from existing working code
- Phase 2 growth points defined without over-architecting
- 67 AI agent rules + this document provide comprehensive guidance

**Areas for Future Enhancement:**

- Animation token centralization
- Component promotion (StatTile, ActivityBar, SkillCard)
- Rate limiter persistence at scale
- Background job scheduling for data retention

### Implementation Handoff

**AI Agent Guidelines:**

1. Read `project-context.md` before implementing any code
2. Follow all decisions in this document exactly
3. Use patterns consistently — Edge Function template, state machines, prompt conventions
4. Respect layer boundaries: Screen → Hook → Library → Edge Function → External API
5. Extend existing patterns; update this document if new patterns emerge

**Implementation Priority (Phase 2):**

1. Notification Engine — independent, low risk
2. Echo Practice — extends existing audio infrastructure
3. Speech-to-Speech Translation — highest complexity
