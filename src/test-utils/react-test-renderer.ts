/**
 * Shared test utilities for `react-test-renderer` (Epic 13 retrospective AI #7).
 *
 * Pre-AI-#7 duplication:
 * - `MinimalTestInstance` was declared inline in two files:
 *   `src/components/__tests__/animated-wrappers-render.test.tsx` (Story 13-7)
 *   and `src/components/auth/__tests__/EmailVerificationGate.test.tsx` (Story 12-9).
 * - `findAllNodes` + `flattenStyle` helpers were declared inline only in
 *   `animated-wrappers-render.test.tsx` (Story 13-7).
 * - The `react-native-reanimated` jest.mock factory was duplicated inline in
 *   `animated-wrappers-render.test.tsx` + `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx`
 *   (the reanimated factory lives at `@/src/test-utils/mocks/reanimated`).
 *
 * `EmailVerificationGate.test.tsx` declared `MinimalTestInstance` locally
 * but uses its own inline `findPressableByLabel` helper (a Pressable-specific
 * predicate walker); it does NOT consume `findAllNodes` or `flattenStyle`
 * post-AI-#7. It now imports just the `MinimalTestInstance` type.
 *
 * Why: the project ships a minimal `react-test-renderer` type shim at
 * `src/types/react-test-renderer.d.ts` (Story 12-1 P8) without a full
 * `TestInstance` surface; the `root: unknown` field forces test code to cast
 * to a known shape. `MinimalTestInstance` is the canonical subset that
 * matches the actual react-test-renderer runtime shape.
 */

import type React from "react";
import type { create } from "react-test-renderer";

/**
 * Minimal type for a node returned by `renderer.root.findAll(...)`.
 * Optional `onPress` covers the Pressable-introspection case in
 * EmailVerificationGate.test.tsx; other tests that don't introspect
 * `onPress` can still use this type — the property is optional.
 */
export interface MinimalTestInstance {
  type: unknown;
  props: Record<string, unknown> & {
    onPress?: (...args: unknown[]) => unknown;
  };
  children: unknown;
}

/**
 * Walk every node in the tree via `renderer.root.findAll(...)` and return
 * the matches. The MinimalTestInstance cast keeps TypeScript strict-mode
 * happy without `@types/react-test-renderer`.
 *
 * @param renderer The test renderer returned by `create(...)`.
 * @param predicate Filter applied to each node.
 * @returns Array of matching nodes (empty if none match).
 */
export function findAllNodes(
  renderer: ReturnType<typeof create>,
  predicate: (node: MinimalTestInstance) => boolean
): MinimalTestInstance[] {
  const root = renderer.root as {
    findAll: (pred: (node: MinimalTestInstance) => boolean) => MinimalTestInstance[];
  };
  return root.findAll(predicate);
}

/**
 * Flatten a React Native style prop value (object | array | nested arrays
 * | null | undefined) into a single merged object for assertion convenience.
 * Mirrors RN's `StyleSheet.flatten` semantics; later entries override earlier
 * entries.
 *
 * Note: does NOT resolve numeric style IDs from `StyleSheet.create(...)`.
 * Tests using `StyleSheet.create` should call RN's actual `StyleSheet.flatten`
 * — this helper is for the common case of inline object / array styles.
 */
export function flattenStyle(style: unknown): Record<string, unknown> {
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

/**
 * Story 18-4 completion pass (review R1 chore): the shared act-wrapped
 * mount. Three near-identical copies had already diverged (two tracked
 * renderers for afterEach cleanup, one didn't). Register the cleanup once
 * per test file via `registerMountCleanup()` (call at module scope), then
 * `mountWithAct(...)` per case — every mounted renderer is unmounted in
 * afterEach even when a test throws mid-case.
 */
const activeRenderers: { unmount: () => void }[] = [];

export function mountWithAct(element: React.ReactElement): ReturnType<typeof create> {
  // Lazy require keeps react-test-renderer + act out of non-component
  // suites that import other helpers from this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, see above
  const rtr = require("react-test-renderer") as typeof import("react-test-renderer");
  let renderer!: ReturnType<typeof create>;
  rtr.act(() => {
    renderer = rtr.create(element) as ReturnType<typeof create>;
  });
  activeRenderers.push(renderer);
  return renderer;
}

/** Install the afterEach that unmounts everything mountWithAct created. */
export function registerMountCleanup(): void {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, see above
    const rtr = require("react-test-renderer") as typeof import("react-test-renderer");
    for (const renderer of activeRenderers) {
      try {
        rtr.act(() => renderer.unmount());
      } catch {
        /* already unmounted */
      }
    }
    activeRenderers.length = 0;
  });
}
