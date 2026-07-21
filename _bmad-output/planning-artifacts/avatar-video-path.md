# Avatar — Realistic Video Talking-Head Path (PARKED)

**Status:** Parked 2026-07-21. Decision: pursue the OTA-safe stylized-character
alternative first (see "The alternative we chose to explore" below). This doc
preserves the video-path research so we can resume cold if the character route
doesn't clear the "feels like a real buddy" bar or if a paid tier later
justifies the infrastructure.

**Origin:** operator ask — "Using human-like AI will be more realistic and feel
like interacting with a real buddy." After cost analysis the operator chose
**self-hosted + Docker**. This is the researched plan for that route.

---

## Why it's parked, not cancelled

The realistic talking-head is real and buildable, but it changes the app's
economics and shipping model in three ways that don't fit a dogfood-stage,
zero-marginal-cost product yet:

1. **Cost flips from marginal to fixed.** Today ≈5¢/session (gpt-realtime-mini),
   scales to zero when idle, the Story 11-4 `$1/user/day` cap works, thousands
   of users cost proportionally. A self-hosted GPU costs money 24/7 whether 1 or
   100 people use it (cloud L4/A10 ≈ $250–500/mo, V100 ≈ $360–900/mo; a local
   4090 is ~free but only reachable while that box is on).
2. **Latency stacks.** Audio-only is sub-second now. Video adds an inference hop
   + WebRTC encode/decode + a new hard failure surface (GPU down → no avatar).
3. **Breaks OTA + needs a native build.** `react-native-webrtc` is a native
   module, so every avatar-touching change becomes a full EAS/TestFlight build,
   not an OTA push — the exact agility the current architecture optimizes for.

---

## Research findings (mid-2026)

### Lip-sync model
- **MuseTalk** (Tencent Music) — the leading real-time self-hostable option.
  MIT-licensed, **commercial use OK**; ~**30fps @ 256×256 on a single V100**;
  "negligible starting latency" via single-step latent-space inpainting.
  - Repo: https://github.com/TMElyralab/MuseTalk
  - Docker fork with a clean HTTP interface: https://github.com/ruxir-ig/MuseTalk-API
  - **License caveat:** MuseTalk's own weights are commercial-OK, but its
    dependency models (Whisper, the VAE, DWPose, and especially the **S3FD**
    face detector) each carry their own licenses — clear every one before
    shipping to real users. The bundled test data is research-only (irrelevant
    to us; we supply our own portrait).
- Newer entrants to re-check at resume: **Live Avatar** (ECCV 2026, needs ~80GB
  VRAM — too heavy), **Linly-Talker-Stream** (Feb 2026, WebRTC full-duplex),
  **LivePortrait** (Kuaishou). MuseTalk remains the best size/latency/license
  balance as of this writing.

### The pipeline is trodden, not novel research
Reference implementations already wire "OpenAI Realtime audio → MuseTalk →
WebRTC to client":
- https://github.com/PunithVT/ai-avatar-system (Realtime-style loop + MuseTalk
  persistent worker + WebRTC + barge-in interruption)
- https://github.com/datascale-ai/opentalking (STT→LLM→TTS→avatar→WebRTC)
- https://github.com/Kedreamix/Linly-Talker
- Tutorial: navtalk.ai "OpenAI Realtime API + MuseTalk"

### Client integration (the OTA-breaking part)
- `react-native-webrtc` + `@config-plugins/react-native-webrtc` + `expo-dev-client`.
- Requires `expo prebuild` + a **custom dev client / new EAS build**. NOT Expo
  Go, NOT OTA-updatable.
  - Handbook: https://react-native-webrtc.github.io/handbook/guides/extra-steps/expo.html
  - Config plugin: https://www.npmjs.com/package/@config-plugins/react-native-webrtc
- Historical caveat: an `event-target-shim` v5-vs-v6 version conflict has bitten
  some SDK versions — verify against Expo SDK 55 at build time.

---

## Target architecture

The load-bearing insight that makes this tractable: **the app already taps the
AI's output audio PCM** to drive the avatar mouth amplitude (Story 18-4,
`onAudioAmplitude` / `pcm16Base64Level` in the orchestrator + `AmplitudeEnvelopePacer`).
That same stream is exactly what MuseTalk needs as its lip-sync driver — so we
**fork the existing audio**, we don't re-architect the pipeline.

```
Phone (RN + react-native-webrtc, behind a feature flag)
   │  mic audio (existing WS path unchanged)
   ▼
OpenAI Realtime API ── AI output audio (PCM deltas) ──┐
   │  (existing: prompt, VAD, corrections, transcript)│
   ▼                                                  ▼
Docker avatar server (GPU)
   ├─ receives the same AI-output PCM we already decode for the mouth
   ├─ MuseTalk lip-syncs a chosen portrait to that audio → video frames
   └─ WebRTC video+audio track ──► phone renders the talking head
```

Feature-flag it with the Story 21-3 system (`ai-conversations-enabled`
precedent). Keep the code-drawn / stylized `CompanionAvatar` as the flag-off
fallback so the 5¢ path always survives (offline, GPU-down, unsupported region).

---

## Phased plan (spike-gated)

- **Phase 0 — throwaway spike, server-only, NO app changes.** MuseTalk in Docker
  on a GPU, fed our real OpenAI Realtime audio, rendered to a **browser** test
  page. Measure the three go/no-go numbers: (a) real end-to-end conversational
  latency with our audio, (b) lip-sync quality on the chosen portrait at 256×256
  — buddy vs uncanny valley, (c) GPU cost per concurrent session. Zero app risk,
  fully reversible. **This is the gate.**
- **Phase 1 — only if the spike passes.** Add `react-native-webrtc` + a new
  dev-client build; render the server's WebRTC video track on the conversation
  screen behind the feature flag; code-drawn avatar stays as flag-off fallback.
- **Phase 2 — harden.** Auth on the GPU endpoint, scaling posture (always-on
  cost vs scale-to-zero-with-warmup cold start), portrait pipeline, per-model
  license sign-off, production hosting decision.

### Inputs needed to start Phase 0
1. **GPU host** — local NVIDIA card (which one?) reachable for dev, or a rented
   hourly cloud GPU (~$0.50–1/hr).
2. **The face** — one portrait image (or short base clip) that is ours to use
   commercially (AI-generated, stock-licensed, or custom).
3. **Intent** — dogfood-only on a local GPU (cheapest), or a path toward real
   users (ongoing GPU cost or cold-start tradeoffs).

---

## The alternative we chose to explore instead

A **higher-fidelity stylized character** (richer in-repo SVG/Canvas, or a Rive
character) driven by the SAME state + amplitude inputs the app already produces:
**zero marginal cost, zero added latency, full OTA** (the Canvas/SVG route needs
no native module; Rive needs one native build then OTA-updatable art). Warmth in
a companion comes from character design + motion quality + personality, not
photorealism — the Duolingo/Finch/Headspace lesson. This is being prototyped for
a "does it feel like a buddy?" gut-check before any RN implementation.

**Revisit-the-video-path triggers:** the character route fails the buddy bar;
OR a paid tier lands that can absorb GPU cost; OR real users explicitly ask for
a photoreal human face.
