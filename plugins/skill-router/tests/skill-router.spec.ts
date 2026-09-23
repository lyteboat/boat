/**
 * The skill router at the driver's seams: dynamic routing per user input,
 * same-step body and tool visibility, sticky decisions, model-initiated
 * activation, full mode, and off.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { defineContentToolFixture, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@boat/agentic-loop'
import * as AgentLoopInvariant from '@boat/agentic-loop/invariant'
import { MockAdapter, mountDshTestServices, textResponse, toolCallResponse } from '@boat/testing'
import ToolPolicyService from '@boat/tool-policy'
import SkillRouterService, { type Config } from '@boat/skill-router'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function harness(adapter: MockAdapter, config: Config): Promise<Context> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await mountDshTestServices(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolPolicyService)
  await ctx.plugin(SkillRouterService, config)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  ctx.skills.register({ name: 'asset-overview', description: '资产总览与配置诊断', content: 'BODY-ASSET', source: 'custom', metadata: { boat: { requiredTools: ['lookup_assets', 'not_a_tool'] } } })
  ctx.skills.register({ name: 'market-news', description: '市场行情与新闻', content: 'BODY-NEWS', source: 'custom', metadata: { boat: { requiredTools: ['fetch_news'] } } })
  ctx.toolPolicy.register(echo('lookup_assets'), { visibility: 'auto' })
  ctx.toolPolicy.register(echo('fetch_news'), { visibility: 'auto' })
  ctx.toolPolicy.register(echo('always_tool'), { visibility: 'always' })
  return ctx
}

function echo(name: string): ToolDefinition {
  return defineContentToolFixture({ name, description: name, parameters: {}, execute: async () => [{ type: 'text', text: `${name} ran` }] })
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

const isRouter = (request: GenerateOptions): boolean => (request.system ?? '').includes('skill 路由器')
const loopRequests = (adapter: MockAdapter): GenerateOptions[] => adapter.requests.filter(request => !isRouter(request))
const routerRequests = (adapter: MockAdapter): GenerateOptions[] => adapter.requests.filter(isRouter)
const toolNames = (request: GenerateOptions): string[] => (request.tools ?? []).map(tool => tool.name).sort()
const messagesText = (request: GenerateOptions): string => JSON.stringify(request.messages)
const routed = (agent: Agent): SessionEvent<'boat/skill-routed'>[] =>
  agent.session.snapshotEvents().filter((event): event is SessionEvent<'boat/skill-routed'> => event.type === 'boat/skill-routed')

describe('dynamic mode', () => {
  it('routes each user input, puts the body and required tools into the same step, and stays sticky', async () => {
    const adapter = new MockAdapter([
      textResponse('{"skill_id": "asset-overview", "reason": "看资产"}'), textResponse('one'),
      textResponse('{"skill_id": null, "reason": "追问"}'), textResponse('two'),
      textResponse('garbage'), textResponse('three'),
      textResponse('{"skill_id": "market-news", "reason": "切到行情"}'), textResponse('four'),
    ])
    const ctx = await harness(adapter, { mode: 'dynamic', historyWindow: 6 })
    const agent = await ctx.agentLoop.create(SessionId('dynamic'), { provider: 'mock', model: 'mock' })

    await send(agent, '看看我的资产')
    expect(routerRequests(adapter)).toHaveLength(1)
    const router = routerRequests(adapter)[0]!
    expect(router.messages).toHaveLength(1)
    expect(messagesText(router)).toContain('<available_skills>')
    expect(messagesText(router)).toContain('<latest_user_input>看看我的资产</latest_user_input>')
    expect(router.maxTokens).toBe(200)
    expect(router.sessionId).toBe(agent.session.id)
    const first = loopRequests(adapter)[0]!
    expect(toolNames(first)).toEqual(['always_tool', 'lookup_assets'])
    expect(messagesText(first)).toContain('<skill_instructions>')
    expect(messagesText(first)).toContain('BODY-ASSET')
    expect(messagesText(first)).not.toContain('BODY-NEWS')
    expect(ctx.skillRouter.activeOf(agent)).toBe('asset-overview')
    expect(ctx.sessionProjections.snapshot(agent.session).values['boatActiveSkill']).toBe('asset-overview')
    const request = agent.session.snapshotEvents().find((event): event is SessionEvent<'boat/route-request'> => event.type === 'boat/route-request')!
    expect(request.data).toMatchObject({ turn: 1, route: { provider: 'mock', model: 'mock' }, candidates: ['asset-overview', 'market-news'], decision: 'asset-overview', reason: '看资产' })
    expect(request.data.durationMs).toBeGreaterThanOrEqual(0)
    expect(routed(agent).map(event => event.data)).toEqual([{ turn: 1, skill: 'asset-overview', reason: '看资产', source: 'router' }])

    // Router says null: kept, no new activation node.
    await send(agent, '那总额呢')
    expect(routed(agent)).toHaveLength(1)
    expect(ctx.skillRouter.activeOf(agent)).toBe('asset-overview')
    expect(messagesText(routerRequests(adapter)[1]!)).toContain('<current_active_skill>asset-overview</current_active_skill>')
    expect(messagesText(routerRequests(adapter)[1]!)).toContain('user: 看看我的资产')

    // Malformed reply: kept, audited as parse_error.
    await send(agent, '再说一遍')
    const requests = agent.session.snapshotEvents().filter((event): event is SessionEvent<'boat/route-request'> => event.type === 'boat/route-request')
    expect(requests[2]!.data).toMatchObject({ decision: 'asset-overview', reason: 'parse_error' })
    expect(routed(agent)).toHaveLength(1)

    // A valid new id switches: new body, the previous skill's tools hidden.
    await send(agent, '今天行情怎么样')
    expect(routed(agent).map(event => event.data.skill)).toEqual(['asset-overview', 'market-news'])
    const fourth = loopRequests(adapter)[3]!
    expect(toolNames(fourth)).toEqual(['always_tool', 'fetch_news'])
    expect(messagesText(fourth)).toContain('BODY-NEWS')
    expect(ctx.skillRouter.activeOf(agent)).toBe('market-news')
  })

  it('keeps the current skill when the router call fails, and skips routing without candidates', async () => {
    const adapter = new MockAdapter([
      () => { throw new Error('boom') }, textResponse('one'),
    ])
    const ctx = await harness(adapter, { mode: 'dynamic' })
    const agent = await ctx.agentLoop.create(SessionId('failing'), { provider: 'mock', model: 'mock' })
    await send(agent, '看看资产')
    const request = agent.session.snapshotEvents().find((event): event is SessionEvent<'boat/route-request'> => event.type === 'boat/route-request')!
    expect(request.data.decision).toBeNull()
    expect(request.data.reason).toBe('Error')
    expect(routed(agent)).toHaveLength(0)
    expect(loopRequests(adapter)).toHaveLength(1)
  })

  it('records a model-initiated skill load with source model and applies it to the next step', async () => {
    const adapter = new MockAdapter([
      textResponse('{"skill_id": null, "reason": "闲聊"}'),
      toolCallResponse('c1', 'skill', { name: 'market-news' }),
      textResponse('done'),
    ])
    const ctx = await harness(adapter, { mode: 'dynamic' })
    ctx.tools.register(defineContentToolFixture({
      name: 'skill', description: 'load a skill', parameters: { name: { type: 'string', required: true } },
      execute: async ({ name }) => [{ type: 'text', text: `loaded ${String(name)}` }],
    }))
    const agent = await ctx.agentLoop.create(SessionId('model-load'), { provider: 'mock', model: 'mock' })
    await send(agent, '你好')
    expect(routed(agent).map(event => event.data)).toEqual([{ turn: 1, skill: 'market-news', reason: 'loaded through the skill tool', source: 'model' }])
    const second = loopRequests(adapter)[1]!
    expect(toolNames(second)).toContain('fetch_news')
    expect(messagesText(second)).toContain('BODY-NEWS')
    expect(ctx.skillRouter.activeOf(agent)).toBe('market-news')
  })
})

describe('full mode', () => {
  it('renders every skill body as a system prompt section, activates every required tool, and never routes', async () => {
    const adapter = new MockAdapter([textResponse('one')])
    const ctx = await harness(adapter, { mode: 'full' })
    const agent = await ctx.agentLoop.create(SessionId('full'), { provider: 'mock', model: 'mock' })
    await send(agent, '看看资产')
    expect(routerRequests(adapter)).toHaveLength(0)
    const request = loopRequests(adapter)[0]!
    const system = JSON.stringify(request.messages[0])
    expect(request.messages[0]!.role).toBe('system')
    expect(system).toContain('BODY-ASSET')
    expect(system).toContain('BODY-NEWS')
    expect(toolNames(request)).toEqual(['always_tool', 'fetch_news', 'lookup_assets'])
    expect(routed(agent)).toHaveLength(0)
  })
})

describe('off mode and preset settings', () => {
  it('does nothing when off, and a scoped declaration overrides the host default', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('{"skill_id": "market-news", "reason": "r"}'), textResponse('two')])
    const ctx = await harness(adapter, {})
    const quiet = await ctx.agentLoop.create(SessionId('off'), { provider: 'mock', model: 'mock' })
    await send(quiet, '看看资产')
    expect(routerRequests(adapter)).toHaveLength(0)
    expect(toolNames(loopRequests(adapter)[0]!)).toEqual(['always_tool'])

    const routedAgent = await ctx.agentLoop.create(SessionId('scoped'), { provider: 'mock', model: 'mock' })
    routedAgent.ctx.get('skillRouter')!.declare({ mode: 'dynamic', historyWindow: 0 })
    expect(ctx.skillRouter.settingsFor(routedAgent)).toEqual({ mode: 'dynamic', historyWindow: 0, timeoutMs: 10_000 })
    expect(ctx.skillRouter.settingsFor(quiet).mode).toBe('off')
    await send(routedAgent, '行情')
    expect(routerRequests(adapter)).toHaveLength(1)
    expect(messagesText(routerRequests(adapter)[0]!)).toContain('(empty)')
    expect(ctx.skillRouter.activeOf(routedAgent)).toBe('market-news')
  })
})
