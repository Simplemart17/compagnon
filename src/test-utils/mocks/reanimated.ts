/**
 * Canonical `react-native-reanimated` jest mock factory (Epic 13 retrospective AI #7).
 *
 * **Scope of this factory:** covers the Reanimated surface used by the test
 * files that currently consume it. Specifically:
 * - `Animated.View` / `Animated.Text` (host string elements)
 * - `Animated.createAnimatedComponent` (identity)
 * - `useSharedValue` / `useAnimatedStyle` (immediate-evaluation worklets)
 * - `withTiming` / `withDelay` / `withRepeat` / `withSpring` / `withSequence` (identity for time-collapsing)
 * - `interpolate` (linear interpolation between input/output ranges)
 * - `cancelAnimation` (no-op)
 * - `Easing` curves (NB: stubbed as constant `() => 0` returners; the
 *   factory's `withTiming` short-circuits to the target value and never
 *   invokes the easing, so the curve shape is irrelevant for current
 *   consumers. A future test asserting on actual easing values must
 *   override this).
 * - Layout-transition / entering animations (`FadeIn` / `FadeInDown` / `FadeInUp` /
 *   `FadeOut` / `SlideInLeft` / `SlideInRight`) — stubbed as no-op layout-animation
 *   objects. NB: these are entry-side stubs only; tests that mount components
 *   relying on these animations will not crash at module load but the
 *   animations themselves will not run. If a future test asserts on
 *   animation-driven behavior, it must override this factory.
 *
 * **Reanimated APIs NOT covered (extend the factory in your consumer if needed):**
 * - `useDerivedValue` (computed shared values — no current consumer)
 * - `runOnJS` / `runOnUI` (worklet-to-JS dispatch — no current consumer)
 * - `measure` / `scrollTo` (worklet DOM access — no current consumer)
 *
 * If a future test consumes a screen that triggers an un-stubbed API, the
 * import-chain succeeds (JS destructuring just yields `undefined`) but the
 * first invocation throws `TypeError: X is not a function`. When this
 * happens, extend the factory body below OR override per-test by spreading
 * the factory result + adding the missing API.
 *
 * **Usage in test files** — jest.mock is hoisted by `babel-plugin-jest-hoist`
 * so the factory must be referenced via `require()` from inside the
 * jest.mock callback (cannot be `import`ed at module scope and referenced):
 *
 * ```ts
 * jest.mock("react-native-reanimated", () =>
 *   // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock hoisting
 *   require("@/src/test-utils/mocks/reanimated").reanimatedMockFactory()
 * );
 * ```
 */
export function reanimatedMockFactory() {
  // Linear interpolation: maps a value from inputRange to outputRange.
  // Mirrors Reanimated's `interpolate(value, inputRange, outputRange, extrapolate?)`
  // behavior for the common 2-point case; for >2 points, finds the active
  // segment and lerps within it. Extrapolation modes ignored — for "extend"
  // (the default) we return the clamped endpoint of the input range.
  const interpolate = (
    value: number,
    inputRange: readonly number[],
    outputRange: readonly number[]
  ): number => {
    if (inputRange.length !== outputRange.length || inputRange.length < 2) {
      return outputRange[0] ?? 0;
    }
    for (let i = 0; i < inputRange.length - 1; i++) {
      const i0 = inputRange[i];
      const i1 = inputRange[i + 1];
      if (value >= i0 && value <= i1) {
        const t = i1 === i0 ? 0 : (value - i0) / (i1 - i0);
        return outputRange[i] + t * (outputRange[i + 1] - outputRange[i]);
      }
    }
    return value < inputRange[0] ? outputRange[0] : outputRange[outputRange.length - 1];
  };

  // Layout-animation stub — minimal shape that supports `.duration(N)` chain
  // without crashing. Real Reanimated returns a layout-animation builder.
  const noopLayoutAnimation = {
    duration: () => noopLayoutAnimation,
    delay: () => noopLayoutAnimation,
    springify: () => noopLayoutAnimation,
    build: () => undefined,
  };

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
    withSequence: (...values: unknown[]) => values[values.length - 1],
    interpolate,
    cancelAnimation: () => undefined,
    FadeIn: noopLayoutAnimation,
    FadeInDown: noopLayoutAnimation,
    FadeInUp: noopLayoutAnimation,
    FadeOut: noopLayoutAnimation,
    SlideInLeft: noopLayoutAnimation,
    SlideInRight: noopLayoutAnimation,
    Easing: {
      // NB: stubs return 0 (or factory-of-0); see scope note above. Current
      // consumers never invoke the easing because `withTiming` is identity.
      out: () => () => 0,
      quad: () => 0,
      linear: () => 0,
      inOut: () => () => 0,
    },
  };
}
