/**
 * Session goal derivation — Story 18-6 (conversation screen redesign).
 *
 * The Talk screen shows a compact goal chip so every session answers "what
 * am I practicing right now?" — the roadmap's curriculum tie-in point.
 * v1 derives the goal from mode + topic; Epic 19's lesson engine will feed
 * a lesson-scenario goal through `SessionGoalChip`'s `goalOverride` prop
 * (this helper is the fallback, not the future lesson path).
 *
 * Chrome rule (Story 14-1): the goal TEXT is EN chrome; the topic is FR
 * learning content and passes through verbatim.
 */

import type { ConversationMode } from "@/src/types/conversation";

export function deriveSessionGoal(mode: ConversationMode, topic: string): string {
  const trimmedTopic = typeof topic === "string" ? topic.trim() : "";
  switch (mode) {
    case "debate":
      return trimmedTopic.length > 0
        ? `Defend your position — ${trimmedTopic}`
        : "Defend your position";
    case "tcf_simulation":
      // The exam simulation's goal is format practice, not the topic.
      return "Exam practice — Expression Orale";
    case "companion":
      return trimmedTopic.length > 0
        ? `Keep the conversation going — ${trimmedTopic}`
        : "Keep the conversation going";
    default: {
      // Review R1: compile-time exhaustiveness (auth-events.ts precedent) —
      // a future 4th ConversationMode (e.g. Epic 19's lesson mode) must
      // deliberately choose its goal text instead of silently inheriting
      // the companion framing.
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
