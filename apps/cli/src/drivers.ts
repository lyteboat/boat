/**
 * The agent driver switch. dsh-base mounts the official driver as the
 * `agent-loop` row and @boat/host disables it for boat's fork; `--driver dsh`
 * reverses that swap above every file layer. `ctx.agents.setFactory` accepts
 * exactly one factory, so the switch is a boot-time patch layer, never a live swap.
 * @module @boat/cli/drivers
 */

import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** The selectable agent drivers. */
export const DRIVERS = ['dsh', 'boat'] as const

/** One selectable agent driver. */
export type Driver = typeof DRIVERS[number]

/** The driver booted when `--driver` is absent. */
export const DEFAULT_DRIVER: Driver = 'boat'

/** The row id dsh-base gives the official driver. */
export const DSH_DRIVER_ROW_ID = 'agent-loop'

/** The row id @boat/host gives boat's fork. */
export const BOAT_DRIVER_ROW_ID = 'boat-agentic-loop'

/**
 * Whether a `--driver` value names a known driver.
 * @param value - the raw flag value.
 * @returns true for a known driver name.
 */
export function isDriver(value: string): value is Driver {
  return (DRIVERS as readonly string[]).includes(value)
}

/**
 * The patch layer that selects a driver, applied above every file overlay.
 * @param driver - the selected driver.
 * @returns the overlay; empty for the default driver, which @boat/host already mounts.
 */
export function driverOverlay(driver: Driver): PatchOptions[] {
  if (driver === 'boat') return []
  return [
    { id: BOAT_DRIVER_ROW_ID, disabled: true },
    { id: DSH_DRIVER_ROW_ID, disabled: false },
  ]
}
