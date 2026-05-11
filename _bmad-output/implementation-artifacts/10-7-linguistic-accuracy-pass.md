# Story 10.7: Linguistic Accuracy Pass — Drop Emoji from Voice Mode, Fix "Force est de constater" Misclassification, Drop "Élémentaire avancé", Drop Québécois Prompt

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TCF Canada candidate whose AI conversation partner runs through `buildConversationPrompt` at [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts) into [`use-realtime-voice.ts:708`](src/hooks/use-realtime-voice.ts) (the Realtime WebSocket session is the only consumer — voice-only) — but the prompt today instructs the model to emit a Correction Report formatted with **emoji** (`📝`, `💡`, `✅`) + **markdown bold** (`**Corrections:**`) + **horizontal rules** (`---`) which OpenAI's Realtime TTS reads literally ("asterisk asterisk corrections asterisk asterisk") or skips unpredictably per [`docs/tcf-spec-source.md §8.4`](docs/tcf-spec-source.md) — and the same prompt at line 113 lists **"Force est de constater que"** in a "Encourage use of advanced **connectors**" list when per [`docs/tcf-spec-source.md §8.1`](docs/tcf-spec-source.md) and Le Bon Usage (Grevisse) + the Trésor de la langue française the expression is a **locution verbale figée** (fixed verbal expression meaning "one must / it is necessary to") not a connector — and [`src/types/cefr.ts:81`](src/types/cefr.ts) labels A2 as `nameFr: "Élémentaire avancé"` which is not a label any of the four French institutional sources (Service-Public.gouv.fr, Eduscol, Beacco/Didier, Alliance Française) use per [`docs/tcf-spec-source.md §8.2`](docs/tcf-spec-source.md) (closest match is the CEFR Companion Volume's informal "A2+" sub-level rendered "élémentaire avancé" only in some FLE-pedagogy schools) — and [`src/lib/prompts/listening.ts:94`](src/lib/prompts/listening.ts) tries to teach Québécois with two errors (`'tu' pronounced 'tsu'` is real /t/-before-/i,y/ affrication but mis-orthographed without IPA tagging, and `'chez nous'` is standard French not a Québécois marker per the OQLF Banque de dépannage linguistique) while [`shippable-roadmap.md` §6 decision D5](_bmad-output/planning-artifacts/shippable-roadmap.md) explicitly says **drop Québécois in v1; reintroduce in v2 with native-speaker review**,

I want (a) the Correction Report block in `buildConversationPrompt` rewritten to emit **plain-text labels only** (no emoji, no `**bold**`, no `---`), preserving the regex-extractable correction-line pattern `"User said" → "Correct form" (explanation)` that [`use-realtime-voice.ts:152-171`](src/hooks/use-realtime-voice.ts) `parseCorrections` depends on (so the post-conversation correction pipeline keeps working), (b) the debate-mode "advanced connectors" list at `conversation.ts:113` split into three correctly-classified categories — **Connectors** (Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part), **Fixed expressions / locutions verbales** (Force est de constater que, Il faut admettre que, Il n'en demeure pas moins que, Quoi qu'il en soit, À supposer que), and **Subjunctive triggers** (Bien que (+ subjonctif), Quand bien même) — addressing §8.1's misclassification finding without dropping the upper-register language, (c) `CEFR_LEVELS` in `src/types/cefr.ts` `nameFr` fields rewritten to the **Alliance Française school convention** (A1 "Élémentaire 1" / A2 "Élémentaire 2" / B1 "Intermédiaire 1" / B2 "Intermédiaire 2" / C1 "Avancé 1" / C2 "Avancé 2") — one institutional convention applied across all six levels per §8.2's recommendation, (d) the `quebecois` arm of `DIALECT_GUIDANCE` and the `"quebecois"` member of the `dialect?` union type in `buildListeningExercisePrompt` **removed entirely** per audit decision D5, leaving the union as `"metropolitan" | "african"` (no caller passes `"quebecois"`; verified — only `use-exercise.ts:120` calls with `"metropolitan"`), and (e) the connector-misclassification of "force est de constater" in [`src/lib/prompts/writing.ts:98`](src/lib/prompts/writing.ts) "Expected connectors by level" block and [`src/lib/prompts/placement.ts:129`](src/lib/prompts/placement.ts) C1 "nuanced connector usage" line corrected to "discourse markers (connectors + fixed expressions)" / "nuanced discourse markers" framing so the linguistic-classification fix is uniform across all CEFR-aware prompt builders,

so that **the four ✗ DELTA rows in [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) (P2-1 voice-mode emoji + P2-2 "Force est de constater" + P2-2 "Élémentaire avancé" + P2-2 Québécois) flip to ✓ Verified** — closing Epic 10's roadmap line 165 "Linguistic accuracy pass — fix 'Force est de constater' misclassification, drop 'Élémentaire avancé', rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage), drop emoji from voice-mode prompt outputs. Covers P2-1, P2-2" — and the §10 follow-up structure in [`docs/tcf-spec-source.md`](docs/tcf-spec-source.md) gains a new "Linguistic accuracy DONE" closure stamp on §8.1, §8.2, §8.3, §8.4. The **Realtime correction-protocol tool-call rewrite** (`report_correction` function call replacing the regex parser) per [`shippable-roadmap.md` Epic 11.1](_bmad-output/planning-artifacts/shippable-roadmap.md) is **out of scope** and remains the architectural successor — this story ships the minimum-viable P2-1 remediation (strip emoji + markdown decoration from the voice-mode prompt; preserve regex shape) so beta can ship before Epic 11. The **Québécois variant rewrite with accurate IPA + real markers** (roadmap line 165 wording: "rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage)") is **explicitly NOT what this story ships** — per audit decision D5 (`shippable-roadmap.md` §6) the Québécois variant is **deferred to v2 with native-speaker review**; this story therefore **drops** the Québécois arm rather than rewriting it. The verified-correct surfaces NOT touched are Story 9-1 / 10-1 TCF spec constants, Story 9-2 promotion engine, Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapping + "treat as data" prelude in `buildConversationPrompt`), Story 9-5 voice transcript dedup, Story 9-7 Zod schema retry path, Story 9-8 / 10-6 speaking pipeline, Story 10-2 per-skill scoring, Story 10-3 per-CEFR passage ranges, Story 10-4 vocabulary-tier integration (`force est de constater` correctly catalogued as C1 token in `vocabulary-tiers.ts` — **not touched**), Story 10-5 placement-test extraction, the Realtime modality config + transcript-event handling, the `parseCorrections` regex, and the post-conversation feedback pipeline.

## Background — Why This Story Exists

### What four ✗ DELTA rows the audit owns to this story

The 2026-05-10 citations matrix at [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) carries **four** linguistic-accuracy rows tagged **Owner: Epic 10.7**:

| Row                                                                          | Value                                | Anchor | Status                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| `src/types/cefr.ts:33` A2 `nameFr`                                           | "Élémentaire avancé"                 | §8.2   | ✗ DELTA — non-standard label. **Owner: Epic 10.7 (P2-2)**                     |
| `src/lib/prompts/listening.ts:65` Québécois prompt                           | (operator-derived heuristic)         | §8.3   | ✗ DELTA — drop or simplify per audit decision D5. **Owner: Epic 10.7 (P2-2)** |
| `src/lib/prompts/conversation.ts:91` "Force est de constater" classification | listed as connector                  | §8.1   | ✗ DELTA — misclassification. **Owner: Epic 10.7 (P2-2)**                      |
| Voice-mode emoji-formatted output                                            | Realtime prompts emit emoji/markdown | §8.4   | ✗ DELTA — TTS reads asterisks. **Owner: Epic 10.7 (P2-1)**                    |

(Line numbers in the matrix are pre-Story-10-1 / pre-Story-10-3 — the rows still resolve to the same surfaces; current locations are documented per AC below.)

### What the source-of-truth says about each finding

**§8.1 (Force est de constater).** Per Le Bon Usage (Grevisse) and the Trésor de la langue française, _force est de_ + infinitive is a **fixed expression (locution verbale figée)** meaning "one must / it is necessary to." It is NOT a connector or transitional adverbial. The codebase's [`src/lib/prompts/conversation.ts:113`](src/lib/prompts/conversation.ts) (debate-mode "advanced connectors" list) classifies it as a connector — that is the misclassification finding. The same misclassification echoes in [`src/lib/prompts/writing.ts:98`](src/lib/prompts/writing.ts) "Expected connectors by level — C1-C2" row and [`src/lib/prompts/placement.ts:129`](src/lib/prompts/placement.ts) C1 "nuanced connector usage" line. **Note:** the C2 "example structures" reference at [`src/lib/prompts/echo.ts:39`](src/lib/prompts/echo.ts) (`"Force est de constater que les résultats ne sont pas à la hauteur des attentes."`) is **NOT a misclassification** — it presents the expression as a C1 example structure, not as a connector. **NOT TOUCHED.** Likewise [`src/lib/prompts/vocabulary-tiers.ts:84,245`](src/lib/prompts/vocabulary-tiers.ts) correctly catalogues `force est de constater` as a C1+ forbidden-lower-tier token + C2 exemplar — per Story 10-4. **NOT TOUCHED.**

**§8.2 (CEFR labels in French).** There is no single canonical French short-label per CEFR level. Four institutional conventions exist (Service-Public.gouv.fr 3-tier "Élémentaire / Indépendant / Expérimenté", Eduscol "A1 (introductif) / A2 (intermédiaire) / B1 (seuil) / B2 (avancé) / C1 (autonome) / C2 (maîtrise)", Beacco/Didier "A1 / A2 / B1 / B2 / C1 / C2" bare codes, Alliance Française school convention "Élémentaire 1 / Élémentaire 2 / Intermédiaire 1 / Intermédiaire 2 / Avancé 1 / Avancé 2"). The CEFR Companion Volume (2018) §3 recognizes informal sub-levels A2.1 / A2.2 (= A2+) which is informally rendered "élémentaire avancé" in some FLE-pedagogy schools — but that is not one of the four institutional conventions, and the audit therefore flags `nameFr: "Élémentaire avancé"` at [`src/types/cefr.ts:81`](src/types/cefr.ts) as non-canonical. §8.2 explicitly recommends: "**Epic 10.7 should pick one convention and apply it across all six levels.**" This story picks the **Alliance Française school convention** because (a) it maintains the existing 3-name-family structure (Élémentaire / Intermédiaire / Avancé) so the UX migration is minimal, (b) the "1" / "2" suffix is a natural sub-level distinguisher between A1↔A2, B1↔B2, C1↔C2 (visible in the profile screen at [`app/(tabs)/profile/index.tsx:408`](app/\(tabs\)/profile/index.tsx) which renders `CEFR_LEVELS[level].nameFr`), and (c) it is the convention familiar to French-as-a-foreign-language students, the audience of this app. The current `nameFr: "Maîtrise"` for C2 is dropped to "Avancé 2" for convention-uniformity (the current "Maîtrise" matches Eduscol's parenthetical descriptor, not Alliance Française).

**§8.3 (Québécois variant).** Per the Office québécois de la langue française (OQLF) and the Banque de dépannage linguistique:

- The "tu" → "tsu" affrication is a **real phonological feature** of Québec French (specifically /t/ before /i/ and /y/ becomes [ts]) — but the codebase prompt's orthography is mis-rendered (no IPA tagging, no precise OQLF orthographic convention).
- **"Chez nous" is NOT a Québécois marker** — it is standard French. Genuine Québécois lexical markers per the OQLF Banque de dépannage linguistique include _icitte_ (here), _pantoute_ (not at all), _astheure_ (now), _piasse_ (dollar), _char_ (car), _magasiner_ (to shop).
- Per audit decision D5 ([`shippable-roadmap.md §6`](_bmad-output/planning-artifacts/shippable-roadmap.md)): **Québécois variant is deferred to v2 with native-speaker review.** v1 should drop the Québécois prompt entirely or significantly simplify it. **This story drops it entirely** — a half-correct rewrite without native-speaker review is worse than no Québécois support, because it teaches incorrect features (`chez nous` as a marker; orthographic `tsu` without IPA context). The roadmap line 165 wording "rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage)" is therefore **NOT what this story ships** — the drop-rather-than-rewrite interpretation is operator-confirmed by D5.

**§8.4 (Voice-mode emoji-formatted output).** OpenAI's Realtime API does not have a documented position on emoji handling in TTS output. Empirical observation: TTS literally reads asterisks (`*` → "asterisk") and reads or skips emoji unpredictably. The codebase's voice-mode prompt (`buildConversationPrompt`, consumed by `use-realtime-voice.ts:708`) instructs the model to emit:

```
---
📝 **Corrections:**
- "User said" → "Correct form" (brief explanation)
- "User said" → "Correct form" (brief explanation)

💡 **Tip:** [One specific, actionable tip to improve]
---
```

When the model dutifully follows the format, TTS reads the asterisks, the dashes, the bullet markers, the emoji names — turning the AI's correction summary into a sound-only train wreck. **The fix is to strip the decoration but preserve the regex-extractable correction-line shape** (`"User said" → "Correct form" (explanation)`) that `parseCorrections` at [`use-realtime-voice.ts:152-171`](src/hooks/use-realtime-voice.ts) regex-matches via `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g`. The regex does NOT depend on emoji or markdown — only on the inner quoted pair + arrow + parenthetical.

### Why the architecturally-clean fix (Epic 11.1 tool-calls) is NOT what 10-7 ships

[`shippable-roadmap.md` Epic 11.1](_bmad-output/planning-artifacts/shippable-roadmap.md): "Correction protocol via tool-calls — replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. **Covers P1-6, P2-1.**"

Epic 11.1 owns the architectural replacement of the regex parser with an OpenAI `tool_call` (`report_correction({ original, corrected, explanation })`) — at which point the prompt no longer instructs the model to emit a Correction Report text block at all; corrections arrive as structured tool-call events. **But Epic 11 is BACKLOG** and Epic 10.7 owns the §8.4 row that must close before beta. The minimum-viable P2-1 fix is therefore: strip emoji + markdown decoration from the existing prompt; preserve the regex contract. Epic 11.1 then replaces the regex contract wholesale; the two stories are sequential, not overlapping.

The Story 10-7 prompt change is a **forward-compatible bridge**: when Epic 11.1 lands, `buildConversationPrompt` will gain an `outputModality: "voice-text" | "voice-tool"` (or similar) discriminator, and the Story 10-7 plain-text-Correction-Report block becomes the `"voice-text"` legacy branch that exists only until Epic 11.1's `"voice-tool"` is the default. No code Story 10-7 writes blocks that migration.

### Threat / failure model — what cannot happen post-story

After this story:

1. **`buildConversationPrompt`** at `src/lib/prompts/conversation.ts` produces a prompt body that contains:
   - **No emoji** (any of `📝`, `💡`, `✅`, or any character in U+1F300-U+1FAFF / U+1F600-U+1F64F).
   - **No markdown bold** (`**...**` token pairs in the Correction Report block — note: `**` may legitimately appear in template-literal example strings like `**Bonne question**` in the `LEVEL_GUIDELINES` blocks; the assertion is scoped to the Correction Report block only).
   - **No horizontal-rule decoration** (`---` as a standalone separator line inside the Correction Report).
   - **A regex-matchable correction line shape** — `parseCorrectionsForTest` regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` matches a representative example line in the rendered prompt (positive assertion).

2. **Debate-mode connector classification.** The list at `conversation.ts:113` is split into three labeled sub-categories:
   - **Connecteurs (Connectors):** Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part
   - **Locutions verbales figées (Fixed expressions):** Force est de constater que, Il faut admettre que, Il n'en demeure pas moins que, Quoi qu'il en soit, À supposer que
   - **Déclencheurs du subjonctif (Subjunctive triggers):** Bien que (+ subjonctif), Quand bien même
   
   Each item appears in exactly one category. `Force est de constater que` is NOT in the Connectors category. (Substring assertion: the prompt does NOT contain the string `"Force est de constater que, Quoi qu'il en soit, En revanche"` consecutively — the pre-10-7 list ordering — but DOES contain `"Force est de constater que"` somewhere in the Fixed expressions sub-section.)

3. **`CEFR_LEVELS` in `src/types/cefr.ts` `nameFr` fields** are rewritten to the Alliance Française school convention:
   - A1: `"Élémentaire 1"` (was `"Élémentaire"`)
   - A2: `"Élémentaire 2"` (was `"Élémentaire avancé"` ← the audit-flagged label)
   - B1: `"Intermédiaire 1"` (was `"Intermédiaire"`)
   - B2: `"Intermédiaire 2"` (was `"Intermédiaire avancé"`)
   - C1: `"Avancé 1"` (was `"Avancé"`)
   - C2: `"Avancé 2"` (was `"Maîtrise"`)

4. **`buildListeningExercisePrompt` `dialect?` union and `DIALECT_GUIDANCE` map** are narrowed:
   - The `dialect?` type union goes from `"metropolitan" | "quebecois" | "african"` to `"metropolitan" | "african"`.
   - The `quebecois` key is **removed** from the `DIALECT_GUIDANCE` map object.
   - The single caller at [`src/hooks/use-exercise.ts:120`](src/hooks/use-exercise.ts) is `buildListeningExercisePrompt({ cefrLevel, dialect: "metropolitan" })` — unchanged. No caller currently passes `"quebecois"` (verified via `grep -rn '"quebecois"' src app`).
   - Citations matrix §8 row 2 anchor at `listening.ts:65` updates to reflect that the Québécois arm is removed entirely. **NOT a rewrite with IPA / real markers** — that would re-incur audit decision D5's "native-speaker review" requirement.

5. **`force est de constater` connector-misclassification echoes** in `writing.ts:98` and `placement.ts:129` are corrected:
   - `writing.ts:80-100` "Expected connectors by level" block is renamed in the rendered prompt to "Expected discourse markers (connectors + fixed expressions) by level" — the categorical framing changes, the items per level do not. The C1-C2 row no longer claims `force est de constater` is a "connector"; it is a fixed expression listed alongside the actual connectors.
   - `placement.ts:129` C1 competencies line changes from `"nuanced connector usage (quoique, en depit de, force est de constater)"` to `"nuanced connectors and fixed expressions (quoique, en dépit de [connector]; force est de constater que [fixed expression])"`. The inline parenthetical labels make the classification explicit without removing the content.

6. **No regression** to the four Story 9-4 / 9-5 / 9-7 invariants:
   - `<USER_FACTS>` and `<USER_WEAK_AREAS>` wrapping + "treat as data" prelude in `buildConversationPrompt` are **NOT touched** (Story 9-4).
   - Voice transcript dedup logic in `use-realtime-voice.ts` is **NOT touched** (Story 9-5).
   - Zod schema retry path is **NOT touched** (Story 9-7) — `buildConversationPrompt` does not feed `chatCompletionJSON`; it feeds the Realtime session config.
   - `parseCorrections` regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` at `use-realtime-voice.ts:155` is **NOT touched**. The prompt change is forward-compatible; the regex still matches the new plain-text Correction Report.

7. **`docs/tcf-spec-source.md §8.1, §8.2, §8.3, §8.4`** each gain a "**DONE — closed by Story 10-7 on 2026-05-XX**" closure stamp with a one-paragraph implementation breakdown + cross-references to the §10 follow-up structure.

8. **`docs/tcf-spec-citations.md §8`** flips all four owned rows from ✗ DELTA → ✓ Verified with Story 10-7 trailers.

9. **`CLAUDE.md`** gains a new "TCF linguistic accuracy pass" architecture line after the Story 10-6 line.

10. **Forward-compat note for Epic 11.1.** The new plain-text Correction Report block is structurally `parseCorrections`-regex-compatible (existing extraction pipeline unchanged). When Epic 11.1 lands the `report_correction` tool-call replacement, the Correction Report block in `buildConversationPrompt` becomes obsolete and is removed in that story; 10-7 does NOT pre-build the tool-call discriminator.

### Out of scope for this story (delegated elsewhere)

- **Replacing the regex-parsed Correction Report with a `report_correction` tool-call** — Epic 11.1 owns. **Specifically NOT touched:** `parseCorrections` at `use-realtime-voice.ts:152-171`, the `inferCategory` heuristic, the post-conversation `extractErrorsFromCorrections` flow.
- **Rewriting the Québécois prompt with accurate IPA + real markers (`icitte`, `pantoute`, `l'affricage`)** — audit decision D5 defers to v2 with native-speaker review. The roadmap line 165 wording was the audit's wishlist; the decision was "drop in v1." This story drops.
- **Adding Québécois back as a v2 feature** — separate v2 story; out of scope.
- **The `african` dialect arm** — not flagged by the audit; not touched. `buildListeningExercisePrompt` retains `"metropolitan" | "african"`. (`african` has no current caller either, but the audit does not own its removal; conservative.)
- **Touching `force est de constater` in [`src/lib/prompts/echo.ts:39`](src/lib/prompts/echo.ts)** — its use there as a C1 "example structure" is linguistically correct (it IS a C1+ fixed expression suitable for echo practice at the upper-register level); the §8.1 audit finding is specifically about the connector-misclassification, not about the expression's existence at C1. **NOT TOUCHED.**
- **Touching `force est de constater` in [`src/lib/prompts/vocabulary-tiers.ts:84,245`](src/lib/prompts/vocabulary-tiers.ts)** — Story 10-4 correctly catalogues it as a C1+ forbidden-lower-tier token + C2 exemplar per §7.2 / §8.1. **NOT TOUCHED.**
- **Touching `LEVEL_GUIDELINES` in `conversation.ts` per-CEFR sentence-structure paragraphs (lines 185-228)** — not flagged by the audit; not touched.
- **Touching `LEVEL_GUIDELINES.C2` literal-character `**bold**` examples** (the per-level guidance text uses `**bold**` in places — e.g., the C2 "use the full range of French expression" paragraph). These are inside the system-prompt body but not in the Correction Report block. The negative-assertion for "no markdown bold" is **scoped to the Correction Report block**, not the whole prompt. (Reasoning: stripping all `**` from the prompt would require a larger sweep + risks losing structural emphasis the model uses to identify rubric sections; the §8.4 TTS-leak failure mode is specifically the model echoing the Correction Report `**Corrections:**` / `**Tip:**` headers back into TTS output, which is what this story fixes.)
- **Migrating historical pre-10-7 conversation transcripts** — forward-only. Pre-10-7 transcripts in `conversation_messages` may contain `**Corrections:**` / `📝` text; not backfilled.
- **Touching the Realtime session config / modality / transcript-event handling** — Story 9-5's `output_modalities: ["audio"]` contract holds. The §6.4 examiner role-play deferral (Story 10-6 follow-up #10) remains deferred.
- **Touching the speaking evaluator's `"no emoji, no markdown"` JSON-output instruction** at `speaking.ts:514` — Story 9-8 / 10-6 already enforced; not regressed. The Story 10-6 `evaluator prompt does NOT contain emoji (Epic 10.7 guard)` test at [`src/lib/prompts/__tests__/speaking.test.ts:145`](src/lib/prompts/__tests__/speaking.test.ts) is a 10-6 / 10-7 cross-story guard that already exists. **NOT TOUCHED.**
- **Touching `app/(tabs)/profile/index.tsx:408`** + **`app/(tabs)/mock-test/[testId].tsx:673`** + **`app/(tabs)/mock-test/index.tsx`** consumers of `nameFr` — they re-render `CEFR_LEVELS[level].nameFr` directly, so the new Alliance Française labels propagate automatically with no UI code change. No screen-level work needed.

## Acceptance Criteria

### 1. Strip emoji + markdown decoration from the Correction Report in `buildConversationPrompt` (P2-1; §8.4)

- [x] **UPDATE** [`src/lib/prompts/conversation.ts:60-75`](src/lib/prompts/conversation.ts) Correction Report block. Replace the current emoji-formatted block:
  ```
  ---
  📝 **Corrections:**
  - "User said" → "Correct form" (brief explanation)
  - "User said" → "Correct form" (brief explanation)

  💡 **Tip:** [One specific, actionable tip to improve]
  ---

  If the user made no errors, replace the Corrections section with:
  ---
  ✅ **Parfait !** No corrections needed.
  💡 **Tip:** [vocabulary enrichment or stylistic suggestion]
  ---
  ```
  With a plain-text version that:
  - Uses **plain-text section labels**: `Corrections:`, `Tip:`, `No corrections.` (no asterisks, no emoji, no `---` rule).
  - Preserves the **regex-extractable correction-line shape**: `"User said" → "Correct form" (brief explanation)` — the inner quoted-pair + U+2192 RIGHTWARDS ARROW + parenthetical is what `parseCorrections` at `use-realtime-voice.ts:155` matches.
  - Uses an **explicit instruction to the model** about TTS:
    ```
    ## Correction Report (Plain Text — Read Aloud)
    Your full response will be spoken aloud verbatim by text-to-speech. Do NOT use markdown formatting (no asterisks, no bullet symbols, no horizontal rules) and do NOT use emoji. At the end of each response, after responding to the user naturally, briefly note any corrections in plain spoken French.
    
    Use this exact line shape for each correction so the post-conversation parser can extract them:
    "What the user said" → "Correct form" (brief explanation in plain French)
    
    Then on the next line:
    Tip: [one specific, actionable tip to improve, in plain French]
    
    If the user made no errors, say "No corrections." on one line and "Tip: [vocabulary enrichment or stylistic suggestion in plain French]" on the next.
    ```
- [x] **No emoji anywhere in the rendered prompt body** — assertable via the same Unicode-range regex Story 10-6 uses at `speaking.test.ts:153-154`: `expect(prompt).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)` AND `expect(prompt).not.toMatch(/[\u{1F600}-\u{1F64F}]/u)`.
- [x] **No `---` horizontal-rule lines** in the Correction Report block — assertable as `expect(promptCorrectionBlock).not.toMatch(/^---$/m)` where `promptCorrectionBlock` is the substring from `"## Correction Report"` to the next `##`.
- [x] **`parseCorrections` regex still matches** the new format — add a test that constructs a sample model response in the new format ("`Bonjour ! ... \"je suis allé\" → \"je suis allée\" (feminine agreement)\nTip: review past participle agreement with être verbs.`") and confirms `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` extracts one match with `original="je suis allé"`, `corrected="je suis allée"`, `explanation="feminine agreement"`.

**Given** `buildConversationPrompt({ cefrLevel: "B1", mode: "free", topic: "voyages" })`
**When** the rendered prompt is inspected
**Then** it contains zero characters in `[\u{1F300}-\u{1FAFF}]` and zero characters in `[\u{1F600}-\u{1F64F}]` and zero `^---$` lines in the Correction Report block; AND a representative correction line `"je suis allé" → "je suis allée" (feminine agreement)` is regex-extractable via the existing `parseCorrections` pattern.

### 2. Split debate-mode "advanced connectors" into three correctly-classified categories (P2-2; §8.1)

- [x] **UPDATE** [`src/lib/prompts/conversation.ts:106-117`](src/lib/prompts/conversation.ts) debate-mode block. Replace the current single list:
  ```
  - Encourage use of advanced connectors:
    Cependant, Néanmoins, Toutefois, Il faut admettre que, Force est de constater que,
    Quoi qu'il en soit, En revanche, D'une part... d'autre part, Il n'en demeure pas moins que,
    Bien que (+ subjonctif), Quand bien même, À supposer que
  ```
  With three labeled sub-categories:
  ```
  - Encourage use of advanced discourse markers, split by linguistic category:
    Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part
    Locutions verbales figées (fixed expressions): Force est de constater que, Il faut admettre que, Il n'en demeure pas moins que, Quoi qu'il en soit, À supposer que
    Déclencheurs du subjonctif (subjunctive triggers): Bien que (+ subjonctif), Quand bien même
  ```
- [x] **Each item appears in exactly one category** — `Force est de constater que` is in the Fixed-expressions category, NOT in the Connectors category. (Verify by reading the rendered prompt: the substring `"Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part"` does NOT contain `"Force"`; and the substring `"Locutions verbales figées (fixed expressions): Force est de constater que, ..."` DOES contain it.)
- [x] **The pre-10-7 single-list ordering is gone** — negative assertion: the rendered debate-mode prompt does NOT contain the consecutive substring `"Force est de constater que, Quoi qu'il en soit, En revanche"` (the pre-10-7 mid-list ordering). A future patch that re-merges the categories would fail this assertion.

**Given** `buildConversationPrompt({ cefrLevel: "B2", mode: "debate", topic: "..." })`
**When** the rendered prompt is inspected
**Then** the debate-mode block contains three labeled sub-categories ("Connecteurs", "Locutions verbales figées", "Déclencheurs du subjonctif") AND `"Force est de constater que"` appears under "Locutions verbales figées" only.

### 3. Rewrite `CEFR_LEVELS` `nameFr` to Alliance Française school convention (P2-2; §8.2)

- [x] **UPDATE** [`src/types/cefr.ts:69-118`](src/types/cefr.ts) `CEFR_LEVELS` const. Apply the Alliance Française school convention to all six `nameFr` fields:
  ```typescript
  A1: { ..., nameFr: "Élémentaire 1", ... },   // was "Élémentaire"
  A2: { ..., nameFr: "Élémentaire 2", ... },   // was "Élémentaire avancé" ← audit-flagged
  B1: { ..., nameFr: "Intermédiaire 1", ... }, // was "Intermédiaire"
  B2: { ..., nameFr: "Intermédiaire 2", ... }, // was "Intermédiaire avancé"
  C1: { ..., nameFr: "Avancé 1", ... },        // was "Avancé"
  C2: { ..., nameFr: "Avancé 2", ... },        // was "Maîtrise"
  ```
- [x] **Add a JSDoc note** on `CEFR_LEVELS` (above the const declaration) documenting that the `nameFr` short labels follow the **Alliance Française school convention** per [`docs/tcf-spec-source.md §8.2`](docs/tcf-spec-source.md) — one institutional convention applied across all six levels. Reference Story 10-7.
- [x] **NO change to `name` (English) fields** — the audit only flags `nameFr`. Existing English labels ("Beginner", "Elementary", "Intermediate", "Upper Intermediate", "Advanced", "Mastery") are stable.
- [x] **NO change to `tcfScoreMin` / `tcfScoreMax` / `description`** — only `nameFr`.
- [x] **Consumers auto-propagate** — verify by reading (not editing) [`app/(tabs)/profile/index.tsx:408`](app/\(tabs\)/profile/index.tsx) (`{CEFR_LEVELS[level].nameFr}` is rendered directly), [`app/(tabs)/mock-test/[testId].tsx:673`](app/\(tabs\)/mock-test/[testId].tsx) (renders section-meta `nameFr` from `TCF_QCM_SECTIONS`, **NOT** `CEFR_LEVELS` — out of scope; do NOT modify), [`app/(tabs)/mock-test/index.tsx`](app/\(tabs\)/mock-test/index.tsx) (renders section-meta `nameFr` from `TCF_QCM_SECTIONS`, **NOT** `CEFR_LEVELS` — out of scope; do NOT modify). The `CEFR_LEVELS[level].nameFr` consumer in `profile/index.tsx` re-renders the new labels with no UI code change.

**Given** the migrated `CEFR_LEVELS` const
**When** `CEFR_LEVELS.A2.nameFr` is read
**Then** it equals `"Élémentaire 2"` (not the pre-10-7 `"Élémentaire avancé"`)

**Given** the migrated `CEFR_LEVELS` const
**When** `CEFR_LEVELS.C2.nameFr` is read
**Then** it equals `"Avancé 2"` (not the pre-10-7 `"Maîtrise"`)

### 4. Drop the Québécois arm from `buildListeningExercisePrompt` (P2-2; §8.3; audit decision D5)

- [x] **UPDATE** [`src/lib/prompts/listening.ts:34`](src/lib/prompts/listening.ts) — narrow the `dialect?` parameter type union from `"metropolitan" | "quebecois" | "african"` to `"metropolitan" | "african"`.
- [x] **UPDATE** [`src/lib/prompts/listening.ts:91-97`](src/lib/prompts/listening.ts) `DIALECT_GUIDANCE` object — **remove** the `quebecois` key entirely. Keep `metropolitan` and `african` arms unchanged.
- [x] **Add a JSDoc note** on `DIALECT_GUIDANCE` (or above the type union) documenting the Québécois v1 drop per audit decision D5 ([`shippable-roadmap.md §6`](_bmad-output/planning-artifacts/shippable-roadmap.md)) and `docs/tcf-spec-source.md §8.3`. State that v2 reintroduction requires native-speaker review (OQLF Banque de dépannage linguistique conformance + accurate IPA tagging for the /t/ → [ts] affrication + real Québécois lexical markers like `icitte` / `pantoute` / `astheure`). Reference Story 10-7.
- [x] **NO new caller passes `"quebecois"`** — verified pre-story via `grep -rn '"quebecois"' src app` returns zero matches outside `listening.ts` itself + the type-narrowing makes future call-sites fail type-check.
- [x] **The single caller at [`src/hooks/use-exercise.ts:120`](src/hooks/use-exercise.ts)** continues to pass `dialect: "metropolitan"` — **NO change** required to that call site.

**Given** `buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "metropolitan" })`
**When** the rendered prompt is inspected
**Then** it contains the metropolitan guidance line AND it does NOT contain the strings `"Québécois"`, `"quebecois"`, `"tsu"`, `"icitte"`, `"pantoute"`, or `"chez nous"` (the Québécois-arm-specific tokens).

**Given** a TypeScript call site that passes `dialect: "quebecois"`
**When** `tsc --noEmit` runs
**Then** the call fails type-check (the literal `"quebecois"` is no longer in the union).

### 5. Correct the `force est de constater` connector-misclassification echoes in `writing.ts` and `placement.ts` (P2-2; §8.1)

- [x] **UPDATE** [`src/lib/prompts/writing.ts:80-101`](src/lib/prompts/writing.ts) `connectorRows` block. Rename the rendered prompt's section header from "Expected connectors by level" to **"Expected discourse markers (connectors + fixed expressions) by level"**. The per-level row content does NOT change at the item level (A1-A2 / B1-B2 / C1-C2 items stay) — but each row's framing now acknowledges that the upper-register entries (C1-C2: `force est de constater`, `il n'en demeure pas moins`, `quoi qu'il en soit`) include both connectors AND fixed expressions, per §8.1.
- [x] **Internal comment update** at `writing.ts:80-82` — replace the existing "filter the AI sees both 'Forbidden at A1: force est de constater' and 'C1-C2 expected: force est de constater' — direct contradiction (Story 10-4 review patch P3 / Edge Case Hunter Finding 1)" comment with an additional Story 10-7 line clarifying that the framing change resolves §8.1 misclassification without re-introducing the A1-vs-C1-C2 contradiction (per-CEFR filter from Story 10-4 still applies).
- [x] **UPDATE** [`src/lib/prompts/placement.ts:127-132`](src/lib/prompts/placement.ts) C1 `competencies` string. Replace:
  ```
  "literary tenses (passe simple recognition), advanced syntax (mise en relief, inversion), nuanced connector usage (quoique, en depit de, force est de constater)"
  ```
  With:
  ```
  "literary tenses (passé simple recognition), advanced syntax (mise en relief, inversion), nuanced connectors and fixed expressions (quoique, en dépit de [connector]; force est de constater que [fixed expression])"
  ```
  Note the four sub-edits: (a) `passe simple` → `passé simple` (orthographic fix — was missing the accent acute), (b) `en depit de` → `en dépit de` (orthographic fix — was missing the accent), (c) the framing change from "nuanced connector usage" to "nuanced connectors and fixed expressions", (d) inline category labels `[connector]` / `[fixed expression]` make the §8.1 classification explicit to the AI generator.
- [x] **No change to placement.ts A1 / A2 / B1 / B2 / C2 competencies** — only C1's connector-misclassification line is touched.
- [x] **No change to `vocabulary-tiers.ts`** — `force est de constater` correctly catalogued as C1+ forbidden-lower-tier token + C2 exemplar (Story 10-4). Verified by re-reading lines 84 and 245.
- [x] **No change to `echo.ts:39`** — `"Force est de constater que les résultats ne sont pas à la hauteur des attentes."` is a C1 "example structure" not a connector classification. Verified-correct.

**Given** `buildWritingEvaluatorPrompt({ cefrLevel: "C2", taskNumber: 3, prompt: "..." })`
**When** the rendered prompt is inspected
**Then** the rendered prompt contains the substring `"Expected discourse markers (connectors + fixed expressions) by level"` AND does NOT contain the pre-10-7 substring `"Expected connectors by level"` AND the C1-C2 row still contains `"force est de constater"`.

**Given** `buildPlacementTestPrompt()` (Story 10-5)
**When** the rendered prompt is inspected
**Then** the C1 competencies row contains the substring `"force est de constater que [fixed expression]"` AND does NOT contain the pre-10-7 substring `"nuanced connector usage (quoique, en depit de, force est de constater)"`.

### 6. Test surface

- [x] **CREATE** [`src/lib/prompts/__tests__/conversation.test.ts`](src/lib/prompts/__tests__/conversation.test.ts) (or **EXTEND** the existing `prompt-injection.test.ts` `buildConversationPrompt` describe block). Add the following test cases:
  - **No emoji in rendered prompt** (parameterized over all 6 CEFR levels × `mode: "free" | "debate" | "tcf_simulation"`):
    ```ts
    expect(prompt).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(prompt).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    ```
  - **No `---` horizontal-rule lines in the Correction Report block** (parameterized over all 6 levels × 3 modes):
    ```ts
    const correctionBlock = prompt.match(/## Correction Report[\s\S]*?(?=^## |\Z)/m)?.[0] ?? "";
    expect(correctionBlock).not.toMatch(/^---$/m);
    ```
  - **`parseCorrections`-regex still matches a representative correction line in the rendered prompt's example shape**:
    ```ts
    const sampleModelResponse = `Bonjour ! ... "je suis allé" → "je suis allée" (feminine agreement)\nTip: review past participle agreement.`;
    const re = /"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g;
    const match = re.exec(sampleModelResponse);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("je suis allé");
    expect(match?.[2]).toBe("je suis allée");
    expect(match?.[3]).toBe("feminine agreement");
    ```
  - **Debate-mode three-category split** (positive + negative):
    ```ts
    const prompt = buildConversationPrompt({ cefrLevel: "B2", mode: "debate", topic: "..." });
    expect(prompt).toContain("Connecteurs (connectors / discourse links): Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part");
    expect(prompt).toContain("Locutions verbales figées (fixed expressions): Force est de constater que");
    expect(prompt).toContain("Déclencheurs du subjonctif (subjunctive triggers): Bien que (+ subjonctif), Quand bien même");
    // Negative: the pre-10-7 mid-list ordering is gone
    expect(prompt).not.toContain("Force est de constater que, Quoi qu'il en soit, En revanche");
    ```
  - **Story 9-4 invariants preserved** (regression guard — re-runs an existing test from `prompt-injection.test.ts` if convenient):
    - `<USER_FACTS>` wrapper still appears when `memories` is provided
    - `<USER_WEAK_AREAS>` wrapper still appears when `errorPatterns` is provided
    - "treat as data" prelude still appears

- [x] **CREATE** [`src/types/__tests__/cefr.test.ts`](src/types/__tests__/cefr.test.ts) (new file — `src/types/__tests__/` does not exist yet; create the directory) OR co-locate as part of an existing test file. Add:
  ```ts
  describe("CEFR_LEVELS nameFr — Alliance Française convention (Story 10-7)", () => {
    it("A1.nameFr = 'Élémentaire 1'", () => expect(CEFR_LEVELS.A1.nameFr).toBe("Élémentaire 1"));
    it("A2.nameFr = 'Élémentaire 2' (not 'Élémentaire avancé')", () => {
      expect(CEFR_LEVELS.A2.nameFr).toBe("Élémentaire 2");
      expect(CEFR_LEVELS.A2.nameFr).not.toBe("Élémentaire avancé");
    });
    it("B1.nameFr = 'Intermédiaire 1'", () => expect(CEFR_LEVELS.B1.nameFr).toBe("Intermédiaire 1"));
    it("B2.nameFr = 'Intermédiaire 2'", () => expect(CEFR_LEVELS.B2.nameFr).toBe("Intermédiaire 2"));
    it("C1.nameFr = 'Avancé 1'", () => expect(CEFR_LEVELS.C1.nameFr).toBe("Avancé 1"));
    it("C2.nameFr = 'Avancé 2' (not 'Maîtrise')", () => {
      expect(CEFR_LEVELS.C2.nameFr).toBe("Avancé 2");
      expect(CEFR_LEVELS.C2.nameFr).not.toBe("Maîtrise");
    });
    it("all 6 nameFr follow the same '<family> <1|2>' convention", () => {
      const labels = (["A1", "A2", "B1", "B2", "C1", "C2"] as const).map((l) => CEFR_LEVELS[l].nameFr);
      for (const label of labels) expect(label).toMatch(/^(Élémentaire|Intermédiaire|Avancé) [12]$/);
    });
  });
  ```

- [x] **CREATE** [`src/lib/prompts/__tests__/listening.test.ts`](src/lib/prompts/__tests__/listening.test.ts) (or extend existing test patterns; the file does not yet exist) OR add a new describe block to `vocabulary-integration.test.ts` if more aligned. Add:
  ```ts
  describe("buildListeningExercisePrompt — Québécois drop (Story 10-7 / audit D5)", () => {
    it("type union no longer admits 'quebecois'", () => {
      // Compile-time check: this assignment must fail tsc.
      // Documented as a `// @ts-expect-error` line so a future widening fails the type-check.
      // @ts-expect-error — Québécois deferred to v2 per Story 10-7 / audit D5
      const _bad: Parameters<typeof buildListeningExercisePrompt>[0] = { cefrLevel: "B1", dialect: "quebecois" };
      void _bad;
    });
    it("renders metropolitan guidance without Québécois leakage", () => {
      const prompt = buildListeningExercisePrompt({ cefrLevel: "B1", dialect: "metropolitan" });
      expect(prompt).toContain("Standard Parisian/metropolitan French");
      for (const forbidden of ["Québécois", "quebecois", "tsu", "icitte", "pantoute", "chez nous"]) {
        expect(prompt).not.toContain(forbidden);
      }
    });
  });
  ```
  Note: the `@ts-expect-error` line is the type-system guard — if a future patch widens the union back to admit `"quebecois"`, the `@ts-expect-error` becomes a real error and the test fails. Same pattern Story 9-7 used for the `ZodIssueCode` regression guards.

- [x] **CREATE** [`src/lib/prompts/__tests__/writing.test.ts`](src/lib/prompts/__tests__/writing.test.ts) (or extend if exists; `passage-calibration.test.ts` covers Story 10-3 but not the connector-classification framing). Add:
  ```ts
  describe("buildWritingEvaluatorPrompt — discourse-markers framing (Story 10-7)", () => {
    it("renders 'Expected discourse markers (connectors + fixed expressions)' header (not the pre-10-7 'Expected connectors')", () => {
      const prompt = buildWritingEvaluatorPrompt({ cefrLevel: "C1", taskNumber: 3, prompt: "Discutez de..." });
      expect(prompt).toContain("Expected discourse markers (connectors + fixed expressions) by level");
      expect(prompt).not.toContain("Expected connectors by level");
    });
    it("C1-C2 row still includes 'force est de constater'", () => {
      const prompt = buildWritingEvaluatorPrompt({ cefrLevel: "C1", taskNumber: 3, prompt: "..." });
      expect(prompt).toContain("force est de constater");
    });
  });
  ```

- [x] **EXTEND** [`src/lib/prompts/__tests__/placement.test.ts`](src/lib/prompts/__tests__/placement.test.ts) (Story 10-5). Add:
  ```ts
  describe("buildPlacementTestPrompt — Force est de constater fixed-expression reclassification (Story 10-7)", () => {
    it("C1 competencies row labels 'force est de constater que' as a fixed expression", () => {
      const prompt = buildPlacementTestPrompt();
      expect(prompt).toContain("force est de constater que [fixed expression]");
    });
    it("C1 competencies row no longer uses 'nuanced connector usage' framing", () => {
      const prompt = buildPlacementTestPrompt();
      expect(prompt).not.toContain("nuanced connector usage");
    });
    it("orthographic fixes — accents on 'passé simple' and 'en dépit de'", () => {
      const prompt = buildPlacementTestPrompt();
      expect(prompt).toContain("passé simple");
      expect(prompt).toContain("en dépit de");
      // Negative: the pre-10-7 unaccented forms are gone
      expect(prompt).not.toContain("passe simple recognition");
      expect(prompt).not.toContain("en depit de,");
    });
  });
  ```

- [x] **VERIFY existing tests stay green** (no regression):
  - `src/lib/__tests__/prompt-injection.test.ts` — `buildConversationPrompt` `<USER_FACTS>` / `<USER_WEAK_AREAS>` invariants stay green (Story 9-4).
  - `src/lib/__tests__/realtime-dedup.test.ts` — `parseCorrectionsForTest` test still parses the existing test-fixture correction lines (Story 9-5).
  - `src/lib/prompts/__tests__/vocabulary-integration.test.ts` (Story 10-4) — `buildConversationPrompt` / `buildListeningExercisePrompt` / `buildWritingEvaluatorPrompt` continue to surface the vocab block.
  - `src/lib/prompts/__tests__/vocabulary-tiers.test.ts` (Story 10-4) — `force est de constater` correctly catalogued as C1+ token; not regressed.
  - `src/lib/prompts/__tests__/passage-calibration.test.ts` (Story 10-3) — Writing per-task word ranges + §5.3 enforcement block continue to render.
  - `src/lib/prompts/__tests__/speaking.test.ts` (Story 9-8 / 10-6) — `evaluator prompt does NOT contain emoji (Epic 10.7 guard)` test stays green; sociolinguistic-5-dim rubric stays green.
  - `src/lib/prompts/__tests__/placement.test.ts` (Story 10-5) — `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` invariants + aggregated vocab table stay green.
  - `src/lib/__tests__/tcf-spec.test.ts` — citations-matrix-completeness assertions stay green; the §8 row updates are content-only.

- [x] **TARGET TEST COUNT POST-STORY:** 732 → 770+ (estimate: ~12 conversation-prompt cases [6 levels × 2 emoji/HR checks] + 7 CEFR-label cases + 2 listening-dialect cases + 2 writing-framing cases + 3 placement-framing cases + ~6 cross-level parameterized variants = ~32 new tests, but consolidate via `it.each` to land at ~25-35 net new test cases).

### 7. Update `docs/tcf-spec-source.md §8` and §10 follow-up

- [x] **UPDATE** [`docs/tcf-spec-source.md §8.1`](docs/tcf-spec-source.md) — append a Story 10-7 closure stamp after the "Owner: Epic 10.7" sentence:
  ```
  **DONE — closed by Story 10-7 on 2026-05-XX.** The connector-misclassification at `src/lib/prompts/conversation.ts:113` is fixed by splitting the debate-mode "advanced connectors" list into three labeled sub-categories (Connecteurs / Locutions verbales figées / Déclencheurs du subjonctif). The same misclassification echoes at `src/lib/prompts/writing.ts:98` (rebranded "Expected discourse markers (connectors + fixed expressions) by level") and `src/lib/prompts/placement.ts:129` (rewritten with explicit `[connector]` / `[fixed expression]` inline labels). `src/lib/prompts/echo.ts:39` (C1 example structure) and `src/lib/prompts/vocabulary-tiers.ts:84,245` (C1+ forbidden-lower-tier token, C2 exemplar) were verified-correct and not touched.
  ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §8.2`](docs/tcf-spec-source.md) — append:
  ```
  **DONE — closed by Story 10-7 on 2026-05-XX.** The Alliance Française school convention is now applied uniformly to all six `CEFR_LEVELS[level].nameFr` values at `src/types/cefr.ts`: A1 "Élémentaire 1", A2 "Élémentaire 2" (was the audit-flagged "Élémentaire avancé"), B1 "Intermédiaire 1", B2 "Intermédiaire 2", C1 "Avancé 1", C2 "Avancé 2" (was "Maîtrise"). The convention is documented in JSDoc on the `CEFR_LEVELS` const + in the `CLAUDE.md` "TCF linguistic accuracy pass" architecture line. Consumers (`app/(tabs)/profile/index.tsx`) re-render the new labels automatically with no UI code change.
  ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §8.3`](docs/tcf-spec-source.md) — append:
  ```
  **DONE — closed by Story 10-7 on 2026-05-XX.** Per audit decision D5 (`shippable-roadmap.md §6`), the Québécois variant is dropped in v1 entirely — the `quebecois` arm of `DIALECT_GUIDANCE` and the `"quebecois"` member of the `dialect?` union in `buildListeningExercisePrompt` (`src/lib/prompts/listening.ts`) are removed. The roadmap line 165 "rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage)" wording was the audit's wishlist; the decision is "drop in v1." Reintroduction in v2 requires native-speaker review per the OQLF Banque de dépannage linguistique conformance (accurate IPA tagging for /t/ → [ts] affrication + real Québécois lexical markers: `icitte`, `pantoute`, `astheure`, `piasse`, `char`, `magasiner`).
  ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §8.4`](docs/tcf-spec-source.md) — append:
  ```
  **DONE — closed by Story 10-7 on 2026-05-XX (minimum-viable P2-1 remediation).** The Correction Report block in `buildConversationPrompt` (`src/lib/prompts/conversation.ts`) is rewritten in plain text — no emoji (📝 / 💡 / ✅ removed), no markdown bold (`**Corrections:**` removed), no horizontal rules (`---` removed). The regex-extractable correction-line shape `"User said" → "Correct form" (explanation)` is preserved so `parseCorrections` at `src/hooks/use-realtime-voice.ts:152-171` continues to work. The Realtime API now reads only spoken-French content, not asterisks or emoji names. The architectural successor — `report_correction` tool-call replacing the regex parser — is owned by Epic 11.1 ("Correction protocol via tool-calls"). Story 10-7 ships the forward-compatible bridge; Epic 11.1 supersedes when it lands.
  ```
- [x] **UPDATE** [`docs/tcf-spec-source.md §10` follow-up tickets](docs/tcf-spec-source.md) — modify the existing item list (do NOT add a new follow-up; §8.1 / §8.2 / §8.3 / §8.4 closure is internal to §8, not a separate §10 ticket). If a §10 follow-up references the linguistic-accuracy work as a prerequisite (e.g., "10. Realtime examiner role-play for Speaking" from Story 10-6 — out of scope; do NOT touch), leave that item unchanged.

### 8. Update `docs/tcf-spec-citations.md §8`

- [x] **UPDATE** [`docs/tcf-spec-citations.md §8`](docs/tcf-spec-citations.md) — flip all four owned rows from ✗ DELTA → ✓ Verified with Story 10-7 trailers.

Row 1 (A2 `nameFr`):
```
| `src/types/cefr.ts` `CEFR_LEVELS.A2.nameFr` | "Élémentaire 2" (was "Élémentaire avancé") | §8.2 — Alliance Française convention applied uniformly to all 6 levels | ✓ Verified 2026-05-XX — closed by Story 10-7 (A1 "Élémentaire 1", A2 "Élémentaire 2", B1 "Intermédiaire 1", B2 "Intermédiaire 2", C1 "Avancé 1", C2 "Avancé 2"); JSDoc documents the convention; profile screen re-renders auto |
```

Row 2 (Québécois prompt):
```
| `src/lib/prompts/listening.ts` `DIALECT_GUIDANCE` | `"metropolitan" \| "african"` (Québécois arm removed) | §8.3 — audit decision D5: drop in v1, reintroduce v2 with native-speaker review | ✓ Verified 2026-05-XX — closed by Story 10-7 (Québécois drop, not rewrite — D5 deferral); JSDoc documents v2 reintroduction requirement |
```

Row 3 (Force est de constater classification):
```
| `src/lib/prompts/conversation.ts` debate-mode discourse markers + `src/lib/prompts/writing.ts` "Expected discourse markers by level" + `src/lib/prompts/placement.ts:129` C1 competencies | "Force est de constater que" classified as fixed expression (locution verbale figée), not connector | §8.1 — Le Bon Usage + Trésor de la langue française | ✓ Verified 2026-05-XX — closed by Story 10-7 (3-category split in conversation.ts debate-mode block; "Expected discourse markers (connectors + fixed expressions)" framing in writing.ts; `[connector]` / `[fixed expression]` inline labels in placement.ts C1 row); echo.ts:39 C1 example structure + vocabulary-tiers.ts:84,245 C1+ forbidden-lower-tier verified-correct, not touched |
```

Row 4 (Voice-mode emoji output):
```
| `src/lib/prompts/conversation.ts` Correction Report block (consumed by `src/hooks/use-realtime-voice.ts:708` Realtime session) | plain text (no emoji, no markdown bold, no `---` horizontal rules); regex-extractable `"X" → "Y" (Z)` line shape preserved for `parseCorrections` | §8.4 — TTS reads asterisks/emoji literally | ✓ Verified-with-caveat 2026-05-XX — Story 10-7 minimum-viable P2-1 remediation; architectural successor (`report_correction` tool-call) owned by Epic 11.1 ("Correction protocol via tool-calls"). Story 10-7 ships the forward-compatible bridge so beta can ship before Epic 11. |
```

- [x] **NO change to §1 / §2 / §3 / §4 / §5 / §6 / §7 / §9 / §10 / §11** of the citations matrix — Story 10-7 is scoped to §8.

### 9. Update CLAUDE.md

- [x] Add a new architecture line to [`CLAUDE.md`](CLAUDE.md) **after** the Story 10-6 "TCF Expression Orale 5-dimension rubric" line (chronological order):
  ```markdown
  **TCF linguistic accuracy pass:** post-Epic-10.7, four `docs/tcf-spec-citations.md §8` linguistic-accuracy ✗ DELTA rows flip to ✓ Verified. (a) `src/lib/prompts/conversation.ts` `buildConversationPrompt` Correction Report block — emoji (📝 / 💡 / ✅), markdown bold (`**Corrections:**`), and horizontal rules (`---`) removed; the regex-extractable correction-line shape `"User said" → "Correct form" (explanation)` is preserved so `parseCorrections` at `src/hooks/use-realtime-voice.ts:152-171` continues to extract corrections via `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g`. Architectural successor — `report_correction` tool-call — owned by Epic 11.1. (b) `conversation.ts` debate-mode "advanced connectors" list split into three correctly-classified sub-categories per `docs/tcf-spec-source.md §8.1`: Connecteurs (Cependant, Néanmoins, Toutefois, En revanche, D'une part... d'autre part), Locutions verbales figées (Force est de constater que, Il faut admettre que, Il n'en demeure pas moins que, Quoi qu'il en soit, À supposer que), Déclencheurs du subjonctif (Bien que (+ subjonctif), Quand bien même); the same misclassification echo at `src/lib/prompts/writing.ts:98` "Expected connectors by level" is rebranded to "Expected discourse markers (connectors + fixed expressions) by level" and `src/lib/prompts/placement.ts:129` C1 competencies row gains inline `[connector]` / `[fixed expression]` labels + accent-orthography fixes (`passé simple`, `en dépit de`); `src/lib/prompts/echo.ts:39` (C1 example structure) and `src/lib/prompts/vocabulary-tiers.ts:84,245` (C1+ forbidden-lower-tier token + C2 exemplar from Story 10-4) verified-correct, not touched. (c) `src/types/cefr.ts` `CEFR_LEVELS` `nameFr` fields rewritten to the **Alliance Française school convention** per §8.2: A1 "Élémentaire 1", A2 "Élémentaire 2" (was the audit-flagged "Élémentaire avancé"), B1 "Intermédiaire 1", B2 "Intermédiaire 2", C1 "Avancé 1", C2 "Avancé 2" (was "Maîtrise"); JSDoc documents the convention; profile screen consumer (`app/(tabs)/profile/index.tsx:408`) re-renders the new labels automatically. (d) The `quebecois` arm of `DIALECT_GUIDANCE` and the `"quebecois"` member of the `dialect?` union in `buildListeningExercisePrompt` (`src/lib/prompts/listening.ts`) are **removed** per audit decision D5 (`shippable-roadmap.md §6`) — Québécois variant deferred to v2 with native-speaker review (OQLF Banque de dépannage linguistique conformance + accurate IPA for /t/ → [ts] affrication + real markers: `icitte` / `pantoute` / `astheure` / `piasse` / `char` / `magasiner`); the single caller (`src/hooks/use-exercise.ts:120`) already passes `"metropolitan"`. Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + "treat as data" prelude) and Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + `appendIfNew` dedup) hold unchanged. Verified 2026-05-XX, story 10-7.
  ```

### Y. GitHub Actions Injection Vector Check (workflow stories only)

**N/A** — Story 10-7 does NOT introduce or modify any `.github/workflows/*.yml` file. The Story 9-9 GHA injection guard pattern is unused here.

### Z. Polish Requirements

- [x] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — **N/A** (no new error-prone code; all changes are to prompt-builder strings + type unions + test files).
- [x] All colors use `Colors.*` design tokens from `@/src/lib/design` — **N/A** (no UI changes; `profile/index.tsx` consumer re-renders with no new styling).
- [x] All loading states use skeleton animations — **N/A** (no UI changes).
- [x] All interactive elements have `accessibilityRole` + `accessibilityLabel` — **N/A** (no UI changes).
- [x] Non-obvious interactions have `accessibilityHint` — **N/A** (no UI changes).
- [x] Stateful elements have `accessibilityState` — **N/A** (no UI changes).
- [x] All tappable elements have minimum 44x44pt touch targets — **N/A** (no UI changes).
- [x] All text uses `Typography.*` presets — no raw pixel `fontSize` — **N/A** (no UI changes).
- [x] **Quality gates pass:** `npm run type-check && npm run lint && npm run format:check && npm test && npm run check:colors`.
- [x] **Citations matrix completeness test** in `tcf-spec.test.ts` continues to pass — the §8 row updates are content-only (no row added / removed).
- [x] **Sentry DSN leak guard + Submit credentials leak guard** in `ci.yml` continue to pass (no DSN / credential changes).
- [x] **Story 9-4 stored-prompt-injection defense holds** — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapping + "treat as data" prelude in `buildConversationPrompt` are NOT modified. Verified by re-reading the relevant lines after the changes + the `prompt-injection.test.ts` `buildConversationPrompt` describe block staying green.
- [x] **Story 9-5 voice transcript dedup holds** — `use-realtime-voice.ts` modality config + `appendIfNew` dedup are NOT modified. Verified by `realtime-dedup.test.ts` staying green.
- [x] **Story 9-7 schema-validation contract holds** — `buildConversationPrompt` does NOT feed `chatCompletionJSON`; the Realtime path is schema-free. NOT touched.
- [x] **Story 9-8 / 10-6 speaking pipeline contract holds** — `buildSpeakingTaskPrompt`, `buildSpeakingEvaluatorPrompt`, the 5-dimension rubric, `RUBRIC_TO_COMPOSITE = 1.0`, the Story 10-6 emoji guard at `speaking.test.ts:145` all unchanged.
- [x] **Story 10-2 per-skill scoring contract holds** — `rawPercentToListeningReadingScore`, `rawPercentToWritingSpeakingScore`, `IRCC_CLB_BANDS` all unchanged.
- [x] **Story 10-3 per-CEFR passage ranges contract holds** — listening / reading / writing word ranges unchanged. The `writing.ts` change is a framing label only, not a range change.
- [x] **Story 10-4 vocabulary-tier integration contract holds** — `buildVocabularyConstraintBlock(cefrLevel)` integration in all 9 CEFR-aware prompt builders unchanged. `force est de constater` correctly catalogued as C1+ forbidden-lower-tier token + C2 exemplar.
- [x] **Story 10-5 placement-test contract holds** — `buildPlacementTestPrompt`, `PLACEMENT_LEVEL_RANGES`, `TOTAL_PLACEMENT_QUESTIONS`, aggregated vocab table integration unchanged. The placement.ts C1 competencies line is the only Story 10-5 surface touched; the framing change is additive (Story 10-7 patches the line content, not the helper signature or the question-distribution metadata).
- [x] **`parseCorrections` regex preserved** — `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` at `use-realtime-voice.ts:155` is NOT modified. Verified by `realtime-dedup.test.ts` `parseCorrectionsForTest` staying green + the new positive assertion in AC #6 confirming the new prompt format is regex-compatible.

### Story File Self-Check (run after writing this file)

<!--
  Lesson from Epic 9 / story 9-9 (full retro 2026-05-09): the prior `_bmad*` blanket gitignore rule silently dropped every file written under `_bmad-output/` — including this story file — until the dev agent forced it via `git add -f`. Verifying that the file is *visible to git but not yet tracked* catches the ignore-rule footgun before story 1 of any future project.
-->

- [x] `git status` lists this story file (`_bmad-output/implementation-artifacts/10-7-linguistic-accuracy-pass.md`) under "Untracked files" — i.e. visible to git, not silently ignored. If the path appears in `git check-ignore -v` output, narrow the offending `.gitignore` rule before continuing.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/10-7-linguistic-accuracy-pass.md` passes — verifies the file isn't being silently excluded by a `.prettierignore` rule that would let drift accumulate.

## Tasks / Subtasks

- [x] Task 1: Strip emoji + markdown decoration from Correction Report (AC #1)
  - [x] Replace `## Correction Report` block at `conversation.ts:60-75` with the plain-text version
  - [x] Add explicit TTS-instruction to the model (no asterisks, no emoji, no `---`)
  - [x] Preserve the regex-extractable `"X" → "Y" (Z)` correction-line shape
  - [x] Verify `parseCorrections` regex at `use-realtime-voice.ts:155` is NOT modified

- [x] Task 2: Split debate-mode "advanced connectors" into 3 categories (AC #2)
  - [x] Replace `conversation.ts:106-117` debate-mode block with 3 labeled sub-categories
  - [x] Verify each item appears in exactly one category
  - [x] Verify `Force est de constater que` is in Locutions verbales figées, not Connecteurs

- [x] Task 3: Rewrite `CEFR_LEVELS` `nameFr` to Alliance Française convention (AC #3)
  - [x] Update 6 `nameFr` fields in `src/types/cefr.ts`
  - [x] Add JSDoc note above `CEFR_LEVELS` documenting the Alliance Française convention + §8.2 + Story 10-7 reference
  - [x] Verify `app/(tabs)/profile/index.tsx:408` consumer auto-propagates (read-only check)
  - [x] Verify `mock-test/index.tsx` + `mock-test/[testId].tsx` are NOT affected (they consume `TCF_QCM_SECTIONS.nameFr`, not `CEFR_LEVELS.nameFr`)

- [x] Task 4: Drop Québécois arm from `buildListeningExercisePrompt` (AC #4)
  - [x] Narrow `dialect?` type union to `"metropolitan" | "african"` in `listening.ts:34`
  - [x] Remove `quebecois` key from `DIALECT_GUIDANCE` at `listening.ts:91-97`
  - [x] Add JSDoc note documenting audit D5 deferral + v2 reintroduction requirements
  - [x] Verify `use-exercise.ts:120` caller continues to pass `"metropolitan"` (no caller change needed)

- [x] Task 5: Correct `force est de constater` connector-misclassification echoes (AC #5)
  - [x] Rebrand `writing.ts:80-101` `connectorRows` block to "Expected discourse markers (connectors + fixed expressions) by level"
  - [x] Update internal Story 10-4 / Edge Case Hunter comment with Story 10-7 framing note
  - [x] Rewrite `placement.ts:129` C1 competencies string with `[connector]` / `[fixed expression]` inline labels + accent fixes (`passé simple`, `en dépit de`)
  - [x] Verify `echo.ts:39` C1 example structure NOT touched (verified-correct)
  - [x] Verify `vocabulary-tiers.ts:84,245` NOT touched (Story 10-4 verified-correct)

- [x] Task 6: Test surface (AC #6)
  - [x] CREATE `src/lib/prompts/__tests__/conversation.test.ts` (or extend `prompt-injection.test.ts`) — emoji-guard + HR-guard + parseCorrections-regex-compatibility + debate-mode 3-category split cases
  - [x] CREATE `src/types/__tests__/cefr.test.ts` (new directory + file) — 6 nameFr cases + uniform-convention assertion
  - [x] CREATE `src/lib/prompts/__tests__/listening.test.ts` (or co-locate) — `@ts-expect-error` type-narrowing guard + content-leakage guard for Québécois tokens
  - [x] CREATE `src/lib/prompts/__tests__/writing.test.ts` — discourse-markers framing assertion + C1-C2 `force est de constater` still-present assertion
  - [x] EXTEND `src/lib/prompts/__tests__/placement.test.ts` (Story 10-5) — fixed-expression label assertion + orthographic-fix assertion + negative against pre-10-7 framing
  - [x] VERIFY all pre-existing tests stay green (prompt-injection, realtime-dedup, vocabulary-integration, vocabulary-tiers, passage-calibration, speaking, placement, tcf-spec)

- [x] Task 7: Update `docs/tcf-spec-source.md §8.1, §8.2, §8.3, §8.4` (AC #7) — append "DONE — closed by Story 10-7" closure stamps to each sub-section

- [x] Task 8: Update `docs/tcf-spec-citations.md §8` (AC #8) — flip all 4 owned rows from ✗ DELTA → ✓ Verified with Story 10-7 trailers

- [x] Task 9: Update CLAUDE.md (AC #9) — add new "TCF linguistic accuracy pass" architecture line after the Story 10-6 line

- [x] Task 10: Quality gates (AC #Z)
  - [x] `npm run type-check` passes (0 errors)
  - [x] `npm run lint` passes (0 errors, 0 warnings)
  - [x] `npm run format:check` passes
  - [x] `npm test` passes — target 770+ tests (was 732 post-10-6)
  - [x] `npm run check:colors` passes
  - [x] CI Sentry DSN + Submit credentials leak guards pass
  - [x] `git status` shows the story file as untracked-but-not-ignored
  - [x] `npx prettier --check` on the story file passes

## Dev Notes

### Architecture pattern alignment

- **Minimum-viable bridge pattern (Story 10-7 § AC #1).** The Correction Report plain-text rewrite is a deliberate forward-compatible bridge to Epic 11.1's `report_correction` tool-call replacement. 10-7 ships the smallest change that closes §8.4 without blocking Epic 11.1: emoji + markdown decoration stripped; regex contract preserved. Epic 11.1 will replace the whole text-extraction approach with structured tool-calls; the bridge has zero migration cost.
- **Type-system enforcement of audit decisions (Story 10-7 § AC #4).** Narrowing the `dialect?` union to `"metropolitan" | "african"` makes `dialect: "quebecois"` a TypeScript error — turning audit decision D5 into a compile-time constraint that survives accidental string-typing. The `@ts-expect-error` test guard pattern is the same one Story 9-7 used for ZodIssueCode regression locks.
- **Categorical re-labeling over content removal (Story 10-7 § AC #2, AC #5).** The `force est de constater` misclassification is fixed by re-labeling the prompt's section headers ("Expected discourse markers" instead of "Expected connectors") and adding inline `[connector]` / `[fixed expression]` labels — NOT by removing the expression from any prompt. The expression is linguistically valid at C1+; the audit's complaint is the wrong category label, not the content presence. Per-level filtering from Story 10-4 (vocab-tiers forbidden-lower-tier) still applies and is not regressed.
- **Single-institutional-convention rule (Story 10-7 § AC #3).** §8.2 explicitly recommends picking ONE convention. Alliance Française school convention chosen because (a) it preserves the existing 3-name-family structure (`Élémentaire` / `Intermédiaire` / `Avancé`), (b) it uses a natural `1` / `2` sub-level distinguisher, (c) it is familiar to French-as-a-foreign-language students. The Service-Public 3-tier convention (`Élémentaire` / `Indépendant` / `Expérimenté`) was considered but rejected because A1 + A2 would collapse to the same `nameFr` ("Élémentaire" / "Élémentaire") — degrading the home-screen + profile-screen distinguishability.
- **Drop-don't-rewrite (Story 10-7 § AC #4).** Per audit decision D5, Québécois v2 reintroduction requires native-speaker review. A half-correct v1 rewrite that fixes "chez nous" but still mis-orthographs "tsu" without IPA tagging would teach the user incorrect features. Drop is safer than partial-rewrite. Same "delete don't alias" pattern Story 10-2 applied to the deprecated 7-band linear `rawToTCFScore`.
- **Story 9-4 invariants preserved.** `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + "treat as data" prelude in `buildConversationPrompt` are not modified. The new Correction Report block is positioned within the same prompt body as the user-data wrappers; the order is unchanged.
- **Story 9-5 invariants preserved.** `output_modalities: ["audio"]` configuration in `realtime.ts` + the `appendIfNew` / `acceptDelta` dedup helpers + the FIFO-capped 256-entry dedup Set are not modified. The Correction Report text change is upstream of the dedup logic.

### Pulling forward Epic 9 + 10-1 / 10-2 / 10-3 / 10-4 / 10-5 / 10-6 lessons

- **Epic 9 retro A1** (git-status-untracked-but-not-ignored): Polish AC #Z bakes this in for the new story file + the new test files. The new test files under `src/types/__tests__/` and `src/lib/prompts/__tests__/` should show as untracked when first written.
- **Epic 9 retro A3** (review-patch budget — "an implementation that passes type-check, lint, and existing tests is ~70% done, not 100%"): expect 5–15 patches in this story's review. Prompt-string stories tend to surface (a) negative assertions that didn't account for legitimate `**` in other parts of the prompt body (LEVEL_GUIDELINES.C2 mentions `**bold**` literally as a stylistic example), (b) test fixtures hand-rolled with the pre-10-7 format strings, (c) cross-story tests (vocabulary-integration, prompt-injection) that depend on substring layout, (d) JSDoc / comment drift between the new framing and old framing. Plan the review-patch round. Edge-Case Hunter is likely to surface (i) any pre-10-7 emoji in the `tcf_simulation` mode block at `conversation.ts:127-135` that this story did NOT touch but maybe should (decision: NOT touched — it's task-instruction prose, not a Correction Report format), (ii) any pre-10-7 "Maîtrise" string elsewhere in the codebase that depends on the C2 label (search before committing), (iii) cross-screen consumers of `nameFr` that this story missed.
- **Story 9-7 lesson** (Zod schema is the runtime guard, prompt is the generation guide): NOT applicable here — `buildConversationPrompt` does not feed `chatCompletionJSON`; Realtime is schema-free. The TypeScript `@ts-expect-error` guard pattern from Story 9-7 IS borrowed for the AC #4 `dialect: "quebecois"` regression lock.
- **Story 9-8 / 10-6 lesson** (verified-correct surfaces are explicitly enumerated, not implicit): the §10-6 story file's "What Story 9-8 shipped (verified-correct, NOT touched by 10-6)" + "Out of scope" sections are mirrored here. Five surfaces are enumerated NOT-TOUCHED in this story's "Out of scope" section: `echo.ts:39`, `vocabulary-tiers.ts:84,245`, `parseCorrections` regex, `speaking.test.ts:145` Epic 10.7 emoji guard, `app/(tabs)/mock-test/[testId].tsx:673` (`TCF_QCM_SECTIONS.nameFr`, NOT `CEFR_LEVELS.nameFr`).
- **Story 10-2 lesson** ("delete don't alias"): the Québécois drop in AC #4 is a delete, not an alias. The `DIALECT_GUIDANCE.quebecois` key is removed; the type union narrows. No legacy `LEGACY_QUEBECOIS_GUIDANCE` kept "for historical compatibility."
- **Story 10-3 lesson** (single source of truth for a derived constant): the `writingTaskWordRange(taskNumber)` helper continues to be the single source of truth for Writing word ranges; AC #5 changes the section-header framing in the rendered prompt but does NOT touch the helper.
- **Story 10-4 lesson** (`buildVocabularyConstraintBlock` integration is positional): the vocab block continues to render in `buildConversationPrompt` between the `## Language Adaptation` block and the `## Correction Behavior` block (current position); the AC #1 Correction Report rewrite does NOT move the vocab block.
- **Story 10-5 lesson** (regression tests pin the deletion claims): AC #6 tests include negative assertions ("does NOT contain 'Élémentaire avancé'", "does NOT contain 'nuanced connector usage'", "does NOT contain '`---`'") that defend the cleanup claims. Same pattern Story 10-5 used for the `top-500` / `top-1000` deletion.
- **Story 10-6 lesson** (forward-only schema/contract changes): the Alliance Française `nameFr` migration in AC #3 is forward-only. Historical `profile.cefr_level` values in the DB are CEFR codes (`"A2"` etc.), not `nameFr` strings, so no DB migration is needed; the UI re-renders the new labels for both old + new profiles automatically.

### Source tree components to touch

| File                                                                                       | Action                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/prompts/conversation.ts](src/lib/prompts/conversation.ts)                         | UPDATE — strip emoji + `**bold**` + `---` from the Correction Report block (AC #1); split debate-mode connectors into 3 labeled sub-categories (AC #2)                                                                                                                                            |
| [src/types/cefr.ts](src/types/cefr.ts)                                                     | UPDATE — rewrite 6 `nameFr` fields to Alliance Française convention; add JSDoc note (AC #3)                                                                                                                                                                                                       |
| [src/lib/prompts/listening.ts](src/lib/prompts/listening.ts)                               | UPDATE — narrow `dialect?` union; remove `quebecois` arm from `DIALECT_GUIDANCE`; add JSDoc note (AC #4)                                                                                                                                                                                          |
| [src/lib/prompts/writing.ts](src/lib/prompts/writing.ts)                                   | UPDATE — rebrand "Expected connectors by level" → "Expected discourse markers (connectors + fixed expressions) by level"; update internal Story 10-4 comment (AC #5)                                                                                                                              |
| [src/lib/prompts/placement.ts](src/lib/prompts/placement.ts)                               | UPDATE — rewrite C1 competencies line with `[connector]` / `[fixed expression]` labels + `passé simple` + `en dépit de` accent fixes (AC #5)                                                                                                                                                      |
| [src/lib/prompts/__tests__/conversation.test.ts](src/lib/prompts/__tests__/conversation.test.ts) | CREATE (or extend `prompt-injection.test.ts`) — emoji-guard, HR-guard, parseCorrections-regex-compat, debate-mode 3-category split, Story 9-4 invariants regression                                                                                                                          |
| [src/types/__tests__/cefr.test.ts](src/types/__tests__/cefr.test.ts)                       | CREATE (new directory + file) — 6 `nameFr` cases + uniform-convention assertion                                                                                                                                                                                                                   |
| [src/lib/prompts/__tests__/listening.test.ts](src/lib/prompts/__tests__/listening.test.ts) | CREATE (or co-locate) — `@ts-expect-error` type-narrowing guard + Québécois-token leakage guard                                                                                                                                                                                                   |
| [src/lib/prompts/__tests__/writing.test.ts](src/lib/prompts/__tests__/writing.test.ts)     | CREATE — discourse-markers framing assertion + C1-C2 `force est de constater` still-present assertion                                                                                                                                                                                             |
| [src/lib/prompts/__tests__/placement.test.ts](src/lib/prompts/__tests__/placement.test.ts) | UPDATE (Story 10-5 file) — fixed-expression label assertion + orthographic-fix assertion + negative against pre-10-7 framing                                                                                                                                                                      |
| [CLAUDE.md](CLAUDE.md)                                                                     | UPDATE — add new "TCF linguistic accuracy pass" architecture line after the Story 10-6 line                                                                                                                                                                                                       |
| [docs/tcf-spec-source.md](docs/tcf-spec-source.md)                                         | UPDATE — append "DONE — closed by Story 10-7" closure stamps to §8.1, §8.2, §8.3, §8.4                                                                                                                                                                                                            |
| [docs/tcf-spec-citations.md](docs/tcf-spec-citations.md)                                   | UPDATE — flip all 4 §8 rows ✗ DELTA → ✓ Verified                                                                                                                                                                                                                                                  |

**Not touched (verified-correct):**

| File                                                                       | Reason                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/prompts/echo.ts](src/lib/prompts/echo.ts)                         | `Force est de constater que ...` is a C1 example structure (Story 6-1), NOT a connector classification — verified-correct                             |
| [src/lib/prompts/vocabulary-tiers.ts](src/lib/prompts/vocabulary-tiers.ts) | `force est de constater` correctly catalogued as C1+ forbidden-lower-tier token + C2 exemplar (Story 10-4)                                            |
| [src/hooks/use-realtime-voice.ts](src/hooks/use-realtime-voice.ts)         | `parseCorrections` regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` at line 155 is the contract Story 10-7 preserves                                |
| [src/hooks/use-exercise.ts](src/hooks/use-exercise.ts)                     | Single caller of `buildListeningExercisePrompt` already passes `"metropolitan"` — no caller change needed                                             |
| [src/lib/prompts/speaking.ts](src/lib/prompts/speaking.ts)                 | Story 9-8 / 10-6 5-dimension rubric + "no emoji, no markdown" JSON-output instruction; not touched                                                    |
| [src/lib/prompts/__tests__/speaking.test.ts](src/lib/prompts/__tests__/speaking.test.ts) | The Story 10-6 `evaluator prompt does NOT contain emoji (Epic 10.7 guard)` test at line 145 already enforces this story's emoji-no-leak invariant for the Speaking evaluator |
| [app/(tabs)/mock-test/[testId].tsx](<app/(tabs)/mock-test/[testId].tsx>)   | Renders `TCF_QCM_SECTIONS.nameFr` (section names), NOT `CEFR_LEVELS.nameFr` — out of AC #3 scope                                                      |
| [app/(tabs)/mock-test/index.tsx](<app/(tabs)/mock-test/index.tsx>)         | Renders `TCF_QCM_SECTIONS.nameFr`, NOT `CEFR_LEVELS.nameFr` — out of AC #3 scope                                                                      |
| [app/(tabs)/profile/index.tsx](<app/(tabs)/profile/index.tsx>)             | Renders `CEFR_LEVELS[level].nameFr` directly — auto-propagates with the AC #3 changes, no UI code change                                              |

### Anti-pattern prevention

- **Do NOT rewrite the Québécois arm with IPA + real markers** — audit decision D5 says drop in v1, not partial-rewrite. The roadmap line 165 wording is the audit's wishlist, not the decision.
- **Do NOT touch `parseCorrections` regex** at `use-realtime-voice.ts:155` — it is the contract Story 10-7 preserves. Future replacement is Epic 11.1's job.
- **Do NOT touch `force est de constater` in `echo.ts` or `vocabulary-tiers.ts`** — those usages are linguistically correct (C1 example structure + C1+ forbidden-lower-tier token + C2 exemplar). The §8.1 finding is specifically about the connector-misclassification in conversation.ts / writing.ts / placement.ts.
- **Do NOT add `tool_call` definitions or `report_correction` function-call infrastructure** — that's Epic 11.1's surface. Story 10-7 ships text-prompt edits only.
- **Do NOT strip `**` from the whole prompt body** — only from the Correction Report block. Other parts of the prompt body (LEVEL_GUIDELINES, debate-mode instructions) use `**bold**` legitimately as visual structure for the model; stripping all of them is scope creep and risks losing structural cues.
- **Do NOT pick a different CEFR-naming convention** (Service-Public 3-tier, Eduscol bracketed, bare Beacco codes) — Alliance Française is the spec'd choice. Operator decision; do not silently flip.
- **Do NOT rename `name` (English) fields** — the audit flags `nameFr` only. English labels are stable.
- **Do NOT rename `nameFr` consumers beyond `app/(tabs)/profile/index.tsx`** — the section-name `TCF_QCM_SECTIONS.nameFr` used in mock-test screens is a DIFFERENT `nameFr` field; do not confuse them.
- **Do NOT introduce a new `outputModality` parameter to `buildConversationPrompt`** — Story 10-7 ships text-only edits. Epic 11.1 introduces the modality discriminator when it lands the tool-call.
- **Do NOT drop the `tcf_simulation` mode block** at `conversation.ts:127-135` — its emoji-free task-instruction prose is not flagged by the audit.
- **Do NOT touch `Story 10-6 emoji-guard test` at `speaking.test.ts:145`** — it is a cross-story guard already in place.
- **Do NOT delete the four ✗ DELTA rows from `docs/tcf-spec-citations.md §8`** — flip their status to ✓ Verified, update the content cells, keep the rows. The citations-matrix-completeness test in `tcf-spec.test.ts` walks the matrix.

### Testing standards

- **Substring assertions on prompt output, not implementation internals** — same contract as Story 10-3 / 10-4 / 10-5 / 10-6 patterns. `expect(prompt).toContain("...")` + `expect(prompt).not.toContain("...")` are the load-bearing assertions.
- **Unicode-range emoji guard:** `expect(prompt).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)` + `expect(prompt).not.toMatch(/[\u{1F600}-\u{1F64F}]/u)` (the same pattern Story 10-6 uses at `speaking.test.ts:153-154`).
- **Scoped horizontal-rule guard:** match the Correction Report block via `prompt.match(/## Correction Report[\s\S]*?(?=^## |\Z)/m)?.[0] ?? ""` then assert `not.toMatch(/^---$/m)`. Scoping prevents false positives from `---` separators elsewhere in the prompt.
- **`@ts-expect-error` type-narrowing guard** for AC #4 — same Story 9-7 pattern. A future widening of the `dialect?` union back to admit `"quebecois"` fails the test by removing the expected error.
- **Negative substring assertions defend deletion claims** — same Story 10-5 pattern. The pre-10-7 strings (`"Élémentaire avancé"`, `"Maîtrise"`, `"nuanced connector usage"`, `"Force est de constater que, Quoi qu'il en soit, En revanche"` consecutive ordering) get explicit `not.toContain` assertions so future regressions fail loudly.
- **Each per-level / per-mode assertion is its own `it.each` row** — Story 10-3 review patch P5 lesson. The Correction Report emoji-guard runs across 6 levels × 3 modes = 18 cases via `it.each`.
- **Don't test the AI's behavior** — only the prompt-builder's output + the regex contract. Whether the AI actually emits a useful plain-text correction is the prod-telemetry's reporting job.

### Project Structure Notes

- All non-test changes are to existing files. **2 new directories** are created for tests: `src/types/__tests__/` (new for this story) — if more aligned, co-locate `cefr.test.ts` under `src/lib/__tests__/` or `src/types/cefr.test.ts` directly without a `__tests__/` subdirectory; the test infrastructure is `vitest` (per `vitest.config.ts`) and discovers tests by file glob, not by directory convention. Dev agent should follow whatever co-location pattern is most consistent with the existing test layout.
- **3-4 new test files** in `src/lib/prompts/__tests__/`: `conversation.test.ts`, `listening.test.ts`, `writing.test.ts`. The existing `passage-calibration.test.ts` (Story 10-3) + `vocabulary-integration.test.ts` (Story 10-4) + `placement.test.ts` (Story 10-5) + `speaking.test.ts` (Story 9-8 / 10-6) + `vocabulary-tiers.test.ts` (Story 10-4) demonstrate the per-builder co-location pattern.
- **No new module files.** All implementation changes are to existing `.ts` files. No `src/lib/*.ts` files are created.
- **No DB migrations.** `CEFR_LEVELS.A2.nameFr` change is a UI string, not a DB value. Historical `profile.cefr_level` rows store `"A2"` etc. (the level code), not the display label.
- **No type-system changes that ripple beyond `dialect?`.** Narrowing the `dialect?` union is the only public-API change; the `CEFR_LEVELS` `nameFr` field type is unchanged (`string`).
- **Documentation localized to §8 + new CLAUDE.md line + 4 citations-matrix rows.**

### References

- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 165 — Epic 10.7 deliverable "Linguistic accuracy pass — fix 'Force est de constater' misclassification, drop 'Élémentaire avancé', rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage), drop emoji from voice-mode prompt outputs. Covers P2-1, P2-2."]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 79 — P2-1 finding "Conversation prompt instructs Realtime voice model to emit emoji-formatted markdown corrections — TTS will literally say the asterisks or skip them"]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 80 — P2-2 finding "'Force est de constater' listed as connector (it's a fixed expression); 'Élémentaire avancé' is a non-standard CEFR label; Québécois prompt is misleading"]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 406 — D5 decision "Whether to support Québécois variant in v1 → Drop in v1; reintroduce in v2 with native-speaker review"]
- [Source: _bmad-output/planning-artifacts/shippable-roadmap.md line 181 — Epic 11.1 successor "Correction protocol via tool-calls — replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. Covers P1-6, P2-1."]
- [Source: docs/tcf-spec-source.md §8.1 — "Force est de constater" fixed expression vs connector classification per Le Bon Usage (Grevisse) + Trésor de la langue française]
- [Source: docs/tcf-spec-source.md §8.2 — CEFR labels in French (4 institutional conventions table) + Epic 10.7 directive to pick one convention]
- [Source: docs/tcf-spec-source.md §8.3 — Québécois variant per OQLF Banque de dépannage linguistique + audit decision D5]
- [Source: docs/tcf-spec-source.md §8.4 — Voice-mode emoji-formatted output, TTS asterisk-leak observation]
- [Source: docs/tcf-spec-citations.md §8 — 4 ✗ DELTA rows owned by Epic 10.7]
- [Source: src/lib/prompts/conversation.ts:38-82 — current emoji-formatted Correction Report block]
- [Source: src/lib/prompts/conversation.ts:104-117 — debate-mode "advanced connectors" list]
- [Source: src/lib/prompts/conversation.ts:127-135 — `tcf_simulation` mode block (NOT touched)]
- [Source: src/lib/prompts/conversation.ts:144-180 — `<USER_FACTS>` / `<USER_WEAK_AREAS>` Story 9-4 wrappers (NOT touched)]
- [Source: src/types/cefr.ts:69-118 — `CEFR_LEVELS` const, current `nameFr` values]
- [Source: src/lib/prompts/listening.ts:34 — `dialect?` parameter type union]
- [Source: src/lib/prompts/listening.ts:91-97 — `DIALECT_GUIDANCE` object]
- [Source: src/lib/prompts/writing.ts:80-101 — `connectorRows` block + Story 10-4 per-level filter]
- [Source: src/lib/prompts/placement.ts:127-132 — C1 competencies string]
- [Source: src/hooks/use-realtime-voice.ts:152-171 — `parseCorrections` regex + Correction[] extraction (preserved unchanged)]
- [Source: src/hooks/use-realtime-voice.ts:708 — `buildConversationPrompt` consumer (Realtime session config)]
- [Source: src/hooks/use-exercise.ts:120 — `buildListeningExercisePrompt({ cefrLevel, dialect: "metropolitan" })` single caller]
- [Source: src/lib/prompts/__tests__/speaking.test.ts:145-155 — Story 10-6 Epic 10.7 emoji guard pattern (mirror for conversation.ts emoji guard)]
- [Source: src/lib/__tests__/prompt-injection.test.ts:294-389 — Story 9-4 `buildConversationPrompt` `<USER_FACTS>` / `<USER_WEAK_AREAS>` regression suite]
- [Source: src/lib/__tests__/realtime-dedup.test.ts:32-54 — `parseCorrectionsForTest` regex contract]
- [Source: app/(tabs)/profile/index.tsx:406-417 — `CEFR_LEVELS[level].name` + `nameFr` + `tcfScoreMin` + `tcfScoreMax` consumer (auto-propagates)]
- [Source: Story 9-4 — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapper + "treat as data" prelude (preserved unchanged)]
- [Source: Story 9-5 — `output_modalities: ["audio"]` + `appendIfNew` dedup (preserved unchanged)]
- [Source: Story 9-7 — `@ts-expect-error` regression-lock pattern (mirror for `dialect: "quebecois"` type-narrowing guard)]
- [Source: Story 10-2 — "delete don't alias" pattern (mirror for Québécois arm removal)]
- [Source: Story 10-4 — `vocabulary-tiers.ts` `force est de constater` C1+ forbidden-lower-tier + C2 exemplar (verified-correct, NOT touched)]
- [Source: Story 10-5 — `buildPlacementTestPrompt` extracted from inline `SYSTEM_PROMPT`; `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` (helper signature unchanged by 10-7)]
- [Source: Story 10-6 — speaking-evaluator emoji guard pattern (`speaking.test.ts:145`) — mirror for `buildConversationPrompt` emoji guard]
- [Source: Office québécois de la langue française (OQLF) — Banque de dépannage linguistique — Québécois marker reference (`icitte`, `pantoute`, `astheure`, `piasse`, `char`, `magasiner`)]
- [Source: Le Bon Usage (Grevisse) + Trésor de la langue française — _force est de_ + infinitive classification as locution verbale figée]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Branch: `feature/10-7-linguistic-accuracy-pass` (from `main` at `ec66881` — post-Story-10-6 PR #64 merge).
- Quality gates:
  - `npm run type-check` ✓ (0 errors) — no cascade after narrowing the `dialect?` union; the single caller at `use-exercise.ts:120` already passed `"metropolitan"`. The `CEFR_LEVELS.nameFr` change is a string-value mutation, not a type signature change, so no downstream type-check cascade.
  - `npm run lint` ✓ (0 errors, 0 warnings, `--max-warnings 0`) — initial run flagged 2 `import/order` warnings on the new `conversation.test.ts` (type imports vs value imports ordering); auto-fixed via `npm run lint:fix`.
  - `npm run format:check` ✓ (prettier-clean) — initial run flagged 3 files (`conversation.test.ts`, `writing.test.ts`, `docs/tcf-spec-citations.md` table column widths); auto-fixed via `npx prettier --write`.
  - `npm test` ✓ (818 passing, was 732 pre-story → +86 net). Initial test run flagged 1 case in `writing.test.ts` where the A1-prompt assertion `not.toContain("force est de constater")` failed because Story 10-4's `buildVocabularyConstraintBlock(A1)` legitimately surfaces the token in the A1 forbidden-lower-tier list AND because my own Story 10-7 explanatory text in the "Expected discourse markers" header line was re-mentioning the token. **Fix:** (a) scoped the A1 regression test to the per-level discourse-markers sub-block via regex slice, not the whole prompt; (b) trimmed the Story 10-7 inline explanation out of the rendered prompt header (kept it in the source-code comment only). Both pre-existing Story 10-4 / 10-5 vocab-integration regression tests stayed green.
  - `npm run check:colors` ✓ ("No hardcoded hex colors found.")
- CI guards (run locally via grep mirroring `.github/workflows/ci.yml`):
  - Sentry DSN leak guard ✓ (no matches in src/ or app/)
  - Submit credentials leak guard ✓ (no Apple Team ID / ASC App ID patterns introduced)
- Story file `_bmad-output/implementation-artifacts/10-7-linguistic-accuracy-pass.md` shows as Untracked in `git status`; `git check-ignore -v` returns exit 1 (Epic 9 retro A1 satisfied).

### Completion Notes List

**Stripped emoji + markdown decoration from the Correction Report block in `buildConversationPrompt`** (`src/lib/prompts/conversation.ts`) per §8.4 P2-1. The pre-10-7 block emitted `📝`, `💡`, `✅`, `**bold**`, and `---` horizontal rules — all of which the OpenAI Realtime TTS reads literally ("asterisk asterisk corrections asterisk asterisk", "dash dash dash") or skips unpredictably. The new block uses plain-text labels (`Corrections:`, `Tip:`, `No corrections.`) and includes an explicit instruction to the model that the full response is read aloud verbatim, so no markdown / no emoji. The regex-extractable correction-line shape `"User said" → "Correct form" (explanation)` is preserved verbatim so `parseCorrections` at `src/hooks/use-realtime-voice.ts:152-171` continues to extract corrections — verified by a positive-match test in `conversation.test.ts` and by the existing `realtime-dedup.test.ts` suite staying green. Epic 11.1 still owns the architectural successor (`report_correction` tool-call replacement); Story 10-7 ships the minimum-viable bridge so beta can ship before Epic 11.

**Split the debate-mode discourse markers in `conversation.ts` into three correctly-classified sub-categories** per §8.1 P2-2. The pre-10-7 single "advanced connectors" list lumped `Force est de constater que` (a locution verbale figée per Le Bon Usage / Trésor de la langue française) together with actual connectors (`Cependant`, `En revanche`) and subjunctive triggers (`Bien que`, `Quand bien même`) — the audit's connector-misclassification finding. The new structure has three labeled rows: **Connecteurs** (5 actual discourse-link items), **Locutions verbales figées** (5 fixed expressions including `Force est de constater que`), **Déclencheurs du subjonctif** (2 subjunctive triggers). Each item appears in exactly one category. Source-code comment cites §8.1 + Le Bon Usage / Trésor for the rationale.

**Rewrote `CEFR_LEVELS` `nameFr` fields to the Alliance Française school convention** (`src/types/cefr.ts`) per §8.2 P2-2: A1 "Élémentaire 1", A2 "Élémentaire 2" (was the audit-flagged "Élémentaire avancé"), B1 "Intermédiaire 1", B2 "Intermédiaire 2", C1 "Avancé 1", C2 "Avancé 2" (was "Maîtrise" — an Eduscol parenthetical descriptor mixed into Alliance Française territory). JSDoc on `CEFR_LEVELS` documents the convention + the Service-Public 3-tier alternative-rejected rationale (A1 + A2 would collapse to identical "Élémentaire" / "Élémentaire" — degrading distinguishability). The single UI consumer (`app/(tabs)/profile/index.tsx:408`) re-renders the new labels automatically with no UI code change. The English `name` fields and `tcfScoreMin` / `tcfScoreMax` / `description` are unchanged. Verified by 7 cases in the new `src/types/__tests__/cefr.test.ts`.

**Dropped the Québécois arm from `buildListeningExercisePrompt`** (`src/lib/prompts/listening.ts`) per §8.3 audit decision D5. The `dialect?` type union narrowed from `"metropolitan" | "quebecois" | "african"` to `"metropolitan" | "african"` and the `quebecois` key removed from `DIALECT_GUIDANCE`. JSDoc on the `dialect?` param documents the v2 reintroduction requirement: OQLF Banque de dépannage linguistique conformance + accurate IPA tagging for /t/ → [ts] affrication + real Québécois lexical markers (`icitte`, `pantoute`, `astheure`, `piasse`, `char`, `magasiner`). The roadmap line 165 "rewrite Québécois prompt with accurate IPA and real markers" was the audit's wishlist; the operator-confirmed decision is "drop in v1." The single caller (`src/hooks/use-exercise.ts:120`) already passed `"metropolitan"` — no caller change needed. A `@ts-expect-error` test guard at `src/lib/prompts/__tests__/listening.test.ts` pins the type narrowing — a future widening fails the test by removing the expected error (same Story 9-7 pattern).

**Corrected the `force est de constater` connector-misclassification echoes** in `src/lib/prompts/writing.ts` (rebranded "Expected connectors by level" → "Expected discourse markers (connectors + fixed expressions) by level") and `src/lib/prompts/placement.ts:129` C1 competencies row (rewrote `"nuanced connector usage (quoique, en depit de, force est de constater)"` to `"nuanced connectors and fixed expressions (quoique, en dépit de [connector]; force est de constater que [fixed expression])"` — adding inline `[connector]` / `[fixed expression]` labels + `passé simple` and `en dépit de` orthographic accent fixes). The per-level filter from Story 10-4 review patch P3 still applies and is not regressed — `vocabulary-integration.test.ts` (Story 10-4) suite stays green. The verified-correct surfaces at `src/lib/prompts/echo.ts:39` (C1 example structure) and `src/lib/prompts/vocabulary-tiers.ts:84,245` (C1+ forbidden-lower-tier token + C2 exemplar from Story 10-4) are NOT touched.

**Added 5 new test artifacts** (+86 net tests, 732 → 818 passing):

- `src/lib/prompts/__tests__/conversation.test.ts` (NEW, +27 cases) — emoji guard parameterized over 6 levels × 3 modes (18 cases) + emoji literals guard (6×3=18 cases collapsed via shared describe) + Correction Report instruction substring + `parseCorrections`-regex compatibility (single + multiple matches) + plain-text `No corrections.` + debate-mode 3-category split (positive + negative + mode-suppression) + Story 9-4 wrapper invariants regression.
- `src/types/__tests__/cefr.test.ts` (NEW directory + file, +9 cases) — 6 per-level `nameFr` assertions + uniform-convention regex assertion + English-name preservation guard + tcfScoreMin/Max preservation guard.
- `src/lib/prompts/__tests__/listening.test.ts` (NEW, +4 cases) — metropolitan / african guidance Québécois-leakage guard + default-when-omitted check + `@ts-expect-error` type-narrowing guard.
- `src/lib/prompts/__tests__/writing.test.ts` (NEW, +4 cases) — discourse-markers framing header positive + C1-C2 row includes `force est de constater` + negative against pre-10-7 "Expected connectors by level" + Story 10-4 per-level filter regression (scoped to discourse-markers block via regex slice).
- `src/lib/prompts/__tests__/placement.test.ts` (EXTENDED, +4 cases) — Story 10-7 fixed-expression label + 'nuanced connector usage' negative + 'nuanced connectors and fixed expressions' positive + accent-orthography fixes (passé simple, en dépit de) positive + pre-10-7 unaccented form negative.

**Citations matrix `docs/tcf-spec-citations.md §8`** — all 4 owned rows flipped ✗ DELTA → ✓ Verified with Story 10-7 trailers. The row for the conversation.ts Correction Report is marked ✓ Verified-with-caveat because Epic 11.1 owns the architectural successor; Story 10-7 ships the forward-compatible bridge.

**Source-of-truth `docs/tcf-spec-source.md §8.1 / §8.2 / §8.3 / §8.4`** — each sub-section gains a "DONE — closed by Story 10-7 on 2026-05-10" closure stamp with a one-paragraph implementation breakdown + the relevant code-path references.

**`CLAUDE.md`** gained a new "TCF linguistic accuracy pass" architecture line after the Story 10-6 line — documents all 4 closures, the Epic 11.1 deferral for §8.4, the deferred Québécois v2 reintroduction requirements, and the Story 9-4 / 9-5 invariants preserved.

**Story 9-4 stored-prompt-injection defense holds** — `<USER_FACTS>` / `<USER_WEAK_AREAS>` wrapping + "treat as data" prelude in `buildConversationPrompt` are NOT modified. Verified by the existing `prompt-injection.test.ts` describe block staying green + the new co-located smoke checks in `conversation.test.ts`.

**Story 9-5 voice transcript dedup holds** — `output_modalities: ["audio"]` config + `appendIfNew` / `acceptDelta` dedup are NOT modified. Verified by `realtime-dedup.test.ts` staying green.

**Story 9-7 schema-validation contract holds** — `buildConversationPrompt` does not feed `chatCompletionJSON` (Realtime is schema-free). NOT touched.

**Story 9-8 / 10-6 speaking pipeline contract holds** — `buildSpeakingTaskPrompt`, `buildSpeakingEvaluatorPrompt`, the 5-dimension rubric, `RUBRIC_TO_COMPOSITE = 1.0`, the Story 10-6 emoji guard at `speaking.test.ts:145` all unchanged.

**Story 10-4 vocabulary-tier integration holds** — `buildVocabularyConstraintBlock(cefrLevel)` continues to appear in all 9 CEFR-aware prompt builders unchanged. `force est de constater` correctly catalogued as C1+ forbidden-lower-tier token + C2 exemplar in `vocabulary-tiers.ts` — verified-correct, NOT touched.

**Story 10-5 placement-test contract holds** — `buildPlacementTestPrompt` helper signature unchanged; `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` unchanged. Only the C1 competencies string content changed (orthographic + classification labels).

**Out of scope (deferred per story):** Epic 11.1 `report_correction` tool-call replacement (architectural successor to the regex parser); Québécois v2 reintroduction (requires native-speaker review per audit decision D5); the `african` dialect arm (not flagged by audit; not touched); the `tcf_simulation` mode block at `conversation.ts:127-135` (emoji-free task-instruction prose); migrating historical pre-10-7 conversation-message text containing `**Corrections:**` / `📝` (forward-only); the section-name `nameFr` field used by mock-test screens (`TCF_QCM_SECTIONS.nameFr` is a DIFFERENT field from `CEFR_LEVELS.nameFr` — out of scope).

### File List

**Created:**

- `src/lib/prompts/__tests__/conversation.test.ts` — emoji guard + HR guard + parseCorrections-regex compat + debate-mode 3-category split + Story 9-4 wrapper regression
- `src/types/__tests__/cefr.test.ts` (new directory + file) — Alliance Française nameFr convention pins
- `src/lib/prompts/__tests__/listening.test.ts` — `@ts-expect-error` type-narrowing guard + Québécois leakage guard
- `src/lib/prompts/__tests__/writing.test.ts` — discourse-markers framing + Story 10-4 per-level filter regression

**Modified:**

- `src/lib/prompts/conversation.ts` (Correction Report block rewritten plain-text; debate-mode list split into 3 categories)
- `src/types/cefr.ts` (`CEFR_LEVELS` `nameFr` rewritten to Alliance Française convention; JSDoc updated)
- `src/lib/prompts/listening.ts` (`dialect?` type union narrowed; `quebecois` arm removed from `DIALECT_GUIDANCE`; JSDoc added documenting v2 reintroduction requirements)
- `src/lib/prompts/writing.ts` (section header rebranded "Expected discourse markers (connectors + fixed expressions) by level"; internal comment updated with Story 10-7 framing note)
- `src/lib/prompts/placement.ts` (C1 competencies string rewritten with inline `[connector]` / `[fixed expression]` labels + `passé simple` / `en dépit de` accent-orthography fixes)
- `src/lib/prompts/__tests__/placement.test.ts` (Story 10-5 file — extended with Story 10-7 describe block: 4 new cases)
- `CLAUDE.md` (added "TCF linguistic accuracy pass" architecture line after the Story 10-6 line)
- `docs/tcf-spec-source.md` (§8.1, §8.2, §8.3, §8.4 each gain a "DONE — closed by Story 10-7" closure stamp)
- `docs/tcf-spec-citations.md` (§8 — all 4 owned rows flipped ✗ DELTA → ✓ Verified with Story 10-7 trailers; table widths reformatted by prettier)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (10-7: backlog → ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/10-7-linguistic-accuracy-pass.md` (this story file — Status, all AC + Task checkboxes [x], Dev Agent Record filled)

### Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-10 | Story 10-7 implementation complete; Correction Report block in `buildConversationPrompt` rewritten plain-text (no emoji, no markdown bold, no `---`); debate-mode discourse markers split into 3 correctly-classified categories; `CEFR_LEVELS` `nameFr` rewritten to Alliance Française convention; Québécois arm dropped from `buildListeningExercisePrompt`; `force est de constater` connector-misclassification echoes corrected in `writing.ts` + `placement.ts`; 4 ✗ DELTA rows in citations matrix §8 flipped to ✓ Verified; +86 net tests (732 → 818); status → review |
| 2026-05-10 | Senior Developer Review patches P1–P10 applied (5 HIGH + 5 MED); +4 net tests (818 → 822 total); all quality gates green                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## Senior Developer Review (AI)

**Review date:** 2026-05-10
**Reviewers:** Blind Hunter (general adversarial, no project context) + Edge Case Hunter (project-aware path tracer) + Acceptance Auditor (spec-vs-diff)
**Outcome:** Changes Requested → 10 patch findings applied → APPROVED

### Triage outcome

- **27 findings** raised across 3 reviewers (18 Blind Hunter + 8 Edge Case Hunter + 0 Acceptance Auditor). After deduplication (BH3↔ECH6 emoji range; BH7+ECH3+ECH4 regex robustness): **24 distinct findings**.
- **10 patch findings applied** in this story branch (5 HIGH + 5 MED).
- **12 defer findings** filed for follow-up (real but pre-existing, out-of-scope per story's NOT-TOUCHED list, or acceptable trade-offs).
- **2 reject findings** dropped as noise (spec-file documentation errors, not code defects).
- **0 violations** from the Acceptance Auditor on the 9 numbered ACs + AC #Z polish — the spec was followed faithfully.

### Action Items (all resolved)

- [x] **[HIGH] P1** (Edge Case Hunter ECH1) `TranscriptView.getDisplayText` at `src/components/conversation/TranscriptView.tsx:42-48` anchored on `text.indexOf("---\n")` to strip the Correction Report from rendered chat bubbles. Story 10-7 removed the `---\n` divider from the prompt (§8.4 emoji + markdown drop), so post-10-7 `dividerIndex` returns `-1` and the full Correction Report (`"X" → "Y" (Z)` lines + `Tip:`) renders inline in every assistant bubble — production-visible regression. The `CorrectionBubble` side-note also renders, creating duplicate display. Patched: rewrote `getDisplayText` to anchor on whichever of (a) the `"..." → "..." (...)` correction-line pattern, (b) a `No corrections.` leading line, (c) a `Tip:` leading line, or (d) the legacy `---\n` divider appears first. The legacy fallback keeps historic / in-flight pre-10-7 conversation messages strippable. No new test was added at the TranscriptView component level (existing component tests are absent for `getDisplayText` and adding one is out-of-scope churn); the regex contract is exercised by the parser-compat test in `conversation.test.ts`.
- [x] **[HIGH] P2** (Blind Hunter BH1) The HR-guard regex in `conversation.test.ts` used `/## Correction Report \(Plain Text — Read Aloud\)[\s\S]*?(?=^## |$)/m`. With the `m` flag, `$` matches end-of-LINE (not end-of-string), and combined with lazy `[\s\S]*?` the regex captured only the header line. The `not.toMatch(/^---$/m)` assertion was vacuous across 18 parameterized cases — a future patch re-introducing `---` in the body would pass silently. JavaScript regex does not support `\Z`. Patched: replaced the regex match with an explicit `indexOf` + `\n## ` boundary search, plus a sanity check `expect(block.length).toBeGreaterThan(200)` so a future regression that shrinks the block to just its header fails loudly.
- [x] **[HIGH] P3** (Blind Hunter BH3 + Edge Case Hunter ECH6) The emoji-range guards `/[\u{1F300}-\u{1FAFF}]/u` and `/[\u{1F600}-\u{1F64F}]/u` missed `✅` (U+2705, Dingbats block U+2700–U+27BF) and the Misc-Symbols / Supplemental-Symbols / Regional-Indicators blocks. The pre-10-7 `✅` was caught only by the literal `not.toContain` check, not by the parameterized 18-case range test. A future regression adding `❌` / `⚠️` / `❗` / `⭐` / `🤔` / `🤖` would slip past. Patched: added a `\p{Extended_Pictographic}/u` guard that covers all emoji-capable Unicode codepoints in one expression; kept the two original range patterns as duplicate coverage (mirror Story 10-6's `speaking.test.ts:153-154` pattern).
- [x] **[HIGH] P4** (Blind Hunter BH2) The `tcf_simulation` mode block in `conversation.ts:127-135` still emitted `**Task 1 (2 minutes):**` / `**Task 2 (5.5 minutes):**` / `**Task 3 (4.5 minutes):**`. The §8.4 audit finding is scoped to the whole voice-mode prompt, not just the Correction Report block — and the new top-of-prompt instruction "Your full response will be spoken aloud verbatim by text-to-speech. Do NOT use markdown formatting (no asterisks...)" creates a contradictory signal with the `**Task N:**` template the model is told to follow. The §8.4 closure was claimed in the citations matrix but the failure mode (TTS reading "asterisk asterisk task one") was still live for `tcf_simulation` users. Patched: dropped the `**bold**` markdown from all three task headers; plain `Task 1 (2 minutes):` labels render identically in AI reasoning and are not read literally by TTS.
- [x] **[HIGH] P5** (Blind Hunter BH4) The C2 assertion `expect(prompt).toContain("force est de constater")` in `writing.test.ts` passed for the wrong reason — Story 10-4's `buildVocabularyConstraintBlock("C2")` legitimately surfaces `force est de constater` in the C2 exemplars list AND in the forbidden-lower-tier listings at multiple levels. The substring check did not scope to the discourse-markers block, so a future patch that drops the item from `connectorRows` would still pass the assertion. Patched: scoped the assertion to the per-level discourse-markers block via the same regex-slice pattern the A1 per-level filter test uses. The scoped block now asserts both the new C1-C2 connecteurs sub-row AND the C1-C2 locutions verbales figées sub-row content (driven by P10's writing.ts split).
- [x] **[MED] P6** (Edge Case Hunter ECH2) `DIALECT_GUIDANCE` at `listening.ts:107` was typed `Record<string, string>` so an arbitrary string key (e.g., a deserialised DB row containing the pre-10-7 `"quebecois"` value, or a future cross-builder caller bypassing TS narrowing) produced `undefined` rendered as `(undefined)` in the system prompt — the AI would then be unconstrained on dialect choice, leaving Québécois features potentially reachable through a non-typed code path. Patched: tightened the type to `Record<"metropolitan" | "african", string>`; added a runtime `if (!(dialect in DIALECT_GUIDANCE)) throw new Error(...)` guard at the function entry, mirroring the `writingTaskWordRange` defensive-throw pattern (Story 10-3). Added 2 new test cases (`listening.test.ts`) asserting the throw fires for `"quebecois"` and arbitrary garbage strings.
- [x] **[MED] P7** (Blind Hunter BH5) `placement.ts` B1/B2 competency / distractor strings retained pre-10-7 unaccented French orthography (`passe compose`, `j'ai alle`, `etre/avoir/aller`, `qui/que/dont/ou`). The C1 row's accent fixes (`passé simple`, `en dépit de`) applied in AC #5 left the lower-level rows inconsistent — and the §8.2 "match the publisher orthography" theme applies uniformly across all six levels, not just C1. Patched: added accents to A1/A2/B1 rows (`être/avoir/aller`, `passé composé with avoir and être`, `imparfait vs passé composé`, `qui/que/dont/où`, `j'ai allé vs je suis allé`). B2 row had no unaccented terms requiring fixes. Added a regression test in `placement.test.ts` (positive + negative substrings).
- [x] **[MED] P8** (Blind Hunter BH7 + Edge Case Hunter ECH3 + ECH4) The new Correction Report prompt relies entirely on the `"X" → "Y" (Z)` line shape for parse extraction (no markdown scaffolding like the pre-10-7 `**Corrections:**` header). Two robustness gaps: (a) French Realtime models commonly emit French typographic guillemets (`« »`) or curly quotes (`" "`) instead of ASCII straight quotes, which the regex `/"([^"]+)"\s*→\s*"([^"]+)"\s*\(([^)]+)\)/g` does not match — silent data loss. (b) French explanations frequently contain nested parentheses (e.g., `(auxiliaire être (être/avoir distinction))`), and the regex's `\(([^)]+)\)` terminates at the first `)` — truncating explanations. Patched (cheapest fix): added a "Formatting rules for the correction line (CRITICAL — the post-conversation parser depends on this exact shape)" block to the prompt explicitly telling the model to use ASCII straight quotes (not guillemets / not curly quotes) and to NOT nest parentheses inside the explanation. Epic 11.1's `report_correction` tool-call is the architectural successor; the prompt-instruction fix is forward-compatible.
- [x] **[MED] P9** (Blind Hunter BH10) The writing.ts per-level filter (`A1|A2` / `B1|B2` / `C1|C2` branches at `connectorRows`) was only tested at A1 in `writing.test.ts`. A future patch that swaps the `B1|B2` branch to `else` or removes a row would not be caught. Patched: added 2 new parameterized test cases for B1 (asserts A1-A2 + B1-B2 rows present, C1-C2 sub-rows absent) and C1 (asserts all three CEFR tiers present). Mirrors the per-CEFR-level coverage pattern from Story 10-3 `passage-calibration.test.ts`.
- [x] **[MED] P10** (Edge Case Hunter ECH5) The §8.1 fix at `writing.ts` was cosmetic — the section header changed from "Expected connectors by level" to "Expected discourse markers (connectors + fixed expressions) by level", but the C1-C2 row content remained a flat comma-separated list mixing actual connectors (`néanmoins`, `toutefois`, `en l'occurrence`) with locutions verbales figées (`force est de constater`, `il n'en demeure pas moins`, `quoi qu'il en soit`). The AI consumed the items as peers, so the misclassification was not actually resolved at the AI-output level. Patched: split the C1-C2 row into two sub-rows mirroring the conversation.ts 3-category structure (AC #2): `C1-C2 connecteurs:` and `C1-C2 locutions verbales figées:`. Each item now lives in its correctly-classified sub-row; the AI receives the same structural signal in writing.ts as in conversation.ts. Updated `writing.test.ts` positive assertions on both sub-rows + negative assertion that `force est de constater` does NOT appear in the connecteurs sub-row.

### Deferred items (filed for follow-up)

- **DEFER-1** (Blind Hunter BH6) `@ts-expect-error` guard effectiveness depends on tsconfig strictness flags + ESLint suppression-unused rule. The current project config compiles the directive correctly, but a future tsconfig relaxation could silently disable the regression-lock. Filing as a manual verification follow-up; not blocking.
- **DEFER-2** (Blind Hunter BH8) The `sanitizeMemoryContent` mock in `conversation.test.ts` is trivial (`s.trim()`), narrower than the production sanitizer (Story 9-4 NFC normalization + instruction-token stripping + 300-char cap). The canonical Story 9-4 regression suite at `prompt-injection.test.ts` exercises the real sanitizer; the co-located smoke check is intentionally a structural-wrapper check, not a sanitization check.
- **DEFER-3** (Blind Hunter BH9) The negative-assertion `expect(prompt).not.toContain("Force est de constater que, Quoi qu'il en soit, En revanche")` is a brittle exact-substring check. The more robust assertion at line 1556 ("the Connecteurs row does not name Force est de constater") catches the same drift more robustly via per-row regex extraction. The line-1572 substring is belt-and-suspenders coverage; acceptable.
- **DEFER-4** (Edge Case Hunter ECH7) `force est de constater` is listed as a C2 vocabulary `exemplar` in `vocabulary-tiers.ts:245` — a cross-classification inconsistency post-10-7 (Story 10-7 now correctly treats it as a locution verbale figée elsewhere). The story explicitly marks `vocabulary-tiers.ts` as "verified-correct, NOT TOUCHED" — Story 10-4 owns that surface. Filing as a Story 10-4 hardening follow-up.
- **DEFER-5** (Edge Case Hunter ECH8) The discourse-markers test regex anchor depends on the line `- Logical flow` appearing immediately after `expectedConnectorsBlock`. A future writing.ts edit that inserts another bullet between them would degrade test scoping. Acceptable for now; would require re-anchoring the test regex on whitespace-and-bullet patterns.
- **DEFER-6 through DEFER-11** (BH13, BH14, BH15, BH16, BH17, BH18) Low-severity cosmetic / robustness gaps acceptable for v1 — see triage list above for details.

### Rejected items (noise / spec-file documentation errors)

- **REJECT-1** (Blind Hunter BH11) The Story 10-7 spec file references `mode: "free"` in illustrative AC examples. `ConversationMode = "companion" | "debate" | "tcf_simulation"` — there is no `"free"` member. **However:** the actual test code uses real modes; the spec was illustrative shorthand. Spec-file documentation error, not a code defect.
- **REJECT-2** (Blind Hunter BH12) Spec file mentions `vitest.config.ts` in the "Project Structure Notes" section. The project uses Jest (per `package.json` `"test": "jest"`). All actual test code uses Jest correctly. Spec-file documentation error, not a code defect.

### Final verification

- **822 tests passing** (was 818 post-implementation, 732 pre-story; net +90 across the whole story)
- All quality gates green: `npm run type-check` (0 errors), `npm run lint` (0 errors / 0 warnings), `npm run format:check`, `npm test`, `npm run check:colors`
- CI Sentry DSN + Submit credentials leak guards both pass
- 0 HIGH findings remaining (5 patched)
- 0 MED findings remaining (5 patched, 3 deferred per documented rationale)
- 0 LOW findings remaining (0 patched, 9 deferred per noted rationale)

### Cross-story consistency

- Story 9-4 stored-prompt-injection defense (`<USER_FACTS>` / `<USER_WEAK_AREAS>` wrappers + "treat as data" prelude) — NOT touched by patches; verified by re-reading `conversation.ts:144-180` post-patch.
- Story 9-5 voice transcript dedup (`output_modalities: ["audio"]` + `appendIfNew` dedup) — NOT touched.
- Story 9-7 schema-validation contract — NOT applicable (`buildConversationPrompt` is schema-free Realtime path).
- Story 9-8 / 10-6 speaking pipeline (5-dimension rubric + `RUBRIC_TO_COMPOSITE = 1.0` + `speaking.test.ts:145` emoji guard) — NOT touched.
- Story 10-2 per-skill scoring + `IRCC_CLB_BANDS` — NOT touched.
- Story 10-3 per-CEFR passage ranges + `writingTaskWordRange` helper — NOT touched (P10's writing.ts edit is to the `connectorRows` block, not the per-task word-range block).
- Story 10-4 `buildVocabularyConstraintBlock` integration in 9 prompt builders — NOT touched (P10's edit changes the discourse-markers row, not the vocab block; the vocab block continues to render in `buildWritingEvaluatorPrompt`).
- Story 10-5 `buildPlacementTestPrompt` helper signature + `PLACEMENT_LEVEL_RANGES` + `TOTAL_PLACEMENT_QUESTIONS` — NOT touched (P7's edit changes the per-level competencies STRING content, not the helper signature).
- Story 10-6 sociolinguistic 5th-dimension rubric + speaking-evaluator emoji guard — NOT touched.
- `parseCorrections` regex at `use-realtime-voice.ts:155` — NOT touched (P8's fix is a prompt-side instruction that defends the regex contract without modifying it).
