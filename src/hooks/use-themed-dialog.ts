import { useCallback, useEffect, useRef, useState } from "react";

import {
  THEMED_DIALOG_ANIM_DURATION_MS,
  type ThemedDialogProps,
} from "@/src/components/common/ThemedDialog";

/**
 * Story 14-8 — declarative state helper for `ThemedDialog`.
 *
 * Each consumer creates one instance per surface that needs a confirmation
 * dialog (sign-out, level change, etc.), then renders
 *   `<ThemedDialog visible={dialog.visible} {...dialog.config} />`
 * inline. Action handlers call `dialog.show({...})` to display; buttons'
 * `onPress` callbacks should call `dialog.hide()` before any async work.
 *
 * **Pattern rationale:** matches the codebase's `useState` + conditional
 * inline render convention (Story 12-9 EmailVerificationGate, Story 14-7
 * mock-test landing). No global provider, no imperative event bus — each
 * consumer owns its dialog state, which makes the data flow obvious and
 * tests don't need any provider wrapping.
 *
 * @see _bmad-output/implementation-artifacts/14-8-themed-dialog-component.md
 */

export type ThemedDialogConfig = Omit<ThemedDialogProps, "visible">;

export interface UseThemedDialogReturn {
  visible: boolean;
  /**
   * The currently-shown config. Retained briefly after `hide()` (for the
   * exit-animation duration) so the component can play its fade-out
   * without the content disappearing mid-frame. After
   * `THEMED_DIALOG_ANIM_DURATION_MS`, this becomes `null`.
   */
  config: ThemedDialogConfig | null;
  /**
   * Show a dialog with the given config. If a dialog is already showing,
   * the config is replaced (no animation interruption — the visible→visible
   * transition is a no-op at the Reanimated layer).
   */
  show: (config: ThemedDialogConfig) => void;
  /**
   * Hide the dialog. Sets `visible` to false immediately; the `config`
   * stays in place for `THEMED_DIALOG_ANIM_DURATION_MS` so the exit
   * animation can complete.
   */
  hide: () => void;
}

export function useThemedDialog(): UseThemedDialogReturn {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<ThemedDialogConfig | null>(null);

  // Track the pending "clear config" timeout so a hide() → show() cycle
  // within the animation window doesn't accidentally clear the new config.
  const clearConfigTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount — defensive against setState on unmounted component.
  useEffect(() => {
    return () => {
      if (clearConfigTimeoutRef.current !== null) {
        clearTimeout(clearConfigTimeoutRef.current);
        clearConfigTimeoutRef.current = null;
      }
    };
  }, []);

  const show = useCallback((nextConfig: ThemedDialogConfig) => {
    // If a hide() is pending (clearing the config after the exit anim),
    // cancel it — the new show() means we want to keep the config.
    if (clearConfigTimeoutRef.current !== null) {
      clearTimeout(clearConfigTimeoutRef.current);
      clearConfigTimeoutRef.current = null;
    }
    setConfig(nextConfig);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    // Defer clearing the config until the exit animation completes so the
    // dialog content doesn't disappear mid-frame.
    if (clearConfigTimeoutRef.current !== null) {
      clearTimeout(clearConfigTimeoutRef.current);
    }
    clearConfigTimeoutRef.current = setTimeout(() => {
      setConfig(null);
      clearConfigTimeoutRef.current = null;
    }, THEMED_DIALOG_ANIM_DURATION_MS);
  }, []);

  return { visible, config, show, hide };
}
