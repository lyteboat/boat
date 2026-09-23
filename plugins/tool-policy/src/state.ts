/**
 * The `boatState` projection: the session's accumulated tool state, folded
 * from the `stateDelta` a successful `tool/result` carries on
 * `meta.boat.stateDelta`. A delta is a JSON object whose top-level keys are
 * dot paths (`assets.total`); each path is assigned into the state, nested
 * plain objects deep-merge (the reference `apply_state_delta` overwrites the leaf
 * instead; boat keeps sibling fields a partial refresh did not mention),
 * every other value replaces. The fold is immutable and returns the same
 * reference when nothing changed.
 * @module @boat/tool-policy/state
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { BoatStateValue, JsonValue } from '@boat/contracts'

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]))

export const boatStateSchema: z.ZodType<BoatStateValue> = z.record(z.string(), jsonValueSchema)

/** Whether a JSON value is a plain object (the only shape that merges). */
export function isJsonObject(value: JsonValue | undefined): value is BoatStateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merge two plain objects without splitting keys; returns `target` when nothing changed. */
function deepMerge(target: BoatStateValue, source: BoatStateValue): BoatStateValue {
  let next = target
  for (const [key, value] of Object.entries(source)) {
    const current = next[key]
    const replacement = isJsonObject(value) && isJsonObject(current) ? deepMerge(current, value) : value
    if (Object.is(replacement, current)) continue
    next = { ...next, [key]: replacement }
  }
  return next
}

function assignPath(target: BoatStateValue, path: readonly string[], value: JsonValue): BoatStateValue {
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
export function mergeStateDelta(state: BoatStateValue, delta: JsonValue): BoatStateValue {
  if (!isJsonObject(delta)) throw new Error('state delta must be a JSON object keyed by dot paths')
  let next = state
  for (const [path, value] of Object.entries(delta)) {
    const segments = path.split('.')
    if (segments.some(segment => segment === '')) throw new Error(`state delta path ${JSON.stringify(path)} has an empty segment`)
    next = assignPath(next, segments, value)
  }
  return next
}

/** The delta a result's presentation meta carries under `boat.stateDelta`, when the meta is a JSON object. */
export function stateDeltaOfMeta(meta: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(meta)) return undefined
  const boat = meta['boat']
  if (!isJsonObject(boat)) return undefined
  return boat['stateDelta']
}

export const boatStateProjectionDefinition = {
  key: 'boatState',
  stateSchema: boatStateSchema,
  init: (): BoatStateValue => ({}),
  apply(state: BoatStateValue, event) {
    // dsh computes presentation meta for top-level calls only, so a subagent's
    // tool never reaches here; an errored result carries no delta worth folding.
    if (event.type !== 'tool/result') return state
    const block = event.data.message.content.find(candidate => candidate.type === 'tool-result')
    if (block?.isError === true) return state
    const delta = stateDeltaOfMeta(event.data.meta)
    if (delta === undefined) return state
    if (!isJsonObject(delta)) throw new Error(`tool result at session seq ${String(event.seq)} carries a non-object state delta`)
    try {
      return mergeStateDelta(state, delta)
    } catch (error: unknown) {
      throw new Error(`invalid state delta at session seq ${String(event.seq)}`, { cause: error })
    }
  },
  wire: { viewSchema: boatStateSchema, view: (state: BoatStateValue) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'boatState', BoatStateValue>

/** The model-facing rendering of the current state; empty when there is none. */
export function renderBoatState(state: BoatStateValue | undefined): string {
  if (state === undefined || Object.keys(state).length === 0) return ''
  return `Session state, accumulated from tool results (JSON):\n${JSON.stringify(state)}`
}
