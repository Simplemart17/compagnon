# Epic Template Guide — Foundation → Hook → Screen

## Default 3-Story Structure

New feature epics should follow this proven pattern by default:

| Story                   | Layer                   | Purpose                                                                              | Example (Echo Practice)                                                                 |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Story 1: Foundation** | Data / API / Generation | Prompt builders, Edge Functions, migrations, types, generation functions             | `echo.ts` prompt builder, `echo-generation.ts`, `ExerciseType` union update             |
| **Story 2: Hook**       | Business Logic          | Custom hook with state machine, API orchestration, progress tracking, error handling | `use-echo-practice.ts` — idle → generating → listen → speak → type → checking → results |
| **Story 3: Screen**     | UI + Integration        | Screen component, practice hub registration, layout registration, accessibility      | `practice/echo.tsx` — 7 screen states, practice hub card, animations                    |

## Why This Works

1. **Clear dependency chain** — Each story builds on the previous, no circular dependencies
2. **Focused scope** — Each story has a single responsibility layer
3. **Testable isolation** — Foundation and hook can be verified independently of UI
4. **Pattern reuse** — Later epics copy the structure and swap domain logic
5. **Story intelligence** — Story 2 knows exactly what Story 1 created; Story 3 knows what the hook exposes

## Validated Examples

| Epic | Feature            | Story 1 (Foundation)         | Story 2 (Hook)                       | Story 3 (Screen)                     |
| ---- | ------------------ | ---------------------------- | ------------------------------------ | ------------------------------------ |
| 6    | Echo Practice      | Prompt builder + generation  | `use-echo-practice.ts` state machine | `echo.tsx` + practice hub            |
| 7    | Translation        | Prompt builder + evaluation  | `use-translation.ts` + transcription | `translation.tsx` + practice hub     |
| 8    | Push Notifications | DB migration + Edge Function | Delivery Edge Function + pg_cron     | `use-notifications.ts` + settings UI |

## When to Use

- New practice exercise types (listening, speaking, writing variants)
- New user-facing features with AI generation (exercises, assessments)
- Features requiring backend + client coordination (notifications, sync)

## When to Deviate

- **Infrastructure/stabilization epics** (e.g., Epic 1: MVP Stabilization) — stories organized by verification area
- **UX polish epics** (e.g., Epic 5: UX System Patterns) — stories organized by concern (toast, scoring, offline)
- **Home screen / dashboard epics** (e.g., Epic 2: Daily Briefing) — hook-first then UI consumers
- **Single-layer epics** — if the feature is purely backend or purely UI, fewer stories may suffice

## Story Template Conventions

Each story MUST include:

- **"What This Story Does NOT Include"** — explicit exclusions preventing scope creep
- **"What Story N-1 Already Provides (DO NOT Recreate)"** — prevents rediscovery
- **Z. Polish Requirements** — design tokens, accessibility, skeletons, error capture
- **Dev Notes** with exact code patterns, request/response contracts, file locations
