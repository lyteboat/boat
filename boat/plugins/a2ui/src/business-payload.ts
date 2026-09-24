/**
 * The `businessPayload` layer: the resolved data behind a rendered card,
 * restricted to the manifest keys the walk actually bound, in key order.
 * A port of the reference implementation's business_payload.py for template mode.
 * @module @boat/a2ui/business-payload
 */

import type { A2uiLog } from './transforms.ts'
import { SILENT_LOG } from './transforms.ts'

export const BUSINESS_PAYLOAD_KEY = 'businessPayload'

function jsonSafe(value: unknown, path: string, log: A2uiLog): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    log.warn(`[A2UI] businessPayload '${path}' 非有限浮点(${String(value)}),降级为字符串`)
    return String(value)
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonSafe(item, `${path}[${String(index)}]`, log))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item, `${path}.${key}`, log)]))
  log.warn(`[A2UI] businessPayload '${path}' 类型 ${typeof value} 不可 JSON 序列化,降级为字符串`)
  return String(value)
}

/** `flat` restricted to `boundPaths`, sorted by key, coerced to JSON. */
export function templateBusinessPayload(flat: Record<string, unknown>, boundPaths: ReadonlySet<string>, log: A2uiLog = SILENT_LOG): Record<string, unknown> {
  const keys = [...boundPaths].filter(key => Object.hasOwn(flat, key)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  return Object.fromEntries(keys.map(key => [key, jsonSafe(flat[key], key, log)]))
}
