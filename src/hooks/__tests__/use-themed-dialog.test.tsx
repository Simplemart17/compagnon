/**
 * Story 14-8 — useThemedDialog hook tests.
 *
 * Covers:
 *  - Initial state { visible: false, config: null }
 *  - show(config) sets visible + config
 *  - hide() clears visible immediately; config retained for animation duration
 *  - show() while visible replaces config without flicker (cancels pending clear timeout)
 *  - hide() then show() within the animation window keeps the new config
 *  - Component-unmount cleans up pending timeout (no setState on unmounted)
 */

/* eslint-disable import/first -- jest.mock factories must precede imports they affect */
import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";

// Reanimated mock — transitively required because the hook imports the
// constant from ThemedDialog.tsx which imports react-native-reanimated.
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

import {
  useThemedDialog,
  type UseThemedDialogReturn,
  type ThemedDialogConfig,
} from "../use-themed-dialog";

const THEMED_DIALOG_ANIM_DURATION_MS = 180;

interface HookHostProps {
  result: { current: UseThemedDialogReturn | null };
}

function HookHost({ result }: HookHostProps): React.ReactElement {
  const value = useThemedDialog();
  result.current = value;
  return <Text>host</Text>;
}

const activeRenderers: ReturnType<typeof create>[] = [];

function renderHost() {
  const result: { current: UseThemedDialogReturn | null } = { current: null };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<HookHost result={result} />);
  });
  activeRenderers.push(renderer!);
  return { result, renderer: renderer! };
}

const SAMPLE_CONFIG: ThemedDialogConfig = {
  title: "Test",
  message: "Test message",
  buttons: [{ label: "OK", style: "default" }],
};

const SAMPLE_CONFIG_2: ThemedDialogConfig = {
  title: "Test 2",
  message: "Different message",
  buttons: [
    { label: "Cancel", style: "cancel" },
    { label: "Confirm", style: "default" },
  ],
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => renderer.unmount());
    } catch {
      // already unmounted
    }
  }
  activeRenderers.length = 0;
  jest.useRealTimers();
});

describe("Story 14-8 — useThemedDialog", () => {
  it("Case 1: initial state is { visible: false, config: null }", () => {
    const { result } = renderHost();
    expect(result.current?.visible).toBe(false);
    expect(result.current?.config).toBeNull();
  });

  it("Case 2: show(config) sets visible=true + config to the provided value", () => {
    const { result } = renderHost();
    act(() => {
      result.current?.show(SAMPLE_CONFIG);
    });
    expect(result.current?.visible).toBe(true);
    expect(result.current?.config).toEqual(SAMPLE_CONFIG);
  });

  it("Case 3: hide() clears visible immediately + retains config briefly for exit animation", () => {
    const { result } = renderHost();
    act(() => {
      result.current?.show(SAMPLE_CONFIG);
    });
    expect(result.current?.visible).toBe(true);

    act(() => {
      result.current?.hide();
    });

    // Immediately after hide(): visible is false, but config is retained
    // for the exit animation to play out.
    expect(result.current?.visible).toBe(false);
    expect(result.current?.config).toEqual(SAMPLE_CONFIG);

    // After the animation duration, config is cleared.
    act(() => {
      jest.advanceTimersByTime(THEMED_DIALOG_ANIM_DURATION_MS);
    });
    expect(result.current?.config).toBeNull();
  });

  it("Case 4: show() while visible replaces config without flicker", () => {
    const { result } = renderHost();
    act(() => {
      result.current?.show(SAMPLE_CONFIG);
    });
    expect(result.current?.config?.title).toBe("Test");

    act(() => {
      result.current?.show(SAMPLE_CONFIG_2);
    });
    expect(result.current?.visible).toBe(true);
    expect(result.current?.config?.title).toBe("Test 2");
    expect(result.current?.config?.buttons.length).toBe(2);
  });

  it("Case 5: hide() then show() within animation window cancels the pending clear-config timeout", () => {
    const { result } = renderHost();
    act(() => {
      result.current?.show(SAMPLE_CONFIG);
    });

    act(() => {
      result.current?.hide();
    });
    // Half the animation duration elapses
    act(() => {
      jest.advanceTimersByTime(THEMED_DIALOG_ANIM_DURATION_MS / 2);
    });
    // Re-show with a new config BEFORE the clear-timeout fires
    act(() => {
      result.current?.show(SAMPLE_CONFIG_2);
    });
    expect(result.current?.visible).toBe(true);
    expect(result.current?.config?.title).toBe("Test 2");

    // The original clear-timeout was scheduled for time T+180. We're now
    // at T+90, and we just called show() which should have cleared the
    // pending timeout. Advance past T+180 and verify config is STILL set
    // (the cancelled timeout did NOT fire).
    act(() => {
      jest.advanceTimersByTime(THEMED_DIALOG_ANIM_DURATION_MS);
    });
    expect(result.current?.visible).toBe(true);
    expect(result.current?.config?.title).toBe("Test 2");
  });

  it("Case 6: unmount during a pending clear-timeout cleans up (no setState after unmount)", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { result, renderer } = renderHost();
    act(() => {
      result.current?.show(SAMPLE_CONFIG);
    });
    act(() => {
      result.current?.hide();
    });
    // Unmount BEFORE the clear-timeout fires
    act(() => {
      renderer.unmount();
    });
    // Advance past the timeout — if cleanup didn't fire, React would log
    // a "setState on unmounted component" warning.
    act(() => {
      jest.advanceTimersByTime(THEMED_DIALOG_ANIM_DURATION_MS + 50);
    });

    // No React unmounted-component warnings should have been logged.
    const unmountedWarnings = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("update on an unmounted"))
    );
    expect(unmountedWarnings.length).toBe(0);

    consoleErrorSpy.mockRestore();
  });
});
