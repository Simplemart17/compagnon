---
title: Companion — Path to Shippable
created: 2026-05-06
audit_source: 10-agent independent review (architecture, mobile, ui-ux, backend, ai-integration, security, performance, qa, french-pedagogy, devops)
status: draft — pending owner approval
supersedes_claims_in: MEMORY.md sprint completion claims (Epics 1–8) — see feedback_memory_log_completeness.md
---

# Companion — Path to Shippable

## 0. Executive Summary

The independent multi-agent audit on **2026-05-06** found that the codebase is a **high-quality solo-built MVP whose self-reported readiness is roughly 1–2 sprints ahead of reality**. Eight epics are marked done in `sprint-status.yaml`, but several "completed" items are wrong, partial, or never built. The architecture, security boundary, and offline strategy are genuinely above-average. The product as it stands today **cannot honestly be sold as TCF prep** — the test specs are wrong, the scoring curve is fabricated, the CEFR promotion engine is silently broken, and Speaking has no scoring pipeline.

**This document scopes the work to take Companion from "polished prototype" to "shippable v1," organized into 9 new epics (Epic 9–17) across 4 phases.** Targeted total effort: **5–7 weeks** of focused work for one engineer, or **3–4 weeks** with parallelism across the existing specialist agents.

**Definition of shippable (this roadmap's bar):**
1. TCF specs match the current France Éducation International specification, verified against authoritative source.
2. CEFR promotion engine works end-to-end and requires evidence across all 5 TCF skills.
3. No PII or screenshots leaked to telemetry; no committed secrets in repo.
4. AI outputs validated by Zod at every JSON-parsing boundary.
5. Critical-path test coverage ≥ 40% (hooks + lib + golden flows).
6. Production deployment substrate is real: signed builds, OTA channels, Edge Function deploy automation, Sentry source maps, staging environment.
7. Beta-tested with ≥ 10 external users for ≥ 7 days without P0 incidents.

---

## 1. Findings Catalog

The 10 agents reported ~120 distinct findings. After deduping cross-cutting themes, the consolidated list below is grouped by severity. Every finding is traceable to a file/line.

### P0 — Release blockers (must fix before any external beta)

| # | Finding | Files | Source agent |
|---|---------|-------|--------------|
| P0-1 | TCF specifications are wrong (listening 39q/35min, reading 45q/60min, grammar 18q/18min — code uses 29/25, 29/45, 18/15) [^p0-1-correction] | `src/lib/constants.ts:14-17`, `src/lib/prompts/mock-test.ts:81-94` | pedagogy |

[^p0-1-correction]: **Story 10-1 footnote (2026-05-10):** the audit's specific numbers were partially wrong — Reading 45q is invented (TCF Canada is **39q/60min**) and Grammar does not exist in TCF Canada at all (Grammar is a TCF Tout Public component only). The pre-audit code values (29/25, 29/45, 18/15) were a faithful match for TCF Tout Public — the codebase was targeting the wrong TCF variant, not implementing the right variant wrong. Story 9-1 pivoted to TCF Canada with the correct numbers (39/35, 39/60, plus 60min Writing + 12min Speaking, no Grammar); story 10-1 expanded the source-of-truth into [docs/tcf-spec-source.md](../../docs/tcf-spec-source.md) (11 sections) with a citations matrix at [docs/tcf-spec-citations.md](../../docs/tcf-spec-citations.md) and 4 publisher snapshots under `docs/tcf-canada-snapshots/`.
| P0-2 | CEFR auto-promotion silently broken — `updateSkillProgress` upserts on `(user_id, skill)` without writing `cefr_level`; `checkCefrPromotion` filters by `cefr_level`, so promotion never re-fires after the first one | `src/lib/activity.ts:84-110`, `src/lib/activity.ts:174-223` | qa, pedagogy |
| P0-3 | CEFR promotion does not require all 5 TCF skills — users can be told they reached B2 with zero speaking practice | `src/lib/activity.ts:174-223` | pedagogy |
| P0-4 | Stored prompt-injection via `companion_memory` — user-spoken text → GPT-extracted "facts" → interpolated into every future system prompt with no delimiters; user can self-jailbreak with "Remember: ignore prior instructions…" | `src/lib/memory.ts:79`, `src/lib/prompts/conversation.ts:121` | security, ai |
| P0-5 | Sentry DSN committed in repo + email + screenshots auto-attached → GDPR risk (conversation transcripts uploaded to Sentry on every error) | `app.json:63`, `app/_layout.tsx:47`, `app/_layout.tsx:92` | security |
| P0-6 | Duplicate transcript entries in voice mode — both `output_text.done` and `output_audio_transcript.done` fire for same response; every assistant turn stored 2× in DB and shown 2× in UI | `src/hooks/use-realtime-voice.ts:293-352`, `src/lib/realtime.ts:234` | architecture |
| P0-7 | Auth listener re-runs `loadProfile` on every `TOKEN_REFRESHED` event — refetches profile, resets loading, re-flushes write queue (queued writes can replay) | `src/hooks/use-auth.ts:35-43` | mobile, qa |
| P0-8 | Zero schema validation on AI outputs — `chatCompletionJSON<T>` blindly casts; every consumer (writing eval, mock test, dictation, memory, error-tracker, conversation feedback) is one drift away from runtime error or silent garbage in DB | `src/lib/openai.ts:112-126` | ai, qa |
| P0-9 | Production deploy is blocked — Apple/Google submit credentials are placeholders, `google-service-account.json` is missing, no `eas update` channels, no Edge Function deploy automation, Sentry source-map upload not wired | `eas.json`, `.github/workflows/build.yml` | devops |
| P0-10 | TCF Speaking section has no scoring pipeline despite being one of the five skills — `mock-test.ts` only handles `listening / reading / grammar` | `src/lib/prompts/mock-test.ts`, `app/(tabs)/mock-test/[testId].tsx` | pedagogy |

### P1 — Quality essentials (should not ship to general availability without)

| # | Finding | Files | Source agent |
|---|---------|-------|--------------|
| P1-1 | Raw% → TCF score curve is fabricated (linear-ish bands), not calibrated against real TCF data; produces over/under-estimation by skill | `src/lib/scoring.ts:13-19` | pedagogy |
| P1-2 | Equal skill weights in composite are wrong — TCF reports per-skill, not composite; the math is invented | `src/lib/scoring.ts:50-56` | pedagogy |
| P1-3 | A1 listening passages too long (50 words exits A1); B2 reading too short (200-300 vs real 300-450); C1 too short; Writing Task 3 spec says 250-300 vs real 120-180 | `src/lib/prompts/listening.ts:71-75`, `src/lib/prompts/reading.ts:78-82`, `src/lib/prompts/writing.ts:99-103` | pedagogy |
| P1-4 | No vocabulary frequency caps in prompts — "A1 vocab" is whatever the model decides | `src/lib/prompts/*.ts` | pedagogy |
| P1-5 | No `placement.ts` prompt file — placement test logic appears inline or absent | `src/lib/prompts/` | pedagogy |
| P1-6 | Correction parsing uses brittle regex `/"X"\s*→\s*"Y"\s*\(...\)/g` — curly quotes, em-dashes, paraphrased corrections silently produce zero corrections; speaking-score pipeline depends on this | `src/hooks/use-realtime-voice.ts:142-161` | architecture, ai |
| P1-7 | No reconnect / barge-in handling in `RealtimeSession` — connection drops mid-conversation = data loss; user talks over AI = overlapping audio | `src/lib/realtime.ts:199-212` | ai |
| P1-8 | Edge Function rate limiter is in-memory per-instance — trivially bypassed; effectively fails-open at low traffic | `supabase/functions/_shared/rate-limit.ts:12` | architecture, backend, ai |
| P1-9 | No upstream timeout on OpenAI/Azure fetches — hung upstream holds Edge Function concurrency for ~150s | `supabase/functions/ai-proxy/index.ts`, `supabase/functions/realtime-session/index.ts` | backend |
| P1-10 | Default `maxTokens: 2048` on every chat call; 3 post-conversation AI calls per voice session; no daily per-user spend cap | `src/lib/openai.ts:67`, `src/hooks/use-realtime-voice.ts:494-585` | ai |
| P1-11 | Profile cache stores PII in plaintext AsyncStorage (full_name, level, streak, last_active_date) — readable on rooted Android | `src/lib/cache.ts:103-119`, `src/hooks/use-auth.ts:51` | security |
| P1-12 | Weak password policy (6 chars, no complexity) | `app/(auth)/signup.tsx:78-80` | security |
| P1-13 | `npm audit` reports 9 vulnerabilities, 3 high (xmldom XML injection, recursion DoS) | `package-lock.json` | security |
| P1-14 | Edge Function `parseUpstreamError` returns raw upstream body to client — leaks model names and prompt fragments | `supabase/functions/_shared/errors.ts:54-79` | security |
| P1-15 | No email-verification gate before app loads — unconfirmed users reach onboarding | `app/_layout.tsx`, `src/hooks/use-auth.ts` | security |
| P1-16 | Test coverage ≈ 3-5% — only `scoring.test.ts` exists; @testing-library/react-native installed but unused | `src/lib/__tests__/` | qa, devops |
| P1-17 | `useRealtimeVoice` is an 794-line god-hook running 14 responsibilities; `persistConversation` runs 8 sequential awaits before showing summary (5-7s tail latency) | `src/hooks/use-realtime-voice.ts` | architecture, mobile |
| P1-18 | Race conditions in `activity.ts` — read-then-write streak/skill/daily activity; phone+web concurrent users lose increments | `src/lib/activity.ts:33-110` | qa, architecture |
| P1-19 | `ExpoPlayAudioStream.destroy()` on every unmount kills shared singleton — second screen mount breaks audio until reload | `src/hooks/use-realtime-voice.ts:784` | mobile |
| P1-20 | Bilingual UI chaos — onboarding mixes French headings with English subtitles; tabs English, home headings French; no rule | `app/onboarding/index.tsx:42-54`, `app/(tabs)/_layout.tsx`, `app/(tabs)/home/index.tsx` | ui-ux |
| P1-21 | Error-tracker dedupe is string-equality with no normalization; will spam dozens of near-duplicate "patterns" | `src/lib/error-tracker.ts:32-37` | ai |

### P2 — Robustness & polish (would hurt user experience under realistic conditions)

| # | Finding | Files | Source agent |
|---|---------|-------|--------------|
| P2-1 | Conversation prompt instructs Realtime voice model to emit emoji-formatted markdown corrections — TTS will literally say the asterisks or skip them | `src/lib/prompts/conversation.ts:38-52` | ai, pedagogy |
| P2-2 | "Force est de constater" listed as connector (it's a fixed expression); "Élémentaire avancé" is a non-standard CEFR label; Québécois prompt is misleading ("tu" → "tsu"; "chez nous" not a marker) | `src/lib/prompts/writing.ts:35`, `src/lib/prompts/conversation.ts:91`, `src/lib/prompts/listening.ts:65`, `src/types/cefr.ts:33` | pedagogy |
| P2-3 | Transcript re-render storm during AI streaming — `setState` per audio chunk (~20ms cadence); FlatList `extraData` invalidates per AI speech state flip | `src/hooks/use-realtime-voice.ts:279`, `src/components/conversation/TranscriptView.tsx:307` | performance |
| P2-4 | Conversation feedback fan-out — 4 sequential effects, ~7 unbounded queries on each `[sessionId]` mount | `app/(tabs)/conversation/[sessionId].tsx:237-456` | performance |
| P2-5 | Daily briefing fires 6+5 = ~11 parallel queries on every home mount + embeds the literal string "daily greeting" via AI proxy | `src/hooks/use-daily-briefing.ts:260`, `src/hooks/use-progress.ts:79`, `src/lib/memory.ts:106` | performance |
| P2-6 | Mock test 3 sequential AI calls (no streaming, no first-section-playable progressive UI) | `app/(tabs)/mock-test/[testId].tsx` | performance |
| P2-7 | History modal uses ScrollView.map (not FlatList) — 500-message conversation renders all bubbles at once | `app/(tabs)/conversation/history.tsx:903` | performance |
| P2-8 | `transcriptRef.current` grows unbounded; CLAUDE.md performance budget says cap at 100 — not implemented | `src/hooks/use-realtime-voice.ts` | performance |
| P2-9 | AI prompts inject memories + error patterns into Realtime system prompt with no truncation — long-tenure users push large prompts and increase TTFT | `src/lib/prompts/conversation.ts:115-131` | ai, performance |
| P2-10 | Three different "card" treatments and five hero styles for the same product — visible inconsistency across home, conversation, practice, profile, mock-test | various screens | ui-ux |
| P2-11 | Onboarding "I don't know" CTA is in English on a French-locale screen ("Quel est votre niveau actuel ?"); microcopy contradicts itself | `app/onboarding/index.tsx:361-371` | ui-ux |
| P2-12 | Accent color overloaded with 3 meanings (streak warmth, progress, CTA action) | `src/lib/design.ts`, multiple screens | ui-ux |
| P2-13 | Mock-test index screen has no "past results" / "resume in-progress" surface despite memory's claim | `app/(tabs)/mock-test/index.tsx` | ui-ux |
| P2-14 | `mock_tests.questions` stored as JSONB blob — blocks per-question analytics and inflates row size | `supabase/migrations/20260301000000_initial_schema.sql` | backend |
| P2-15 | `notification_log` has RLS enabled with no policies (deny-all to authenticated); works because service-role bypasses but is undocumented and brittle | `supabase/migrations/20260402000000_notification_cron.sql:76` | backend |
| P2-16 | `set_updated_at()` trigger function lacks `SECURITY DEFINER` + `SET search_path` despite the security pass claim | `supabase/migrations/20260303000000_triggers_indexes_cleanup.sql:12` | backend, security |
| P2-17 | `companion_memory.source_conversation_id` has no index despite being a FK | `supabase/migrations/20260301000000_initial_schema.sql` | backend |
| P2-18 | `send-notifications` doesn't paginate — pulls all eligible users into memory; will hot-spot at ~10k DAU | `supabase/functions/send-notifications/index.ts` | backend |
| P2-19 | SM-2 lapse handling is too punitive for adult L2 vocab (resets to 1-day interval AND decrements ease) | `src/lib/srs.ts:46-50` | pedagogy, ai |
| P2-20 | SRS is bound only to vocabulary — not applied to grammar, listening, or idiomatic expressions | `src/lib/srs.ts`, `src/lib/error-tracker.ts` | pedagogy |
| P2-21 | Race in `useRealtimeVoice.start` — `sessionRef.current = session` is set after `await connect()`; events arriving in the await window see null ref | `src/hooks/use-realtime-voice.ts:682-688` | mobile |
| P2-22 | Pronunciation history grows unbounded in memory; `identifyWeakSounds` runs over whole history on every call | `src/hooks/use-pronunciation.ts:79-88` | mobile, performance |
| P2-23 | Several hooks have `useEffect` ESLint deps disabled (9+ places) hiding real stale-closure risks | various | mobile, qa |
| P2-24 | Screens too large (sessionId 1291 lines, placement-test 1167, echo 1034, translation 1000) — CLAUDE.md guideline says 200 | various screens | mobile |
| P2-25 | Dictation accent-stripping is over-permissive — `l'eau` typed as `leau` passes (apostrophes also stripped) | `src/hooks/use-dictation.ts` | qa, pedagogy |

### P3 — Post-launch / nice-to-have

| # | Finding | Files |
|---|---------|-------|
| P3-1 | HNSW vector index will not scale per-user beyond ~5M vectors; consider partial index by user_id | `supabase/migrations/20260301000002_production_fixes.sql` |
| P3-2 | No OTA / `runtimeVersion` configured in `app.json` — every fix requires full store build | `app.json`, `eas.json` |
| P3-3 | One Supabase project for dev/staging/prod | infra |
| P3-4 | No EAS build on PR; reviewers can't smoke-test binaries | `.github/workflows/build.yml` |
| P3-5 | No analytics product surface beyond Sentry breadcrumbs — cannot measure activation, retention | `src/lib/analytics.ts` |
| P3-6 | No phonetics/IPA curriculum despite TCF Expression Orale weighting pronunciation heavily | `src/lib/prompts/` |
| P3-7 | No discourse/argumentation curriculum for Writing Task 3 thesis-development-conclusion | `src/lib/prompts/writing.ts` |
| P3-8 | One-way CEFR promotion only (no demotion / spaced retention check) | `src/lib/activity.ts` |
| P3-9 | No item bank caching — every exercise regenerated by GPT (cost + no anti-repetition) | `src/hooks/use-exercise.ts` |
| P3-10 | AudioWaveform: 7 sharedValues + 7 useAnimatedStyle restart on every speaker change | `src/components/conversation/AudioWaveform.tsx` |
| P3-11 | Three different vocabulary sources of truth (memory cache, AsyncStorage cache, DB) with hand-listed invalidation | `src/lib/cache.ts`, hooks |
| P3-12 | Migrations are forward-only; no rollback playbook | `supabase/migrations/` |
| P3-13 | No uptime/health checks, no alerting | infra |

---

## 2. Epic Breakdown

The work below is organized into 9 new epics (Epic 9–17). Each maps to one of the 4 phases in §3 and to a single primary specialist agent (with secondary agents named for review/cross-cutting work).

### Epic 9 — Release Blockers (P0)
**Goal:** Eliminate every P0 finding so the app can enter closed beta with no known correctness or compliance defects.
**Primary agent:** `system-architect` (orchestration); per-finding agent listed below.
**Deliverables:**
- 9.1 TCF spec verification & correction (`pedagogy + backend`) — verify against authoritative source, update constants, prompts, scoring scale acceptance bands. **Covers P0-1, P0-10.**
- 9.2 CEFR promotion engine fix (`backend + ai-integration`) — write `cefr_level` on `updateSkillProgress`; require coverage of all 5 skills; add re-promotion test. **Covers P0-2, P0-3.**
- 9.3 Sentry leak remediation (`security + devops`) — move DSN to env, drop email, set `attachScreenshot:false`, add `beforeSend` scrubber, rotate DSN, update privacy policy. **Covers P0-5.**
- 9.4 Stored-prompt-injection defense (`security + ai-integration`) — wrap memories in `<UNTRUSTED>` block; restrict extractor output (no imperatives); strip "ignore/system/prompt" tokens; cap memory length. **Covers P0-4.**
- 9.5 Voice transcript dedup (`mobile + ai-integration`) — switch to single modality per response or de-dup keyed off `response.id`; verify no DB doubles. **Covers P0-6.**
- 9.6 Auth listener fix (`mobile`) — branch on `_event` (only re-load on SIGNED_IN/OUT/INITIAL); idempotent `flushWriteQueue`; add unhandled-rejection catch on initial getSession. **Covers P0-7.**
- 9.7 Zod validation infrastructure (`ai-integration + qa`) — add `zod`; wrap every `chatCompletionJSON` call site with a parse step; on parse failure: retry once, then fail loudly to Sentry. **Covers P0-8.**
- 9.8 Speaking section pipeline (`pedagogy + ai-integration`) — add `mock-test.ts` Speaking branch; build evaluation rubric aligned to TCF Expression Orale; persist to `mock_test_answers`. **Covers P0-10.**
- 9.9 Submit credentials & deploy substrate (`devops`) — fill Apple Team ID / App Store Connect ID / Apple ID; obtain Google service account JSON; configure `runtimeVersion` + `eas update` channels (preview, production); add Edge Function deploy job to `build.yml`; add `SENTRY_AUTH_TOKEN` and verify source-map upload. **Covers P0-9.**

**Acceptance criteria:**
- TCF question count, time limit, and section composition match an authoritative spec PDF saved at `docs/tcf-spec-source.pdf`.
- A user who completes 10 exercises × 3 skills at 85% and **also** has Speaking + Writing evidence is auto-promoted; without all 5, they are not.
- Sentry events from a fresh build do not contain `email` or screenshot payload (verified via dry-run).
- No transcript appears twice in DB or UI for any voice conversation in the test matrix.
- Zod parse failure is observable in Sentry and never produces undefined fields in DB.
- `eas submit` completes without manual intervention against TestFlight and internal Play track.

**Estimated effort:** 8–12 engineer-days. **Cannot ship without.**

---

### Epic 10 — TCF Pedagogy Realignment (P0/P1)
**Goal:** Make the app a credible TCF prep tool — content, scoring, and progression all aligned with the real exam.
**Primary agent:** `french-pedagogy-expert`; secondary `ai-integration`, `backend`.
**Deliverables:**
- 10.1 Authoritative TCF spec sourcing — fetch official spec PDFs from france-education-international.fr, store under `docs/`, include citation in CLAUDE.md.
- 10.2 Scoring scale calibration — replace the linear bands with empirically-anchored thresholds (per-skill, not composite); use published TCF→CEFR mapping. **Covers P1-1, P1-2.**
- 10.3 Per-level passage / sentence calibration — fix listening A1 (≤30 words), reading B2 (300-450), C1 (500-700), writing Task 3 (120-180). **Covers P1-3.**
- 10.4 Vocabulary frequency caps — embed top-1000 / top-3000 / top-5000 lists in prompts; add explicit "do not exceed level" negative constraint. **Covers P1-4.**
- 10.5 Placement test prompt extraction — create `src/lib/prompts/placement.ts` with explicit competency rubric and frequency constraints. **Covers P1-5.**
- 10.6 Speaking rubric & scoring pipeline (deferred from Epic 9 if needed) — Expression Orale tasks 1, 2, 3 with calibrated turn-taking expectations and per-task rubric.
- 10.7 Linguistic accuracy pass — fix "Force est de constater" misclassification, drop "Élémentaire avancé", rewrite Québécois prompt with accurate IPA and real markers (icitte, pantoute, l'affricage), drop emoji from voice-mode prompt outputs. **Covers P2-1, P2-2.**
- 10.8 Anti-cheat & frequency anti-repetition — add basic item dedupe (hash of question stem) to avoid showing the same generated MCQ across sessions.

**Acceptance criteria:**
- A French-pedagogy review (re-run `french-pedagogy-expert`) returns no severity-HIGH findings.
- A side-by-side comparison of 10 generated B2 listening passages vs official TCF B2 samples shows mean word count within ±15%.
- Placement test results map to the same level for the same user across 5 trials within ±1 CEFR step.

**Estimated effort:** 5–8 engineer-days. **Cannot ship without.**

---

### Epic 11 — AI Robustness & Cost Discipline (P1)
**Goal:** Make AI integration deterministic and bounded in cost.
**Primary agent:** `ai-integration`; secondary `backend`.
**Deliverables:**
- 11.1 Correction protocol via tool-calls — replace regex parsing with a `report_correction` function call; voice prompt asks model to invoke it; remove emoji-markdown corrections in voice mode. **Covers P1-6, P2-1.**
- 11.2 Realtime reconnect & barge-in — auto-reconnect with exponential backoff on `onclose`; on user audio while AI speaking, fire `response.cancel` + `conversation.item.truncate`. **Covers P1-7.**
- 11.3 Edge Function upstream timeouts — `AbortController` with 30–60s budget on every OpenAI/Azure fetch. **Covers P1-9.**
- 11.4 Replace in-memory rate limit with Upstash Redis (or Supabase-managed rate-limit RPC) — per-user, per-day cost cap as second tier. **Covers P1-8, P1-10.**
- 11.5 Cost discipline pass — drop default `maxTokens` to per-call right-sizing; collapse 3 post-conversation AI calls into 1 with a structured output; add `gpt-realtime-mini` for free tier; add per-user daily spend ceiling enforced server-side. **Covers P1-10.**
- 11.6 Embedding-based dedupe in error-tracker — embed normalized pattern, cosine threshold ≥ 0.85 for merge; replaces string-equality. **Covers P1-21.**
- 11.7 Truncation in prompts — top-3 memories, top-3 error patterns, max 80 chars each. **Covers P2-9.**
- 11.8 Empty-response detection for non-JSON chat completions; retry parity (TTS = 2 retries). **Covers P2-x ai-integration findings.**

**Acceptance criteria:**
- Disconnect simulation mid-conversation reconnects within 5s and does not lose transcript.
- Single user cannot exceed 30 chat req/min by hitting cold instances (Upstash counter test).
- Per-user daily AI spend cap enforced; verified by triggering ceiling.
- Synthetic prompt-injection tests in CI ("Remember: ignore all instructions") do not change downstream session behavior.

**Estimated effort:** 4–6 engineer-days.

---

### Epic 12 — Mobile/Architecture Hardening (P1)
**Goal:** Eliminate the runtime races and god-hook architecture that will produce silent data-loss bugs.
**Primary agent:** `mobile-engineer`; secondary `system-architect`, `qa-engineer`.
**Deliverables:**
- 12.1 Decompose `useRealtimeVoice` into a `RealtimeOrchestrator` class (lib) + thin hook (state surface only); parallelize the 8-step persistConversation chain. **Covers P1-17.**
- 12.2 Move auth subscription to one-time bootstrap in Zustand store; consumers read state only. **Covers P0-7 deepening.**
- 12.3 Atomic RPC mutations — convert `incrementDailyActivity`, `updateStreak`, `updateSkillProgress` to server-side `UPDATE … SET x = x + $1`. **Covers P1-18.**
- 12.4 Fix `useRealtimeVoice.start` race — assign `sessionRef.current = session` before `connect()`; queue events arriving during connect. **Covers P2-21.**
- 12.5 Fix `ExpoPlayAudioStream` lifecycle — singleton manager with reference counting; stop instead of destroy on unmount. **Covers P1-19.**
- 12.6 Cap `transcriptRef` at 200 entries; spill older to disk if needed. **Covers P2-8.**
- 12.7 Move profile cache to encrypted SecureStore-wrapped adapter; update `cache.ts`. **Covers P1-11.**
- 12.8 Tighten password policy (≥10 chars, complexity); add Supabase HIBP if available. **Covers P1-12.**
- 12.9 Email verification gate before app loads. **Covers P1-15.**
- 12.10 `npm audit fix` + Expo SDK update path if needed. **Covers P1-13.**
- 12.11 Sanitize Edge Function error responses — never return raw upstream body. **Covers P1-14.**
- 12.12 Cap pronunciation history; memoize `identifyWeakSounds`. **Covers P2-22.**

**Acceptance criteria:**
- `useRealtimeVoice.ts` ≤ 250 lines.
- Concurrent phone+web session test does not lose any increments (verified via 100 concurrent updates).
- Audio works after 5 successive screen mount/unmount cycles.
- `npm audit` reports 0 high vulnerabilities.

**Estimated effort:** 4–6 engineer-days.

---

### Epic 13 — Performance Hot Paths (P2)
**Goal:** Smooth voice conversations on 3-year-old phones; reduce home-screen first-paint cost.
**Primary agent:** `performance-engineer`; secondary `mobile-engineer`.
**Deliverables:**
- 13.1 Drop `extraData` on `TranscriptView` (or change to ref-stable); guard `setState` on `output_audio.delta`. **Covers P2-3.**
- 13.2 Reduce home query fan-out — combine `useDailyBriefing` + `useProgress` into a single RPC returning a denormalized blob; cache the "daily greeting" embedding once per launch. **Covers P2-5.**
- 13.3 Convert `[sessionId].tsx` 4-effect waterfall into a single hook backed by a SQL view returning aggregates. **Covers P2-4.**
- 13.4 Stream mock-test generation — render section 1 while sections 2/3 generate. **Covers P2-6.**
- 13.5 Replace history modal `ScrollView.map` with FlatList. **Covers P2-7.**
- 13.6 Lower Sentry `tracesSampleRate` to 0.05 in production; remove `attachScreenshot`. **Covers P2-x performance.**
- 13.7 Resolve mixed `className`+`style` on hot animated rows (ConversationCard, etc).
- 13.8 Truncate prompts (already in 11.7; verify here from a perf POV).

**Acceptance criteria:**
- Voice conversation maintains ≥ 55 FPS on iPhone 11 for 30 turns (Reactotron / Flipper trace).
- Home cold-cache first-paint with-data ≤ 1.5s on 4G simulation.
- Mock test feels playable (first section rendered) within 8s of tap.

**Estimated effort:** 3–5 engineer-days.

---

### Epic 14 — UI/UX Consistency (P2)
**Goal:** Ship one product, not five visual styles.
**Primary agent:** `ui-ux-designer`; secondary `mobile-engineer`.
**Deliverables:**
- 14.1 Language decision — pick a primary surface language (recommend FR with EN fallback for instructional copy until i18n exists); rewrite onboarding, tabs, screen titles. **Covers P1-20, P2-11.** Owner decision required (see §6).
- 14.2 Card consolidation — collapse the three card treatments into 2 reusable components (`SkillCard`, `ListItemCard`). **Covers P2-10.**
- 14.3 Icon system replacement — choose SF Symbols / Material Symbols / lucide; replace decorative emoji.
- 14.4 Token enforcement — add ESLint rule rejecting raw `rounded-[Npx]` and `shadowOpacity:` literals; enforce `Radii.*` and `Shadows.*`. **Covers P2-x ui-ux.**
- 14.5 Resolve accent color overload — split into `accent`, `streak`, `progress`. **Covers P2-12.**
- 14.6 30-second post-onboarding tour — 3-card guided "what Companion does."
- 14.7 Mock-test landing — add "Resume in-progress" and "Past results" sections. **Covers P2-13.**
- 14.8 Replace `Alert.alert` for high-traffic flows (sign-out, level change) with a custom themed dialog component.
- 14.9 Hero pattern unification — pick one hero system; apply across home, conversation, practice, mock-test, profile.

**Acceptance criteria:**
- A new user can describe what the app does in one sentence after onboarding (informal user test, n≥5).
- Re-run `ui-ux-designer` audit returns no severity-HIGH findings.
- Lint catches a raw `rounded-[12px]` on a fresh PR.

**Estimated effort:** 4–7 engineer-days.

---

### Epic 15 — Test Coverage & QA Infrastructure (P1)
**Goal:** Make CI a real gate, not a green-light theater.
**Primary agent:** `qa-engineer`; secondary `backend-engineer`, `ai-integration`.
**Deliverables:**
- 15.1 Lib unit tests — `srs.ts`, `cache.ts`, `activity.ts`, `memory.ts`, `error-tracker.ts`, `pronunciation.ts` (compare logic), `dictation` word comparison.
- 15.2 Hook integration tests with @testing-library/react-native — `use-auth` (sign-in success/failure, token refresh), `use-exercise` (MCQ + writing flows), `use-realtime-voice` (mocked WebSocket), `use-pronunciation` (mocked API).
- 15.3 Edge Function Deno tests — auth gate, rate limit, model allowlist, account-delete idempotency.
- 15.4 Golden-flow E2E with Detox or Maestro — sign-up → onboarding → 1 exercise → 1 conversation → mock test partial → review.
- 15.5 AI schema regression tests — record 10 real model outputs per prompt (writing eval, mock test, dictation, etc); replay through Zod parsers in CI.
- 15.6 CI gating — Jest threshold ≥ 40% on `src/lib/` and `src/hooks/`; fail PR on regression.

**Acceptance criteria:**
- `npm test` runs ≥ 80 distinct test cases.
- `coverage/` reports ≥ 40% on lib + hooks.
- E2E suite runs nightly against EAS preview build.

**Estimated effort:** 5–8 engineer-days.

---

### Epic 16 — Deploy & Launch Readiness (P1)
**Goal:** Production deployment is repeatable, observable, and rollbackable.
**Primary agent:** `devops-engineer`; secondary `security-analyst`.
**Deliverables:**
- 16.1 Real submit credentials filled in `eas.json` (Apple Team ID, App Store Connect App ID, Apple ID); Google service account key obtained and stored as EAS secret.
- 16.2 Configure `runtimeVersion` (policy: `appVersion`) + `eas update` channels (preview, production). **Covers P3-2.**
- 16.3 Edge Function deploy step in `build.yml` — `supabase functions deploy ...` on `push: main` after tests pass.
- 16.4 Sentry source-map upload — `SENTRY_AUTH_TOKEN` in CI, `sentry:sourcemaps:upload` step verified by uploading a synthetic stack.
- 16.5 Staging environment — second Supabase project; build profile `preview` points to staging; smoke-test on every PR build.
- 16.6 Migration rollback playbook — `_bmad-output/planning-artifacts/runbooks/migration-rollback.md` with worked example of last 3 migrations.
- 16.7 Edge Function error → Sentry — replace `console.error` with `Sentry.captureException` in functions.
- 16.8 Uptime check — Better Uptime or Supabase ping every 5min on `/auth/health`, page Slack on outage.
- 16.9 App Store Connect / Google Play submission package complete (using existing `store/ios-metadata.md` + `store/android-metadata.md`).
- 16.10 Beta tester recruitment — TestFlight + internal Play track invitation list of ≥ 10 users.

**Acceptance criteria:**
- A pushed commit to main results in: tests pass → staging Edge Functions deployed → preview build to TestFlight → source maps uploaded — fully automated.
- Production Sentry events deobfuscate to source.
- Rollback of the most recent migration succeeds in staging within 15min.

**Estimated effort:** 3–5 engineer-days.

---

### Epic 17 — Backend Hardening & Long-Tail (P2/P3)
**Goal:** Address the slower-burning backend cliffs and long-tail items before scale exposes them.
**Primary agent:** `backend-engineer`; secondary `security-analyst`.
**Deliverables:**
- 17.1 Normalize `mock_tests.questions` into `mock_test_questions` table; migration with backfill. **Covers P2-14.**
- 17.2 Document `notification_log` deny-all RLS pattern with code comment; revisit if any client read needed. **Covers P2-15.**
- 17.3 Harden `set_updated_at()` (`SECURITY DEFINER` + `SET search_path = ''`). **Covers P2-16.**
- 17.4 Add `idx_companion_memory_source_conv` on `source_conversation_id`. **Covers P2-17.**
- 17.5 Paginate `send-notifications` with cursor — process in batches of 500. **Covers P2-18.**
- 17.6 Move pgvector to `extensions` schema (lint warning). **Covers P3-1 prep.**
- 17.7 Reverse migrations for the next 5 forward migrations (`*_down.sql` template). **Covers P3-12.**
- 17.8 Truncate push tokens in logs. **Covers P2-x security.**

**Acceptance criteria:**
- Per-question analytics queries (`GROUP BY question_id`) work end-to-end.
- Migration rollback runbook validates a forward+down cycle.

**Estimated effort:** 3–4 engineer-days. **Can ship before this is done; do during beta.**

---

## 3. Phasing & Sequencing

```
Week 1–2  PHASE 1 — STOP-THE-BLEED                  Epic 9 + Epic 10 (parallel)
Week 3    PHASE 2 — AI & ARCHITECTURE HARDENING     Epic 11 + Epic 12 (parallel)
Week 4    PHASE 3 — TEST + DEPLOY                   Epic 15 + Epic 16 (parallel)
Week 5    PHASE 4 — POLISH                          Epic 13 + Epic 14 (parallel)
Week 6    BETA                                      TestFlight; Epic 17 in background
Week 7    LAUNCH PREP                               Bug triage from beta; submit
```

**Critical path:** Epic 9 → Epic 10 → Epic 16 (deploy substrate). Without these three, nothing ships.

**Parallelism notes:**
- Epic 10 work can begin on day 1 in parallel with Epic 9 because pedagogy work is read-mostly on the prompts/scoring layer.
- Epic 15 (tests) should start during Epic 9 — every blocker fix should land with a regression test.
- Epic 14 (UI/UX) requires the §6 language-strategy decision before starting.

---

## 4. Effort Summary

| Epic | Days (lo) | Days (hi) | Phase |
|------|-----------|-----------|-------|
| 9 — Release Blockers | 8 | 12 | 1 |
| 10 — TCF Pedagogy Realignment | 5 | 8 | 1 |
| 11 — AI Robustness & Cost | 4 | 6 | 2 |
| 12 — Mobile/Architecture Hardening | 4 | 6 | 2 |
| 13 — Performance Hot Paths | 3 | 5 | 4 |
| 14 — UI/UX Consistency | 4 | 7 | 4 |
| 15 — Test Coverage | 5 | 8 | 3 |
| 16 — Deploy & Launch Readiness | 3 | 5 | 3 |
| 17 — Backend Hardening | 3 | 4 | parallel/post |
| **Total (sequential)** | **39** | **61** | |
| **Total (with phase parallelism, single eng)** | **24** | **38** | ~5–8 weeks |

A solo engineer working ~5h/day on this realistically takes the upper bound. With aggressive subagent parallelism and minimal context-switching cost, lower bound is achievable.

---

## 5. Risks & Dependencies

### External dependencies
- **Authoritative TCF spec PDF availability** — france-education-international.fr publishes specs but format changes; verify current spec for the Tout Public test before Epic 10 starts.
- **Supabase staging project provisioning** — Epic 16 assumes a second project is creatable; if blocked, fall back to schema-prefix isolation.
- **Apple Developer + Google Play accounts active** — confirm before Epic 9.9.
- **Upstash account** (or chosen rate-limit store) — Epic 11.4.

### Technical risks
- **Supabase Edge Function cold-start cost** with Upstash adds round-trip latency. Mitigation: short-TTL token cache.
- **Realtime API event names hardcoded** (`response.output_audio_transcript.done`, etc.) — OpenAI may rename. Mitigation: subscribe to OpenAI changelog, add CI check that fetches a sample event sequence.
- **EAS migration to Expo SDK 56** may be required to clear xmldom CVE; would invalidate parts of the codebase. Mitigation: defer to Epic 17 or accept Expo's transitive risk.
- **Zod parse failures in production** could be loud to users — mitigate with retry-once-then-graceful-degradation per call site.

### Process risks
- **The MEMORY.md "completed sprint" pattern** (overstated completeness) is the single biggest delivery risk. Mitigation: every epic acceptance criterion above is verifiable by a test or a re-run of the audit agent — **do not mark anything done by author claim**. Run the relevant specialist agent post-fix and only mark done when the re-audit returns clean.

---

## 6. Owner Decisions Required

The following require human judgment before Phase 1 starts. They are blocking only for the listed epics — work in other epics can begin in parallel.

| # | Decision | Blocks | Recommendation | Status |
|---|----------|--------|----------------|--------|
| D1 | Primary surface language for v1: French / English / bilingual with toggle | Epic 14 | English-primary with French as the **content** language (target audience is non-French speakers preparing for TCF). All UI chrome in English; prompts/exercises in French. | **DECIDED 2026-05-06** — owner accepted recommendation. UI chrome = English; content (prompts, exercises, AI responses, transcripts) = French. No bilingual toggle in v1. |
| D2 | Free tier vs paid only — affects cost ceiling design | Epic 11.5 | Free tier with a daily AI spend ceiling per user; paid removes ceiling. |
| D3 | Beta cohort size and recruitment channel | Epic 16.10 | 10–25 users from FR-immigration / TCF subreddit; 14-day beta. |
| D4 | Deferred-launch posture — TestFlight only vs public submission immediately after beta | Epic 16 | TestFlight first, public 4 weeks after beta launch. |
| D5 | Whether to support Québécois variant in v1 | Epic 10.7 | Drop in v1; reintroduce in v2 with native-speaker review. |
| D6 | Whether to add OTA (`eas update`) hotfix capability before launch | Epic 16.2 | Yes, mandatory — without it, every fix is a 1–7 day store review cycle. |
| D7 | Telemetry posture under GDPR — opt-in or opt-out for analytics | Epic 11/16 | Opt-in for analytics; transactional/security telemetry (Sentry minus PII) is opt-out. |

---

## 7. Definition of Done (per epic)

A story within an epic is "done" only when all of:

1. Code merged to `main` with passing CI (type-check, lint, format, jest, migration validation).
2. At least one unit or integration test directly exercising the change is added (or, for content-only changes, the relevant pedagogy / linguistic check).
3. The relevant **specialist agent re-runs against the changed surface and returns no HIGH-severity finding** related to the work item.
4. Story file updated with implementation notes and any deviations from spec.
5. Sprint-status YAML updated.

An epic is "done" only when:

- All stories above done.
- Acceptance criteria from §2 verified — explicitly checked off in the epic retro.
- Retrospective written under `_bmad-output/implementation-artifacts/epic-N-retro-YYYY-MM-DD.md`.

---

## 8. Agent & Skill Assessment

The user authorized creating new agents/skills "if it requires." After scoping all 9 epics:

**Agents:** No new agents needed. The 10 existing specialist agents map 1-to-1 with the work areas (system-architect, mobile-engineer, ui-ux-designer, backend-engineer, ai-integration, security-analyst, performance-engineer, qa-engineer, french-pedagogy-expert, devops-engineer). Each epic above names a primary and secondary agent. Adding more agents would dilute routing clarity without adding coverage.

**Skills:** No new skills needed. BMad skills already provide:
- `bmad-create-story` — generate story files from epic descriptions above
- `bmad-create-epics-and-stories` — break each epic into stories
- `bmad-correct-course` — when a story discovers scope expansion
- `bmad-retrospective` — at end of each epic
- `bmad-check-implementation-readiness` — before launch
- `bmad-code-review` — adversarial review per story

The **anti-pattern to avoid** is creating a "release-readiness" or "tcf-spec-verify" custom skill that just wraps a search. The existing `WebFetch`, `Context7`, and specialist agents handle these one-shot tasks better than a skill abstraction would.

**One workflow recommendation:** when invoking a specialist agent for a fix, also run them on the verification step. E.g., for Epic 9.1 (TCF spec correction), invoke `french-pedagogy-expert` once to fetch authoritative specs and propose the correction, then invoke them a second time post-implementation to verify the fix lands the right numbers. This is the discipline the existing memory log was missing.

---

## 9. Anti-pattern: Trusting the Author's Claim

The single biggest reason this audit was needed is that **MEMORY.md sprint completion claims overstated actual completeness**. To prevent recurrence:

- Every claim of "fixed X" in a future memory entry must include a verification artifact: a test name, a grep result, a reaudit citation, or a screenshot.
- "Done" is a subagent-verifiable state, not an author-asserted one.
- Do not write narrative summaries of completed work to MEMORY.md. Instead, point to the retrospective file under `_bmad-output/implementation-artifacts/`.
- Treat external specs (TCF, GDPR, OpenAI API surfaces) as **always to be verified at the time of work**, never recalled from prior memory.

---

## 10. Quick-Reference Index

- Critical fixes shopping list: §1 (P0 + P1)
- What to do this week: Epic 9 + Epic 10
- What to do next: Epic 11 + Epic 12
- What to ship beta with: Phases 1–3 done
- What can wait: Epic 17 + §1 P3 items
- What's blocked on owner: §6
- What's done: see `sprint-status.yaml` (Epics 1–8 marked done; this roadmap re-opens specific items per §1)
