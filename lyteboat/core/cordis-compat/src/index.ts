/**
 * Runtime mirrors of `declare const enum`s from the published `@deepseek-ai/cordis`
 * build. tsc inlines const enums, but the esbuild transforms behind vitest and tsx
 * do not, so any `FiberState.X` read from a dependency is `undefined` at runtime.
 * lyteboat compiles with `isolatedModules`, which turns such reads into TS2748; this
 * module is the one place that spells the values out. A test checks every value
 * against the installed `fiber.d.ts`.
 * @module @lyteboat/cordis-compat
 */

import type { FiberState } from '@deepseek-ai/cordis'

/** Lifecycle states of a Cordis fiber, by value (cordis `lib/types/fiber.d.ts`). */
export const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const
