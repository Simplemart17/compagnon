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

**Why these:** the project's `shippable-roadmap.md` Epic 13 line 244 reads "Smooth voice conversations on 3-year-old phones." iPhone 11 is the slowest iPhone Apple still ships iOS updates to in 2026; Pixel 4a is its Android counterpart.

---

## 3. Tools

The project runs **React Native 0.83.2**; Meta retired Flipper as the default RN debugger starting RN 0.74 (mid-2024). Use the modern toolchain documented below.

**Required:**

- **React Native DevTools** (built-in to RN 0.74+; opens via Dev Menu) — for the JS-side Perf Monitor overlay + React Profiler. The Perf Monitor overlay (Cmd-D on iOS simulator / Cmd-M on Android emulator → "Show Perf Monitor") shows JS FPS + native FPS in a corner overlay.
- **Xcode Instruments** (Time Profiler + Core Animation FPS Gauge templates) — for native-side iPhone 11 perf. Tethered device → Xcode → Product → Profile (Cmd-I) → choose a template.
- **Android Studio Profiler** (CPU + Frames panels) — for native-side Pixel 4a perf. Tethered device → Android Studio → Profile → CPU panel, switch to Frames view.
- **`performance.now()` instrumentation** in the running app — for sub-second wall-clock measurements (AC #2 + AC #3 thresholds are 1.5s + 8s; human-eye stopwatch reaction floor is ~150-250ms which is ~10-15% noise on the AC #2 threshold). The app already ships Sentry breadcrumb infrastructure (Story 9-3 contract); use it to log timing markers — see § 4.2 below.
- **Network throttling** — see § 5 for the per-OS 4G recipe (NOT Chrome DevTools — that only throttles WebViews, not RN's main bundle).

**Setup:**

1. Build the app in **production mode** (`eas build --profile production` or `npx expo run:ios --configuration Release` for local iOS / `npx expo run:android --variant release` for local Android). DO NOT measure dev builds — Metro bundler + dev-only checks make perf numbers meaningless.
2. Connect the device via USB / wireless debugging.
3. Open the appropriate native profiler (Xcode Instruments for iOS / Android Studio Profiler for Android) and attach to the running app process.

---

## 4. AC #1 — Voice conversation FPS

### 4.1 Procedure

1. Launch the app on iPhone 11 (or fallback). Sign in to an account with prior conversation history.
2. Navigate to a conversation. Start a new Realtime session.
3. **iOS:** open Xcode Instruments → Core Animation FPS Gauge template, attach to the running app. **Android:** open Android Studio Profiler → CPU panel → switch to Frames view. Both also expose React Native DevTools' Perf Monitor overlay via Dev Menu → "Show Perf Monitor" (Cmd-D / Cmd-M) for a quick visual sanity check.
4. **Hold a 30-turn conversation** (i.e., ~15 round-trips of speak-then-listen).
5. Record the FPS values throughout the session via the instrument's recording session. Export the trace. Capture:
   - **Average FPS** across all 30 turns.
   - **Minimum FPS** (worst frame in the session).
   - **% of frames < 55 FPS** (the AC threshold).
6. **Hot path to watch:** during AI speech streaming (when `pendingAiText` is updating via the rAF-coalesced setState from Story 13-1) AND during barge-in transitions (Story 11-2). These are the algorithmic hot paths Epic 13 targeted.

### 4.2 Pass criteria (AC #1)

- Average FPS ≥ 55 across all 30 turns: ✅ PASS.
- Minimum FPS ≥ 50 (allow brief dips for navigation / network reconnect): ✅ PASS.
- < 5% of frames below 55 FPS: ✅ PASS.

### 4.3 Fail action

- If average FPS < 55: profile with Xcode Instruments Time Profiler (or Android Studio Profiler CPU panel) to identify the dominant cost (style merge / setState frequency / native bridge calls).
- File a follow-up story (e.g., `14-X-conversation-fps-regression`) with the trace evidence.
- DO NOT ship to TestFlight until the AC is met empirically.

**Run on:** both iPhone 11 + Pixel 4a. Record per-device results.

---

## 5. AC #2 — Home cold-cache first-paint on 4G

### 5.1 Network throttling — per-OS recipe

**iOS (requires Mac + tethered iPhone):**

1. Install Xcode Additional Tools (`Xcode → Open Developer Tool → More Developer Tools…` → download "Additional Tools for Xcode"). The download contains `Network Link Conditioner.prefPane`.
2. Install the pane: double-click the `.prefPane` file → "Install for all users".
3. Tether the iPhone to the Mac.
4. On iPhone: `Settings → Developer → Network Link Conditioner → Set Active`, choose **"3G"** preset for a conservative 4G floor (the iOS NLC presets predate 4G profiles; "3G" approximates real 4G LTE on a congested cell; for a stricter test choose "Edge" for sub-1Mbps).
5. Verify throttling is active: in Safari on the iPhone, load a moderately heavy page and observe slowness.

**Android (works with emulator OR tethered device):**

1. **Preferred — emulator:** Android Studio AVD Manager → Advanced settings → Network Speed → **"LTE"** + Network Latency → **"middling"**. This throttles at the emulator network layer, including the RN bundle traffic.
2. **Hardware device:** use a hardware router with QoS rules OR `adb shell tc qdisc add dev wlan0 root netem rate 4000kbit delay 100ms` (requires root on the device). Note that `tc` requires root which most Pixel 4a units don't have; the emulator path is recommended.

**Why Chrome DevTools is NOT used:** Chrome DevTools Network throttling only affects WebViews — it does NOT throttle the RN main bundle's `fetch` calls. Using it would produce false-passes.

### 5.2 Procedure

1. Force-quit the app on the device. Clear the AsyncStorage cache (sign out + sign back in, OR use `Clear Cache` if exposed).
2. Throttle the network to the 4G profile (§ 5.1 above).
3. **Instrument the home screen** for sub-second wall-clock measurement. Add this temporary instrumentation to `app/(tabs)/home/index.tsx` BEFORE running the test (revert before merge):

   ```typescript
   // TEMPORARY perf instrumentation for AC #2 verification — REVERT before merge
   import { addBreadcrumb } from "@/src/lib/sentry";
   useEffect(() => {
     const mountTime = performance.now();
     addBreadcrumb({
       category: "perf",
       level: "info",
       message: "home-mount-start",
       data: { feature: "home-first-paint", t: mountTime },
     });
     // Re-add another addBreadcrumb at the moment the home screen has rendered
     // user data (when `progress.isLoading === false && progress.skills.length > 0`)
     // in a separate useEffect — capture the delta as `home-first-paint-complete`.
   }, []);
   ```

4. Cold-launch the app.
5. Sign in (if not already signed in — but for AC #2 the user IS signed in; this is "open app, see home screen" timing).
6. Trigger the cold-launch sequence by force-quitting + re-opening.
7. Read the Sentry breadcrumb timeline (Sentry dashboard → recent events → breadcrumb tab) and compute `t_complete - t_start`.

### 5.3 Pass criteria (AC #2)

- First-paint with data ≤ 1.5s on 4G: ✅ PASS.
- First-paint with data ≤ 2.0s acceptable on Pixel 4a (slower-class device): ⚠️ MARGINAL.

### 5.4 Fail action

- If > 1.5s: profile the network waterfall (Android Studio Network Inspector for Android; Xcode Instruments Network template for iOS) to identify the slow request.
- Verify Story 13-2's `get_home_aggregate` RPC is being hit (should be ONE Supabase RPC, not multiple `from(...)` queries).
- File a follow-up story if the regression is structural.

**Run on:** both devices. Record per-device results.

---

## 6. AC #3 — Mock test playable within 8s of tap

### 6.1 Procedure

1. Throttle network to 4G as above (§ 5.1).
2. **Instrument the mock-test screen** for sub-second wall-clock measurement. Add to `app/(tabs)/mock-test/[testId].tsx` BEFORE running the test (revert before merge):

   ```typescript
   // TEMPORARY perf instrumentation for AC #3 verification — REVERT before merge
   // Capture `mock-test-tap-start` on tap of "Start mock test"
   // Capture `mock-test-first-question-tappable` when state.status === "active"
   //   AND state.questions[0] is non-null.
   // Use addBreadcrumb with category "perf" + feature "mock-test-tap-to-playable".
   ```

3. Navigate to the Mock Test tab.
4. Tap "Start mock test" — capture `mock-test-tap-start` breadcrumb.
5. Wait for the first question to become interactive — capture `mock-test-first-question-tappable` breadcrumb.
6. Read the breadcrumb timeline + compute the delta.
7. Note whether section 2 is still loading at this point (it should be — that's Story 13-4's parallel-generation pattern; section 2 finishes during section 1 play).

### 6.2 Pass criteria (AC #3)

- First-question-tappable ≤ 8s on 4G: ✅ PASS.
- Section 2 finishes loading before user finishes section 1 (verify by reaching end of section 1 and observing zero wait): ✅ PASS.

### 6.3 Fail action

- If > 8s: profile the AI generation step (`chatCompletionJSON` call timing). May indicate OpenAI Realtime model latency rather than the app's parallel-fire pattern.
- Verify Story 13-4's `useMockTestGeneration` hook is firing both sections in parallel (check Sentry breadcrumbs for `mock-test-generate-${section}` interleaved across both sections — for TCF Canada 2026 the section names are `listening` + `reading`; if Story 17.X restores a third section, this verification step's section name list expands accordingly).

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
