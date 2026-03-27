import React, { createContext, useCallback, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

export interface ShowToastParams {
  type: ToastType;
  message: string;
  action?: ToastAction;
}

export interface ToastContextValue {
  showToast: (params: ShowToastParams) => void;
  current: ToastItem | null;
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const GAP_MS = 300;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastItem | null>(null);
  const currentRef = useRef<ToastItem | null>(null);
  const queueRef = useRef<ToastItem[]>([]);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNext = useCallback(() => {
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      currentRef.current = next;
      setCurrent(next);
    } else {
      currentRef.current = null;
      setCurrent(null);
    }
  }, []);

  const dismiss = useCallback(() => {
    currentRef.current = null;
    setCurrent(null);
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = setTimeout(showNext, GAP_MS);
  }, [showNext]);

  const showToast = useCallback((params: ShowToastParams) => {
    const item: ToastItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...params,
    };

    if (currentRef.current === null && queueRef.current.length === 0) {
      currentRef.current = item;
      setCurrent(item);
    } else {
      queueRef.current.push(item);
    }
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, current, dismiss }),
    [showToast, current, dismiss]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
