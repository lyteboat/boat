/**
 * The agent directory `boat run --agents <root> --agent <id>` composes from:
 * `<root>/<id>/agent.cordis.yml` holds the agent's plugin rows (a Cordis
 * entry list, `!!js` included) and the optional `<root>/<id>/preset.yml` its
 * display `name`, `description`, and `order`. A directory reads into one dsh
 * agent preset declaration: the id is the directory name, the rows are taken
 * verbatim, and the display fields come from `preset.yml`.
 *
 * Adapted from deepseek-ai/deepseek-harness packages/preset/agent-presets/src/discovery.ts
 * and metadata.ts @ dsh-v0.1.5-alpha.2 (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md.
 * Differences: one directory is read on demand instead of a roster, and a
 * malformed `preset.yml` fails loud instead of degrading to no metadata.
 * @module @boat/run/agent-directory
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load, type LoadOptions } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** The composition file that makes a directory an agent. */
export const AGENT_COMPOSITION_FILE = 'agent.cordis.yml'

/** The optional display-metadata file beside the composition. */
export const AGENT_METADATA_FILE = 'preset.yml'

function isAgentDirectory(root: string, name: string): boolean {
  return existsSync(join(root, name, AGENT_COMPOSITION_FILE))
}

/**
 * The agent ids a set of roots holds: every direct subdirectory with an agent composition.
 * @param roots - absolute agent root directories.
 * @returns the ids, deduplicated and sorted.
 */
export function agentIds(roots: readonly string[]): string[] {
  const ids = new Set<string>()
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && isAgentDirectory(root, entry.name)) ids.add(entry.name)
    }
  }
  return [...ids].sort()
}

/**
 * Locate one agent: the first root whose direct subdirectory of that name holds an agent composition.
 * @param roots - absolute agent root directories, in precedence order.
 * @param id - the agent id (a directory name, never a path).
 * @returns the agent directory, or undefined when no root holds the id.
 */
export function findAgentDirectory(roots: readonly string[], id: string): string | undefined {
  for (const root of roots) {
    const match = readdirSync(root, { withFileTypes: true }).find(entry => entry.isDirectory() && entry.name === id)
    if (match !== undefined && isAgentDirectory(root, id)) return join(root, id)
  }
  return undefined
}

function readYaml(path: string, options?: LoadOptions): unknown {
  try {
    return load(readFileSync(path, 'utf8'), options)
  } catch (error: unknown) {
    throw new Error(`boat run: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function displayFields(dir: string): Pick<PresetDefinition, 'name' | 'description' | 'order'> {
  const path = join(dir, AGENT_METADATA_FILE)
  if (!existsSync(path)) return {}
  const raw = readYaml(path)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`boat run: ${path} must be a mapping of name, description, and order`)
  const { name, description, order } = raw as Record<string, unknown>
  if (name !== undefined && typeof name !== 'string') throw new Error(`boat run: ${path}: name must be a string`)
  if (description !== undefined && typeof description !== 'string') throw new Error(`boat run: ${path}: description must be a string`)
  if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order))) throw new Error(`boat run: ${path}: order must be a finite number`)
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
  }
}

/**
 * Read one agent directory into its preset declaration. The row list is
 * checked for being a list only; the preset registry judges the rows
 * themselves and refuses a composition it cannot mount.
 * @param id - the agent id.
 * @param dir - the agent directory.
 * @returns the declaration to register.
 * @throws when a file is unreadable or not the shape its role requires.
 */
export function readAgentDefinition(id: string, dir: string): PresetDefinition {
  const path = join(dir, AGENT_COMPOSITION_FILE)
  const rows = readYaml(path, { schema: entryListSchema })
  if (!Array.isArray(rows)) throw new Error(`boat run: ${path} must be a list of plugin rows`)
  // YAML boundary: beyond being a list the rows are unchecked here; the registry validates each one.
  return { id, ...displayFields(dir), plugins: rows }
}
