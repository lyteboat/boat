/**
 * What the `render_a2ui` tool renders from: the raw namespace collected from
 * the session's `lyteboatState`, and the model's `template_args`. Ports of
 * the reference implementation's `_collect_raw_data` and `_parse_object_args`,
 * messages included.
 * @module @lyteboat/a2ui/render-tool-input
 */

import type { LyteboatStateValue } from '@lyteboat/contracts'
import type { RawData } from './transforms.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The reference `_collect_raw_data`: each state key namespaced and flattened. */
export function collectRawData(state: LyteboatStateValue | undefined, stateKeys: readonly string[]): RawData {
  const raw: RawData = {}
  for (const key of stateKeys) {
    let data: unknown = state?.[key]
    if (data === undefined || data === null) continue
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        continue
      }
    }
    if (isRecord(data)) {
      raw[key] = data
      Object.assign(raw, data)
    }
  }
  return raw
}

/** The reference `_parse_object_args`: an object, a JSON object string, or nothing. */
export function parseObjectArgs(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (isRecord(value)) return value
  if (typeof value === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('template_args 必须是 JSON 对象')
    }
    if (isRecord(parsed)) return parsed
  }
  throw new Error('template_args 必须是 JSON 对象')
}
