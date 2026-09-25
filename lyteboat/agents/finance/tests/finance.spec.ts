/**
 * The finance agent on the unit harness: the real driver, tool policy, skill
 * router, a2ui, request context and admission services, the agent's own row,
 * and a scripted model that classifies each request, routes it, and calls the
 * routed skill's tool. Each request carries its context and is admitted
 * before it enters the loop, as `lyteboat run` does. One agent takes several
 * turns in process, so routing, the cards and their placement, and the request
 * context are checked across turns without a reopen.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { MockAdapter, createLyteboatUnitHost, followUpAndWait, textResponse, toolCallResponse } from '@lyteboat/testing'
import ToolPolicyService from '@lyteboat/tool-policy'
import AuxLlmService from '@lyteboat/aux-llm'
import LyteboatDistroService from '@lyteboat/distro'
import SkillRouterService from '@lyteboat/skill-router'
import A2uiService, { validateFullPayload } from '@lyteboat/a2ui'
import RequestContextService from '@lyteboat/request-context'
import IntakeGuardService from '@lyteboat/intake-guard'
import * as financeAgent from '@lyteboat/agent-finance/agent'

interface TurnPlan { skill: string; tool: string; args?: Record<string, unknown> }

function textOf(message: { readonly content: readonly ContentBlock[] }): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

const isRouter = (request: GenerateOptions): boolean => (request.system ?? '').includes('skill 路由器')
const isIntake = (request: GenerateOptions): boolean => (request.system ?? '').includes('准入分类器')
/** A request of the agent's own loop, not a side call. */
const isLoop = (request: GenerateOptions): boolean => !isRouter(request) && !isIntake(request)

/** The human input this loop request answers: the last user message a person wrote. */
function humanIndex(request: GenerateOptions): number {
  return request.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
}

function calledSinceHuman(request: GenerateOptions, tool: string): boolean {
  return request.messages.slice(humanIndex(request) + 1).some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === tool))
}

/** The final answer writes one marker per card the last tool result prepared. */
function answer(request: GenerateOptions): string {
  const toolResults = request.messages.slice(humanIndex(request) + 1).filter(message => message.role === 'tool')
  const areas = /areas=([^\]\s]+)/u.exec(toolResults.map(textOf).at(-1) ?? '')?.[1] ?? 'none'
  const markers = areas === 'none' ? [] : areas.split(',').map(area => `[[card:${area}]]`)
  return ['好的。', ...markers, '以上。'].join('\n')
}

function scriptFor(plans: ReadonlyMap<string, TurnPlan>, intents: ReadonlyMap<string, string>): (request: GenerateOptions) => StreamChunk[] {
  let calls = 0
  return (request) => {
    if (isIntake(request)) {
      const latest = /<latest>([\s\S]*?)<\/latest>/u.exec(request.messages.map(textOf).join('\n'))?.[1] ?? ''
      const plan = plans.get(latest)
      const intent = intents.get(latest) ?? (plan === undefined ? 'other' : plan.skill === 'investor-education' ? 'education' : 'asset')
      return textResponse(intent === 'garbled' ? '我不确定' : JSON.stringify({ intent, reason: 'test' }))
    }
    if (isRouter(request)) {
      const latest = /<latest_user_input>([\s\S]*?)<\/latest_user_input>/u.exec(request.messages.map(textOf).join('\n'))?.[1] ?? ''
      return textResponse(JSON.stringify({ skill_id: plans.get(latest)?.skill ?? null, reason: 'test' }))
    }
    const human = request.messages[humanIndex(request)]
    const plan = human === undefined ? undefined : plans.get(textOf(human))
    if (plan !== undefined && (request.tools ?? []).some(tool => tool.name === plan.tool) && !calledSinceHuman(request, plan.tool)) {
      calls += 1
      return toolCallResponse(`call-${String(calls)}`, plan.tool, plan.args ?? {})
    }
    return textResponse(answer(request))
  }
}

async function harness(plans: ReadonlyMap<string, TurnPlan>, intents: ReadonlyMap<string, string> = new Map()): Promise<{ ctx: Context; adapter: MockAdapter }> {
  const script = scriptFor(plans, intents)
  const adapter = new MockAdapter(Array.from({ length: 80 }, () => script))
  const ctx = await createLyteboatUnitHost(adapter)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(ToolPolicyService)
  await ctx.plugin(LyteboatDistroService)
  await ctx.plugin(AuxLlmService)
  await ctx.plugin(SkillRouterService, { mode: 'dynamic', historyWindow: 6 })
  await ctx.plugin(A2uiService)
  await ctx.plugin(RequestContextService)
  await ctx.plugin(IntakeGuardService)
  await ctx.plugin(financeAgent)
  return { ctx, adapter }
}

/**
 * One request as `lyteboat run` sends it: admitted first, then followed up
 * with its context (when it carries one) and verdict on the human message.
 */
async function send(ctx: Context, agent: Agent, text: string, customer?: string): Promise<void> {
  const context = customer === undefined ? undefined : { customer }
  const intake = await ctx.intakeGuard.admit(agent, { text, context: context ?? ctx.requestContext.contextOf(agent) }, AbortSignal.timeout(5000))
  await followUpAndWait(agent, ctx.requestContext.message(text, { ...context === undefined ? {} : { context }, ...intake === undefined ? {} : { intake } }))
}

type ResultMeta = { lyteboat?: { cards?: { area: string; emission: string; payload: Record<string, unknown> }[] } }

/** Every finance tool result, in order. */
function results(agent: Agent): { text: string; meta: ResultMeta }[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result' && event.surfaceOp === 'append')
    .map(event => ({ text: textOf(event.data.message), meta: event.data.meta as unknown as ResultMeta }))
}

/** The surface ids of a result's cards, in answer order. */
function cardsOf(result: { meta: ResultMeta }): string[] {
  return (result.meta.lyteboat?.cards ?? []).map(card => String(card.payload['surfaceId']))
}

function payloadsOf(agent: Agent): Record<string, unknown>[] {
  return results(agent).flatMap(result => (result.meta.lyteboat?.cards ?? []).map(card => card.payload))
}

describe('the finance agent across turns (in process, scripted model)', () => {
  it('overview, diagnosis, and a concept on one session: each turn routes to its skill and places its cards', async () => {
    const plans = new Map<string, TurnPlan>([
      ['看看我的资产', { skill: 'asset-overview', tool: 'asset_overview' }],
      ['诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' }],
      ['什么是再平衡', { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '再平衡' } }],
    ])
    const { ctx, adapter } = await harness(plans)
    const agent = await ctx.agentLoop.create(SessionId('finance-turns'), { provider: 'mock', model: 'mock' })

    await send(ctx, agent, '看看我的资产', 'young-idle-cash')
    const loops = adapter.requests.filter(isLoop)
    expect((loops[0]?.tools ?? []).map(tool => tool.name).sort()).toEqual(['asset_overview'])
    expect(loops[0]?.temperature).toBe(0)
    expect(results(agent)[0]?.text).toMatch(/^\[tool:asset_overview status=ok areas=asset_overview\]/u)
    expect(results(agent)[0]?.text).toContain('稳健资产（存款、货币基金、债券） 54,400.00 元（约 5.44 万元），占 68.0%')
    expect(cardsOf(results(agent)[0]!)).toEqual([expect.stringMatching(/^asset_overview-/u) as string])

    const turn2Start = agent.session.seq
    await send(ctx, agent, '诊断一下我的配置')
    const diagnosis = results(agent)[1]!
    expect(diagnosis.text).toMatch(/^\[tool:allocation_diagnosis status=ok verdict=cautious areas=allocation_diagnosis,allocation_plan\]/u)
    expect(diagnosis.text).toContain('风险资产占 32.0%；按「100 减年龄」，28 岁的建议区间是 62%–82%')
    expect(cardsOf(diagnosis)).toEqual([expect.stringMatching(/^allocation_diagnosis-/u) as string, expect.stringMatching(/^allocation_plan-/u) as string])
    expect((adapter.requests.filter(isLoop).at(-2)?.tools ?? []).map(tool => tool.name)).toEqual(['allocation_diagnosis'])
    // Both cards are deferred: they sit where the answer wrote their markers, and the markers are gone.
    const parts = ctx.a2ui.turnParts(agent.session, turn2Start)
    expect(parts.map(part => part.kind === 'card' ? part.card.area : part.text)).toEqual(['好的。\n', 'allocation_diagnosis', 'allocation_plan', '以上。'])

    await send(ctx, agent, '什么是再平衡')
    expect(results(agent)[2]?.text).toMatch(/^\[tool:lookup_knowledge status=ok topic=再平衡 areas=none\]/u)
    expect(ctx.a2ui.cardsOf(agent).map(card => card.area)).toEqual(['asset_overview', 'allocation_diagnosis', 'allocation_plan'])

    for (const payload of payloadsOf(agent)) {
      expect(validateFullPayload(payload, { strict: true }).errors, JSON.stringify(payload['surfaceId'])).toEqual([])
    }
    // Only the first request carried the context; the session kept it.
    expect(ctx.sessionProjections.stateOf(agent.session, 'lyteboatRequest')).toMatchObject({ requests: 3, context: { customer: 'young-idle-cash' }, intake: { by: 'finance-admission', decision: 'pass', verdict: 'education' } })
  })
})

describe('the finance agent by customer situation', () => {
  async function askOnce(customer: string, text: string, plan?: TurnPlan, intents: ReadonlyMap<string, string> = new Map()): Promise<{ agent: Agent; adapter: MockAdapter; ctx: Context }> {
    const { ctx, adapter } = await harness(new Map(plan === undefined ? [] : [[text, plan]]), intents)
    const agent = await ctx.agentLoop.create(SessionId(`finance-${customer}`), { provider: 'mock', model: 'mock' })
    await send(ctx, agent, text, customer)
    return { agent, adapter, ctx }
  }

  const replies = (agent: Agent): string[] => agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    .map(event => textOf(event.data.message))

  it('too much at market risk for the age: the diagnosis says so and points back inside the band', async () => {
    const { agent } = await askOnce('pre-retiree-risky', '诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' })
    const [result] = results(agent)
    expect(result?.text).toMatch(/verdict=aggressive areas=allocation_diagnosis,allocation_plan\]/u)
    expect(JSON.stringify(result?.meta.lyteboat?.cards?.[1]?.payload)).toContain('回到 52% 以内')
  })

  it('nothing authorized: the admission answers with the unauthorized card before the loop', async () => {
    const start = SessionLogOffset(0)
    const { agent, adapter, ctx } = await askOnce('none-authorized', '看看我的资产', { skill: 'asset-overview', tool: 'asset_overview' })
    expect(adapter.requests.filter(isLoop)).toEqual([])
    expect(adapter.requests.filter(isRouter)).toEqual([])
    expect(results(agent)).toEqual([])
    expect(replies(agent)).toEqual(['您还没有授权任何账户，授权后我就能帮您看资产了。'])
    const parts = ctx.a2ui.turnParts(agent.session, start)
    expect(parts.map(part => part.kind === 'card' ? part.card.area : part.text)).toEqual(['unauthorized', '您还没有授权任何账户，授权后我就能帮您看资产了。'])
    expect(ctx.sessionProjections.stateOf(agent.session, 'lyteboatRequest')?.intake).toMatchObject({ decision: 'reply', verdict: 'unauthorized' })
  })

  it('nothing authorized and the request unclassified: the tool falls back to the unauthorized card and concludes the turn', async () => {
    const { agent, adapter } = await askOnce('none-authorized', '看看我的资产', { skill: 'asset-overview', tool: 'asset_overview' }, new Map([['看看我的资产', 'garbled']]))
    const [result] = results(agent)
    expect(result?.text).toMatch(/^\[tool:asset_overview status=unauthorized areas=unauthorized\]/u)
    expect(cardsOf(result!)).toEqual([expect.stringMatching(/^unauthorized-/u) as string])
    expect(adapter.requests.filter(isLoop)).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
  })

  it('out of scope: the admission answers with the service scope, and no model request follows', async () => {
    const { agent, adapter } = await askOnce('midlife-moderate', '帮我写一首诗')
    expect(adapter.requests.filter(isIntake)).toHaveLength(1)
    expect(adapter.requests.filter(isLoop)).toEqual([])
    expect(replies(agent)).toEqual(['这个问题不在我的服务范围内。我可以帮您看看资产、诊断配置，或者讲讲理财常识。'])
  })

  it('investor education: admitted even when nothing is authorized, a fallback for an unknown concept, never a card', async () => {
    const found = await askOnce('none-authorized', '什么是再平衡', { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '再平衡' } })
    expect(results(found.agent)[0]?.text).toMatch(/^\[tool:lookup_knowledge status=ok topic=再平衡 areas=none\]/u)
    const missing = await askOnce('midlife-moderate', '区块链是什么', { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '区块链' } })
    expect(results(missing.agent)[0]?.text).toContain('status=fallback')
    expect(payloadsOf(missing.agent)).toEqual([])
  })
})
