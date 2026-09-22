/**
 * `--plugin <file>`: insert one local ESM plugin file as a row of the booted
 * tree, so a plugin can be run before it is packaged. The loader imports the
 * file by URL and the file's own bare imports resolve from its directory, so
 * this works for files inside the boat checkout or its installation closure.
 * @module @boat/cli/plugins
 */

import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** The row id a plugin file is inserted under. */
export function pluginRowId(file: string): string {
  return `plugin:${basename(file).replace(/\.[cm]?js$/u, '')}`
}

/**
 * The patch layer inserting every `--plugin` file, in argv order.
 * @param files - plugin file paths, resolved against the working directory.
 * @returns the overlay; empty without files.
 * @throws when a file does not exist.
 */
export function pluginOverlay(files: readonly string[]): PatchOptions[] {
  if (files.length === 0) return []
  const rows = files.map((file) => {
    const absolute = resolve(file)
    if (!existsSync(absolute)) throw new Error(`boat: --plugin file not found: ${absolute}`)
    return { id: pluginRowId(absolute), name: pathToFileURL(absolute).href }
  })
  return [{ insert: rows }]
}
