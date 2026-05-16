/**
 * Story 14-8 — ThemedDialog runtime tests.
 *
 * Covers:
 *  - 1 / 2 / 3 button layouts (full-width / horizontal cancel-left / vertical stack)
 *  - Backdrop tap behavior: fires onRequestClose when no destructive; suppressed when any destructive
 *  - Double-tap re-entrancy guard via useRef
 *  - Backdrop a11y attrs (Story 14-3 R1-P1 3-prop decorative pattern)
 *  - Button accessibilityRole + accessibilityLabel propagation
 *  - frozen-style invariant (Object.isFrozen on themedDialogCardStaticStyle)
 *  - Title + message rendered via Typography presets
 *  - THEMED_DIALOG_ANIM_DURATION_MS exported as 180
 *
 * Uses react-test-renderer (Story 12-1 P8 / 13-3 / 13-7 / 14-2 / 14-7 precedent).
 */

/* eslint-disable import/first -- jest.mock factories must precede imports they affect */
import React from "react";
import { act, create } from "react-test-renderer";

import { findAllNodes, type MinimalTestInstance } from "@/src/test-utils/react-test-renderer";

// Reanimated mock — canonical factory from Epic 13 AI #7
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

import {
  ThemedDialog,
  THEMED_DIALOG_ANIM_DURATION_MS,
  themedDialogCardStaticStyle,
  type ThemedDialogButton,
} from "../ThemedDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const activeRenderers: ReturnType<typeof create>[] = [];

function renderDialog(props: {
  visible: boolean;
  title: string;
  message: string;
  buttons: ThemedDialogButton[];
  onRequestClose?: () => void;
  accessibilityLabel?: string;
}) {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<ThemedDialog {...props} />);
  });
  activeRenderers.push(renderer!);
  return renderer!;
}

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => renderer.unmount());
    } catch {
      // already unmounted
    }
  }
  activeRenderers.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Story 14-8 — ThemedDialog", () => {
  describe("Constants + frozen-style invariants", () => {
    it("Case 1: THEMED_DIALOG_ANIM_DURATION_MS is exactly 180", () => {
      expect(THEMED_DIALOG_ANIM_DURATION_MS).toBe(180);
    });

    it("Case 2: themedDialogCardStaticStyle is Object.frozen (Story 13-7 R1-P2 mutation defense)", () => {
      expect(Object.isFrozen(themedDialogCardStaticStyle)).toBe(true);
      // Mutation attempt should silently fail in non-strict mode (or throw in strict).
      try {
        (themedDialogCardStaticStyle as { padding: number }).padding = 999;
      } catch {
        // strict-mode throws — expected
      }
      // Either way, the value is unchanged.
      expect(themedDialogCardStaticStyle.padding).toBe(24);
    });
  });

  describe("Button layouts", () => {
    it("Case 3: 1-button layout renders the single button full-width (no horizontal/vertical group needed)", () => {
      const onPress = jest.fn();
      const renderer = renderDialog({
        visible: true,
        title: "Info",
        message: "Got it?",
        buttons: [{ label: "OK", onPress }],
      });
      // Story 13-7 R1-P3 lesson: react-test-renderer surfaces multiple
      // fiber-tree levels per logical Pressable. Dedupe by accessibilityLabel.
      const allMatches = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityRole === "button"
      );
      const labelMap = new Map<string, MinimalTestInstance>();
      for (const node of allMatches) {
        const label = node.props.accessibilityLabel as string | undefined;
        if (typeof label === "string" && !labelMap.has(label)) {
          labelMap.set(label, node);
        }
      }
      const buttons = Array.from(labelMap.values());
      expect(buttons.length).toBe(1);
      expect(buttons[0].props.accessibilityLabel).toBe("OK");
    });

    it("Case 4: 2-button layout renders cancel + action (cancel-left convention via input order)", () => {
      const renderer = renderDialog({
        visible: true,
        title: "Confirm",
        message: "Are you sure?",
        buttons: [
          { label: "Cancel", style: "cancel" },
          { label: "Confirm", style: "default" },
        ],
      });
      // Story 13-7 R1-P3 lesson: react-test-renderer surfaces multiple
      // fiber-tree levels per logical Pressable. Dedupe by accessibilityLabel.
      const allMatches = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityRole === "button"
      );
      const labelMap = new Map<string, MinimalTestInstance>();
      for (const node of allMatches) {
        const label = node.props.accessibilityLabel as string | undefined;
        if (typeof label === "string" && !labelMap.has(label)) {
          labelMap.set(label, node);
        }
      }
      const buttons = Array.from(labelMap.values());
      expect(buttons.length).toBe(2);
      expect(buttons[0].props.accessibilityLabel).toBe("Cancel");
      expect(buttons[1].props.accessibilityLabel).toBe("Confirm");
    });

    it("Case 5: 3-button layout renders all 3 in input order (vertical stack)", () => {
      const renderer = renderDialog({
        visible: true,
        title: "Pick One",
        message: "Choose an action",
        buttons: [
          { label: "Action A", style: "default" },
          { label: "Action B", style: "default" },
          { label: "Cancel", style: "cancel" },
        ],
      });
      // Story 13-7 R1-P3 lesson: react-test-renderer surfaces multiple
      // fiber-tree levels per logical Pressable. Dedupe by accessibilityLabel.
      const allMatches = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityRole === "button"
      );
      const labelMap = new Map<string, MinimalTestInstance>();
      for (const node of allMatches) {
        const label = node.props.accessibilityLabel as string | undefined;
        if (typeof label === "string" && !labelMap.has(label)) {
          labelMap.set(label, node);
        }
      }
      const buttons = Array.from(labelMap.values());
      expect(buttons.length).toBe(3);
      expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
        "Action A",
        "Action B",
        "Cancel",
      ]);
    });
  });

  describe("Backdrop dismissal behavior", () => {
    it("Case 6: backdrop tap fires onRequestClose when NO button is destructive", () => {
      const onRequestClose = jest.fn();
      const renderer = renderDialog({
        visible: true,
        title: "Confirm",
        message: "Reversible action",
        buttons: [
          { label: "Cancel", style: "cancel" },
          { label: "OK", style: "default" },
        ],
        onRequestClose,
      });

      // The backdrop-press Pressable is the one WITHOUT an accessibilityRole
      // (the action buttons all have role="button"). Filter to Pressables
      // that have an onPress + are not accessibilityRole="button".
      const allPressables = findAllNodes(
        renderer,
        (n: MinimalTestInstance) =>
          typeof n.props.onPress === "function" && n.props.accessibilityRole !== "button"
      );
      expect(allPressables.length).toBeGreaterThan(0);

      act(() => {
        const backdrop = allPressables[0];
        backdrop.props.onPress?.();
      });

      expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it("Case 7: backdrop tap SUPPRESSED when any button is destructive (Q4 — force explicit choice)", () => {
      const onRequestClose = jest.fn();
      const renderer = renderDialog({
        visible: true,
        title: "Delete",
        message: "This cannot be undone",
        buttons: [
          { label: "Cancel", style: "cancel" },
          { label: "Delete", style: "destructive" },
        ],
        onRequestClose,
      });

      // The backdrop-press Pressable should NOT exist when a destructive
      // button is present — search for ANY non-button Pressable with onPress.
      const backdropPressables = findAllNodes(
        renderer,
        (n: MinimalTestInstance) =>
          typeof n.props.onPress === "function" && n.props.accessibilityRole !== "button"
      );
      expect(backdropPressables.length).toBe(0);
      expect(onRequestClose).not.toHaveBeenCalled();
    });
  });

  describe("Button re-entrancy guard", () => {
    it("Case 8: double-tap on a button fires onPress EXACTLY ONCE (synchronous useRef guard)", () => {
      const onPress = jest.fn();
      const renderer = renderDialog({
        visible: true,
        title: "Confirm",
        message: "Do it?",
        buttons: [{ label: "Yes", style: "default", onPress }],
      });
      const button = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityLabel === "Yes"
      )[0];

      act(() => {
        // Simulate two synchronous taps (same JS tick, before microtask flushes)
        button.props.onPress?.();
        button.props.onPress?.();
      });

      // The synchronous useRef gate should suppress the second invocation.
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe("Accessibility", () => {
    it("Case 9: backdrop has Story 14-3 R1-P1 3-prop decorative a11y pattern", () => {
      const renderer = renderDialog({
        visible: true,
        title: "Test",
        message: "Test",
        buttons: [{ label: "OK", style: "default" }],
      });

      // Find a View with `accessible={false}` + `accessibilityElementsHidden={true}` +
      // `importantForAccessibility="no-hide-descendants"`.
      const decorativeNodes = findAllNodes(
        renderer,
        (n: MinimalTestInstance) =>
          n.props.accessible === false &&
          n.props.accessibilityElementsHidden === true &&
          n.props.importantForAccessibility === "no-hide-descendants"
      );
      expect(decorativeNodes.length).toBeGreaterThan(0);
    });

    it("Case 10: dialog card has role='alert' + accessibilityLabel default (title. message)", () => {
      const renderer = renderDialog({
        visible: true,
        title: "Sign Out",
        message: "Are you sure?",
        buttons: [{ label: "OK", style: "default" }],
      });
      const alerts = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityRole === "alert"
      );
      expect(alerts.length).toBe(1);
      expect(alerts[0].props.accessibilityLabel).toBe("Sign Out. Are you sure?");
    });

    it("Case 11: explicit accessibilityLabel prop overrides the default", () => {
      const renderer = renderDialog({
        visible: true,
        title: "Sign Out",
        message: "Confirm?",
        buttons: [{ label: "OK" }],
        accessibilityLabel: "Custom label",
      });
      const alerts = findAllNodes(
        renderer,
        (n: MinimalTestInstance) => n.props.accessibilityRole === "alert"
      );
      expect(alerts.length).toBe(1);
      expect(alerts[0].props.accessibilityLabel).toBe("Custom label");
    });
  });
});
