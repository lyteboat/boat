/**
 * The `lyteboatState` projection: the session's accumulated tool state, folded
 * from the `stateDelta` a successful `tool/result` carries on
 * `meta.lyteboat.stateDelta`. A delta is a JSON object whose top-level keys are
 * dot paths (`assets.total`); each path is assigned into the state, nested
 * plain objects deep-merge (the reference `apply_state_delta` overwrites the leaf
 * instead; lyteboat keeps sibling fields a partial refresh did not mention),
 * every other value replaces. The fold is immutable and returns the same
 * reference when nothing changed.
 * @module @lyteboat/tool-policy/state
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { LyteboatStateValue, JsonValue } from '@lyteboat/contracts'

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]))

export const lyteboatStateSchema: z.ZodType<LyteboatStateValue> = z.record(z.string(), jsonValueSchema)

/** Whether a JSON value is a plain object (the only shape that merges). */
export function isJsonObject(value: JsonValue | undefined): value is LyteboatStateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merge two plain objects without splitting keys; returns `target` when nothing changed. */
function deepMerge(target: LyteboatStateValue, source: LyteboatStateValue): LyteboatStateValue {
  let next = target
  for (const [key, value] of Object.entries(source)) {
    const current = next[key]
    const replacement = isJsonObject(value) && isJsonObject(current) ? deepMerge(current, value) : value
    if (Object.is(replacement, current)) continue
    next = { ...next, [key]: replacement }
  }
  return next
}

function assignPath(target: LyteboatStateValue, path: readonly string[], value: JsonValue): LyteboatStateValue {
  const [head, ...rest] = path
  /* v8 ignore next -- mergeStateDelta rejects an empty path before descending */
  if (head === undefined) throw new Error('state delta path must not be empty')
  const current = target[head]
  let replacement: JsonValue
  if (rest.length > 0) replacement = assignPath(isJsonObject(current) ? current : {}, rest, value)
  else if (isJsonObject(value) && isJsonObject(current)) replacement = deepMerge(current, value)
  else replacement = value
  if (Object.is(replacement, current)) return target
  return { ...target, [head]: replacement }
}

/**
 * Fold one delta into the state.
 * @param state - the state before the delta.
 * @param delta - a JSON object keyed by dot paths.
 * @returns the next state, or `state` itself when the delta changed nothing.
 */
export function mergeStateDelta(state: LyteboatStateValue, delta: JsonValue): LyteboatStateValue {
  if (!isJsonObject(delta)) throw new Error('state delta must be a JSON object keyed by dot paths')
  let next = state
  for (const [path, value] of Object.entries(delta)) {
    const segments = path.split('.')
    if (segments.some(segment => segment === '')) throw new Error(`state delta path ${JSON.stringify(path)} has an empty segment`)
    next = assignPath(next, segments, value)
  }
  return next
}

/** The delta a result's presentation meta carries under `lyteboat.stateDelta`, when the meta is a JSON object. */
export function stateDeltaOfMeta(meta: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(meta)) return undefined
  const lyteboat = meta['lyteboat']
  if (!isJsonObject(lyteboat)) return undefined
  return lyteboat['stateDelta']
}

export const lyteboatStateProjectionDefinition = {
  key: 'lyteboatState',
  stateSchema: lyteboatStateSchema,
  init: (): LyteboatStateValue => ({}),
  apply(state: LyteboatStateValue, event) {
    // dsh computes presentation meta for top-level calls only, so a subagent's
    // tool never reaches here; an errored result carries no delta worth folding.
    // A surface replacement (compaction pruning, an agent shortening an old
    // result) must keep the original meta, so folding it would apply an old delta
    // over newer state: only the appended result counts.
    if (event.type !== 'tool/result' || event.surfaceOp !== 'append') return state
    if (event.data.message.isError === true) return state
    const delta = stateDeltaOfMeta(event.data.meta)
    if (delta === undefined) return state
    if (!isJsonObject(delta)) throw new Error(`tool result at session seq ${String(event.seq)} carries a non-object state delta`)
    try {
      return mergeStateDelta(state, delta)
    } catch (error: unknown) {
      throw new Error(`invalid state delta at session seq ${String(event.seq)}`, { cause: error })
    }
  },
  wire: { viewSchema: lyteboatStateSchema, view: (state: LyteboatStateValue) => state },
  stateVersion: 2,
} satisfies ProjectionDefinition<'lyteboatState', LyteboatStateValue>

/** The model-facing rendering of the current state; empty when there is none. */
export function renderLyteboatState(state: LyteboatStateValue | undefined): string {
  if (state === undefined || Object.keys(state).length === 0) return ''
  return `Session state, accumulated from tool results (JSON):\n${JSON.stringify(state)}`
}
