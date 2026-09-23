import { describe, expect, it } from 'vitest'
import { mergeStateDelta, renderBoatState } from '@boat/tool-policy'

describe('mergeStateDelta', () => {
  it('assigns dot paths, creating intermediate objects', () => {
    const next = mergeStateDelta({}, { 'assets.total': 1234, 'assets.currency': 'CNY' })
    expect(next).toEqual({ assets: { total: 1234, currency: 'CNY' } })
  })

  it('deep-merges nested plain objects and replaces every other value', () => {
    const state = { assets: { total: 1, tags: ['a'] }, user: 'x' }
    const next = mergeStateDelta(state, { assets: { total: 2, tags: ['b'] }, user: { name: 'y' } })
    expect(next).toEqual({ assets: { total: 2, tags: ['b'] }, user: { name: 'y' } })
    expect(state).toEqual({ assets: { total: 1, tags: ['a'] }, user: 'x' })
  })

  it('returns the same reference when nothing changed', () => {
    const state = { assets: { total: 1 } }
    expect(mergeStateDelta(state, { 'assets.total': 1 })).toBe(state)
    expect(mergeStateDelta(state, {})).toBe(state)
  })

  it('replaces a scalar on the path with an object', () => {
    expect(mergeStateDelta({ assets: 5 }, { 'assets.total': 1 })).toEqual({ assets: { total: 1 } })
  })

  it('rejects non-object deltas and empty path segments', () => {
    expect(() => mergeStateDelta({}, [1])).toThrow(/JSON object/u)
    expect(() => mergeStateDelta({}, { 'a..b': 1 })).toThrow(/empty segment/u)
  })
})

describe('renderBoatState', () => {
  it('renders nothing for an empty or absent state', () => {
    expect(renderBoatState(undefined)).toBe('')
    expect(renderBoatState({})).toBe('')
  })

  it('renders the JSON state under a fixed heading', () => {
    expect(renderBoatState({ a: 1 })).toBe('Session state, accumulated from tool results (JSON):\n{"a":1}')
  })
})
