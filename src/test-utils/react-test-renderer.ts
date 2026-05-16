/**
 * Shared test utilities for `react-test-renderer` (Epic 13 retrospective AI #7).
 *
 * Three test files previously duplicated the same local `MinimalTestInstance`
 * shim + `findAllNodes` / `flattenStyle` helpers:
 * - `src/components/__tests__/animated-wrappers-render.test.tsx` (Story 13-7)
 * - `src/components/auth/__tests__/EmailVerificationGate.test.tsx` (Story 12-9)
 * - `app/(tabs)/conversation/__tests__/history-flatlist-virtualization.test.tsx` (Story 13-5)
 *
 * This module extracts the canonical shapes. Future test authors should
 * import from `@/src/test-utils/react-test-renderer` rather than re-declaring
 * the type locally.
 *
 * Why: the project ships a minimal `react-test-renderer` type shim at
 * `src/types/react-test-renderer.d.ts` (Story 12-1 P8) without a full
 * `TestInstance` surface; the `root: unknown` field forces test code to cast
 * to a known shape. `MinimalTestInstance` is the canonical subset that
 * matches the actual react-test-renderer runtime shape.
 */

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
