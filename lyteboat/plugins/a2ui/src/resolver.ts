/**
 * Resolve a card's manifest against raw data into the flat binding table.
 * A port of the reference implementation's template_engine/resolver.py: `state` entries read a path
 * (with an optional default), `transform` entries run the transforms DSL,
 * `computed` entries call a named export of the card's compute module with
 * `state:<path>` arguments pre-resolved.
 * @module @lyteboat/a2ui/resolver
 */

import { executeTransforms, resolvePath, TransformError } from './transforms.ts'
import type { A2uiLog, RawData } from './transforms.ts'
import { SILENT_LOG } from './transforms.ts'

export type ComputeModule = Record<string, unknown>
export type ManifestPaths = Record<string, Record<string, unknown>>

const STATE_PREFIX = 'state:'

function resolveArg(arg: unknown, raw: RawData): unknown {
  if (typeof arg === 'string' && arg.startsWith(STATE_PREFIX)) {
    try {
      return resolvePath(raw, arg.slice(STATE_PREFIX.length))
    } catch (error: unknown) {
      if (error instanceof TransformError) return null
      throw error
    }
  }
  return arg
}

function resolveState(key: string, entry: Record<string, unknown>, raw: RawData, warnings: string[]): unknown {
  const path = typeof entry['path'] === 'string' ? entry['path'] : ''
  try {
    return resolvePath(raw, path)
  } catch (error: unknown) {
    if (!(error instanceof TransformError)) throw error
    if (Object.hasOwn(entry, 'default')) return entry['default']
    warnings.push(`[MANIFEST] state '${key}' path '${path}' 解析失败: ${error.message}`)
    return ''
  }
}

function resolveComputed(key: string, entry: Record<string, unknown>, raw: RawData, compute: ComputeModule | undefined, warnings: string[], log: A2uiLog): unknown {
  const fnName = typeof entry['fn'] === 'string' ? entry['fn'] : ''
  const fn = compute?.[fnName]
  // The reference implementation degrades a missing export to a warning and a blank value at render
  // time, not at load; kept, with its message, for golden fidelity.
  if (typeof fn !== 'function') {
    warnings.push(`[MANIFEST] computed '${key}': compute.js 缺少导出 '${fnName}'`)
    return ''
  }
  const args = (Array.isArray(entry['args']) ? entry['args'] : []).map(arg => resolveArg(arg, raw))
  try {
    return (fn as (...values: unknown[]) => unknown)(...args)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`[MANIFEST] computed '${key}' fn '${fnName}' 执行失败: ${message}`)
    log.warn(`compute fn '${fnName}' for key '${key}' failed: ${message}`)
    return ''
  }
}

/**
 * Resolve every manifest entry: state first, then transforms, then computed.
 * @returns the flat data and the warnings for entries that degraded.
 */
export function resolveManifest(manifest: ManifestPaths, raw: RawData, compute: ComputeModule | undefined, log: A2uiLog = SILENT_LOG): { flat: Record<string, unknown>; warnings: string[] } {
  const flat: Record<string, unknown> = {}
  const warnings: string[] = []
  const transforms: Record<string, unknown> = {}
  const computed: Record<string, Record<string, unknown>> = {}
  for (const [key, entry] of Object.entries(manifest)) {
    const kind = entry['kind']
    // An unknown kind degrades to a warning at render time, not a load failure: the reference
    // implementation's behavior and message, kept for golden fidelity.
    if (kind === 'state') flat[key] = resolveState(key, entry, raw, warnings)
    else if (kind === 'transform') transforms[key] = entry['spec'] ?? {}
    else if (kind === 'computed') computed[key] = entry
    else warnings.push(`[MANIFEST] '${key}': 未知 kind=${kind === undefined ? 'None' : `'${String(kind)}'`}`)
  }
  if (Object.keys(transforms).length > 0) {
    const result = executeTransforms(transforms, raw, log)
    Object.assign(flat, result.computed)
    warnings.push(...result.warnings)
  }
  for (const [key, entry] of Object.entries(computed)) flat[key] = resolveComputed(key, entry, raw, compute, warnings, log)
  return { flat, warnings }
}
