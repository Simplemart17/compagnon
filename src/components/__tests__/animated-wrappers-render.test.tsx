/* eslint-disable import/first -- jest.mock must precede imports to take effect at module-load time */
/**
 * Story 13-7 — runtime smoke tests for the 3 hot-animated wrappers that
 * Story 13-7 converted from mixed `className`+`style` to pure `style` arrays.
 *
 * Companion to `animated-wrapper-className-style-source-drift.test.ts` —
 * the drift detector pins the source-file shape; this file pins the RUNTIME
 * behavior so a future Babel transform / NativeWind upgrade / Reanimated SDK
 * change that re-injects `className` on the animated wrapper is also caught.
 *
 * Pattern: react-test-renderer `create` + `act` (Story 12-1 P8 / 13-4 P2 /
 * 13-5 precedent). Reanimated mocked at file-level with no-op stubs.
 *
 * Pins (4 cases):
 *   - ConversationCard mounts; outer animated wrapper flattened style
 *     contains `backgroundColor: Colors.primary`.
 *   - StatTile mounts; outer animated wrapper flattened style contains
 *     `flex: 1` and `borderRadius: Radii.card`.
 *   - SkillCard mounts; the inner Pressable's flattened style contains
 *     `backgroundColor: Colors.surfaceWhite`.
 *   - NEGATIVE control: NONE of the 3 outer animated wrapper / inner
 *     Pressable elements expose a `className` prop at render time —
 *     defends against a future SDK / Babel-transform regression that
 *     silently re-injects `className`.
 */

// Reanimated mock factory shared with other test files (Epic 13 retro AI #7).
// `jest.mock` is hoisted by `babel-plugin-jest-hoist`; the factory must be
// reached via `require()` from inside the callback.
jest.mock("react-native-reanimated", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting requires require() inside the callback
  require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
);

// `app/(tabs)/home/index.tsx` transitively imports `useDailyBriefing` →
// `src/lib/cache.ts` → `@react-native-async-storage/async-storage`, which
// crashes under Jest without a NativeModule shim. Mock at file-level so
// the ConversationCard import boundary is clean.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => undefined),
    fetch: jest.fn().mockResolvedValue({ isConnected: true }),
  },
  addEventListener: jest.fn(() => () => undefined),
}));

// Review-round-1 P5: explicit `expo-secure-store` mock. The transitive
// import chain `home/index.tsx` → `useDailyBriefing` → `memory.ts` →
// `supabase.ts` → `expo-secure-store` is currently auto-mocked by the
// jest-expo preset, but relying on the preset is brittle to future jest-
// config changes. Defense-in-depth: explicit no-op mock here.
jest.mock("expo-secure-store", () => ({
  __esModule: true,
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

jest.mock("@/src/lib/haptics", () => ({
  __esModule: true,
  hapticLight: jest.fn(),
}));

jest.mock("@/src/lib/sentry", () => ({
  __esModule: true,
  captureError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import React from "react";
import { act, create } from "react-test-renderer";

import { ConversationCard, conversationCardStaticStyle } from "@/app/(tabs)/home/index";
import { Colors, Radii } from "@/src/lib/design";
import { SkillCard, skillCardPressableStaticStyle } from "@/src/components/common/SkillCard";
import { StatTile, statTileStaticStyle } from "@/src/components/common/StatTile";
// Shared `findAllNodes` + `flattenStyle` from `@/src/test-utils/react-test-renderer`
// (Epic 13 retro AI #7). Pre-AI-#7 this file duplicated the type + helpers inline.
import { findAllNodes, flattenStyle } from "@/src/test-utils/react-test-renderer";

const activeRenderers: ReturnType<typeof create>[] = [];

// Review-round-1 P6: clear AsyncStorage / NetInfo / SecureStore / Sentry mock
// call history between cases so a future regression in `home/index.tsx`'s
// module-load behavior (e.g., transitive cache reads) cannot leak call
// history into the next test's assertions. Pattern: Story 12-7 / 12-8.
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  for (const renderer of activeRenderers) {
    try {
      act(() => renderer.unmount());
    } catch {
      /* already unmounted */
    }
  }
  activeRenderers.length = 0;
});

function mount(element: React.ReactElement) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(element);
  });
  activeRenderers.push(renderer);
  return renderer;
}

describe("Story 13-7 — animated-wrappers runtime smoke tests", () => {
  it("Case 1: ConversationCard mounts; outer AnimatedPressable flattened style includes Colors.primary background", () => {
    const renderer = mount(<ConversationCard onPress={() => {}} />);
    // Outer animated wrapper: under the file-level reanimated mock,
    // `Animated.createAnimatedComponent(Pressable)` returns Pressable
    // as-is. Review-round-1 P3: anchor on (Colors.primary background) AND
    // (accessibilityRole === "button"); react-test-renderer's findAll
    // returns multiple nodes for one logical Pressable (composite +
    // forwardRef + host levels in the fiber tree), so we don't enforce
    // `length === 1` — instead we verify all matches describe the SAME
    // logical element by comparing their `accessibilityLabel`s, which
    // catches the future-regression case where a different element gets
    // `Colors.primary` background.
    const candidates = findAllNodes(renderer, (node) => {
      const flat = flattenStyle(node.props.style);
      return flat.backgroundColor === Colors.primary && node.props.accessibilityRole === "button";
    });
    expect(candidates.length).toBeGreaterThan(0);
    const labels = new Set(candidates.map((c) => c.props.accessibilityLabel));
    expect(labels).toEqual(new Set(["Talk with Companion"]));
    const outer = candidates[0];
    const flat = flattenStyle(outer.props.style);
    expect(flat.backgroundColor).toBe(Colors.primary);
    expect(flat.borderRadius).toBe(Radii.card);
    // NEGATIVE control: no className at runtime — defends against a future
    // Babel-transform / NativeWind upgrade that re-injects className on the
    // animated wrapper.
    expect(outer.props.className).toBeUndefined();
  });

  it("Case 2: StatTile mounts; outer Animated.View flattened style includes flex 1 + Radii.card border-radius", () => {
    const renderer = mount(<StatTile value="42" unit="min" label="Today" delay={0} />);
    // Find the StatTile outer wrapper by its unique style signature:
    // it's the ONLY rendered node carrying both `flex: 1` and the
    // accessibilityLabel for the tile. Anchoring on accessibilityLabel
    // avoids matching the inner `<View className="flex-1" ...>` siblings
    // that the home screen renders elsewhere.
    const candidates = findAllNodes(renderer, (node) => {
      const flat = flattenStyle(node.props.style);
      const label = node.props.accessibilityLabel;
      return flat.flex === 1 && typeof label === "string" && label.startsWith("Today:");
    });
    // Review-round-1 P3: assert all candidates describe ONE logical element
    // (react-test-renderer surfaces composite + host fiber-tree levels per
    // logical node, so cardinality > 1 is normal — uniqueness of label
    // catches the regression where a different element matches the
    // predicate).
    expect(candidates.length).toBeGreaterThan(0);
    const labels = new Set(candidates.map((c) => c.props.accessibilityLabel));
    expect(labels.size).toBe(1);
    const outer = candidates[0];
    const flat = flattenStyle(outer.props.style);
    expect(flat.flex).toBe(1);
    expect(flat.borderRadius).toBe(Radii.card);
    expect(flat.backgroundColor).toBe(Colors.surfaceWhite);
    // NEGATIVE control: no className at runtime.
    expect(outer.props.className).toBeUndefined();
  });

  it("Case 3: SkillCard mounts; inner Pressable flattened style includes Colors.surfaceWhite background", () => {
    const renderer = mount(
      <SkillCard
        emoji="🎯"
        titleFr="Écoute"
        titleEn="Listening"
        description="Practice"
        accentColor="#1E3A5F"
        delay={0}
        onPress={() => {}}
      />
    );
    // The inner Pressable carries Colors.surfaceWhite as its background AND
    // an accessibilityRole="button"; this combination uniquely identifies
    // the converted Pressable in the rendered tree.
    const candidates = findAllNodes(renderer, (node) => {
      const flat = flattenStyle(node.props.style);
      return (
        flat.backgroundColor === Colors.surfaceWhite && node.props.accessibilityRole === "button"
      );
    });
    // Review-round-1 P3: assert all candidates describe ONE logical element
    // (fiber-tree levels — see Case 1 explanation).
    expect(candidates.length).toBeGreaterThan(0);
    const labels = new Set(candidates.map((c) => c.props.accessibilityLabel));
    expect(labels.size).toBe(1);
    const inner = candidates[0];
    const flat = flattenStyle(inner.props.style);
    expect(flat.backgroundColor).toBe(Colors.surfaceWhite);
    expect(flat.borderRadius).toBe(Radii.card);
    // NEGATIVE control: no className at runtime.
    expect(inner.props.className).toBeUndefined();
  });

  it("Case 4: NEGATIVE control — exported static-style constants match runtime values (proves constant-driven layout)", () => {
    // Belt-and-suspenders pin: the EXPORTED static-style constants must
    // contain the design-token-sourced values that the runtime renders.
    // A future refactor that diverges the constant from the rendered shape
    // (e.g., someone re-introduces inline shadow on the JSX block) trips
    // this case before the merge.
    expect(conversationCardStaticStyle.backgroundColor).toBe(Colors.primary);
    expect(conversationCardStaticStyle.borderRadius).toBe(Radii.card);
    expect(statTileStaticStyle.flex).toBe(1);
    expect(statTileStaticStyle.borderRadius).toBe(Radii.card);
    expect(statTileStaticStyle.backgroundColor).toBe(Colors.surfaceWhite);
    expect(skillCardPressableStaticStyle.backgroundColor).toBe(Colors.surfaceWhite);
    expect(skillCardPressableStaticStyle.borderRadius).toBe(Radii.card);
  });

  it("Case 5: review-round-1 P2 — all 3 *StaticStyle constants are frozen against runtime mutation", () => {
    // Story 12-1's `getState() = Object.freeze({...})` precedent applied here.
    // A debug-session / runtime A/B test / future theming code path mutating
    // `conversationCardStaticStyle.backgroundColor = ...` would silently
    // change EVERY instance globally for the rest of the JS session. The
    // freeze defense at module-load prevents this.
    expect(Object.isFrozen(conversationCardStaticStyle)).toBe(true);
    expect(Object.isFrozen(statTileStaticStyle)).toBe(true);
    expect(Object.isFrozen(skillCardPressableStaticStyle)).toBe(true);
    // Belt-and-suspenders: attempted mutation must throw (strict mode under
    // Jest) or silently no-op. Either way, the value MUST stay unchanged.
    // The `as ViewStyle` cast at the constant declaration strips the
    // Readonly<> shape, so the runtime mutation compiles cleanly — the
    // freeze is the runtime guard, not the type system.
    const originalBackground = conversationCardStaticStyle.backgroundColor;
    try {
      conversationCardStaticStyle.backgroundColor = "#FF0000";
    } catch {
      /* expected under strict mode */
    }
    expect(conversationCardStaticStyle.backgroundColor).toBe(originalBackground);
  });
});
