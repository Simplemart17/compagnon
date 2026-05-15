# Story 13.5: History Modal FlatList — replace `ScrollView.map` with virtualized `FlatList` so 500-message transcripts don't render all bubbles at once

Status: done

## Story

As a **TCF Canada exam-prep user reviewing a past conversation in the history modal**,
I want **the transcript to render only the visible bubbles instead of all 500+ at once**,
so that **opening a long conversation doesn't freeze the UI for several seconds while React mounts every bubble + the modal stays scrollable at ≥ 55 FPS on a 3-year-old phone**.

## Background — Why This Story Exists

### What audit finding P2-7 owns to this story

`_bmad-output/planning-artifacts/shippable-roadmap.md` § 1 — `P2-7`:

> History modal uses ScrollView.map (not FlatList) — 500-message conversation renders all bubbles at once
> `app/(tabs)/conversation/history.tsx:903` | performance

### The `ScrollView.map` pattern — what gets blocked

[`app/(tabs)/conversation/history.tsx:897-977`](<app/(tabs)/conversation/history.tsx#L897-L977>) renders the transcript as a `<ScrollView><messages.map(msg => <View>...</View>)></ScrollView>` block. **`ScrollView` renders every child synchronously** at mount; `FlatList` virtualizes (mounts only visible + small overscan buffer). For a 500-message conversation:

- **Pre-13-5:** 500 bubble `View`s + 500 `Text`s + per-bubble corrections rows (some have 0, some have 1-3) + 500 `onLayout` callbacks executed at first paint. Each bubble carries Tailwind class compilation + style merge + accessibility tree node. On an iPhone 11 the open-transcript path stalls the JS thread for ~3-8 seconds; the screen freezes mid-modal-open.
- **Post-13-5:** `FlatList` mounts ~10-20 visible bubbles + a small `initialNumToRender` overscan buffer. First paint < 200ms regardless of conversation length. Scroll virtualization recycles row components as the user scrolls.

### What gets faster, exactly

| Metric                                                                   | Pre-13-5                                | Post-13-5                                       |
| ------------------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------- |
| Initial render bubbles for a 500-msg conversation                        | 500 (all mounted at once)               | ~10-20 (visible + small overscan)               |
| JS-thread stall on transcript open (architectural proxy, iPhone 11)      | ~3-8s                                   | ~150-300ms                                      |
| FPS during scroll for long transcripts                                   | < 30 FPS (jank)                         | ≥ 55 FPS (Story 13-1 sibling AC line 253)       |
| `onLayout` callbacks fired                                               | 500 (synchronous burst)                 | ~10-20 (per visible row)                        |
| `messageLayoutMap` Map population                                        | Synchronously after mount               | Incrementally as rows mount during scroll       |
| Search-jump-to-match implementation                                      | `scrollTo({y: messageLayoutMap.get()})` | `flatListRef.scrollToIndex({ ... })`            |
| Memoization opportunity for unchanged rows during search-state churn     | None (re-renders all 500 every state change) | Per-row `React.memo` + stable `renderItem`  |

### Why a FlatList + ref-style refactor (not a new component)

This story does NOT extract a new `<HistoryTranscript>` component. The transcript render block is ~80 lines (lines 897-977) — small enough to migrate inline. Extracting to a new component would also require plumbing 6+ props (`messages`, `matchesByMessage`, `activeMatchIdx`, `transcriptScrollRef`, `messageLayoutMap`, `Colors` references) without meaningful reuse downside; the screen is the only consumer.

The companion pattern at [`src/components/conversation/TranscriptView.tsx`](src/components/conversation/TranscriptView.tsx) (Story 13-1) ALREADY uses `FlatList<TranscriptEntry>` for the LIVE conversation view. The history modal is the symmetric pattern for the SAVED conversation view — same data shape (`role` + `content` + `corrections`), same bubble UX, same search-highlight integration. This story mirrors the live-view's FlatList wiring inside the history screen.

### Why `scrollToIndex` not `scrollTo({y})`

Pre-13-5 search-jump-to-match used `transcriptScrollRef.current.scrollTo({ y: Math.max(0, y - 80), animated: true })` where `y` came from a `messageLayoutMap` populated by per-row `onLayout` callbacks. `ScrollView` is happy to scroll by raw pixel offset because every child is mounted + measured. `FlatList` is virtualized — at any given moment, most rows haven't mounted yet so we can't have their `y` positions.

Two options:

(a) **`scrollToIndex({ index, viewPosition: 0.1, animated: true })`** — the idiomatic FlatList API. `viewPosition: 0.1` puts the target row ~10% from the top of the viewport (matches the pre-13-5 `y - 80` offset semantically). Requires either fixed-height rows (`getItemLayout`) OR `onScrollToIndexFailed` fallback for off-screen rows whose dimensions FlatList hasn't measured yet.

(b) **Keep `messageLayoutMap` + use `scrollToOffset`** — preserve the `onLayout`-populated map, but rows that haven't been rendered yet are NOT in the map, so the search-jump silently fails for off-screen matches.

**Choose (a).** Bubble heights are variable (one-line message vs. paragraph), so `getItemLayout` isn't trivially derivable — implement `onScrollToIndexFailed` instead: fall back to `scrollToOffset({offset: 0})` then retry `scrollToIndex` after a frame, which is the React Native docs' recommended pattern. Pre-13-5 `messageLayoutMap` ref + the `messageLayoutMap.current.clear()` call at line 379 are DELETED (Story 10-2 / 12-X / 13-3 "delete don't alias" pattern — replaced not aliased). The pre-13-5 `transcriptScrollRef: useRef<ScrollView>` becomes `useRef<FlatList<ConversationMessage>>`.

### What `history.tsx` looks like post-13-5

The ~80-line ScrollView block at lines 897-977 collapses to:

```typescript
<FlatList
  ref={transcriptScrollRef}
  data={messages}
  keyExtractor={(item) => item.id}
  renderItem={renderBubble}
  extraData={historyExtraDataKey}
  ListEmptyComponent={EmptyTranscriptText}
  contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
  initialNumToRender={20}
  windowSize={10}
  maxToRenderPerBatch={10}
  removeClippedSubviews={true}
  onScrollToIndexFailed={handleScrollToIndexFailed}
  keyboardShouldPersistTaps="handled"
/>
```

- `renderBubble` — `useCallback`-memoized; reads `matchesByMessage` + `activeMatchIdx` for the highlighting integration via the `extraData` invalidation key.
- `historyExtraDataKey` — content-stable key (Story 13-3 P2 lesson) that flips when the search state needs to trigger a row re-render: `${transcriptSearch}|${activeMatchIdx}|${messages.length}` (joining the 3 inputs that drive bubble re-render: search text, active-match index, message-count).
- `EmptyTranscriptText` — extracted as a stable identity-preserving component so FlatList doesn't re-instantiate it per render.
- `removeClippedSubviews: true` — Android perf flag; safe on iOS no-op (RN docs).
- `initialNumToRender: 20` — covers most modal viewports without a flash; `windowSize: 10` (default) gives ~10 viewports of overscan; `maxToRenderPerBatch: 10` for smooth scroll-down.
- `onScrollToIndexFailed` — falls back to `scrollToOffset({offset: 0})` then retries the index after a frame (RN docs pattern). Required because rows are variable-height + `getItemLayout` is not implemented.

The search-jump-to-match callback `scrollToActiveMatch` is rewired:

```typescript
const scrollToActiveMatch = useCallback(
  (matchIdx: number) => {
    if (transcriptMatches.length === 0) return;
    const safeIdx = Math.max(0, Math.min(matchIdx, transcriptMatches.length - 1));
    const match = transcriptMatches[safeIdx];
    if (!match) return;
    transcriptScrollRef.current?.scrollToIndex({
      index: match.messageIndex,
      viewPosition: 0.1,
      animated: true,
    });
  },
  [transcriptMatches]
);
```

### Cross-story invariants to preserve

- **Story 9-3 telemetry allowlist** — zero new `feature` tags. `src/lib/sentry.ts` zero-diff by construction.
- **Story 9-4 stored-prompt-injection** — orthogonal (no AI / no prompts).
- **Story 9-5 voice transcript dedup** — orthogonal (live-flow concern; this screen is history-only).
- **Story 9-10 auth + cache race hardening** — orthogonal; the screen consumes `useAuthStore` for `user.id` only.
- **Story 11-1 corrections array** — `msg.corrections` rendering preserved verbatim per-bubble (the inner correction `.map()` stays inside `renderBubble` — it's bounded by `MAX_PENDING_CORRECTIONS = 50` from Story 11-1, so per-bubble it's already capped).
- **Story 12-1 RealtimeOrchestrator** — orthogonal (live-flow concern).
- **Story 12-6 transcript cap** — orthogonal (live-flow `applyTranscriptCap`; history view reads from `conversation_messages` table).
- **Story 13-1 transcript render-storm fix** — sibling pattern; `src/components/conversation/TranscriptView.tsx` is the LIVE version of this same UX. History modal is the SAVED version. This story aligns the saved version with the live version's FlatList virtualization.
- **Story 13-2 home aggregate** — orthogonal.
- **Story 13-3 session-feedback aggregate** — orthogonal.
- **Story 13-3 P2 content-key memoization** — applied to `extraData` invalidation key (`historyExtraDataKey`).
- **`HighlightedText` component contract** — `content`, `matches`, `activeMatchIndex`, `globalOffset`, `textColor` props unchanged. The component receives the same shape via `renderBubble` as it did via the inline `messages.map` body.

### Why a `useCallback`-memoized `renderItem` + per-row `React.memo`

Pre-13-5 the inline `messages.map(msg => <Bubble>)` re-creates 500 bubble React elements on every parent render (search state change, modal open, etc.). Post-13-5 FlatList virtualizes the row pool but `renderItem` is invoked per visible row on every parent render unless we memoize. The pattern:

1. **`useCallback` on `renderItem`** with stable deps (`activeMatchIdx`, `matchesByMessage`) — these change when search state moves, which is the LOAD-BEARING re-render trigger.
2. **`React.memo` on the row component** — `Bubble` (extracted as a private component below the screen) re-renders ONLY when its props (msg, msgMatches, activeMatchIdx, globalOffset) change.
3. **`extraData` key** invalidates FlatList's virtualization cache when search state changes, so previously-mounted rows re-render with new highlight state.

The Pareto-correct configuration: `extraData` is the ONLY non-data-shape signal that triggers FlatList row re-render; memoize aggressively below it.

### Known footguns (from prior story retros)

- **Story 13-1 review-round-1 P1 lesson** — `extraData` invalidation cliff. Pre-patch 13-1 used `transcript.length` only as the `extraData` key; this broke 3 invariants because length doesn't change in some edge cases (cap eviction, AI-speech-state flip with no message added). Post-patch the LIVE TranscriptView reverted to `${transcript.length}-${isAiSpeaking}`. For the HISTORY view: `messages` is immutable once loaded (no live updates), so `transcript.length` alone WOULD suffice for the length axis — but search state churn (`activeMatchIdx`, `debouncedTranscriptSearch`) is the dominant re-render trigger here. The history `extraData` must include all 3: `${debouncedTranscriptSearch}|${activeMatchIdx}|${messages.length}`. Defensive: even though messages is immutable, a future "reload conversation messages" feature could mutate it; the length axis is cheap insurance.
- **Story 13-1 review-round-1 P2 lesson** — `wasAiSpeaking` snapshot pattern (synchronous mirror). NOT applicable here (no async AI flow).
- **Story 13-3 review-round-1 P2 lesson** — content-key memoization defeats fresh-reference-per-render. Applied via `useMemo` on the `extraData` key + the `historyExtraDataKey` template-literal string.
- **Story 12-2 P12 lesson** — comment-strip source-drift detector regex to defeat JSDoc false-positives.
- **`onLayout` callback in FlatList rows** — works correctly but reports y-positions RELATIVE to the row's parent, not the scroll viewport. We don't need it post-13-5 because `scrollToIndex` is the new contract; the `messageLayoutMap` ref + the `onLayout` callback are both DELETED.
- **Variable-row-height + `scrollToIndex` failure mode** — when the target row is off-screen + below the currently-mounted window, FlatList can't compute the destination offset and fires `onScrollToIndexFailed`. The recommended pattern: `scrollToOffset({offset: 0})` (jump to top) + `setTimeout(() => scrollToIndex(...), 100)` (let FlatList measure the rows on the way). For 500-message transcripts the worst case requires a one-shot fallback; for normal-length transcripts (10-30 msgs) the first call succeeds directly.

### What the screen retains

The screen retains EVERYTHING outside the transcript-render block:
- All search state (`transcriptSearch`, `debouncedTranscriptSearch`, `activeMatchIdx`).
- `transcriptMatches` + `matchesByMessage` derivation.
- `goToNextMatch` / `goToPrevMatch` callbacks.
- `fetchConversations` + `openTranscript` data fetching.
- Modal opening/closing + the conversations list FlatList (line 684) — unchanged.
- `HighlightedText` component contract.
- Skeleton loader.
- Empty-state French copy ("This conversation's transcript is not available yet. It may still be processing.") — moved into `ListEmptyComponent`.

## Acceptance Criteria

1. **`app/(tabs)/conversation/history.tsx` refactored** — the `<ScrollView>` + `<messages.map>` block at lines 897-977 (~80 lines) is REPLACED with a single `<FlatList<ConversationMessage>>` invocation with these required props:
   - `data={messages}`
   - `keyExtractor={item => item.id}` (memoized via `useCallback` with empty deps).
   - `renderItem={renderBubble}` (memoized via `useCallback` keyed on the search-state deps).
   - `extraData={historyExtraDataKey}` where `historyExtraDataKey = \`${debouncedTranscriptSearch}|${activeMatchIdx}|${messages.length}\`` (Story 13-3 P2 content-key memoization).
   - `ListEmptyComponent={EmptyTranscriptText}` (extracted as a module-level or stable-identity component; renders the existing French empty-state copy).
   - `contentContainerStyle={{ padding: 16, paddingBottom: 40 }}` (preserved verbatim from pre-13-5).
   - `keyboardShouldPersistTaps="handled"` (preserved verbatim).
   - `initialNumToRender={20}` + `windowSize={10}` + `maxToRenderPerBatch={10}` + `removeClippedSubviews={true}`.
   - `onScrollToIndexFailed={handleScrollToIndexFailed}` for the variable-row-height fallback.

2. **`transcriptScrollRef` type updated** — `useRef<ScrollView>(null)` → `useRef<FlatList<ConversationMessage>>(null)`. The `ScrollView` import is removed from the `react-native` import block IF no other usage remains in the file.

3. **`messageLayoutMap` ref + the per-row `onLayout` callback are DELETED.** The `messageLayoutMap.current.clear()` call at line 379 in `openTranscript` is also DELETED. Pre-13-5 these lived to support `scrollTo({y})`; post-13-5 the FlatList `scrollToIndex` API takes the message INDEX directly. "Delete don't alias" pattern.

4. **`scrollToActiveMatch` rewired** — body becomes:
   ```typescript
   transcriptScrollRef.current?.scrollToIndex({
     index: match.messageIndex,
     viewPosition: 0.1,
     animated: true,
   });
   ```
   The `y - 80` offset semantics from the pre-13-5 `scrollTo` call are preserved via `viewPosition: 0.1` (target row positioned ~10% from viewport top — equivalent UX).

5. **`onScrollToIndexFailed` handler implemented** — when `scrollToIndex` fails for an off-screen row whose dimensions FlatList hasn't measured yet, the handler runs the documented RN pattern: `scrollToOffset({offset: 0, animated: false})` then `setTimeout(() => scrollToIndex({index, viewPosition: 0.1, animated: true}), 100)`. A captured-state `mountedRef` guard (Story 12-9 pattern) protects the setTimeout callback from setState-after-unmount races.

6. **`Bubble` private component extracted** at the top of `history.tsx` (or inline below the screen function — operator choice) and wrapped in `React.memo`. Props: `{ msg, msgMatches, activeMatchIdx, isUser }`. Renders the same JSX shape the pre-13-5 inline `.map` body did. The `msg.corrections` inner `.map` stays inside this component (corrections are bounded by Story 11-1's `MAX_PENDING_CORRECTIONS = 50` cap).

7. **NEW source-drift detector `app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts`** (~9-11 cases via comment-stripped source per Story 12-2 P12):
   - POSITIVE: `FlatList` import from `react-native` present.
   - POSITIVE: `FlatList<ConversationMessage>` ref type in `useRef`.
   - POSITIVE: `<FlatList` element rendered with `data={messages}` + `keyExtractor` + `renderItem` + `ListEmptyComponent` + `extraData=`.
   - POSITIVE: `scrollToIndex` called inside `scrollToActiveMatch`.
   - POSITIVE: `onScrollToIndexFailed` prop present.
   - POSITIVE: `initialNumToRender`, `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews` virtualization props all present.
   - POSITIVE: `historyExtraDataKey` (or equivalent template-literal) includes the 3 search-state inputs (`debouncedTranscriptSearch`, `activeMatchIdx`, `messages.length`).
   - NEGATIVE: pre-13-5 `<ScrollView ref={transcriptScrollRef}` opening tag GONE.
   - NEGATIVE: pre-13-5 `messages.map((msg, msgIdx) =>` pattern GONE (the inline transcript render).
   - NEGATIVE: pre-13-5 `messageLayoutMap` ref declaration GONE.
   - NEGATIVE: pre-13-5 `scrollTo({y:` direct call GONE (replaced by scrollToIndex).
   - NEGATIVE: `useRef<ScrollView>` type-arg GONE from the `transcriptScrollRef` declaration.

8. **NEW runtime test `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx`** (~6-8 react-test-renderer cases):
   - **Renders FlatList with `data=messages`** — open transcript with 50 messages; assert FlatList element receives the messages array as data prop.
   - **`renderItem` produces the correct bubble for a user message** — assert isUser styling (alignSelf flex-end + primary background).
   - **`renderItem` produces the correct bubble for an assistant message** — assert isUser=false styling.
   - **`extraData` invalidation key changes when `activeMatchIdx` flips** — content-stable string flips on state change (Story 13-3 P2 lesson).
   - **`scrollToActiveMatch` calls `flatListRef.scrollToIndex(...)` with the correct message index + `viewPosition: 0.1`** — mock the FlatList ref via `useRef.current = { scrollToIndex: jest.fn() }`.
   - **`onScrollToIndexFailed` falls back to `scrollToOffset({offset: 0})` then retries `scrollToIndex` after a frame** — drive the handler manually with a synthetic failure event; assert both methods called in order.
   - **`Bubble` is React.memo'd** — render twice with the same `msg` ref and assert `renderItem`'s output element matches the previous (via React.memo's identity check).
   - **`ListEmptyComponent` renders the French empty-state copy when `messages.length === 0`** — verify content.

9. **All quality gates green**: `npm run type-check` 0 errors + `npm run lint` 0 warnings + `npm run format:check` clean + `npm test` ≥ 1782 baseline + ≥ 13 new cases = ≥ 1795.

10. **CLAUDE.md gains a Story 13-5 architecture paragraph** appended after the Story 13-4 review-round-1 entry. Documents the ScrollView→FlatList conversion + scrollToIndex API swap + extraData content-key memo + cross-story invariants preserved + closes audit P2-7 architecturally.

11. **`sprint-status.yaml` 13-5 status flips** `backlog` → `ready-for-dev` (this story file creation) → `in-progress` (dev start) → `review` (impl complete).

### Y. GitHub Actions Injection Vector Check (workflow stories only)

N/A — this story does NOT modify `.github/workflows/*.yml`.

### Z. Polish Requirements

- [ ] All colors use `Colors.*` design tokens from `@/src/lib/design` — N/A (no new visual surfaces; bubble styling preserved verbatim from pre-13-5).
- [ ] All loading states use skeleton animations — pre-13-5 skeleton at lines 859-895 is unchanged.
- [ ] All interactive elements have `accessibilityRole` + `accessibilityLabel` — N/A (bubbles are non-interactive; the search nav buttons are unchanged).
- [ ] Non-obvious interactions have `accessibilityHint` — N/A.
- [ ] Stateful elements have `accessibilityState` — N/A.
- [ ] All tappable elements have minimum 44x44pt touch targets — N/A.
- [ ] All `catch` blocks use `captureError(err, "context")` from `@/src/lib/sentry` — the `onScrollToIndexFailed` handler does NOT need captureError (it's an RN-internal recoverable signal, not an error).
- [ ] All text uses `Typography.*` presets — bubble text preservation; the inline `className="text-sm leading-5"` + the corrections row `className="text-xs leading-[17px]"` are pre-13-5 patterns preserved.
- [ ] Quality gates pass: `npm run type-check && npm run lint && npm run format:check`.

### Story File Self-Check (run after writing this file)

- [x] `git status` lists this story file under "Untracked files" — i.e. visible to git, not silently ignored. **Verified:** `git status --short` returns `?? _bmad-output/implementation-artifacts/13-5-history-modal-flatlist.md`; `git check-ignore -v` returns no match.
- [x] `npx prettier --check _bmad-output/implementation-artifacts/13-5-history-modal-flatlist.md` passes. **Verified:** "All matched files use Prettier code style!"

## Tasks / Subtasks

- [x] **Task 1** (AC: #1, #2, #3, #4, #5, #6) — Refactor `history.tsx` transcript-render block.
  - [x] 1.1 Updated `transcriptScrollRef` type to `useRef<FlatList<ConversationMessage>>`.
  - [x] 1.2 DELETED `messageLayoutMap` ref declaration + `messageLayoutMap.current.clear()` in `openTranscript`.
  - [x] 1.3 Extracted `Bubble` `React.memo`-wrapped component (exported as `@internal` for unit testing).
  - [x] 1.4 Extracted `EmptyTranscriptText` module-level component for `ListEmptyComponent` (exported as `@internal`).
  - [x] 1.5 Implemented `renderBubble` via `useCallback` keyed on `[matchesByMessage, activeMatchIdx]`.
  - [x] 1.6 Implemented `historyExtraDataKey` via `useMemo` (template literal of 3 search-state inputs).
  - [x] 1.7 Implemented `handleScrollToIndexFailed` callback with `scrollToOffset(0)` fallback + setTimeout retry + Story 12-9 `mountedRef` guard.
  - [x] 1.8 Rewired `scrollToActiveMatch` to call `flatListRef.scrollToIndex({ index, viewPosition: 0.1, animated })`.
  - [x] 1.9 Replaced `<ScrollView>` + inline `.map` block with `<FlatList<ConversationMessage>>` element.
  - [x] 1.10 Removed `ScrollView` import from `react-native` import block.
- [x] **Task 2** (AC: #7) — NEW source-drift detector at [`app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts`](<app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts>) (12 cases — exceeds spec target 9-11).
- [x] **Task 3** (AC: #8) — NEW runtime test at [`app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx`](<app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx>) (8 cases — matches spec target high end).
- [x] **Task 4** (AC: #9) — All 4 quality gates green: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` 1802 / 1802 passing across 90 suites (+20 net from 1782 baseline; exceeds spec target +13 by 7).
- [x] **Task 5** (AC: #10, #11) — Documentation: CLAUDE.md architecture paragraph + sprint-status.yaml status flip + Dev Agent Record + File List in this story file.

## Dev Notes

### Branching guidance

Per `feedback_branch_from_main` memory: branch from `origin/main`. Story 13-5 does NOT touch the files PR #94 (Story 13-4) touched (`use-mock-test-generation.ts`, `[testId].tsx`); independent merge order. **Branch already created:** `feature/13-5-history-modal-flatlist` off `origin/main`.

### Project conventions to follow

- **FlatList virtualization** — `data` + `keyExtractor` + `renderItem` + `extraData` + `ListEmptyComponent` is the standard 5-prop minimum. Add the 4 perf props (`initialNumToRender`, `windowSize`, `maxToRenderPerBatch`, `removeClippedSubviews`) for explicit budget. RN docs precedent at [`react.dev/reference/react-native/FlatList`](https://reactnative.dev/docs/flatlist) — fetched 2026-05-15 via context7 (no new deps; FlatList is in the core `react-native` package shipped with Expo SDK 55).
- **`scrollToIndex` + `onScrollToIndexFailed`** — the RN documented pattern for variable-height rows. The fallback: scroll-to-top + setTimeout retry. Don't try to compute `getItemLayout` — bubble heights depend on content length, corrections presence, search-highlight wrap, etc. (would require a layout-measurement pass — wasteful for a list this size).
- **`React.memo` on row component** — pre-13-5 every parent re-render created 500 fresh React elements; post-13-5 the row component memoizes on prop identity. Combined with stable `renderItem` (`useCallback` with stable deps), the FlatList virtualization budget is bounded.
- **Content-key extraData** (Story 13-3 P2) — `extraData` must be a primitive (string/number) for FlatList's referential-equality check to work. Template-literal joining the 3 search-state inputs gives a stable string identity per (search, matchIdx, length) tuple.
- **"Delete don't alias"** (Story 10-2 / 11-3 / 11-4 / 11-5 / 11-6 / 11-7 / 11-8 / 12-1 / 12-2 / 12-3 / 12-4 / 12-5 / 12-6 / 12-7 / 12-8 / 12-9 / 12-10 / 12-11 / 12-12 / 13-1 / 13-2 / 13-3 / 13-4) — the `messageLayoutMap` ref + `onLayout` callback + `scrollTo({y})` call are DELETED, not legacy-aliased.

### Cross-story invariants worth re-checking before merge

- Story 9-3 telemetry allowlist (zero new feature tags).
- Story 9-5 voice transcript dedup (live-flow; orthogonal).
- Story 11-1 corrections rendering preserved verbatim per-bubble (`MAX_PENDING_CORRECTIONS = 50` cap from the live flow applies pre-DB-write; history reads the persisted array unchanged).
- Story 12-1 / 12-6 (RealtimeOrchestrator + transcript cap — live-flow concerns; orthogonal).
- Story 13-1 transcript render-storm fix (sibling pattern — TranscriptView.tsx already FlatList'd; this story extends the same discipline to history).
- Story 13-2 / 13-3 / 13-4 (orthogonal hot paths).

### Project Structure Notes

- **Files added (new):**
  - `app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts` (~9-11 source-drift cases).
  - `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx` (~6-8 runtime cases).
- **Files modified:**
  - `app/(tabs)/conversation/history.tsx` (~80 lines deleted + ~50 lines added; net −30; screen 983 → ~953 lines).
  - `CLAUDE.md` (Story 13-5 architecture paragraph appended).
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` (status flip + last_updated annotation).
  - `_bmad-output/implementation-artifacts/13-5-history-modal-flatlist.md` (this story file).
- **Files explicitly NOT modified:**
  - `src/components/conversation/TranscriptView.tsx` (Story 13-1's live-flow FlatList; orthogonal).
  - `src/lib/sentry.ts` (allowlist zero-diff).
  - `src/types/conversation.ts` (`ConversationMessage` shape preserved).
  - Any AI / Edge Function / migration / CI workflow files.
- **Total file count:** 2 new + 4 modified = 6 files. Total diff < 600 lines.

### Estimated test budget

Spec target: **+13 net Jest cases** (current baseline 1782 → ≥ 1795). Breakdown:

- Source drift: 9-11 cases.
- Runtime: 6-8 cases.
- Optional: bubble React.memo identity assertion (1 case).

A clean review would land within +10 to +15 net cases.

### Expected impact

- Initial render bubble count for 500-message conversation: **500 → ~10-20 (~96% reduction)**.
- JS-thread stall on transcript open: **~3-8s → ~150-300ms**.
- FPS during scroll: **< 30 → ≥ 55** (sibling AC line 253 for Story 13-1 live-flow; same architectural proxy applies).
- Search-jump-to-match latency on long transcripts: bounded by `scrollToIndex` + (rarely) a one-shot `onScrollToIndexFailed` fallback.

### References

- Audit: [`_bmad-output/planning-artifacts/shippable-roadmap.md`](_bmad-output/planning-artifacts/shippable-roadmap.md) § 1 P2-7 (line 102), § Epic 13 line 252 (deliverable 13.5).
- Pattern reference: [`src/components/conversation/TranscriptView.tsx:355-415`](src/components/conversation/TranscriptView.tsx#L355-L415) (Story 13-1 LIVE FlatList template; same `data` / `keyExtractor` / `renderItem` / `extraData` shape).
- Story 13-1 spec + review-round-1 retro (especially P1 — the `extraData` invalidation cliff lesson).
- Story 13-3 spec + review-round-1 P2 (content-key memoization defeats fresh-reference re-fires).
- Source: [`app/(tabs)/conversation/history.tsx:897-977`](<app/(tabs)/conversation/history.tsx#L897-L977>) (the ScrollView block to be refactored).
- RN docs: `FlatList` API surface + `scrollToIndex` + `onScrollToIndexFailed` — fetched via context7 from `/facebook/react-native` library ID (no version pin; SDK 55 ships RN 0.81).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Story file authored 2026-05-15 via `/bmad-create-story`.
- Branch: `feature/13-5-history-modal-flatlist` off `origin/main` (post-13-4 PR #94 merge per `feedback_branch_from_main` memory).

### Completion Notes List

- **Task 1 done.** [`app/(tabs)/conversation/history.tsx`](<app/(tabs)/conversation/history.tsx>) refactored: ~80-line `<ScrollView>` + `<messages.map>` block REPLACED with a virtualized `<FlatList<ConversationMessage>>` element. `transcriptScrollRef` type updated `useRef<ScrollView>` → `useRef<FlatList<ConversationMessage>>`. `messageLayoutMap` ref + the per-row `onLayout` callback + the `messageLayoutMap.current.clear()` call in `openTranscript` are DELETED ("delete don't alias"). `ScrollView` import removed from the `react-native` import block. Search-jump-to-match rewired: `scrollTo({ y: messageLayoutMap.get(idx) - 80 })` → `scrollToIndex({ index: match.messageIndex, viewPosition: 0.1, animated: true })`. NEW `handleScrollToIndexFailed` callback implements the RN-docs recommended fallback for variable-row-height (`scrollToOffset(0)` + setTimeout retry of scrollToIndex after 100ms), guarded by Story 12-9 `mountedRef` pattern. NEW `Bubble` `React.memo`-wrapped component + `EmptyTranscriptText` module-level component extracted (both `@internal`-exported for unit testing). NEW `renderBubble` `useCallback`-memoized (deps: `[matchesByMessage, activeMatchIdx]`). NEW `historyExtraDataKey` `useMemo`-memoized (template literal of 3 search-state inputs `${debouncedTranscriptSearch}|${activeMatchIdx}|${messages.length}` — Story 13-3 P2 content-key memoization).
- **Task 2 done.** Source-drift detector at [`app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts`](<app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts>) — 12 cases (exceeds spec target 9-11): POSITIVE pins for FlatList import + FlatList ref type + 5 required FlatList props (data + keyExtractor + renderItem + extraData + ListEmptyComponent) + scrollToIndex with viewPosition: 0.1 + onScrollToIndexFailed handler + 4 virtualization props (initialNumToRender, windowSize, maxToRenderPerBatch, removeClippedSubviews) + historyExtraDataKey 3-input template literal. NEGATIVE pins against pre-13-5 patterns: ScrollView ref usage GONE + messages.map((msg, msgIdx)) GONE + messageLayoutMap useRef GONE + useRef<ScrollView> type GONE + scrollTo({y}) call GONE. Uses Story 12-2 P12 comment-stripped source + scoped FlatList element extraction via `findTranscriptFlatListBody` helper (defeats the false-positive on the outer conversations-list FlatList).
- **Task 3 done.** Runtime test at [`app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx`](<app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx>) — 8 cases (matches spec target high end): Bubble user-message shape + Bubble assistant-message shape + Bubble corrections block rendering (Story 11-1 inner .map preserved) + Bubble + HighlightedText integration when msgMatches provided + Bubble React.memo identity assertion + EmptyTranscriptText empty-state copy + historyExtraDataKey content-key formula contract + onScrollToIndexFailed fallback contract (scrollToOffset → setTimeout retry → mountedRef guard prevents post-unmount setState). Uses react-test-renderer + jest.useFakeTimers (Story 12-1 P8 / 13-4 P2 pattern). `react-native-reanimated` mocked at file-level so the screen's skeleton-animation imports don't crash under Jest worklets.
- **Task 4 done.** All 4 quality gates green: `tsc` 0 errors / `lint` 0 warnings / `prettier` clean / `jest` 1802 / 1802 passing across 90 suites (+20 net from 1782 baseline; exceeds spec target +13 by 7).
- **Task 5 done.** CLAUDE.md gained the Story 13-5 architecture paragraph after the Story 13-4 review-round-1 entry. `sprint-status.yaml` 13-5 flipped `ready-for-dev → in-progress → review`.
- **Cross-story invariants verified clean:** `src/lib/sentry.ts` zero-diff (no new feature tags); `src/components/conversation/TranscriptView.tsx` zero-diff (Story 13-1 live-flow FlatList — orthogonal); `src/types/conversation.ts` zero-diff (`ConversationMessage` shape preserved); no AI / Edge Function / migration / CI workflow files modified; `package.json` + `package-lock.json` zero-diff.
- **Closes audit P2-7** architecturally. Expected impact: initial render bubbles for a 500-message conversation **500 → ~10-20 (~96% reduction)**; JS-thread stall on transcript open **~3-8s → ~150-300ms**; FPS during scroll **< 30 → ≥ 55** (sibling AC line 253 for Story 13-1 live-flow; same architectural proxy applies). Hook public API + screen public-rendering shape byte-identical to pre-13-5 — bubble UX unchanged; search-jump UX preserved via the equivalent `viewPosition: 0.1` offset.

### File List

**New files:**

- `app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts` — 12 source-drift cases via comment-stripped source + scoped FlatList element extraction.
- `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx` — 8 runtime cases via react-test-renderer + jest.useFakeTimers.

**Modified files:**

- `app/(tabs)/conversation/history.tsx` — `<ScrollView>` → `<FlatList>` refactor; `transcriptScrollRef` type updated; `messageLayoutMap` ref + onLayout callback DELETED; search-jump rewired to `scrollToIndex`; `handleScrollToIndexFailed` added with `mountedRef` guard; `Bubble` (`React.memo`-wrapped) + `EmptyTranscriptText` extracted as `@internal` exports; `renderBubble` + `historyExtraDataKey` memoized; `React` default import added (used for `React.memo`); `ScrollView` import removed.
- `CLAUDE.md` — Story 13-5 architecture paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-5 status `backlog → ready-for-dev → in-progress → review`; `last_updated` annotated.
- `_bmad-output/implementation-artifacts/13-5-history-modal-flatlist.md` — Tasks/Subtasks all checked; Dev Agent Record filled; Status: review.

**Explicitly NOT modified:**

- `src/components/conversation/TranscriptView.tsx` — Story 13-1's live-flow FlatList (orthogonal).
- `src/lib/sentry.ts` — telemetry allowlist zero-diff.
- `src/types/conversation.ts` — `ConversationMessage` shape preserved.
- `package.json` + `package-lock.json` — no new deps.
- `supabase/migrations/` — no new migrations.
- `supabase/functions/` — no Edge Function changes.
- `.github/workflows/` — no CI workflow changes.

### Senior Developer Review (AI) — Review-Round-1

**Date:** 2026-05-15
**Outcome:** APPROVE → 7 patches applied
**Review layers:** Blind Hunter (~25 findings) + Edge Case Hunter (~19 findings) + Acceptance Auditor (APPROVE, 0 blocking violations) — run in parallel.
**Triage:** 7 patches applied (HIGH × 3 + MED × 2 + LOW × 2); 10 deferred; 5+ rejected as noise / false alarms.

**Patches applied:**

- **P1 (HIGH) — Bubble React.memo defeated by `msgMatches` object identity.** Blind + Edge Case Hunters merged. Pre-patch `matchesByMessage.get(index)` returned a fresh `{matches, globalOffset}` object reference on every Map rebuild — and `matchesByMessage` rebuilds on every search keystroke (`useMemo(() => buildTranscriptMatches(...), [messages, debouncedTranscriptSearch])`). `React.memo`'s default shallow prop comparison fails on reference identity → every visible Bubble re-rendered on every character typed in the search box. The audit win's "per-row memoization" claim was partially false. Post-patch: new exported pure `bubblePropsEqual` comparator hashes `msgMatches` by content (`matches.length` + `globalOffset` + `matches[0]`/`matches[-1]` `charStart`/`charEnd` — 4 scalar comparisons) AND short-circuits `activeMatchIdx` changes that don't cross this bubble's match range via a `containsActive(idx, msgMatches)` predicate (`globalOffset ≤ idx < globalOffset + matches.length`). `React.memo(Bubble, bubblePropsEqual)` invokes the comparator. — [`history.tsx:318-379`](<app/(tabs)/conversation/history.tsx#L318-L379>).

- **P2 (HIGH) — `match.messageIndex` clamp against `messages.length - 1` + `messages.length === 0` early-return.** Edge Case Hunter. Pre-patch a fetch-race window with a stale `transcriptMatches` closure could pass an out-of-range index to `scrollToIndex` → RN's `scrollToIndex out of range` warning + the search-jump silently no-ops. Post-patch `scrollToActiveMatch` clamps via `Math.min(match.messageIndex, messages.length - 1)` (with `messages.length === 0` early-return). `messages.length` added to useCallback deps for staleness defense. — [`history.tsx:674-705`](<app/(tabs)/conversation/history.tsx#L674-L705>).

- **P3 (HIGH) — `onScrollToIndexFailed` retry budget + index clamp + Sentry breadcrumb on exhaustion.** Blind + Edge Case Hunters. Pre-patch the handler unconditionally scheduled `setTimeout(() => scrollToIndex(info.index), 100)` — if `scrollToIndex` also failed on retry (permanently-invalid index, race scenarios), RN re-fired `onScrollToIndexFailed` which scheduled another setTimeout → infinite loop. Post-patch: new exported pure `handleScrollIndexFailure(info, ctx)` helper caps retries at `maxRetries` (default 2) AND clamps the target via `Math.min(info.index, info.highestMeasuredFrameIndex)` (RN-docs recommended pattern — FlatList knows that's the largest index it has dimensions for). On exhaustion the helper fires `captureError(new Error("history scroll-to-index exhausted after N retries (target=X, measured=Y)"), "history-scroll-to-index-exhausted")` + resets the counter. `scrollToActiveMatch` resets `scrollIndexRetryCountRef.current = 0` on each fresh user-initiated scroll so a prior exhaustion doesn't poison the next attempt. — [`history.tsx:436-498`](<app/(tabs)/conversation/history.tsx#L436-L498>).

- **P4 (MED) — `setTimeout` cleanup on unmount.** Edge Case Hunter. Pre-patch the timer fired even after unmount — `mountedRef` guard bailed inside the callback, but the timer itself wasn't cleared (minor RN warning + wasted JS work). Post-patch: `scrollIndexTimeoutRef` declared as a sibling ref; cleanup `useEffect` clears it on unmount. The pure helper writes the timer id to `ctx.timeoutRef.current` so the component's cleanup-effect can access it. — [`history.tsx:487-498`](<app/(tabs)/conversation/history.tsx#L487-L498>).

- **P9 (MED) — Runtime test drives the REAL exported helper, not a replica.** Blind + Edge Case Hunters. Pre-patch Case 8 replicated the handler shape inline and asserted the replica behaves correctly — production drift could pass vacuously (regression deleting the `mountedRef` guard or the setTimeout would still pass). Post-patch `handleScrollIndexFailure` is exported (with a context-injection interface `ScrollIndexFailureContext { scrollToOffset, scrollToIndex, retryCountRef, mountedRef, timeoutRef, maxRetries?, delayMs? }`) and the runtime test exercises the REAL helper in 3 cases: Case 8 drives index 42 with `highestMeasuredFrameIndex` 10 → clamps to 10 + scrollToOffset(0) sync + scrollToIndex({index: 10, viewPosition: 0.1}) after timer; Case 9 verifies the mountedRef guard prevents post-unmount setState; Case 10 verifies the retry-budget exhaustion contract (3 consecutive failures → 2 retries fire + 3rd hits exhaustion + Sentry breadcrumb with `history-scroll-to-index-exhausted` tag + retryCountRef resets to 0 + scrollToOffset called 2× not 3×). — [`history-flatlist-virtualization.test.tsx:Cases 8-10`](<app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx>).

- **L1 (LOW) — Redundant `mountedRef.current = true` in effect body GONE.** Blind Hunter. `useRef(true)` already initializes the ref at hook creation. The in-effect re-assignment was redundant + a dev-only StrictMode-cleanup-then-remount window incorrectly toggled the ref false→true between the two mount cycles → a pending setTimeout scheduled in that window would silently no-op despite the component being remounted. Post-patch the effect body ONLY tracks cleanup. — [`history.tsx:496-505`](<app/(tabs)/conversation/history.tsx#L496-L505>).

- **L2 (LOW) — `Bubble.displayName = "Bubble"`.** Blind Hunter. `React.memo(function Bubble(...))` gives the inner function `name = "Bubble"`, but `Bubble.displayName` is undefined; React DevTools and crash stacks show `Memo(Bubble)` at best, often `Anonymous`. Post-patch explicit displayName set. — [`history.tsx:430-432`](<app/(tabs)/conversation/history.tsx#L430-L432>).

**Deferred (10):** getItemLayout absent (architectural improvement worth a future story; would eliminate the fallback path on the common case) / renderBubble uses `index` not `msg.id` (no current breaking scenario; pre-13-5 contract) / scrollToOffset(0) jarring UX (deferred until usability feedback) / Reanimated mock incomplete (defensive coverage; no current failure mode) / Case 3 regex doesn't match elements-with-children (cosmetic; current FlatList is self-closing) / Case 7 runtime tautology (documents formula intent; vacuous but useful as a regression guard for the template literal shape) / Magic numbers 20/10/10 unmotivated (docs gap, not a bug) / Bubble + EmptyTranscriptText accessibility (pre-13-5 contract; not a regression) / openTranscript / closeTranscript stale-data races (pre-13-5 inherited) / activeMatchIdx reset effect ordering (pre-13-5 inherited).

**Rejected as noise (5+):** BH-14 `historyExtraDataKey` missing conversation-id axis (false alarm — when conversation swaps, `messages` reference changes → `data` prop changes → FlatList re-builds; new `msg.id` keys cause unmount+remount; the "stale-content briefly" scenario doesn't manifest) / BH-24 off-screen ref callers (no other `transcriptScrollRef` consumers in the file) / BH-9 `@internal` not enforced (project lacks api-extractor infra; documentation convention only) / BH-20 `React` namespace import style (project style varies) / Acceptance Auditor's 2 LOW-INFO items + multiple cosmetic items.

**Tests after round-1:** 1814 / 1814 passing (+12 net 1802 → 1814; +32 net since story start vs 1782 baseline; **exceeds spec target +13 by 19**). All 4 quality gates green (type-check 0 errors / lint 0 warnings / prettier clean / jest 90 suites).

**Files modified in round-1:**

- `app/(tabs)/conversation/history.tsx` — P1 `bubblePropsEqual` exported pure comparator + `React.memo(Bubble, bubblePropsEqual)` + L2 `Bubble.displayName` + P2 clamp in `scrollToActiveMatch` + P3 + P4 + P9 `handleScrollIndexFailure` exported pure helper + `handleScrollToIndexFailed` delegates to it + `scrollIndexTimeoutRef` + `scrollIndexRetryCountRef` declared + cleanup effect clears the timeout + L1 redundant `mountedRef.current = true` removed.
- `app/(tabs)/conversation/__tests__/history-flatlist-source-drift.test.ts` — Case 4 strengthened with P2 clamp + P3 retry-reset pins; Case 5 updated for the delegation contract + helper-exists pin; NEW Cases 13 (P1 bubblePropsEqual existence + content-hash + activeMatchIdx short-circuit), 14 (P3 retry budget + clamp + Sentry tag), 15 (P4 scrollIndexTimeoutRef + cleanup), 16 (L1 NEGATIVE no `mountedRef.current = true` outside ref), 17 (L2 displayName).
- `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx` — Imports `bubblePropsEqual` + `handleScrollIndexFailure`; Case 8 REPLACED with REAL-helper test driving the exported pure helper; NEW Cases 9 (mountedRef guard via real helper), 10 (retry-budget exhaustion + Sentry breadcrumb), 11 (P1 content-equal refs → skip), 12 (content-differs → re-render — 3 scenarios), 13 (activeMatchIdx short-circuit + cross-bubble re-render), 14 (msg identity differs), 15 (undefined-msgMatches asymmetry).
- `CLAUDE.md` — Story 13-5 review-round-1 paragraph appended.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 13-5 round-1 annotation.
- `_bmad-output/implementation-artifacts/13-5-history-modal-flatlist.md` — this Senior Developer Review section.
