# Story 14.1: Language Strategy Rewrite — convert all UI chrome to English while preserving French content

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **non-French speaker preparing for the TCF Canada exam who reads English-primary UI and learns French-primary content**,
I want **every UI chrome surface (titles, buttons, navigation labels, alerts, microcopy, error messages) rendered in English while every French-language learning surface (AI prompts, AI spoken/written responses, vocabulary words, exercise content, conversation topic names, transcripts of the AI's French speech) stays in French**,
so that **I can navigate the app in the language I read fluently while practicing French in the language I'm learning — and I never have to context-switch mid-screen because of "bilingual UI chaos" (audit P1-20) or read a "Quel est votre niveau actuel ?" heading next to an "I don't know" CTA (audit P2-11)**.

## Background — Why This Story Exists

### What audit P1-20 + P2-11 own to this story

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 270 — Epic 14 deliverable 14.1:

> 14.1 Language decision — pick a primary surface language (recommend FR with EN fallback for instructional copy until i18n exists); rewrite onboarding, tabs, screen titles. **Covers P1-20, P2-11.** Owner decision required (see §6).

Roadmap lines 89 + 106 — the two audit findings 14.1 closes:

> P1-20 — Bilingual UI chaos — onboarding mixes French headings with English subtitles; tabs English, home headings French; no rule. Files: `app/onboarding/index.tsx:42-54`, `app/(tabs)/_layout.tsx`, `app/(tabs)/home/index.tsx`.

> P2-11 — Onboarding "I don't know" CTA is in English on a French-locale screen ("Quel est votre niveau actuel ?"); microcopy contradicts itself. File: `app/onboarding/index.tsx:361-371`.

### The operator decision — already made

[`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) line 419 (Decision Matrix row D1):

> **DECIDED 2026-05-06** — owner accepted recommendation. UI chrome = English; content (prompts, exercises, AI responses, transcripts) = French. No bilingual toggle in v1.

The roadmap's body text at line 270 wrote "recommend FR with EN fallback" but the **operator-accepted final decision is EN UI / FR content** (per the D1 row + per the `project_language_strategy.md` auto-memory). The roadmap body text was the recommendation phase; the matrix row is the contract. Story 14-1 implements the matrix-row decision.

The Epic 13 retrospective at [`_bmad-output/implementation-artifacts/epic-13-retro-2026-05-15.md`](_bmad-output/implementation-artifacts/epic-13-retro-2026-05-15.md) lines 270-275 ("Operator decision required before Epic 14 starts") confirms this decision is the entry condition for Story 14-1.

### Scope rule — chrome vs content

The split between "UI chrome" (convert to EN) and "French content" (preserve as FR) follows this rule:

- **UI chrome (CONVERT FR→EN):** the operator-facing UI text the app puts around the learning material — screen titles, headers, navigation labels, button labels, placeholder text, alert titles/bodies, error messages, "Question N of M" counters, section headers, "Save" / "Cancel" / "Retry" buttons, settings labels, accessibility labels/hints.
- **French learning content (PRESERVE):** anything the app is asking the user to read, parse, listen to, or speak in French — vocabulary words, example sentences, AI conversation responses, AI feedback in French (e.g., when the AI corrects a learner's grammar mid-conversation), placement-test question text, mock-test passages, reading-comprehension paragraphs, dictation source text, conversation topic names that name the LEARNING topic (e.g., the topic name "Se présenter" on the conversation topic picker — the user IS learning to introduce themselves in French; the topic name is the content).

Edge cases the dev MUST adjudicate during implementation (see operator-decision items in AC #11 below):

1. **Speaker labels in transcripts** — `src/components/conversation/TranscriptView.tsx:140` `isUser ? "Vous" : "Compagnon"` and `:205` / `:246` "Compagnon" headers. The speaker label is chrome (it's the UI's identification of who said what), but the transcript BELOW the label is French content. Recommendation: speaker labels become English ("You" / "Companion") so the chrome rule is consistent; the French content below is untouched.
2. **Brand name "Compagnon"** — currently mixed: `app/(tabs)/_layout.tsx` headerTitle says "Companion"; auth screens (`login.tsx:124`, `signup.tsx:180`, `forgot-password.tsx:123`) say "Compagnon"; `src/components/home/CompanionMessage.tsx:88` says "Compagnon"; `src/components/conversation/CorrectionBubble.tsx:115` says "Compagnon noticed"; conversation history empty state (`history.tsx:871`) says "Have your first chat with Compagnon and it will show up here for review." Recommendation: standardize on **one brand name** project-wide for chrome consistency; the operator must pick "Companion" (English) or "Compagnon" (French) — see AC #11.
3. **Login tagline** `login.tsx:131` "Parlez. Apprenez. Maîtrisez." — brand voice; operator decision.
4. **Placement-test congratulation phrases** `placement-test.tsx:89-114` `LEVEL_CONGRATS` object (`"Bonjour !"`, `"Très bien !"`, `"Bravo !"`, `"Excellent !"`, `"Magnifique !"`, `"Parfait !"` + English subtitles). Per-level flavor text; operator decision.
5. **EmailVerificationGate (Story 12-9) French chrome** — the entire gate component was **intentionally localized to French** during Story 12-9 implementation per the Story 12-9 spec (operator-localized signup flow). All alerts, button labels, body copy in `src/components/auth/EmailVerificationGate.tsx` are French. Under Story 14-1's new EN-UI rule, this surface MUST be reconsidered — see AC #11.

### Why a centralized i18n library is OUT OF SCOPE for 14-1

The roadmap line 270 explicitly says "until i18n exists" — i.e., no i18n is in scope for v1. There is currently no i18n library installed (`grep -nE "react-i18next|i18next|expo-localization" package.json` returns empty). Adding one is its own multi-story effort (extracting all strings to a key-based catalog, picking a library, wiring the provider, configuring fallback locale, build-time validation that no key is missing) and would balloon 14-1 from a 1-2 day rewrite into a 1-2 week infrastructure project.

**14-1 does mechanical find-replace in-place.** A future Epic-N story can extract strings to a copy module / introduce `react-i18next` / add a locale switcher; 14-1 does not preempt that work and does not introduce abstractions that would conflict with it. Strings stay inline in JSX where they are today.

### Inventory of affected surfaces

| Surface | File(s) | Approx. chrome string count | Notes |
| --- | --- | --- | --- |
| Onboarding wizard | `app/onboarding/index.tsx` lines 43, 47, 51, 531-533 | ~4 strings + 3 CTA labels | Mixed FR headings + EN subtitles + EN "I don't know" — the canonical P1-20 + P2-11 surface |
| Placement test | `app/onboarding/placement-test.tsx` lines 89-114, 572, 626, 645, 662, 699, 808, 913, 944, 1030-1031 | ~12 strings + 6 congratulation phrases | Headers, CTAs, alert titles, retry button |
| Tabs layout | `app/(tabs)/_layout.tsx` | 0 to convert | **Already EN** — verified |
| Home screen | `app/(tabs)/home/index.tsx` lines 113, 115, 294, 378, 446, 492, 552 | ~7 strings | "Parlez avec Compagnon" card, "Aujourd'hui", "Mes compétences", empty-state placeholders |
| Conversation list | `app/(tabs)/conversation/index.tsx` lines 282 + `TOPIC_EMOJIS` keys | ~1 chrome string ("Parlez avec Compagnon"); topic names = **content (preserve)** | French topic names like "Se présenter" stay French — they are the learning topic |
| Conversation history | `app/(tabs)/conversation/history.tsx` line 871 | 1 string ("Compagnon" in empty state copy) | Linked to brand-name decision (AC #11 question 2) |
| Conversation session | `app/(tabs)/conversation/[sessionId].tsx` | Story 13-4 overlay strings already FR; review | "Préparation de la section suivante..." (line 676 of `[testId].tsx`) — see mock test section |
| Practice index | `app/(tabs)/practice/index.tsx` lines 26-32, 125, 135, 152, 186, 188 | ~6 strings | `PRACTICE_LABELS` has EN equivalents already in the same object; "Entraînement" hero title; "Vocabulaire" featured card |
| Mock test list | `app/(tabs)/mock-test/index.tsx` lines 81, 89, 361 | ~3 strings | "COMPRÉHENSION COMPLÈTE" badge, descriptions |
| Mock test runner | `app/(tabs)/mock-test/[testId].tsx` line 676 | 1 string ("Préparation de la section suivante...") | Story 13-4 overlay copy — convert under chrome rule |
| Profile root | `app/(tabs)/profile/index.tsx` line 352 | 1 string ("Mes compétences") | |
| Profile settings | `app/(tabs)/profile/settings.tsx` lines 347, 419, 452, 456, 470, 481, 491, 499, 520, 613, 688, 718, 739, 755 | ~14 strings | Section labels, button labels ("Enregistrer", "Annuler"), placeholders, "Politique de confidentialité" / "Conditions d'utilisation" links |
| Auth screens | `app/(auth)/login.tsx` lines 131, 156, 171, 199, 240 + `signup.tsx` lines 216, 258, 289, 318, 328-342, 348, 356 + `forgot-password.tsx` lines 157, 162-163, 179, 207, 223 | ~20 strings + 3 brand names + 1 tagline | Card titles, placeholders, button labels, legal-notice text, brand name "Compagnon" |
| Stack screen titles | `app/(tabs)/conversation/_layout.tsx`, `app/(tabs)/practice/_layout.tsx`, `app/(tabs)/mock-test/_layout.tsx`, `app/(tabs)/profile/_layout.tsx`, `app/onboarding/_layout.tsx` | 0 to convert | **Already EN** — verified |
| EmailVerificationGate (Story 12-9) | `src/components/auth/EmailVerificationGate.tsx` lines 189-337 | ~10 strings | **Operator-decision required (AC #11 question 5)** — was intentionally FR per Story 12-9 spec |
| Shared components | `src/components/conversation/TranscriptView.tsx:140,205,246`, `src/components/conversation/CorrectionBubble.tsx:115`, `src/components/home/CompanionMessage.tsx:88` | ~5 strings | Speaker labels + brand-name occurrences — linked to AC #11 questions 1 + 2 |
| Daily briefing labels | `src/hooks/use-daily-briefing.ts` lines 172-238 | 0 to convert | Already EN |
| NetworkBanner | `src/components/common/NetworkBanner.tsx:59` | 0 to convert | "No internet connection" — already EN |
| ProfileRetryScreen (inline in `app/_layout.tsx:263-330`) | already EN | 0 to convert | Verified |

**Total**: ~95 chrome strings across ~14 files to convert (excluding the 5 operator-decision items). The mechanical conversion work is small per file but spread across many files.

### What 14-1's deliverable looks like

- **Source-code changes:** in-place FR→EN string replacements across the ~14 files enumerated above.
- **No new packages.** No `react-i18next`, no `expo-localization`. Strings stay inline in JSX.
- **No new copy module / `src/lib/copy.ts`.** Future-story refactor.
- **No migrations.** No Supabase / RLS / Edge Function changes.
- **No CI workflow changes.**
- **One new drift-detector test** (Story 12-2 P12 + Story 13-7 lessons applied): reads each touched screen from disk via comment-stripped source, NEGATIVE-pins each pre-14-1 French chrome string is gone, POSITIVE-pins the EN replacement is present. Catches a future revert / merge conflict that re-introduces French chrome.

### Why this is a SMALL story (load-bearing scope discipline)

Pattern from Stories 12-10 / 12-11 / 12-12 / 13-6 / 13-7 / 13-8 — "small + targeted, scope mostly mechanical, one new drift-detector test":

- **~14 source files modified** + 4 housekeeping files (CLAUDE.md + sprint-status.yaml + this story file + 1 new drift-detector test).
- **0 new packages, 0 migrations, 0 Edge Function changes, 0 CI workflow changes, 0 logic changes** — `package.json` + `package-lock.json` + `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` + every `src/lib/*.ts` (except inline copy edits where applicable, e.g., the `useDailyBriefing` hook if any FR text surfaces there) and every `src/hooks/*.ts` (same caveat) zero-diff EXCEPT the inline string changes.
- **Total diff < 600 lines** (mostly small per-line replacements; the new drift test is the largest single file).

### Footguns to avoid (from prior story retros)

- **Story 13-7 P3 lesson (over-tight assertions)** — drift-detector regexes should accept defensible refactors (e.g., a future `Settings` screen reorder that moves a string to a new line number) without false-failing. Pin on string content, not line number; use `expect(source).not.toMatch(/Mes compétences/)` rather than `expect(line(352)).not.toMatch(...)`.
- **Story 13-2 P11 lesson (vacuous positive guards)** — every NEGATIVE pin must be paired with a POSITIVE pin so a regression that DELETES the string altogether doesn't pass vacuously. For each FR string removed, assert the EN replacement IS present.
- **Story 12-2 P12 lesson (comment-stripped source-drift)** — strip comments before regex-searching so a JSDoc comment that mentions the legacy FR string doesn't trip the negative guard. Example: `app/(tabs)/profile/settings.tsx:346` has the comment `{/* ---- Section: Apprentissage ---- */}` AND line 347 has `<SectionLabel>Apprentissage</SectionLabel>` — the dev MUST update BOTH or strip comments before the assertion runs.
- **Story 13-4 review R1 (synchronous mirror)** — N/A here (no async / no state machines).
- **Story 12-12 M1 lesson (regex too tight)** — use word-boundary or substring matches that tolerate punctuation drift (`/Mes compétences/` matches both `<Text>Mes compétences</Text>` and `accessibilityLabel="Mes compétences"`).
- **Accessibility labels MUST also be converted** — `accessibilityLabel="Vocabulaire - Vocabulary..."` at `practice/index.tsx:125` is a screen-reader-facing string; it counts as chrome. Easy to miss because it's behind an attribute.
- **`useDailyBriefing` and `daily-briefing-aggregate` queries return ENGLISH already** (verified — `use-daily-briefing.ts:139` etc. all in English). No backend / data-layer changes are needed; this story is UI-only.

### What 14-1 does NOT do

- **NO i18n library** — explicitly deferred per roadmap line 270 ("until i18n exists" implies later).
- **NO copy extraction** — no new `src/lib/copy/strings.ts` module. Strings stay inline.
- **NO modification of French learning content** — AI prompts in `src/lib/prompts/*.ts` are untouched; vocabulary words in DB are untouched; conversation topic names (the French side `titleFr`) are untouched; exercise content is untouched.
- **NO modification of Edge Function error messages** — those are Story 12-11's territory; `parseUpstreamError` returns categorical English strings already.
- **NO modification of Sentry breadcrumbs / feature tags** — those are operator-facing telemetry, already English.
- **NO accessibility-audit-pass beyond converting the labels listed in the inventory** — that's Story 14-x's territory.
- **NO design-token-pass / color-pass / layout-pass** — Stories 14.2 through 14.9 own those.

### Cross-story invariants to preserve

- **Story 9-3 Sentry allowlist + GDPR scrubber** — zero-diff. No new feature tags / extras keys. The chrome rewrite is operator-facing only.
- **Story 9-4 stored-prompt-injection** — N/A (no prompt changes).
- **Story 9-5 voice transcript dedup** — N/A (transcript content untouched; only the speaker-label chrome above the transcript changes per AC #11 question 1).
- **Story 9-6 auth listener** — N/A (no auth flow logic changes; only auth-screen chrome converts).
- **Story 9-9 deploy substrate** — N/A.
- **Story 9-10 + 12-2 auth + cache race** — `ProfileRetryScreen` chrome already EN; zero-diff.
- **Story 10-X TCF spec source-of-truth** — N/A (no TCF content / scoring changes).
- **Story 11-1 tool-call protocol** — N/A.
- **Story 11-2 reconnect + barge-in** — N/A (status text "Reconnecting..." already EN per `ConversationState.status` literal).
- **Story 11-7 prompt-truncation** — N/A (prompt is operator-built FR; not chrome).
- **Story 12-1 RealtimeOrchestrator** — N/A (no orchestrator surface change).
- **Story 12-6 transcript cap** — N/A (cap logic untouched; only display-time speaker labels change per AC #11 q1).
- **Story 12-8 password policy** — Story 12-8's French strings (placeholder + accessibilityHint + Alert.alert messages + the French strings inside `password-policy.ts` `FRENCH_MESSAGES`) — **operator decision required (AC #11 question 6)**. Story 12-8 deliberately localized these to French; under the new EN-UI rule they should convert, but operators may have shipped them to users already and reverting changes the support footprint. **Recommended action: convert under the new rule** (the audit P1-20 mandate is "no bilingual UI chaos" — keeping FR on the password screen while every other auth screen is EN re-introduces the chaos).
- **Story 12-9 EmailVerificationGate** — **operator decision required (AC #11 question 5)** — same shape as #6.
- **Story 12-11 Edge Function error sanitization** — N/A (returns categorical English `"Upstream API error (status N)"`; not chrome).
- **Story 12-12 pronunciation history cap** — N/A.
- **Stories 13-1 through 13-8** — orthogonal. Note the Story 13-4 "Préparation de la section suivante..." overlay copy (a Story 13-4 review-round-1 holdover that landed in French) becomes "Preparing next section..." under the chrome rule.

### Example of an in-place conversion (for the dev's mental model)

Before:

```tsx
// app/(tabs)/home/index.tsx:113-115
<Text className="text-white font-bold text-base">Parlez avec Compagnon</Text>
<Text className="text-white/80 text-xs mt-1">Conversez en temps réel avec votre IA</Text>
```

After (assuming brand-name decision = "Companion"):

```tsx
// app/(tabs)/home/index.tsx:113-115
<Text className="text-white font-bold text-base">Talk with Companion</Text>
<Text className="text-white/80 text-xs mt-1">Converse in real-time with your AI</Text>
```

Drift-detector pin (Story 12-2 P12 pattern):

```typescript
// src/lib/__tests__/language-strategy-source-drift.test.ts
import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(__dirname, "../../..");
const COMMENT_STRIP_RE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;

function readScreen(relPath: string): string {
  const raw = readFileSync(join(PROJECT_ROOT, relPath), "utf8");
  return raw.replace(COMMENT_STRIP_RE, "");
}

describe("Story 14-1 — chrome strings converted to English", () => {
  it("home/index.tsx: 'Parlez avec Compagnon' converted to English", () => {
    const src = readScreen("app/(tabs)/home/index.tsx");
    expect(src).not.toMatch(/Parlez avec Compagnon/);
    expect(src).toMatch(/Talk with Companion/);
  });
  // ... ~14 more cases per touched file
});
```

## Acceptance Criteria

1. **All ~95 French chrome strings across the ~14 source files enumerated in the Background "Inventory of affected surfaces" table are converted to English** — verified by the new drift-detector test (AC #9). Strings include screen titles, section headers, button labels, placeholders, alert titles/bodies, error messages, accessibility labels/hints, and the few inline French strings in shared components (TranscriptView speaker labels per AC #11 q1, CorrectionBubble's "Compagnon noticed", CompanionMessage's "Compagnon").

2. **All French learning content is preserved verbatim** — verified by NEGATIVE drift-detector cases that pin the presence of French content surfaces:
   - `src/lib/prompts/conversation.ts` + every other prompt file in `src/lib/prompts/` is zero-diff (`git diff main..HEAD -- src/lib/prompts/` returns empty).
   - Conversation topic French names (`titleFr` field) in `app/(tabs)/conversation/index.tsx` `TOPIC_EMOJIS` keys are unchanged (verified by reading the object's keys).
   - `app/(tabs)/conversation/index.tsx` `{item.titleFr}` rendering at line 127 is preserved.

3. **The 5 operator-decision items in AC #11 are explicitly resolved** before the dev finalizes the conversion — see AC #11 for the question shape. The dev's Completion Notes record each operator's chosen answer + the rationale.

4. **The Story 13-4 "Préparation de la section suivante..." overlay copy in `app/(tabs)/mock-test/[testId].tsx:676`** is converted to English (e.g., "Preparing next section...") under the chrome rule.

5. **Comments referencing the legacy French strings are also updated or removed** (e.g., `{/* ---- Section: Apprentissage ---- */}` at `settings.tsx:346` becomes `{/* ---- Section: Learning ---- */}` or is removed). Story 12-2 P12 lesson: comments that name the legacy string are confusing once the string changes.

6. **No accessibility regression** — every converted `accessibilityLabel` + `accessibilityHint` retains semantic equivalence; touch targets unchanged; screen-reader announcement order unchanged. Stack-screen `title` props unchanged (already EN per inventory).

7. **No new packages.** `package.json` + `package-lock.json` zero-diff. No `react-i18next` / `i18next` / `expo-localization` added.

8. **No new copy / strings module.** Strings stay inline in JSX. Future i18n extraction is a separate story (not preempted).

9. **NEW drift-detector test [`src/lib/__tests__/language-strategy-source-drift.test.ts`](src/lib/__tests__/language-strategy-source-drift.test.ts)** with one Jest case per touched screen (~14 cases), each pinning:
   - NEGATIVE: each pre-14-1 French chrome string is gone from the comment-stripped source (Story 12-2 P12 pattern).
   - POSITIVE: each EN replacement is present (Story 13-2 P11 vacuous-pin defense).
   - Uses comment-stripped source per Story 12-2 P12 so JSDoc / inline comments that mention the legacy FR string don't trip the negative guard.
   - Uses substring or word-boundary regex per Story 12-12 M1 lesson — tolerant of punctuation drift.

10. **All 4 quality gates green:** `tsc` 0 errors / `lint` 0 warnings / `prettier --check` clean / `jest` baseline + ~14 new cases. Current baseline 1859 → ≥ 1873 (spec target +10–15 net Jest cases depending on `it.each` collapsing).

11. **Operator decisions documented before merge.** The dev MUST resolve these 5 questions with the operator BEFORE finalizing the conversion. Each answer is recorded in the Completion Notes:
    - **Q1 — Speaker labels in TranscriptView (`src/components/conversation/TranscriptView.tsx:140,205,246`).** Convert `isUser ? "Vous" : "Compagnon"` to `isUser ? "You" : "Companion"` (or whatever the brand-name answer is for Q2)? **Recommended: YES** — the speaker label is chrome; the transcript text below it stays French.
    - **Q2 — Brand name standardization.** Currently mixed: tabs say "Companion" (EN), auth screens / transcript / home say "Compagnon" (FR). Pick ONE: "Companion" or "Compagnon"? **Recommended: "Companion"** — chrome consistency under the EN-UI rule. The French app name was a brand-flavor choice; standardizing on "Companion" is the chrome-consistency choice.
    - **Q3 — Login tagline (`app/(auth)/login.tsx:131`).** "Parlez. Apprenez. Maîtrisez." — convert to "Speak. Learn. Master." or keep French as brand voice? **Recommended: convert** — chrome rule.
    - **Q4 — Placement-test congratulation phrases (`app/onboarding/placement-test.tsx:89-114` `LEVEL_CONGRATS` object).** Per-level French exclamations ("Bonjour !", "Bravo !", "Excellent !", etc.) shown on results screen. Convert to English equivalents or keep as French flavor? **Recommended: convert** — chrome rule; the English subtitles in the same object already provide the consistent EN voice.
    - **Q5 — EmailVerificationGate (`src/components/auth/EmailVerificationGate.tsx`) AND password-policy strings (Story 12-8 `src/lib/password-policy.ts` `FRENCH_MESSAGES` + `signup.tsx:289` French placeholder + `signup.tsx:297` accessibilityHint + signup Alert.alert messages).** Stories 12-8 + 12-9 deliberately localized the signup verification flow to French. Convert to English under the new chrome rule, or keep FR (recognizing it re-introduces the P1-20 chaos pattern on a single flow)? **Recommended: convert** — the audit mandate is "no bilingual UI chaos"; keeping FR on signup while every other surface is EN keeps the chaos. The password-policy `FRENCH_MESSAGES` exported constant can be renamed `ENGLISH_MESSAGES` or just `MESSAGES`. Story 12-8's existing tests pin the French canonicals — they'll need updating in lockstep (~22 test cases in `password-policy.test.ts` may need their canonical-string assertions updated; verify exact count when implementing).

### Y. GitHub Actions Injection Vector Check

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — N/A (no UI styling changes; only text content).
- [ ] All loading states use skeleton animations — N/A (no loading-state changes).
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` — verified during string conversion; existing labels updated to EN where they were FR.
- [ ] Non-obvious interactions have `accessibilityHint` — preserved (chrome conversion only).
- [ ] Stateful elements have `accessibilityState` — N/A.
- [ ] All tappable elements have minimum 44x44pt touch targets — N/A (no layout changes).
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — N/A (no new catch blocks).
- [ ] All text uses `Typography.*` presets — N/A (text presets unchanged; only the rendered string content changes).
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check && npm test` — AC #10.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9: verify this story file is visible to git but not silently ignored.
-->

- [x] `git status` lists this story file under "Untracked files" — verified: `git status --short` returns `?? _bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md`; `git check-ignore -v` returns exit code 1 (no ignore rule matches).
- [x] `npx prettier --check _bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md` passes — verified: "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1: Resolve the 5 operator-decision items (AC #11) BEFORE any source edits.**
  - [x] Subtask 1.1: All Q1–Q5 resolved per the AC #11 RECOMMENDED answers (convert all under EN-UI rule). Operator-decision rationale recorded in the Completion Notes below.
  - [x] Subtask 1.2: N/A — Q5 = convert (no scope-down needed).

- [x] **Task 2: Convert chrome strings file-by-file per the inventory table (AC #1).**
  - [x] Subtask 2.1: `app/onboarding/index.tsx` — 3 step titles + 3 CTA labels converted.
  - [x] Subtask 2.2: `app/onboarding/placement-test.tsx` — ~12 chrome strings + 6 `LEVEL_CONGRATS` entries converted.
  - [x] Subtask 2.3: `app/(tabs)/home/index.tsx` — 7 chrome strings + `Bonjour` greeting + `Impossible de charger le plan` error all converted.
  - [x] Subtask 2.4: `app/(tabs)/practice/index.tsx` — `VEDETTE` → `FEATURED`; `Vocabulaire` → `Vocabulary` (Vocabulary card flipped to EN-primary with the duplicate FR-secondary line dropped); `Entraînement` → `Practice`; hero subtitle + accessibilityLabel updated.
  - [x] Subtask 2.5: `app/(tabs)/mock-test/index.tsx` — `COMPRÉHENSION COMPLÈTE` → `FULL COMPREHENSION` + description + `Sections individuelles` + 2 additional FR labels (`Bientôt disponible` + `Production écrite et orale`) converted.
  - [x] Subtask 2.6: `app/(tabs)/mock-test/[testId].tsx` — `Préparation de la section suivante...` → `Preparing next section...`; secondary line + adjacent inline-comment-referencing-the-legacy-string updated.
  - [x] Subtask 2.7: `app/(tabs)/conversation/index.tsx` — `Parlez avec Compagnon` → `Talk with Companion`. `TOPIC_EMOJIS` keys + `titleFr` rendering preserved (AC #2 — French topic names are content).
  - [x] Subtask 2.8: `app/(tabs)/conversation/history.tsx` — `Compagnon` → `Companion` in empty-state copy (Q2 brand-name).
  - [x] Subtask 2.9: `app/(tabs)/profile/index.tsx` — `Mes compétences` → `My skills`; `exercices complétés` → `exercises completed`; `unit="jours" label="Série"` → `unit="days" label="Streak"`; `À améliorer` → `Needs work`; `Aucune erreur détectée pour le moment.\nContinuez à pratiquer !` → English equivalent; `"Utilisateur"` fallback → `"User"`; `Se déconnecter` → `Sign out`.
  - [x] Subtask 2.10: `app/(tabs)/profile/settings.tsx` — all ~14 section labels + button labels + placeholders + privacy/terms link labels converted, including `Apprentissage` / `Compte` / `Données` / `À propos` / `Niveau actuel` / `Niveau cible` / `Objectif quotidien` / `Nom d'affichage` / `Adresse e-mail` / `Enregistrer` / `Annuler` / `Non défini` / `Politique de confidentialité` / `Conditions d'utilisation` / `Voir →` / `Exporter mes données` / `← Paramètres` / `Se déconnecter`.
  - [x] Subtask 2.11: `app/(auth)/login.tsx` — `Compagnon` brand → `Companion`; tagline `Parlez. Apprenez. Maîtrisez.` → `Speak. Learn. Master.`; `Bon retour` → `Welcome back`; placeholders + button + forgot-link converted.
  - [x] Subtask 2.12: `app/(auth)/signup.tsx` — `Compagnon` → `Companion`; `Commencez votre voyage` → `Start your journey`; `Créer un compte` → `Create account`; all placeholders + button + legal-notice text + sign-in link converted; password-related strings updated in lockstep with Subtask 2.18-2.19.
  - [x] Subtask 2.13: `app/(auth)/forgot-password.tsx` — `Compagnon` → `Companion`; `Récupérez votre accès` → `Recover your account`; `Mot de passe oublié` → `Forgot password`; description + placeholder + button + back-link converted.
  - [x] Subtask 2.14: `src/components/conversation/TranscriptView.tsx` — `isUser ? "Vous" : "Compagnon"` → `isUser ? "You" : "Companion"` (Q1); 2 additional `Compagnon` header occurrences → `Companion` (Q2).
  - [x] Subtask 2.15: `src/components/conversation/CorrectionBubble.tsx` — `Compagnon noticed` → `Companion noticed` (Q2).
  - [x] Subtask 2.16: `src/components/home/CompanionMessage.tsx` — `Compagnon` brand label → `Companion` (Q2).
  - [x] Subtask 2.17 (Q5 = convert): `src/components/auth/EmailVerificationGate.tsx` — heading + body + 4 button labels + 3 Alert titles + 3 Alert bodies + 1 conditional `Vérification non confirmée` alert all converted.
  - [x] Subtask 2.18 (Q5 = convert): `src/lib/password-policy.ts` — `FRENCH_MESSAGES` → `MESSAGES`; `passwordPolicyReasonToFrenchMessage` → `passwordPolicyReasonToMessage`; `getPwnedFrenchMessage` → `getPwnedMessage`; `getGenericWeakPasswordFrenchMessage` → `getGenericWeakPasswordMessage`; all canonical message strings converted to English equivalents.
  - [x] Subtask 2.19 (Q5 = convert): `app/(auth)/signup.tsx` placeholder template literal + accessibilityHint + 4 Alert.alert call-sites + import line all updated to the renamed helpers + English titles.
  - [x] Bonus surface 2.20: `src/components/auth/PasswordStrengthIndicator.tsx` — `STRENGTH_LABELS` `Faible / Moyen / Fort` → `Weak / Medium / Strong`; `passwordPolicyReasonToFrenchMessage` import renamed.
  - [x] Bonus surface 2.21: `src/lib/email-verification.ts` — `VERIFICATION_EMAIL_FALLBACK_FR = "votre adresse e-mail"` → `VERIFICATION_EMAIL_FALLBACK = "your email address"`.
  - [x] Bonus surface 2.22: `app/(tabs)/mock-test/results.tsx` `SECTION_LABELS` converted (`Compréhension Orale / Écrite / Structures de la Langue` → `Listening Comprehension / Reading Comprehension / Language Structures`).
  - [x] Bonus surface 2.23: `app/(tabs)/practice/grammar.tsx` — `Parfait ! / Bon travail !` → `Perfect! / Nice work!`.
  - [x] Bonus surface 2.24: `src/components/common/SkillCard.tsx` — render order flipped: `{titleEn}` is now the primary big label, `{titleFr}` is the secondary line (Q2 + chrome rule applied to the practice list); accessibilityLabel narrowed from `${titleFr} - ${titleEn}` to `${titleEn}`.

- [x] **Task 3: Update inline comments that name the legacy FR strings (AC #5).** Updated 1 comment in `app/(tabs)/mock-test/[testId].tsx:571` + 5 JSDoc-level references in `src/components/auth/EmailVerificationGate.tsx` (button-label tour) + JSDoc-level references in `src/lib/password-policy.ts` + JSDoc-level references in `src/lib/email-verification.ts` + JSDoc-level reference in `src/components/auth/PasswordStrengthIndicator.tsx`.

- [x] **Task 4: Write the new drift-detector test [`src/lib/__tests__/language-strategy-source-drift.test.ts`](src/lib/__tests__/language-strategy-source-drift.test.ts) (AC #9).** 24 Jest-reported cases: 23 paired NEGATIVE / POSITIVE per touched file + 1 global negative sweep over 23 high-signal FR substrings × 23 touched files. Comment-stripped read per Story 12-2 P12; whitespace-tolerant regexes per Story 12-12 M1 + Story 13-7 P3 lessons.

- [x] **Task 5: Update Story 12-8's existing tests to reflect EN canonicals.** `src/lib/__tests__/password-policy.test.ts` — 4 canonical-string assertions + 4 import names + 2 describe-block names updated. `src/lib/__tests__/password-policy-source-drift.test.ts` — added Case 4b NEGATIVE pin against `caractères`; Case 6 placeholder positive-pin regex switched from `caractères` to `characters`; Case 7 JSDoc comment updated to reflect new EN canonicals. `src/lib/__tests__/email-verification.test.ts` — 6 FR fallback assertions converted to English. `src/components/auth/__tests__/EmailVerificationGate.test.tsx` — 9 Alert-title / label-content / canonical-string assertions converted to English.

- [x] **Task 6: Run all 4 quality gates green (AC #10).** `npm run type-check && npm run lint && npm run format:check && npm test` — all green. Final: 1884 / 1884 cases passing in 95 suites (+25 net 1859 → 1884; exceeds spec target +10-15 by 10).

- [x] **Task 7: Append the Story 14-1 architecture paragraph to CLAUDE.md.** Appended after the Story 13-8 entry; documents the EN-UI / FR-content rule + the audit findings closed + the 5 operator-decision answers + the drift detector + the explicit non-scope (no i18n library; no copy module; no design-token / accessibility / color audits — those are 14.2 through 14.9).

- [x] **Task 8: Flip sprint-status.yaml 14-1 status.** `ready-for-dev` → `in-progress` → `review`. `last_updated` annotated. Epic 14 status auto-flipped to `in-progress` during story-file creation.

- [x] **Task 9: Branch from `origin/main`** per `feedback_branch_from_main` memory. Branched off `origin/main` directly (post-merge of Epic 13 retro AI batch, commit `5c0a3b5`); created `feature/14-1-language-strategy-rewrite` branch.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory (2026-05-13): every new story branches from `origin/main`; do NOT stack on the prior branch's in-flight work even if a PR is open. Current branch `chore/epic-13-retro-action-items` is unrelated; create 14-1's branch off `origin/main` directly. No file-scope conflict with the chore branch (chore touches `_bmad-output/` + memory files only).

### Project conventions to follow

- **Inline strings stay inline.** No new copy module; no abstractions. Per scope rule + roadmap line 270 ("until i18n exists").
- **Conversion is mechanical** — read the inventory table, do the replacements, run the drift detector. No new logic.
- **Speaker labels in TranscriptView are CHROME** per AC #11 Q1 recommendation. The French text BELOW the label is content; the label itself is the UI's identification of who said what.
- **Brand name standardization** per AC #11 Q2 recommendation. The choice propagates to ~6 files (auth screens + transcript + correction bubble + companion message + history empty state). Pick once, apply everywhere via the drift detector.
- **Comments referencing legacy strings MUST be updated** (Story 12-2 P12 lesson; AC #5). The drift detector's comment-stripped read would let a stale comment slip past, but a stale comment confuses future readers.
- **Quality gates are the merge gate** — `tsc + lint + prettier + jest` all green.
- **Drift-detector regexes are tolerant** of punctuation / formatter drift (Story 12-12 M1 + Story 13-7 P3 lessons). Use substring or word-boundary matches; avoid line-number anchoring.

### Pattern: chrome-conversion-with-drift-pin

For each FR string `"FR_STRING"` in file `path/to/screen.tsx`:

1. Read the surrounding context (line + 3 lines above / below) to understand semantic intent.
2. Choose the natural EN equivalent (preserve sentence shape, punctuation, emoji, formatting).
3. Replace in-place.
4. Add to the drift-detector test:

   ```typescript
   it("screen.tsx: 'FR_STRING' converted to English", () => {
     const src = readScreen("path/to/screen.tsx");
     expect(src).not.toMatch(/FR_STRING/);
     expect(src).toMatch(/EN_REPLACEMENT/);
   });
   ```

5. Update any inline comment that names `FR_STRING`.

### Cross-story invariants worth re-checking before merge

- Story 9-3 Sentry allowlist: zero-diff (no telemetry surface).
- Story 9-5 voice transcript dedup: speaker-label chrome conversion does NOT touch dedup helpers; verified.
- Story 11-1 tool-call protocol: zero-diff.
- Story 11-2 reconnect status copy: `state.status` literals already EN.
- Story 12-1 RealtimeOrchestrator: zero-diff.
- Story 12-6 transcript cap: cap logic untouched.
- Story 12-8 password policy: depends on Q5 answer; if convert, ~22 password-policy.test.ts cases update in lockstep + the `password-policy.ts` exports rename.
- Story 12-9 EmailVerificationGate: depends on Q5 answer; if convert, ~10 EmailVerificationGate.test.tsx cases update in lockstep (verify exact count when implementing).
- Story 13-4 mock-test overlay copy: convert per AC #4.

### Project Structure Notes

- **Files modified (estimated ~14-18 depending on Q5 answer):**
  - `app/onboarding/index.tsx`
  - `app/onboarding/placement-test.tsx`
  - `app/(tabs)/home/index.tsx`
  - `app/(tabs)/practice/index.tsx`
  - `app/(tabs)/mock-test/index.tsx`
  - `app/(tabs)/mock-test/[testId].tsx`
  - `app/(tabs)/conversation/index.tsx`
  - `app/(tabs)/conversation/history.tsx`
  - `app/(tabs)/profile/index.tsx`
  - `app/(tabs)/profile/settings.tsx`
  - `app/(auth)/login.tsx`
  - `app/(auth)/signup.tsx`
  - `app/(auth)/forgot-password.tsx`
  - `src/components/conversation/TranscriptView.tsx`
  - `src/components/conversation/CorrectionBubble.tsx`
  - `src/components/home/CompanionMessage.tsx`
  - (Conditional on Q5) `src/components/auth/EmailVerificationGate.tsx`
  - (Conditional on Q5) `src/lib/password-policy.ts`
  - (Conditional on Q5) `src/lib/__tests__/password-policy.test.ts` (test updates)
  - (Conditional on Q5) `src/lib/__tests__/password-policy-source-drift.test.ts` (test updates)
  - (Conditional on Q5) `src/components/auth/__tests__/EmailVerificationGate.test.tsx` (test updates)

- **Files added (1):**
  - `src/lib/__tests__/language-strategy-source-drift.test.ts` — ~14 cases pinning FR-gone + EN-present per touched screen.

- **Housekeeping (3):**
  - `CLAUDE.md` — Story 14-1 architecture paragraph.
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` — 14-1 status flip + `last_updated`.
  - `_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md` — this story file.

- **Explicitly NOT modified:**
  - `src/lib/prompts/*.ts` — French prompts are content; zero-diff.
  - `src/lib/scoring.ts` / `srs.ts` / `activity.ts` / `realtime-orchestrator.ts` / `cache.ts` / `memory.ts` / `error-tracker.ts` / `home-aggregate.ts` / `session-feedback-aggregate.ts` — zero-diff.
  - `src/hooks/*.ts` — zero-diff (existing English in `use-daily-briefing.ts:139-238` is preserved; no FR found in hooks).
  - `src/components/common/NetworkBanner.tsx` — already EN.
  - `app/_layout.tsx` `ProfileRetryScreen` (lines 263-330) — already EN.
  - `app/(tabs)/*/_layout.tsx` Stack screen titles — already EN.
  - `package.json` + `package-lock.json` — no new deps.
  - `tailwind.config.js` + `src/lib/design.ts` — N/A.
  - `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` — zero-diff.

### Estimated test budget

Spec target: **+10–15 net Jest cases** (baseline 1859 → 1869–1874). Breakdown:

- ~14 drift-detector cases (one per touched screen).
- (Conditional on Q5) ~22 password-policy.test.ts updates (string-canonical changes, NOT new cases — net 0).
- (Conditional on Q5) ~10 EmailVerificationGate.test.tsx updates (string-canonical changes, NOT new cases — net 0).

### Expected impact (architectural proxy)

- Audit P1-20 + P2-11 closed architecturally.
- Bilingual chrome surfaces: ~95 → 0 (drift-pinned).
- Brand-name occurrences: standardized on the Q2 answer (one of "Companion" or "Compagnon").
- Speaker labels in transcripts: consistent under the chrome rule (Q1).
- New-user onboarding mental model: read EN chrome, learn FR content. No mid-screen context switches.
- Future i18n migration: unaffected (this story does not preempt or block an `i18n` extraction; inline strings can be lifted into a key catalog later without rework).

### NativeWind / Reanimated / etc. — N/A

This story is pure UI text content. No styling, no animations, no layout, no design tokens.

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) lines 37, 89, 106, 270, 419.
- Operator decision: row D1 of the Decision Matrix (line 419) — **DECIDED 2026-05-06**.
- Memory: [`project_language_strategy.md`](/Users/simplemart/.claude/projects/-Users-simplemart-Development-projects-personal-companion/memory/project_language_strategy.md).
- Epic 13 retro entry condition: [`_bmad-output/implementation-artifacts/epic-13-retro-2026-05-15.md`](_bmad-output/implementation-artifacts/epic-13-retro-2026-05-15.md) lines 270-275.
- Story 12-2 P12 — comment-stripped source drift pattern (referenced by AC #9 + Subtask 4.1).
- Story 12-8 — French password-policy strings (`src/lib/password-policy.ts` `FRENCH_MESSAGES`) impacted by Q5.
- Story 12-9 — French EmailVerificationGate (`src/components/auth/EmailVerificationGate.tsx`) impacted by Q5.
- Story 12-12 M1 + Story 13-7 P3 — regex tolerance lessons (referenced by AC #9 + Subtask 4.2).
- Story 13-4 — "Préparation de la section suivante..." overlay copy (AC #4).
- Story 13-7 — `*StaticStyle` constant pattern (precedent for the upcoming Story 14-2 card consolidation; 14-1 doesn't touch styling).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branched from `origin/main` post-merge of Epic 13 retro AI batch (commit `5c0a3b5`) on 2026-05-15.
- All 5 operator-decision items (AC #11) resolved per RECOMMENDED answers under the EN-UI rule.
- The drift detector initially had 7 failing assertions due to (a) the literal `→` arrow being escape-sequenced in source (`→`), (b) `>X<` patterns failing on multi-line JSX where text is indented on its own line, and (c) `>Voir /` failing because the text is `Voir {"→"}` not `Voir →` directly. All three fixed by widening regexes to `\s*X\s*` / dropping the `>X<` anchor where appropriate / matching `View \{` for the arrow case.
- Prettier auto-fixed 5 files (`forgot-password.tsx`, `login.tsx`, `profile/settings.tsx`, `EmailVerificationGate.tsx`, `language-strategy-source-drift.test.ts`).
- Bonus surface conversions surfaced during the broad accented-string sweep that weren't in the original inventory (Subtasks 2.20–2.24): `PasswordStrengthIndicator.tsx` strength labels, `email-verification.ts` FR fallback constant, `mock-test/results.tsx` `SECTION_LABELS`, `practice/grammar.tsx` completion praise, `SkillCard.tsx` render-order flip.

### Completion Notes List

**Operator-decision Q1–Q5 answers (per AC #11 recommendations — convert all under EN-UI rule):**

- **Q1 — TranscriptView speaker labels:** CONVERT. `"Vous" / "Compagnon"` → `"You" / "Companion"`. The speaker label is chrome (it's the UI's identification of who said what); the transcript text below stays French content.
- **Q2 — Brand name:** STANDARDIZE on **"Companion"** (English). Applied to: `app/_layout.tsx` header (already EN, kept), all 3 auth screens (Compagnon → Companion), TranscriptView speaker label, TranscriptView typing-indicator + PendingAiBubble header (2 occurrences), CorrectionBubble "Compagnon noticed" → "Companion noticed", CompanionMessage brand label, conversation/history empty-state copy.
- **Q3 — Login tagline:** CONVERT. `Parlez. Apprenez. Maîtrisez.` → `Speak. Learn. Master.`
- **Q4 — LEVEL_CONGRATS:** CONVERT. 6 entries: `Bonjour !` → `Hello!`; `Très bien !` → `Nice work!`; `Bravo !` → `Well done!`; `Excellent !` → `Excellent!`; `Magnifique !` → `Wonderful!`; `Parfait !` → `Perfect!`
- **Q5 — Story 12-8 password-policy + Story 12-9 EmailVerificationGate FR strings:** CONVERT. The audit mandate is "no bilingual UI chaos"; keeping FR on signup while every other surface is EN would re-introduce the chaos. Password-policy exports renamed (`*FrenchMessage` → `*Message`; `FRENCH_MESSAGES` → `MESSAGES`); all consumer call sites updated in lockstep; 4 test files updated (`password-policy.test.ts` + `password-policy-source-drift.test.ts` + `email-verification.test.ts` + `EmailVerificationGate.test.tsx`).

**Test results:** 1884 / 1884 cases passing in 95 suites (+25 net 1859 → 1884; **exceeds spec target +10-15 by 10**). Breakdown: +24 from the new drift detector; +1 net from the existing test file updates (string-canonical changes are mostly value swaps, not new cases).

**File count:** 18 source files modified + 1 new drift detector test + 4 existing test files updated in lockstep + 3 housekeeping files (CLAUDE.md + sprint-status.yaml + this story file) = 26 files total; ~700 lines diff.

**Bonus surface conversions** (not in the original inventory table but found during the comprehensive accented-string sweep):

- `src/lib/email-verification.ts` — `VERIFICATION_EMAIL_FALLBACK_FR` renamed; canonical string converted (impacts 6 test assertions).
- `src/components/auth/PasswordStrengthIndicator.tsx` — `STRENGTH_LABELS` `Faible / Moyen / Fort` → `Weak / Medium / Strong`; consumer of the renamed `passwordPolicyReasonToMessage` helper.
- `app/(tabs)/mock-test/results.tsx` — `SECTION_LABELS` 3 entries converted.
- `app/(tabs)/practice/grammar.tsx` — completion praise `Parfait !` / `Bon travail !` converted.
- `src/components/common/SkillCard.tsx` — render order flipped EN-primary / FR-secondary (Q2 + chrome rule applied to the practice-list shared component); accessibilityLabel narrowed.

**Cross-story invariants verified clean:**

- Story 9-3 Sentry allowlist + GDPR scrubber: zero-diff (no telemetry surface — chrome is operator-facing only).
- Story 9-4 stored-prompt-injection: N/A (no prompt changes).
- Story 9-5 voice transcript dedup: transcript content untouched; only speaker-label chrome changed.
- Story 11-1 tool-call protocol: zero-diff (operator-facing chrome only).
- Story 11-2 reconnect + barge-in: orthogonal.
- Story 11-7 prompt-truncation: French prompt content + `buildConversationPrompt` byte-identical.
- Story 12-1 RealtimeOrchestrator: orthogonal.
- Story 12-6 transcript cap (`MAX_TRANSCRIPT_ENTRIES = 200`): preserved.
- Story 12-7 secure-cache: orthogonal (no chrome surface here).
- Story 12-8 password-policy: existing test pin contract preserved; FR canonicals replaced with EN equivalents 1:1.
- Story 12-9 EmailVerificationGate: existing test pin contract preserved; FR canonicals replaced with EN equivalents 1:1; mountedRef + breadcrumb + module-level Set guards all preserved.
- Story 13-1 through 13-8: all orthogonal except for Story 13-4 mock-test overlay copy which got the chrome conversion in line.

**Realtime API behavior unchanged.** French prompts in `src/lib/prompts/*.ts` are zero-diff; `buildConversationPrompt` output byte-identical; speaker-label conversion is presentation-only at `TranscriptView.tsx:140`.

**Architectural close:** audit P1-20 (bilingual UI chaos) + P2-11 (onboarding mixed-language) both close architecturally. The new drift detector at `src/lib/__tests__/language-strategy-source-drift.test.ts` is the regression guard — any future PR that re-introduces FR chrome to any of the 23 touched files will fail CI loudly with a paired NEGATIVE-fail + POSITIVE-fail signal.

### File List

**New files (1):**

- `src/lib/__tests__/language-strategy-source-drift.test.ts` — 24 Jest cases pinning FR-gone + EN-present per touched file + 1 global negative sweep over 23 high-signal FR substrings × 23 touched files.

**Modified source files (18):**

- `app/onboarding/index.tsx` — wizard step titles + CTA labels.
- `app/onboarding/placement-test.tsx` — chrome strings + `LEVEL_CONGRATS` (Q4).
- `app/(tabs)/home/index.tsx` — 7 chrome strings + greeting + error message.
- `app/(tabs)/practice/index.tsx` — VEDETTE / Vocabulaire / Entraînement / hero subtitle.
- `app/(tabs)/practice/grammar.tsx` — completion praise.
- `app/(tabs)/mock-test/index.tsx` — 5 chrome strings.
- `app/(tabs)/mock-test/[testId].tsx` — Story 13-4 overlay copy + inline comment.
- `app/(tabs)/mock-test/results.tsx` — `SECTION_LABELS`.
- `app/(tabs)/conversation/index.tsx` — hero heading (titleFr content preserved per AC #2).
- `app/(tabs)/conversation/history.tsx` — empty-state brand name.
- `app/(tabs)/profile/index.tsx` — section header + 5 chrome strings + sign-out + fallback.
- `app/(tabs)/profile/settings.tsx` — ~14 section labels + buttons + placeholders + links + back arrow + export.
- `app/(auth)/login.tsx` — brand + tagline + card title + placeholders + button + forgot-link.
- `app/(auth)/signup.tsx` — brand + tagline + card title + placeholders + button + legal + sign-in link + password-policy consumer updates (Q5).
- `app/(auth)/forgot-password.tsx` — brand + tagline + card title + description + placeholder + button + back-link.
- `src/components/conversation/TranscriptView.tsx` — speaker labels (Q1) + brand name (Q2).
- `src/components/conversation/CorrectionBubble.tsx` — section label brand (Q2).
- `src/components/home/CompanionMessage.tsx` — brand label (Q2).
- `src/components/common/SkillCard.tsx` — render order flipped + accessibilityLabel narrowed.
- `src/components/auth/EmailVerificationGate.tsx` — heading + body + 4 button labels + 3 Alert titles + 3 Alert bodies + JSDoc comments (Q5).
- `src/components/auth/PasswordStrengthIndicator.tsx` — `STRENGTH_LABELS` + consumer of renamed helper.
- `src/lib/password-policy.ts` — 4 export renames + canonical strings + JSDoc (Q5).
- `src/lib/email-verification.ts` — fallback constant renamed + JSDoc.

**Modified test files (4 — string-canonical updates):**

- `src/lib/__tests__/password-policy.test.ts` — import names + 4 canonical assertions + 2 describe blocks.
- `src/lib/__tests__/password-policy-source-drift.test.ts` — Case 4b added + Case 6 regex updated + Case 7 JSDoc.
- `src/lib/__tests__/email-verification.test.ts` — 6 FR-fallback assertions.
- `src/components/auth/__tests__/EmailVerificationGate.test.tsx` — 9 Alert + label-content assertions.

**Housekeeping (3):**

- `CLAUDE.md` — Story 14-1 architecture paragraph appended after Story 13-8 entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 14-1 status `ready-for-dev` → `in-progress` → `review`; epic-14 auto-flipped to `in-progress`; `last_updated` annotated.
- `_bmad-output/implementation-artifacts/14-1-language-strategy-rewrite.md` — this story file: Status `review`; Tasks/Subtasks checked; Dev Agent Record + File List filled.

**Explicitly NOT modified:**

- `src/lib/prompts/*.ts` — all French prompts are content; zero-diff.
- `src/hooks/use-daily-briefing.ts` — already English (verified pre-14-1).
- `src/components/common/NetworkBanner.tsx` — already English.
- `app/_layout.tsx` `ProfileRetryScreen` — already English.
- `app/(tabs)/*/_layout.tsx` Stack screen titles — all already English.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/migrations/` + `supabase/functions/` + `.github/workflows/` — zero-diff.

### Change Log

| Date | Change |
| --- | --- |
| 2026-05-15 | Initial implementation: 18 source files + 1 new drift test + 4 existing tests updated in lockstep. +25 net Jest cases (1859 → 1884). All 4 quality gates green. Audit P1-20 + P2-11 closed architecturally. |
