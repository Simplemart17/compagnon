/**
 * Avatar state derivation — Story 18-4 (Avatar v1).
 *
 * Pure mapper from the orchestrator's ConversationState to the companion
 * avatar's expression state. Extracted from the pre-18-4 inline `orbState`
 * IIFE in `[sessionId].tsx` so the priority order is unit-testable and the
 * renderer (code-drawn today; Rive-swappable later — see the D-V1 amendment
 * in v2-vision-roadmap.md) consumes ONE typed union.
 *
 * Priority order (first match wins — preserved from the AIOrb derivation):
 *   1. connecting  — connection setup / Story 11-2 reconnect window
 *   2. speaking    — AI audio is playing (the most user-visible AI moment)
 *   3. listening   — user is speaking (mic VAD)
 *   4. thinking    — AI request in flight, no audio yet
 *   5. idle        — everything else (connected-and-waiting, ended, error…)
 *
 * `celebrating` is a member of the AvatarState union but is NOT derived
 * here — it is a surface-level literal (the end-sheet milestone card mounts
 * `<CompanionAvatar state="celebrating">` directly). Review R1 removed the
 * speculative `opts.celebrating` parameter (production-dead; only its own
 * test called it) — re-add it when Story 18.6 gives the mapper a real
 * celebrating caller.
 */

import type { ConversationState } from "@/src/lib/realtime-orchestrator";

export type AvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "celebrating";

export type AvatarStateInput = Pick<
  ConversationState,
  "status" | "isSpeaking" | "isAiSpeaking" | "isProcessing"
>;

export function deriveAvatarState(conversation: AvatarStateInput): AvatarState {
  if (conversation.status === "connecting" || conversation.status === "reconnecting") {
    return "connecting";
  }
  if (conversation.isAiSpeaking) return "speaking";
  if (conversation.isSpeaking) return "listening";
  if (conversation.isProcessing) return "thinking";
  return "idle";
}
