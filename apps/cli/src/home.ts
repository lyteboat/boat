/**
 * boat's data directory. Every dsh package reads `DSH_HOME` through
 * `resolveDshHome()` on each call, so the launcher resolves `BOAT_HOME` and
 * exports it as `DSH_HOME` before any dsh module loads (bin.ts imports this
 * module first and dynamic-imports the rest). The override is unconditional:
 * a user's own `DSH_HOME` must never receive boat data.
 * @module @boat/cli/home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable that overrides the default boat home. */
export const BOAT_HOME_ENV = 'BOAT_HOME'

/** Directory name of the default boat home under the OS home. */
export const BOAT_HOME_DIR_NAME = '.boat'

/** The dsh environment variable boat's home is exported as. */
const DSH_HOME_ENV = 'DSH_HOME'

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the boat home with the same rules dsh applies to `DSH_HOME`: a blank
 * value counts as unset, and a leading `~` expands to the OS home.
 * @param env - environment mapping to read `BOAT_HOME` from.
 * @returns the absolute boat home path.
 */
export function resolveBoatHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env[BOAT_HOME_ENV]
  const selected = configured !== undefined && configured.trim().length > 0
    ? configured
    : join(homedir(), BOAT_HOME_DIR_NAME)
  return resolve(expandHomePath(selected))
}

/**
 * Export the resolved boat home as `DSH_HOME` for every dsh package in this process.
 * @param env - environment mapping to read and write.
 * @returns the absolute boat home path.
 */
export function installBoatHome(env: Record<string, string | undefined> = process.env): string {
  const home = resolveBoatHome(env)
  env[DSH_HOME_ENV] = home
  return home
}
