/**
 * Canonical `react-native-reanimated` jest mock factory (Epic 13 retrospective AI #7).
 *
 * Three test files duplicated this exact factory inline pre-AI-#7:
 * - `src/components/__tests__/animated-wrappers-render.test.tsx`
 * - `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx`
 * - (and any future tests that import a screen using Reanimated)
 *
 * **Usage in test files** — jest.mock is hoisted by `babel-plugin-jest-hoist`
 * so the factory must be referenced via `require()` from inside the
 * jest.mock callback (cannot be `import`ed at module scope and referenced):
 *
 * ```ts
 * jest.mock("react-native-reanimated", () =>
 *   require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
 * );
 * ```
 *
 * The factory returns a no-op stub that satisfies the typical Reanimated
 * surface used in the project: `Animated.View` / `Animated.Text` as host
 * strings; `createAnimatedComponent` returns the input as-is;
 * `useSharedValue` returns `{value: v}`; `useAnimatedStyle` calls the
 * callback immediately (so the result is captured as an inline object);
 * `withTiming` / `withDelay` / `withRepeat` return the input value verbatim;
 * `Easing` exports no-op curve functions.
 *
 * Tests requiring additional Reanimated APIs (e.g., `useDerivedValue`,
 * `interpolate`) should extend this factory in the consuming test file by
 * spreading the result + adding the additional API stubs.
 */
export function reanimatedMockFactory() {
  return {
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
    withRepeat: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    Easing: {
      out: () => () => 0,
      quad: () => 0,
      linear: () => 0,
      inOut: () => () => 0,
    },
  };
}
