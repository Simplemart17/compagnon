import { useContext } from "react";

import { ToastContext } from "@/src/components/common/Toast/ToastContext";
import type { ToastContextValue } from "@/src/components/common/Toast/ToastContext";

/**
 * Ergonomic access to the toast notification system.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast({ type: "success", message: "Saved!" });
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
