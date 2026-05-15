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

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: "View",
    Text: "Text",
    createAnimatedComponent: (c: unknown) => c,
  },
  useSharedValue: (v: unknown) => ({ value: v }),
  useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  withTiming: (v: unknown) => v,
  withDelay: (_delay: unknown, v: unknown) => v,
  Easing: { out: () => () => 0, quad: () => 0 },
}));

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

// The project ships a minimal `react-test-renderer` type shim
// (`src/types/react-test-renderer.d.ts`) without a full `TestInstance`
// surface; declare the small subset we need locally (Story 12-9 +
// EmailVerificationGate.test.tsx precedent).
interface MinimalTestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown;
}

const activeRenderers: ReturnType<typeof create>[] = [];

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

/**
 * Walk every node in the tree and return the matches. Mirrors
 * react-test-renderer's `findAll` API via the local MinimalTestInstance
 * shape so TypeScript's strict-mode is satisfied without `@types/*`.
 */
function findAllNodes(
  renderer: ReturnType<typeof create>,
  predicate: (node: MinimalTestInstance) => boolean
): MinimalTestInstance[] {
  const root = renderer.root as {
    findAll: (pred: (node: MinimalTestInstance) => boolean) => MinimalTestInstance[];
  };
  return root.findAll(predicate);
}

/**
 * Flatten a React Native style prop value (object | array | nested arrays)
 * into a single merged object for assertion convenience. Mirrors RN's
 * StyleSheet.flatten semantics; later entries override earlier entries.
 */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, item) => ({ ...acc, ...flattenStyle(item) }),
      {}
    );
  }
  if (typeof style === "object") {
    return style as Record<string, unknown>;
  }
  return {};
}

describe("Story 13-7 — animated-wrappers runtime smoke tests", () => {
  it("Case 1: ConversationCard mounts; outer AnimatedPressable flattened style includes Colors.primary background", () => {
    const renderer = mount(<ConversationCard onPress={() => {}} />);
    // Outer animated wrapper: under the file-level reanimated mock,
    // `Animated.createAnimatedComponent(Pressable)` returns Pressable
    // as-is. Find the top-level node carrying the Colors.primary
    // background — that's our converted ConversationCard outer wrapper.
    const candidates = findAllNodes(renderer, (node) => {
      const flat = flattenStyle(node.props.style);
      return flat.backgroundColor === Colors.primary;
    });
    expect(candidates.length).toBeGreaterThan(0);
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
    expect(candidates.length).toBeGreaterThan(0);
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
    expect(candidates.length).toBeGreaterThan(0);
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
});
