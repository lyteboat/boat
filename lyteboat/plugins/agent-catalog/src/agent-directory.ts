/**
 * An agent directory: `<root>/<id>/agent.cordis.yml` holds the agent's plugin
 * rows (a Cordis entry list, `!!js` included) and the optional
 * `<root>/<id>/agent.yml` its manifest (`LyteboatAgentManifest`: display
 * fields, version, model). A directory reads into one dsh agent preset
 * declaration (the id is the directory name, the rows are taken verbatim, the
 * display fields come from the manifest) and the manifest fields the preset
 * registry has no place for.
 *
 * The discovery is adapted from deepseek-ai/deepseek-harness
 * packages/preset/agent-presets/src/discovery.ts @ dsh-v0.1.5-alpha.2
 * (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md. Differences: a directory's id
 * must be unique across the roots; the manifest is lyteboat's and a malformed
 * one fails loud.
 * @module @lyteboat/agent-catalog/agent-directory
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load, type LoadOptions } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { lyteboatAgentManifestSchema, type LyteboatAgentManifest, type LyteboatAgentModel } from '@lyteboat/contracts'

/** The composition file that makes a directory an agent. */
const AGENT_COMPOSITION_FILE = 'agent.cordis.yml'

/** The optional manifest beside the composition. */
const AGENT_MANIFEST_FILE = 'agent.yml'

/** The display-metadata file the manifest replaced; its presence is a stale directory. */
const RETIRED_METADATA_FILE = 'preset.yml'

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

/** One agent directory the roots hold. */
export interface AgentCatalogLocation {
  readonly id: string
  readonly dir: string
}

/**
 * The agent directories to declare: every agent the roots hold, or the
 * `include`d ones in that order.
 * @param roots - absolute agent root directories.
 * @param include - the ids to take; empty or absent takes every agent.
 * @returns the locations, sorted by id without `include`.
 * @throws when a root is not a directory, two roots hold the same id, or no root holds an included id.
 */
export function locateAgents(roots: readonly string[], include: readonly string[] | undefined): AgentCatalogLocation[] {
  const found = new Map<string, string>()
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`agent-catalog: agent root not found: ${root}`)
    for (const id of agentIds([root])) {
      const other = found.get(id)
      if (other !== undefined) throw new Error(`agent-catalog: agent "${id}" is in two roots: ${other} and ${root}`)
      found.set(id, root)
    }
  }
  const ids = include !== undefined && include.length > 0 ? include : [...found.keys()].sort()
  const missing = ids.filter(id => !found.has(id))
  if (missing.length > 0) throw new Error(`agent-catalog: no root holds ${missing.map(id => JSON.stringify(id)).join(', ')} (available: ${[...found.keys()].sort().join(', ') || 'none'})`)
  return ids.map(id => ({ id, dir: join(found.get(id) ?? '', id) }))
}

function readYaml(path: string, options?: LoadOptions): unknown {
  try {
    return load(readFileSync(path, 'utf8'), options)
  } catch (error: unknown) {
    throw new Error(`agent-catalog: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function readManifest(dir: string): LyteboatAgentManifest {
  if (existsSync(join(dir, RETIRED_METADATA_FILE))) {
    throw new Error(`agent-catalog: ${join(dir, RETIRED_METADATA_FILE)} is now ${AGENT_MANIFEST_FILE}: rename it (name, description, and order stay; version and model are new)`)
  }
  const path = join(dir, AGENT_MANIFEST_FILE)
  if (!existsSync(path)) return {}
  const parsed = lyteboatAgentManifestSchema.safeParse(readYaml(path) ?? {})
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.') || '(the file)'}: ${issue.message}`)
    throw new Error(`agent-catalog: ${path}: ${problems.join('; ')}`)
  }
  return parsed.data
}

/** One agent directory read: the preset the registry mounts, and the manifest fields it has no place for. */
export interface AgentDirectoryDefinition {
  readonly preset: PresetDefinition
  readonly version?: string
  readonly model?: LyteboatAgentModel
}

/**
 * Read one agent directory into its preset declaration and manifest. The row
 * list is checked for being a list only; the preset registry judges the rows
 * themselves and refuses a composition it cannot mount.
 * @param id - the agent id.
 * @param dir - the agent directory.
 * @returns the declaration to register, with the manifest's version and model.
 * @throws when a file is unreadable or not the shape its role requires, or the retired `preset.yml` is still there.
 */
export function readAgentDefinition(id: string, dir: string): AgentDirectoryDefinition {
  const path = join(dir, AGENT_COMPOSITION_FILE)
  const rows = readYaml(path, { schema: entryListSchema })
  if (!Array.isArray(rows)) throw new Error(`agent-catalog: ${path} must be a list of plugin rows`)
  const { name, description, order, version, model } = readManifest(dir)
  return {
    // YAML boundary: beyond being a list the rows are unchecked here; the registry validates each one.
    preset: {
      id,
      ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...order === undefined ? {} : { order },
      plugins: rows,
    },
    ...version === undefined ? {} : { version },
    ...model === undefined ? {} : { model },
  }
}
