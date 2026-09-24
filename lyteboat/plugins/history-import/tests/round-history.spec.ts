import { describe, expect, it } from 'vitest'
import { parseHistoryRounds } from '@lyteboat/history-import'

const entry = (role: 'user' | 'assistant', traceId: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ role, traceId, parts: [{ type: 'text', text }], channel: 'app', ...extra })

describe('parseHistoryRounds', () => {
  it('groups user and assistant entries by trace id into rounds and joins part text', () => {
    const { rounds, dropped } = parseHistoryRounds([
      entry('user', 't1', '  看看资产 ', { createTime: '2026-01-01 10:00:00' }),
      { role: 'assistant', traceId: 't1', parts: [{ text: '总额 100' }, { text: '' }, { text: '三桶均衡' }], createTime: '2026-01-01 10:00:05' },
    ])
    expect(dropped).toEqual({ malformed: 0, duplicated: 0, half: 0, empty: 0 })
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ traceId: 't1', createTime: '2026-01-01 10:00:00', user: { text: '看看资产', meta: { channel: 'app', createTime: '2026-01-01 10:00:00' } }, assistant: { text: '总额 100\n三桶均衡' } })
  })

  it('drops malformed entries, half rounds, empty rounds and keeps the first duplicate role', () => {
    const { rounds, dropped } = parseHistoryRounds([
      'nope',
      { role: 'system', traceId: 'x' },
      entry('user', 'half', '进行中的这一轮'),
      entry('user', 'empty', ''),
      entry('assistant', 'empty', '   '),
      entry('user', 'dup', '第一条'),
      entry('user', 'dup', '第二条'),
      entry('assistant', 'dup', '回答'),
    ])
    expect(dropped).toEqual({ malformed: 2, duplicated: 1, half: 1, empty: 1 })
    expect(rounds.map(round => [round.traceId, round.user.text])).toEqual([['dup', '第一条']])
  })

  it('sorts by createTime only when every round has one, else keeps input order', () => {
    const sorted = parseHistoryRounds([
      entry('user', 'b', 'B', { createTime: '2026-01-02' }), entry('assistant', 'b', 'b'),
      entry('user', 'a', 'A', { createTime: '2026-01-01' }), entry('assistant', 'a', 'a'),
    ])
    expect(sorted.rounds.map(round => round.traceId)).toEqual(['a', 'b'])
    const unsorted = parseHistoryRounds([
      entry('user', 'b', 'B', { createTime: '2026-01-02' }), entry('assistant', 'b', 'b'),
      entry('user', 'a', 'A'), entry('assistant', 'a', 'a'),
    ])
    expect(unsorted.rounds.map(round => round.traceId)).toEqual(['b', 'a'])
  })

  it('treats a non-list as one malformed input', () => {
    expect(parseHistoryRounds({ role: 'user' })).toEqual({ rounds: [], dropped: { malformed: 1, duplicated: 0, half: 0, empty: 0 } })
  })
})
