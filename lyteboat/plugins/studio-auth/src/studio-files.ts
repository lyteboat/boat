/**
 * The files Studio keeps under its directory (`$LYTEBOAT_HOME/studio` by
 * default): each is JSON, read whole, and replaced whole through a temporary
 * file and a rename, so a reader never sees half a write. They hold account
 * hashes, role grants, and the token secret, so they are created 0600.
 * @module @lyteboat/studio-auth/studio-files
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Read a JSON file Studio wrote; undefined when it does not exist.
 * @throws when the file exists but is not JSON.
 */
export function readStudioJson(file: string): unknown {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch (error: unknown) {
    throw new Error(`studio-auth: ${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** Replace a JSON file whole, readable by its owner only. */
export function writeStudioJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(file), `.${randomBytes(6).toString('hex')}.tmp`)
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(temporary, file)
}
