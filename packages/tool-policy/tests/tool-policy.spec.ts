/**
 * The tool policy at the driver's seams: visibility through restriction,
 * confirmation through `ask`, and state deltas through `boat/state`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture, defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@boat/runtime'
import * as AgentLoopInvariant from '@boat/runtime/invariant'
import { mountAgentLoopTestDependencies } from '@boat/runtime-testkit'
import ToolPolicyService from '@boat/tool-policy'
import { MockAdapter, textResponse, toolCallResponse } from '../../runtime/tests/mock-adapter.ts'

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
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolPolicyService)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return ctx
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

function echo(name: string): ToolDefinition {
  return defineContentToolFixture({
    name, description: name, parameters: {},
    execute: async () => [{ type: 'text', text: `${name} ran` }],
  })
}

function toolNames(adapter: MockAdapter, index: number): string[] {
  return (adapter.requests[index]?.tools ?? []).map(tool => tool.name)
}

describe('visibility', () => {
  it('hides auto tools until activated, applies an activation made in boat/pre-assemble to the same step, and reissues only on change', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two'), textResponse('three')])
    const ctx = await harness(adapter)
    ctx.toolPolicy.register(echo('always_tool'), { visibility: 'always' })
    ctx.toolPolicy.register(echo('auto_tool'), { visibility: 'auto' })
    // Declared through the registrar path, registered by an ordinary row.
    ctx.tools.register(echo('official_tool'))
    ctx.toolPolicy.declare('official_tool', { visibility: 'auto' })
    // Declared but registered nowhere: skipped, never a restrict() error.
    ctx.toolPolicy.declare('phantom_tool', { visibility: 'auto' })
    let changes = 0
    ctx.on('tools/change', () => { changes += 1 })
    let activate: string[] = []
    ctx.on('boat/pre-assemble', async (payload, next) => {
      if (activate.length > 0) ctx.toolPolicy.activate(payload.agent, activate)
      return next()
    })
    const agent = await ctx.agentLoop.create(SessionId('visibility'), { provider: 'mock', model: 'mock' })

    await send(agent, 'hello')
    expect(toolNames(adapter, 0)).toEqual(['always_tool'])
    expect(changes).toBe(1)
    expect(ctx.toolPolicy.visible(agent)).toEqual(['always_tool'])

    await send(agent, 'again')
    expect(toolNames(adapter, 1)).toEqual(['always_tool'])
    expect(changes).toBe(1)

    activate = ['auto_tool']
    await send(agent, 'now')
    expect(toolNames(adapter, 2)).toEqual(['always_tool', 'auto_tool'])
    expect(ctx.toolPolicy.activated(agent)).toEqual(['auto_tool'])
    // Lifting the old restriction and issuing the new one: two notifications.
    expect(changes).toBe(3)
  })

  it('activate() rejects undeclared names and takes effect at once; clear() hides again', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    ctx.toolPolicy.register(echo('auto_tool'), { visibility: 'auto' })
    const agent = await ctx.agentLoop.create(SessionId('activate'), { provider: 'mock', model: 'mock' })
    expect(() => ctx.toolPolicy.activate(agent, ['nope'])).toThrow(/undeclared tool "nope"/u)

    ctx.toolPolicy.activate(agent, ['auto_tool'])
    await send(agent, 'hello')
    expect(toolNames(adapter, 0)).toEqual(['auto_tool'])

    ctx.toolPolicy.clear(agent)
    await send(agent, 'again')
    expect(toolNames(adapter, 1)).toEqual([])
    expect(ctx.toolPolicy.activated(agent)).toEqual([])
  })
})

describe('confirmation', () => {
  it('turns a requiresConfirmation call into ask, which denies without an approval service', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'guarded', {}), textResponse('done')])
    const ctx = await harness(adapter)
    let executed = false
    ctx.toolPolicy.register(defineContentToolFixture({
      name: 'guarded', description: 'guarded', parameters: {},
      execute: async () => { executed = true; return [{ type: 'text', text: 'ran' }] },
    }), { requiresConfirmation: true })
    const agent = await ctx.agentLoop.create(SessionId('confirm'), { provider: 'mock', model: 'mock' })

    await send(agent, 'go')
    expect(executed).toBe(false)
    const result = agent.session.snapshotEvents().find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')!
    const block = result.data.message.content[0]!
    expect(block.type).toBe('tool-result')
    expect(JSON.stringify(block)).toContain('requires confirmation')
    expect(JSON.stringify(block)).toContain('"isError":true')
  })
})

describe('state', () => {
  it('appends boat/state from the result meta, folds it into boatState, and shows it to the model next step', async () => {
    const adapter = new MockAdapter([toolCallResponse('c1', 'lookup', {}), textResponse('done')])
    const ctx = await harness(adapter)
    ctx.toolPolicy.register(defineTool({
      name: 'lookup', description: 'lookup', parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { total: { type: 'number', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `sum ${value.total}` }],
        presentationMeta: () => ({ card: 'own' }),
      },
      execute: async () => ({ total: 5 }),
    }), { stateDelta: (_args, value) => ({ 'portfolio.total': (value as { total: number }).total }) })
    const agent = await ctx.agentLoop.create(SessionId('state'), { provider: 'mock', model: 'mock' })

    await send(agent, 'go')
    const events = agent.session.snapshotEvents()
    const state = events.find((event): event is SessionEvent<'boat/state'> => event.type === 'boat/state')!
    expect(state.data).toEqual({ callId: 'c1', delta: { 'portfolio.total': 5 } })
    const result = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')!
    expect(result.data.meta).toEqual({ card: 'own', boat: { stateDelta: { 'portfolio.total': 5 } } })
    expect(events.indexOf(state)).toBeLessThan(events.indexOf(result))
    expect(ctx.sessionProjections.stateOf(agent.session, 'boatState')).toEqual({ portfolio: { total: 5 } })
    expect(ctx.sessionProjections.snapshot(agent.session).values['boatState']).toEqual({ portfolio: { total: 5 } })
    // The second request carries the runtime context with the state; the first had none.
    expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('Session state')
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('Session state, accumulated from tool results')
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('portfolio')
  })
})
