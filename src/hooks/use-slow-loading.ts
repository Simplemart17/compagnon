/**
 * Hook that returns true after a delay, for showing "Taking longer than usual..." messages.
 *
 * Resets when isLoading transitions to false.
 */

import { useEffect, useRef, useState } from "react";

/**
 * @param isLoading — whether the loading state is active
 * @param delayMs — how long to wait before flagging as slow (default 8000ms)
 */
export function useSlowLoading(isLoading: boolean, delayMs = 8000): boolean {
  const [isSlow, setIsSlow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      timerRef.current = setTimeout(() => setIsSlow(true), delayMs);
    } else {
      setIsSlow(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isLoading, delayMs]);

  return isSlow;
}
