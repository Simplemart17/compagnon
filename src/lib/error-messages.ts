/**
 * Shared error classification utility.
 *
 * Converts raw errors into user-friendly messages by category
 * (network, timeout, permission, or generic fallback).
 */

type ErrorCategory = "network" | "timeout" | "permission" | "generic";

interface ClassifiedError {
  category: ErrorCategory;
  message: string;
}

const NETWORK_KEYWORDS = ["network", "offline", "fetch", "dns", "econnrefused"];
const TIMEOUT_KEYWORDS = ["timed out", "timeout", "aborted"];
const PERMISSION_KEYWORDS = ["permission", "microphone", "denied"];

/**
 * Classify an error and return a user-friendly message.
 *
 * @param err - The caught error value
 * @param fallbackMessage - Fallback message if the error doesn't match a known category
 */
export function classifyError(err: unknown, fallbackMessage: string): ClassifiedError {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (NETWORK_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      category: "network",
      message: "No internet connection. Please check your network and try again.",
    };
  }

  if (TIMEOUT_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      category: "timeout",
      message: "The request timed out. Please try again.",
    };
  }

  if (PERMISSION_KEYWORDS.some((kw) => lower.includes(kw))) {
    return {
      category: "permission",
      message: "Microphone access is required. Please enable it in your device settings.",
    };
  }

  return { category: "generic", message: fallbackMessage };
}
