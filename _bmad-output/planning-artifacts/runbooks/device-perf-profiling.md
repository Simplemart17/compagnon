# Device Perf Profiling Runbook

**Status:** prep-only (no measurements run yet)
**Filed:** 2026-05-15 via Epic 13 retrospective Action Item #3
**Owner:** `performance-engineer`
**Priority:** **HIGH** — Epic 16 blocker (app-store submission)
**Last measurements:** none

---

## 1. Why this runbook exists

Epic 13 (Performance Hot Paths) shipped 8 stories that closed audit P2-3 / P2-4 / P2-5 / P2-6 / P2-7 architecturally. The 3 Epic 13 acceptance criteria are stated in the roadmap as **device-empirical** measurements:

| Roadmap AC | Stated as | Verified architecturally? | Verified on device? |
| --- | --- | --- | --- |
| AC #1 | Voice conversation ≥ **55 FPS on iPhone 11** for 30 turns (Reactotron / Flipper trace) | ✅ via Story 13-1 transcript render-storm fix + Story 13-7 className/style hot-row refactor | ❌ |
| AC #2 | Home cold-cache first-paint **≤ 1.5s on 4G simulation** | ✅ via Story 13-2 home aggregate RPC (Supabase round-trips 11 → 2) | ❌ |
| AC #3 | Mock test feels playable (first section rendered) **within 8s of tap** | ✅ via Story 13-4 streaming mock-test generation (parallel `Promise.allSettled` per section) | ❌ |

**The Epic 13 retro flagged this** — "architectural proxy" is not the same as "device verified". Before Epic 16 (app-store submission) ships to TestFlight / Internal Track, the 3 ACs MUST be re-verified on actual devices + actual network conditions.

This runbook is the recipe for that verification.

---

## 2. Devices

**Two-device matrix** (covers iOS + Android low-end baselines for the project's 3-year-old phone target):

- **iPhone 11** (2019, A13 Bionic, 4 GB RAM) — iOS target.
  - If unavailable, fall back to **iPhone XR** (2018, A12 Bionic, 3 GB RAM) — same perf envelope.
- **Pixel 4a** (2020, Snapdragon 730G, 6 GB RAM) — Android target.
  - If unavailable, fall back to **Pixel 3a** (2019, Snapdragon 670, 4 GB RAM).

**Why these:** the project's `shippable-roadmap.md` Epic 13 line 245 reads "Smooth voice conversations on 3-year-old phones." iPhone 11 is the slowest iPhone Apple still ships iOS updates to in 2026; Pixel 4a is its Android counterpart.

---

## 3. Tools

**Required:**

- **React Native Performance Monitor** (Reactotron OR Flipper) — for the FPS overlay during conversation.
- **Chrome DevTools / Safari Web Inspector** — for network throttling (4G profile).
- **Stopwatch** — wall-clock measurements for first-paint + mock-test-playable.

**Setup:**

1. Build the app in **production mode** (`eas build --profile production` or the equivalent local production build). DO NOT measure dev builds — Metro bundler + dev-only checks make perf numbers meaningless.
2. Connect the device via USB / wireless debugging.
3. Open Reactotron OR Flipper and connect to the running app.
4. Throttle the network at the OS level OR via DevTools.

---

## 4. AC #1 — Voice conversation FPS

**Procedure:**

1. Launch the app on iPhone 11 (or fallback). Sign in to an account with prior conversation history.
2. Navigate to a conversation. Start a new Realtime session.
3. Open the Reactotron / Flipper FPS overlay.
4. **Hold a 30-turn conversation** (i.e., ~15 round-trips of speak-then-listen).
5. Record the FPS values throughout the session. Capture:
   - **Average FPS** across all 30 turns.
   - **Minimum FPS** (worst frame in the session).
   - **% of frames < 55 FPS** (the AC threshold).
6. **Hot path to watch:** during AI speech streaming (when `pendingAiText` is updating via the rAF-coalesced setState from Story 13-1) AND during barge-in transitions (Story 11-2). These are the algorithmic hot paths Epic 13 targeted.

**Pass criteria (AC #1):**

- Average FPS ≥ 55 across all 30 turns: ✅ PASS.
- Minimum FPS ≥ 50 (allow brief dips for navigation / network reconnect): ✅ PASS.
- < 5% of frames below 55 FPS: ✅ PASS.

**Fail action:**

- If average FPS < 55: profile with Flipper to identify the dominant cost (style merge / setState frequency / native bridge calls).
- File a follow-up story (e.g., `14-X-conversation-fps-regression`) with the trace evidence.
- DO NOT ship to TestFlight until the AC is met empirically.

**Run on:** both iPhone 11 + Pixel 4a. Record per-device results.

---

## 5. AC #2 — Home cold-cache first-paint on 4G

**Procedure:**

1. Force-quit the app on the device. Clear the AsyncStorage cache (sign out + sign back in, OR use `Clear Cache` if exposed).
2. Throttle the network to **4G profile**:
   - iOS: Settings → Developer → Network Link Conditioner → "4G" preset.
   - Android: Chrome DevTools → Network → "Fast 4G" preset (via remote debugging).
3. Cold-launch the app.
4. Sign in (if not already signed in — but for AC #2 the user IS signed in; this is "open app, see home screen" timing).
5. **Start the stopwatch when the home tab first becomes visible.**
6. **Stop the stopwatch when the home screen renders the user's actual data** (the streak number, the SkillCards with real progress, the today's plan items — NOT the skeleton states).

**Pass criteria (AC #2):**

- First-paint with data ≤ 1.5s on 4G: ✅ PASS.
- First-paint with data ≤ 2.0s acceptable on Pixel 4a (slower-class device): ⚠️ MARGINAL.

**Fail action:**

- If > 1.5s: profile the network waterfall (Chrome DevTools Network tab on remote-debugged Android) to identify the slow request.
- Verify Story 13-2's `get_home_aggregate` RPC is being hit (should be ONE Supabase RPC, not multiple `from(...)` queries).
- File a follow-up story if the regression is structural.

**Run on:** both devices. Record per-device results.

---

## 6. AC #3 — Mock test playable within 8s of tap

**Procedure:**

1. Throttle network to 4G as above.
2. Navigate to the Mock Test tab.
3. **Start the stopwatch on tap of "Start mock test".**
4. **Stop the stopwatch when the FIRST question is tappable** (i.e., the user can answer it — not just visible, but interactive).
5. Note whether section 2 is still loading at this point (it should be — that's Story 13-4's parallel-generation pattern; section 2 finishes during section 1 play).

**Pass criteria (AC #3):**

- First-question-tappable ≤ 8s on 4G: ✅ PASS.
- Section 2 finishes loading before user finishes section 1 (verify by reaching end of section 1 and observing zero wait): ✅ PASS.

**Fail action:**

- If > 8s: profile the AI generation step (`chatCompletionJSON` call timing). May indicate OpenAI Realtime model latency rather than the app's parallel-fire pattern.
- Verify Story 13-4's `useMockTestGeneration` hook is firing both sections in parallel (check Sentry breadcrumbs for `mock-test-generate-listening` AND `mock-test-generate-reading` interleaved).

---

## 7. Reporting template

After running the matrix, document results in `docs/perf-baseline-YYYY-MM-DD.md`:

```markdown
# Device perf baseline — YYYY-MM-DD

**Measured by:** [name]
**App version:** [git SHA + version]
**Build profile:** production

## Devices

- iPhone 11 (iOS 17.x)
- Pixel 4a (Android 14, build XXX)

## Results

| AC | Target | iPhone 11 | Pixel 4a | Pass? |
| --- | --- | --- | --- | --- |
| #1 Voice FPS (30 turns) | ≥ 55 FPS avg | XX | XX | ✅/❌ |
| #2 Home first-paint 4G | ≤ 1.5s | X.Xs | X.Xs | ✅/❌ |
| #3 Mock test tap-to-playable | ≤ 8s | X.Xs | X.Xs | ✅/❌ |

## Notes

- [Anything that surprised the operator]
- [Sentry breadcrumb references that helped diagnose]
- [Follow-up story files if any AC failed]
```

Commit this file to the repo as a versioned baseline. Re-run quarterly OR before each app-store submission.

---

## 8. Cross-reference

This runbook is referenced from CLAUDE.md's **Numerical Claims Index** (Epic 13 retro AI #2). Several CLAUDE.md per-story numerical claims (Story 13-1 FPS / Story 13-2 first-paint / Story 13-4 first-section / Story 13-7 cascade FPS) are tagged "estimate-only" pending this runbook's first execution.

Once the first measurement run completes, **update the Numerical Claims Index in CLAUDE.md** to flip each row from ⏳ "estimate-only / Action Item #3" to either ✅ "Device-verified YYYY-MM-DD" or ❌ "Failed — see follow-up story" with a link to `docs/perf-baseline-YYYY-MM-DD.md`.

---

## 9. Schedule

- **First run:** before Epic 16 (app-store submission) kickoff. File this as the Epic 16 prerequisite gate.
- **Subsequent runs:** quarterly + before each major release. Run after every Epic that touches conversation / home / mock-test surfaces.
