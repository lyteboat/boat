/**
 * Load and cache a card's template bundle: `template.json`, `manifest.yaml`
 * (`paths`, `args`, `emission_mode`), `business_hierarchy.yaml` (`default`,
 * `hierarchies`) and the optional `compute.js` ESM module (named exports: the
 * manifest's computed functions, plus the `digest(raw, flat)` and
 * `stateDelta(raw, flat)` hooks). A port of ark's template_engine/loader.py
 * with `compute.py` replaced by an ES module.
 * @module @boat/a2ui/loader
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import type { A2uiLog } from './transforms.ts'
import { SILENT_LOG } from './transforms.ts'
import type { ComputeModule, ManifestPaths } from './resolver.ts'
import type { TemplateDocument } from './walker.ts'

export type EmissionMode = 'immediate' | 'deferred'

export type ComputeHook = (raw: Record<string, unknown>, flat: Record<string, unknown>) => unknown

/** One card's resolved authoring artifacts. */
export interface TemplateBundle {
  readonly name: string
  readonly template: TemplateDocument
  readonly manifest: ManifestPaths
  readonly hierarchies: Record<string, { root?: string; ui_ids?: string[] }>
  readonly defaultHierarchy: string
  readonly argSpecs: Record<string, Record<string, unknown>>
  readonly compute: ComputeModule | undefined
  readonly digest: ComputeHook | undefined
  readonly stateDelta: ComputeHook | undefined
  readonly emissionMode: EmissionMode | undefined
  readonly mtimes: string
}

const FILES = ['template.json', 'manifest.yaml', 'business_hierarchy.yaml', 'compute.js'] as const

const cache = new Map<string, TemplateBundle>()

function mtimeOf(path: string): number {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.mtimeMs : 0
  } catch {
    return 0
  }
}

function fileMtimes(cardDir: string): string {
  return FILES.map(name => String(mtimeOf(join(cardDir, name)))).join(',')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readYaml(path: string): Record<string, unknown> {
  if (mtimeOf(path) === 0) return {}
  const doc: unknown = parseYaml(readFileSync(path, 'utf8'))
  return isRecord(doc) ? doc : {}
}

async function loadCompute(cardDir: string): Promise<ComputeModule | undefined> {
  const path = join(cardDir, 'compute.js')
  const mtime = mtimeOf(path)
  if (mtime === 0) return undefined
  // The query defeats the ESM cache when the file changed on disk.
  const url = `${pathToFileURL(path).href}?mtime=${String(mtime)}`
  const module: unknown = await import(url)
  return isRecord(module) ? module : undefined
}

function hookOf(compute: ComputeModule | undefined, ...names: string[]): ComputeHook | undefined {
  for (const name of names) {
    const candidate = compute?.[name]
    if (typeof candidate === 'function') return candidate as ComputeHook
  }
  return undefined
}

/** Whether `root/card/template.json` exists. */
export function isCardDir(root: string, card: string): boolean {
  return mtimeOf(join(root, card, 'template.json')) !== 0
}

/**
 * Load (or return the cached) bundle for `root/card/`.
 * @param root - the templates root directory.
 * @param card - the card directory name.
 * @param log - the degradation sink.
 */
export async function loadBundle(root: string, card: string, log: A2uiLog = SILENT_LOG): Promise<TemplateBundle> {
  const cardDir = join(root, card)
  let isDir = false
  try {
    isDir = statSync(cardDir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) throw new Error(`template 卡目录不存在: ${card} (路径: ${cardDir})`)
  const mtimes = fileMtimes(cardDir)
  const cached = cache.get(cardDir)
  if (cached !== undefined && cached.mtimes === mtimes) return cached
  const templatePath = join(cardDir, 'template.json')
  if (mtimeOf(templatePath) === 0) throw new Error(`template.json 不存在: ${templatePath}`)
  const template = JSON.parse(readFileSync(templatePath, 'utf8')) as TemplateDocument
  const manifestDoc = readYaml(join(cardDir, 'manifest.yaml'))
  const manifest = isRecord(manifestDoc['paths']) ? manifestDoc['paths'] as ManifestPaths : {}
  const argSpecs = isRecord(manifestDoc['args']) ? manifestDoc['args'] as Record<string, Record<string, unknown>> : {}
  let emissionMode: EmissionMode | undefined
  const rawMode = manifestDoc['emission_mode']
  if (rawMode !== undefined && rawMode !== null) {
    const text = String(rawMode).trim()
    if (text === 'immediate' || text === 'deferred') emissionMode = text
    else log.warn(`template '${card}' manifest.emission_mode=${JSON.stringify(rawMode)} not in {immediate,deferred}; ignoring`)
  }
  const hierarchyDoc = readYaml(join(cardDir, 'business_hierarchy.yaml'))
  const hierarchies = isRecord(hierarchyDoc['hierarchies']) ? hierarchyDoc['hierarchies'] as TemplateBundle['hierarchies'] : {}
  const declaredDefault = hierarchyDoc['default']
  const defaultHierarchy = typeof declaredDefault === 'string' && declaredDefault !== '' ? declaredDefault : Object.keys(hierarchies)[0] ?? card
  const compute = await loadCompute(cardDir)
  const bundle: TemplateBundle = {
    name: card,
    template,
    manifest,
    hierarchies,
    defaultHierarchy,
    argSpecs,
    compute,
    digest: hookOf(compute, 'digest'),
    stateDelta: hookOf(compute, 'stateDelta', 'state_delta'),
    emissionMode,
    mtimes,
  }
  cache.set(cardDir, bundle)
  return bundle
}
