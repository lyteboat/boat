/**
 * `--plugin <file>`: insert one local ESM plugin file as a row of the booted
 * tree, so a plugin can be run before it is packaged. The loader imports the
 * file by URL and the file's own bare imports resolve from its directory, so
 * this works for files inside the boat checkout or its installation closure.
 * @module @boat/cli/plugins
 */

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/**
 * The row id a plugin file is inserted under: its path relative to the
 * working directory (absolute when outside it), without the extension, so two
 * files that share a basename (`a/plugin.mjs`, `b/plugin.mjs`) get distinct rows.
 * @param file - the plugin file path.
 * @param cwd - the working directory the path is relative to.
 */
export function pluginRowId(file: string, cwd: string = process.cwd()): string {
  const absolute = resolve(cwd, file)
  const relativePath = relative(cwd, absolute)
  const shown = relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath) ? absolute : relativePath
  return `plugin:${shown.split(sep).join('/').replace(/\.[cm]?js$/u, '')}`
}

/**
 * Check the `--plugin` paths before any tree is composed.
 * @param files - plugin file paths, resolved against `cwd`.
 * @param cwd - the working directory.
 * @returns the first problem as a usage message, or `undefined` when every file exists once.
 */
export function pluginFilesProblem(files: readonly string[], cwd: string = process.cwd()): string | undefined {
  const seen = new Map<string, string>()
  for (const file of files) {
    const absolute = resolve(cwd, file)
    if (!existsSync(absolute)) return `--plugin file not found: ${absolute}`
    const earlier = seen.get(absolute)
    if (earlier !== undefined) return `--plugin names the same file twice: ${earlier} and ${file}`
    seen.set(absolute, file)
  }
  return undefined
}

/**
 * The patch layer inserting every `--plugin` file, in argv order. The paths
 * passed {@link pluginFilesProblem} first.
 * @param files - plugin file paths, resolved against the working directory.
 * @returns the overlay; empty without files.
 */
export function pluginOverlay(files: readonly string[]): PatchOptions[] {
  if (files.length === 0) return []
  const rows = files.map((file) => {
    const absolute = resolve(file)
    return { id: pluginRowId(absolute), name: pathToFileURL(absolute).href }
  })
  return [{ insert: rows }]
}
