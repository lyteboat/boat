/**
 * lyteboat's data directory. Every dsh package reads `DSH_HOME` through
 * `resolveDshHome()` on each call, so the launcher resolves `LYTEBOAT_HOME` and
 * exports it as `DSH_HOME` before any dsh module loads (bin.ts imports this
 * module first and dynamic-imports the rest). The override is unconditional:
 * a user's own `DSH_HOME` must never receive lyteboat data.
 * @module @lyteboat/cli/home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable that overrides the default lyteboat home. */
export const LYTEBOAT_HOME_ENV = 'LYTEBOAT_HOME'

/** Directory name of the default lyteboat home under the OS home. */
export const LYTEBOAT_HOME_DIR_NAME = '.lyteboat'

/** The dsh environment variable lyteboat's home is exported as. */
const DSH_HOME_ENV = 'DSH_HOME'

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the lyteboat home with the same rules dsh applies to `DSH_HOME`: a blank
 * value counts as unset, and a leading `~` expands to the OS home.
 * @param env - environment mapping to read `LYTEBOAT_HOME` from.
 * @returns the absolute lyteboat home path.
 */
export function resolveLyteboatHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env[LYTEBOAT_HOME_ENV]
  const selected = configured !== undefined && configured.trim().length > 0
    ? configured
    : join(homedir(), LYTEBOAT_HOME_DIR_NAME)
  return resolve(expandHomePath(selected))
}

/**
 * Export the resolved lyteboat home as `DSH_HOME` for every dsh package in this process.
 * @param env - environment mapping to read and write.
 * @returns the absolute lyteboat home path.
 */
export function installLyteboatHome(env: Record<string, string | undefined> = process.env): string {
  const home = resolveLyteboatHome(env)
  env[DSH_HOME_ENV] = home
  return home
}
