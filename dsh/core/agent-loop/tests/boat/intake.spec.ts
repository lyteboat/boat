/**
 * boat extension `agent-loop-intake` (contract/extensions.yml): the intake
 * gate between the inbox claim and prompt assembly. Upstream's own suite runs
 * unchanged beside this file; these tests cover only what boat adds.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentLoop, { BOAT_ASSISTANT_PROVIDER, type BoatIntakeDecision } from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from '../mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function textOf(messages: readonly { content: readonly { type: string; text?: string }[] }[]): string {
  return messages.map(message => message.content.map(block => block.text ?? '').join('')).join('')
}

/** A gate that answers anything mentioning stocks and passes everything else. */
function stockGate(ctx: Context): void {
  ctx.on('boat/intake', async (payload, next): Promise<BoatIntakeDecision> => {
    if (!/股票/u.test(textOf(payload.messages))) return next()
    return { kind: 'reply', plugin: 'test-gate', content: [{ type: 'text', text: '不提供股票建议' }] }
  })
}

function typesOf(events: readonly SessionEvent[]): string[] {
  return events.map(event => event.type).filter(type => !type.startsWith('agent/inbox/'))
}

describe('boat/intake', () => {
  it('answers a step with a fixed reply and no model request, keeping node 0 for the prompt', async () => {
    const adapter = new MockAdapter([textResponse('model answer')])
    const ctx = await harness(adapter)
    stockGate(ctx)
    const agent = await ctx.agentLoop.create(SessionId('intake-reply'), { provider: 'mock', model: 'mock' })

    await send(agent, '帮我买股票')
    expect(adapter.requests).toHaveLength(0)
    const events = agent.session.snapshotEvents()
    expect(typesOf(events)).toEqual(['turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end'])
    expect((events.at(-1) as SessionEvent<'turn/end'>).data.reason).toEqual({ kind: 'completed' })
    const reply = events.find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(reply?.data.message.source).toEqual({ kind: 'model', provider: BOAT_ASSISTANT_PROVIDER, model: 'test-gate' })
    expect(reply?.data.stream).toEqual([])
    // An empty system head projects to no wire message, but it holds surface node 0.
    expect(agent.session.deriveMessages().map(message => message.role)).toEqual(['user', 'assistant'])
    expect(agent.session.eventAt(agent.session.surface.nodes[0] ?? -1)?.type).toBe('system/message')

    // The next admitted step assembles a real prompt: it replaces node 0 instead of trailing the history.
    await send(agent, '看看资产配置')
    expect(adapter.requests).toHaveLength(1)
    const request = adapter.requests[0] as GenerateOptions
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('replaces the empty head on an in-history route too: the first request of a session starts its series', async () => {
    const adapter = new MockAdapter([textResponse('model answer')])
    adapter.systemPromptUpdate = 'in-history'
    const ctx = await harness(adapter)
    stockGate(ctx)
    const agent = await ctx.agentLoop.create(SessionId('intake-in-history'), { provider: 'mock', model: 'mock' })

    await send(agent, '帮我买股票')
    await send(agent, '看看资产配置')
    const request = adapter.requests[0] as GenerateOptions
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    const systemNodes = agent.session.snapshotEvents().filter(event => event.type === 'system/message')
    expect(systemNodes).toHaveLength(2)
    expect(systemNodes[1]?.surfaceOp).toEqual({ op: 'replace', startSeq: systemNodes[0]?.seq, endSeq: systemNodes[0]?.seq })
  })

  it('passes by default, so a loop with no listener behaves as upstream', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('intake-pass'), { provider: 'mock', model: 'mock' })

    await send(agent, 'hello')
    expect(adapter.requests).toHaveLength(1)
    const reply = agent.session.snapshotEvents().find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(reply?.data.message.source).toEqual({ kind: 'model', provider: 'mock', model: 'mock' })
  })
})
