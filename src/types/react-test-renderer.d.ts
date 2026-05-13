/**
 * Minimal type declaration for `react-test-renderer` (Story 12-1 P8).
 * Only the surface used by `src/hooks/__tests__/use-realtime-voice.test.tsx`
 * is declared. The full library has no `@types/*` package in our deps; this
 * shim keeps TypeScript strict-mode happy without polluting node_modules.
 */
declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  export interface TestRenderer {
    unmount(): void;
    update(element: ReactElement): void;
    root: unknown;
    toJSON(): unknown;
  }

  export function create(element: ReactElement): TestRenderer;
  export function act(callback: () => void | Promise<void>): void;
}
