/**
 * Story 14-6 — post-onboarding tour runtime tests.
 *
 * Covers:
 *  - 3-card sequence renders correctly (each card's headline + body + icon)
 *  - Next button advances `currentIndex`
 *  - Dot pagination tap navigates directly to that index
 *  - Get-started button (card 2) routes to `/(tabs)/home`
 *  - Skip button routes to `/(tabs)/home`
 *  - `addBreadcrumb` fires per card view with the `cardIndex` data field
 *  - `TOUR_CARDS` content contract (3 entries, each shape-valid)
 */

/* eslint-disable import/first -- jest.mock factories must precede imports they affect */
import { create, act } from "react-test-renderer";

import { findAllNodes, type MinimalTestInstance } from "@/src/test-utils/react-test-renderer";

// Reanimated mock — canonical factory from Epic 13 AI #7
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

// Mock router so Pressable handlers can assert navigation intent
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  Stack: {
    Screen: () => null,
  },
  useRouter: () => ({ replace: mockReplace }),
}));

// Mock safe-area-context (no-op insets so layout calc doesn't depend on host)
jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock haptics (assert calls without invoking native module)
const mockHapticLight = jest.fn();
const mockHapticMedium = jest.fn();
jest.mock("@/src/lib/haptics", () => ({
  __esModule: true,
  hapticLight: () => mockHapticLight(),
  hapticMedium: () => mockHapticMedium(),
}));

// Mock Sentry breadcrumb (assert per-card-view telemetry)
const mockAddBreadcrumb = jest.fn();
jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  addBreadcrumb: (crumb: unknown) => mockAddBreadcrumb(crumb),
}));

// Mock Icon to a no-op null component. The tests introspect icon-name choice
// via the exported `TOUR_CARDS[i].iconName` directly (Case 3), not via the
// rendered tree, so returning null avoids dragging in the Feather native
// module + NativeWind CSS-interop transforms.
jest.mock("@/src/components/common/Icon", () => ({
  __esModule: true,
  Icon: () => null,
}));

// Now import the screen + the @internal TOUR_CARDS contract
import TourScreen, { TOUR_CARDS, TOUR_TRANSITION_HALF_MS } from "../tour";

describe("Story 14-6 — post-onboarding tour runtime", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockHapticLight.mockClear();
    mockHapticMedium.mockClear();
    mockAddBreadcrumb.mockClear();
  });

  describe("TOUR_CARDS content contract", () => {
    it("Case 1: exports exactly 3 cards with the recommended shape", () => {
      expect(TOUR_CARDS).toHaveLength(3);
      for (const card of TOUR_CARDS) {
        expect(typeof card.headline).toBe("string");
        expect(card.headline.length).toBeGreaterThan(0);
        expect(typeof card.body).toBe("string");
        expect(card.body.length).toBeGreaterThan(0);
        expect(typeof card.iconName).toBe("string");
        expect(typeof card.iconBackgroundColor).toBe("string");
      }
    });

    it("Case 2: TOUR_TRANSITION_HALF_MS is exactly 125ms (250ms total transition)", () => {
      expect(TOUR_TRANSITION_HALF_MS).toBe(125);
    });

    it("Case 3: recommended copy + icons match the Q1 operator-decision defaults", () => {
      expect(TOUR_CARDS[0].iconName).toBe("mic");
      expect(TOUR_CARDS[1].iconName).toBe("book-open");
      expect(TOUR_CARDS[2].iconName).toBe("award");
      // Verify the spec-recommended headlines (operator-decision Q1 defaults)
      expect(TOUR_CARDS[0].headline).toMatch(/AI tutor/i);
      expect(TOUR_CARDS[1].headline).toMatch(/8 different ways/i);
      expect(TOUR_CARDS[2].headline).toMatch(/TCF.*practice tests/i);
    });
  });

  describe("Card rendering + breadcrumb telemetry", () => {
    it("Case 4: renders card 0 by default + fires breadcrumb with cardIndex=0", () => {
      let renderer: ReturnType<typeof create> | null = null;
      act(() => {
        renderer = create(<TourScreen />);
      });
      expect(renderer).not.toBeNull();

      // First card's headline + body should be in the tree
      const textNodes = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => typeof n.type === "string" && n.type === "Text"
      );
      const textContent = textNodes
        .map((n) => (typeof n.props.children === "string" ? n.props.children : ""))
        .join("|");
      expect(textContent).toContain(TOUR_CARDS[0].headline);
      expect(textContent).toContain(TOUR_CARDS[0].body);

      // Sentry breadcrumb fired with cardIndex=0
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "tour",
          level: "info",
          message: "Tour card viewed",
          data: { cardIndex: 0 },
        })
      );
    });

    it("Case 5: Next button advances to card 1 + fires hapticLight + new breadcrumb cardIndex=1", () => {
      let renderer: ReturnType<typeof create> | null = null;
      act(() => {
        renderer = create(<TourScreen />);
      });
      expect(renderer).not.toBeNull();
      mockAddBreadcrumb.mockClear();

      // Find Next button via its accessibilityLabel
      const nextButton = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => n.props["accessibilityLabel"] === "Next card"
      );
      expect(nextButton.length).toBeGreaterThan(0);

      act(() => {
        const onPress = nextButton[0].props.onPress;
        if (typeof onPress === "function") onPress();
      });

      // Now card 1 should be rendered
      const textNodes = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => typeof n.type === "string" && n.type === "Text"
      );
      const textContent = textNodes
        .map((n) => (typeof n.props.children === "string" ? n.props.children : ""))
        .join("|");
      expect(textContent).toContain(TOUR_CARDS[1].headline);
      expect(mockHapticLight).toHaveBeenCalledTimes(1);
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ data: { cardIndex: 1 } })
      );
    });
  });

  describe("Pagination + final card", () => {
    it("Case 6: dot pagination tap navigates directly to that index", () => {
      let renderer: ReturnType<typeof create> | null = null;
      act(() => {
        renderer = create(<TourScreen />);
      });
      expect(renderer).not.toBeNull();
      mockAddBreadcrumb.mockClear();

      // Find dot 3 (cardIndex=2 → accessibilityLabel="Go to tour card 3")
      const dot3 = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => n.props["accessibilityLabel"] === "Go to tour card 3"
      );
      expect(dot3.length).toBeGreaterThan(0);

      act(() => {
        const onPress = dot3[0].props.onPress;
        if (typeof onPress === "function") onPress();
      });

      // Final card (index 2) should be rendered
      const textNodes = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => typeof n.type === "string" && n.type === "Text"
      );
      const textContent = textNodes
        .map((n) => (typeof n.props.children === "string" ? n.props.children : ""))
        .join("|");
      expect(textContent).toContain(TOUR_CARDS[2].headline);
      // CTA label flips from "Next" to "Get started"
      expect(textContent).toContain("Get started");
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ data: { cardIndex: 2 } })
      );
    });

    it("Case 7: Get-started on card 2 routes to /(tabs)/home + fires hapticMedium", () => {
      let renderer: ReturnType<typeof create> | null = null;
      act(() => {
        renderer = create(<TourScreen />);
      });
      expect(renderer).not.toBeNull();

      // Navigate to last card via dot
      const dot3 = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => n.props["accessibilityLabel"] === "Go to tour card 3"
      );
      act(() => {
        const onPress = dot3[0].props.onPress;
        if (typeof onPress === "function") onPress();
      });

      // Now find Get-started button
      const getStarted = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => n.props["accessibilityLabel"] === "Get started"
      );
      expect(getStarted.length).toBeGreaterThan(0);

      act(() => {
        const onPress = getStarted[0].props.onPress;
        if (typeof onPress === "function") onPress();
      });

      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
      expect(mockHapticMedium).toHaveBeenCalledTimes(1);
      // hapticLight was called once (during dot tap), but NOT a second time
      // (Get-started uses hapticMedium, not hapticLight)
      expect(mockHapticLight).toHaveBeenCalledTimes(1);
    });
  });

  describe("Skip button", () => {
    it("Case 8: Skip button routes to /(tabs)/home + fires hapticLight (NOT hapticMedium)", () => {
      let renderer: ReturnType<typeof create> | null = null;
      act(() => {
        renderer = create(<TourScreen />);
      });
      expect(renderer).not.toBeNull();

      const skipButton = findAllNodes(
        renderer!,
        (n: MinimalTestInstance) => n.props["accessibilityLabel"] === "Skip tour"
      );
      expect(skipButton.length).toBeGreaterThan(0);

      act(() => {
        const onPress = skipButton[0].props.onPress;
        if (typeof onPress === "function") onPress();
      });

      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
      expect(mockHapticLight).toHaveBeenCalledTimes(1);
      expect(mockHapticMedium).not.toHaveBeenCalled();
    });
  });
});
