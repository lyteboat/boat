import { describe, expect, it } from 'vitest'
import { HISTORY_IMPORT_MODEL, seedFromRounds } from '@boat/history-import'
import type { HistoryRound } from '@boat/history-import'
import { BOAT_ASSISTANT_PROVIDER, BOAT_HISTORY_IMPORT_PLUGIN } from '@boat/contracts'

const round = (traceId: string): HistoryRound => ({ traceId, createTime: undefined, user: { text: `u-${traceId}`, meta: {} }, assistant: { text: `a-${traceId}`, meta: {} } })

describe('seedFromRounds', () => {
  it('writes one closed turn per round with contiguous seqs, an empty system head on node 0, and the audit node last', () => {
    const { events, imported, skipped } = seedFromRounds([round('t1'), round('t2')], { source: 'sa.json', time: 5 })
    expect(skipped).toBe(0)
    expect(imported).toHaveLength(2)
    expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))
    expect(events.every(event => event.time === 5)).toBe(true)
    expect(events.map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end',
      'turn/start', 'step/start', 'user/message', 'assistant/message', 'step/end', 'turn/end',
      'boat/history-imported',
    ])
    expect(events[0]!.data).toEqual({ turn: 1 })
    expect(events[7]!.data).toEqual({ turn: 2 })
    expect(events[6]!.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    const head = events[2]!.data as { message: { content: unknown[]; source: { plugin: string } } }
    expect(head.message.content).toEqual([])
    expect(head.message.source.plugin).toBe('@deepseek-ai/dsh-system-prompt')
    expect(events[2]!.surfaceOp).toBe('append')
    const user = events[3]!.data as { content: { text: string }[]; source: { kind: string; plugin: string } }
    expect(user.source).toEqual({ kind: 'plugin', plugin: BOAT_HISTORY_IMPORT_PLUGIN })
    expect(user.content[0]!.text).toBe('u-t1')
    expect(events[3]!.surfaceOp).toBe('append')
    const assistant = events[4]!.data as { turn: number; step: number; stream: unknown[]; message: { source: { kind: string; provider: string; model: string }; content: { text: string }[] } }
    expect(assistant).toMatchObject({ turn: 1, step: 1, stream: [] })
    expect(assistant.message.source).toEqual({ kind: 'model', provider: BOAT_ASSISTANT_PROVIDER, model: HISTORY_IMPORT_MODEL })
    expect(events.at(-1)!.data).toEqual({ source: 'sa.json', traceIds: ['t1', 't2'], rounds: 2 })
  })

  it('skips known trace ids, continues turn and seq numbering, and writes no head when one exists', () => {
    const { events, skipped } = seedFromRounds([round('t1'), round('t2')], { source: 's', knownTraceIds: new Set(['t1']), startTurn: 4, startSeq: 10, hasSystemNode: true })
    expect(skipped).toBe(1)
    expect(events.map(event => event.type)).toEqual(['turn/start', 'step/start', 'user/message', 'assistant/message', 'step/end', 'turn/end', 'boat/history-imported'])
    expect(events[0]!.seq).toBe(10)
    expect(events[0]!.data).toEqual({ turn: 4 })
    expect(events.at(-1)!.data).toEqual({ source: 's', traceIds: ['t2'], rounds: 1 })
  })

  it('produces nothing when every round is known', () => {
    expect(seedFromRounds([round('t1')], { source: 's', knownTraceIds: new Set(['t1']) })).toEqual({ events: [], imported: [], skipped: 1 })
  })
})
