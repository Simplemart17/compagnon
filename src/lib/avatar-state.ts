/**
 * Avatar state derivation — Story 18-4 (Avatar v1).
 *
 * Pure mapper from the orchestrator's ConversationState to the companion
 * avatar's expression state. Extracted from the pre-18-4 inline `orbState`
 * IIFE in `[sessionId].tsx` so the priority order is unit-testable and the
 * renderer (code-drawn today; Rive-swappable later — see the D-V1 amendment
 * in v2-vision-roadmap.md) consumes ONE typed union.
 *
 * Priority order (first match wins — preserved from the AIOrb derivation,
 * with `celebrating` layered on top):
 *   1. celebrating — explicit caller signal (milestone on the end sheet)
 *   2. connecting  — connection setup / Story 11-2 reconnect window
 *   3. speaking    — AI audio is playing (the most user-visible AI moment)
 *   4. listening   — user is speaking (mic VAD)
 *   5. thinking    — AI request in flight, no audio yet
 *   6. idle        — everything else (connected-and-waiting, ended, error…)
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

export function deriveAvatarState(
  conversation: AvatarStateInput,
  opts?: { celebrating?: boolean }
): AvatarState {
  if (opts?.celebrating === true) return "celebrating";
  if (conversation.status === "connecting" || conversation.status === "reconnecting") {
    return "connecting";
  }
  if (conversation.isAiSpeaking) return "speaking";
  if (conversation.isSpeaking) return "listening";
  if (conversation.isProcessing) return "thinking";
  return "idle";
}
