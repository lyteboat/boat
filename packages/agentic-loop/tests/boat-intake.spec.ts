/**
 * boat: the intake gate and the pre-assembly hook — the fork's own behavior
 * on top of the upstream contract suite.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import AgentLoop from '@boat/agentic-loop'
import * as AgentLoopInvariant from '@boat/agentic-loop/invariant'
import { mountAgentLoopTestDependencies } from '@boat/agentic-loop-testkit'
import { BOAT_ASSISTANT_PROVIDER, type IntakeDecision } from '@boat/contracts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function harness(adapter: MockAdapter): Promise<{ ctx: Context }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return { ctx }
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function typesOf(events: readonly SessionEvent[]): string[] {
  return events.map(event => event.type).filter(type => !type.startsWith('agent/inbox/'))
}

describe('boat/intake', () => {
  it('answers a rejected step with a fixed reply and no model request, keeping node 0 for the prompt', async () => {
    const adapter = new MockAdapter([textResponse('model answer')])
    const { ctx } = await harness(adapter)
    ctx.on('boat/intake', async (payload, next): Promise<IntakeDecision> => {
      const text = payload.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('')
      if (!/股票/u.test(text)) return next()
      return {
        kind: 'reply',
        plugin: 'test-gate',
        content: [{ type: 'text', text: '不提供股票建议' }],
      }
    })
    const agent = await ctx.agentLoop.create(SessionId('intake-reply'), { provider: 'mock', model: 'mock' })

    await send(agent, '帮我买股票')
    expect(adapter.requests).toHaveLength(0)
    const events = agent.session.snapshotEvents()
    expect(typesOf(events)).toEqual([
      'turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end',
    ])
    const turnEnd = events.at(-1) as SessionEvent<'turn/end'>
    expect(turnEnd.data.reason).toEqual({ kind: 'completed' })
    const reply = events.find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')!
    expect(reply.data.message.source).toEqual({ kind: 'model', provider: BOAT_ASSISTANT_PROVIDER, model: 'test-gate' })
    expect(reply.data.stream).toEqual([])
    // An empty system head projects to no wire message, but it holds surface node 0.
    expect(agent.session.deriveMessages().map(message => message.role)).toEqual(['user', 'assistant'])
    expect(agent.session.eventAt(agent.session.surface.nodes[0]!)?.type).toBe('system/message')

    // The next admitted step assembles a real prompt: it replaces node 0 instead of trailing the history.
    await send(agent, '看看资产配置')
    expect(adapter.requests).toHaveLength(1)
    const request = adapter.requests[0] as GenerateOptions
    expect(request.messages[0]?.role).toBe('system')
    expect(request.messages.filter(message => message.role === 'system')).toHaveLength(1)
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    const headSeq = agent.session.surface.nodes[0]!
    expect(agent.session.eventAt(headSeq)?.type).toBe('system/message')
  })

  it('replaces the empty head on an in-history route too: the first request of a session starts its series', async () => {
    const adapter = new MockAdapter([textResponse('model answer')])
    adapter.systemPromptUpdate = 'in-history'
    const { ctx } = await harness(adapter)
    ctx.on('boat/intake', async (payload, next): Promise<IntakeDecision> => {
      const text = payload.messages.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('')
      if (!/股票/u.test(text)) return next()
      return { kind: 'reply', plugin: 'test-gate', content: [{ type: 'text', text: '不提供股票建议' }] }
    })
    const agent = await ctx.agentLoop.create(SessionId('intake-in-history'), { provider: 'mock', model: 'mock' })
    await send(agent, '帮我买股票')
    await send(agent, '看看资产配置')
    const request = adapter.requests[0] as GenerateOptions
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    const systemNodes = agent.session.snapshotEvents().filter(event => event.type === 'system/message')
    expect(systemNodes).toHaveLength(2)
    expect(systemNodes[1]?.surfaceOp).toEqual({ op: 'replace', startSeq: systemNodes[0]?.seq, endSeq: systemNodes[0]?.seq })
  })

  it('passes by default and never fires under an unhandled step', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const { ctx } = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('intake-pass'), { provider: 'mock', model: 'mock' })
    await send(agent, 'hello')
    expect(adapter.requests).toHaveLength(1)
    const reply = agent.session.snapshotEvents().find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')!
    expect(reply.data.message.source).toEqual({ kind: 'model', provider: 'mock', model: 'mock' })
  })
})

describe('boat/pre-assemble', () => {
  it('runs before assembly, so a section registered there reaches this step\'s request', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const { ctx } = await harness(adapter)
    let registered = false
    ctx.on('boat/pre-assemble', async (payload, next) => {
      if (!registered) {
        registered = true
        payload.agent.ctx.systemPrompt.section({ name: 'boat:test-mark', order: 5, text: 'PRE-ASSEMBLE-MARK' })
      }
      return next()
    })
    const agent = await ctx.agentLoop.create(SessionId('pre-assemble'), { provider: 'mock', model: 'mock' })
    await send(agent, 'hello')
    expect(adapter.requests).toHaveLength(1)
    const system = adapter.requests[0]!.messages[0]!
    expect(system.role).toBe('system')
    expect(JSON.stringify(system.content)).toContain('PRE-ASSEMBLE-MARK')
  })
})
