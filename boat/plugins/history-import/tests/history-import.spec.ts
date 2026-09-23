/**
 * A seeded session under the driver: the header, the turn numbering, the
 * derived request, the projection, and the invariants.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { MockAdapter, mountDshTestServices, textResponse } from '@boat/testing'
import HistoryImportService, { saHistoryOf } from '@boat/history-import'
import type { HistoryRound } from '@boat/history-import'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await mountDshTestServices(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(HistoryImportService)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return ctx
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

const round = (traceId: string, user: string, assistant: string): HistoryRound => ({ traceId, createTime: undefined, user: { text: user, meta: {} }, assistant: { text: assistant, meta: {} } })

describe('a seeded session', () => {
  it('starts after the imported turns and derives them into the first request', async () => {
    const adapter = new MockAdapter([textResponse('继续')])
    const ctx = await harness(adapter)
    const seed = ctx.historyImport.seed([round('t1', '看看资产', '总额 100'), round('t2', '风险如何', '偏高')])
    const { agent } = await ctx.agents.create({
      sessionId: SessionId('seeded'),
      meta: { isSeeded: true },
      seed: seed.events,
      inheritedEventCount: SessionLogOffset(seed.events.length),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(agent.session.header.isSeeded).toBe(true)
    expect(agent.session.inheritedEventCount).toBe(seed.events.length)
    expect(agent.session.eventAt(agent.session.surface.nodes[0]!)?.type).toBe('system/message')
    expect(seed.events.map(event => event.type).filter(type => type.startsWith('boat/'))).toEqual([])

    await send(agent, '那怎么办')
    const request = adapter.requests[0] as GenerateOptions
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
    expect(JSON.stringify(request.messages[1])).toContain('看看资产')
    expect(JSON.stringify(request.messages[4])).toContain('偏高')
    expect(request.messages.filter(message => message.role === 'system')).toHaveLength(1)
    const events = agent.session.snapshotEvents()
    const starts = events.filter((event): event is SessionEvent<'turn/start'> => event.type === 'turn/start').map(event => event.data.turn)
    expect(starts).toEqual([1, 2, 3])
    expect(events.map(event => event.type)).toContain('session/end-seed')
    expect(events.filter(event => event.type === 'turn/end').at(-1)!.data).toEqual({ turn: 3, reason: { kind: 'completed' } })
    // Only the live turn's prompt replaced node 0: the log still holds one system node per surface head.
    expect(events.filter(event => event.type === 'system/message')).toHaveLength(2)
  })

  it('reads the entry list out of a bare array or an envelope', () => {
    expect(saHistoryOf([1])).toEqual([1])
    expect(saHistoryOf({ sa_history: [2] })).toEqual([2])
    expect(saHistoryOf({ context: { sa_history: [3] } })).toEqual([3])
    expect(saHistoryOf({ other: [] })).toBeUndefined()
  })
})
