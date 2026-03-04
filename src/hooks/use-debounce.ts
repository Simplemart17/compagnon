/**
 * useDebounce Hook
 *
 * Returns a debounced version of the provided value.
 * The debounced value only updates after the specified delay
 * has elapsed since the last change.
 */

import { useState, useEffect } from "react";

/**
 * Debounce a value by a given delay in milliseconds.
 *
 * @param value - The value to debounce
 * @param delayMs - Delay in milliseconds (default 300)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
