/**
 * The finance agent on the unit harness: the real driver, tool policy, skill
 * router, and a2ui service, the agent's own row, and a scripted model that
 * routes each turn and calls the routed skill's tool. One agent takes several
 * turns in process, so the session state (facts, questions asked, diagnosis
 * numbers) and the cards are checked across turns without a reopen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { createUserMessage, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { MockAdapter, mountDshTestServices, textResponse, toolCallResponse } from '@lyteboat/testing'
import ToolPolicyService from '@lyteboat/tool-policy'
import SkillRouterService from '@lyteboat/skill-router'
import A2uiService, { validateFullPayload } from '@lyteboat/a2ui'
import * as financeAgent from '@lyteboat/agent-finance/agent'

interface TurnPlan { skill: string; tool: string; args?: Record<string, unknown> }

const cleanups: (() => Promise<void>)[] = []
let savedCustomer: string | undefined
beforeEach(() => { savedCustomer = process.env['LYTEBOAT_FINANCE_CUSTOMER'] })
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  if (savedCustomer === undefined) delete process.env['LYTEBOAT_FINANCE_CUSTOMER']
  else process.env['LYTEBOAT_FINANCE_CUSTOMER'] = savedCustomer
})

function textOf(message: { readonly content: readonly ContentBlock[] }): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

const isRouter = (request: GenerateOptions): boolean => (request.system ?? '').includes('skill 路由器')

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

function scriptFor(plans: ReadonlyMap<string, TurnPlan>): (request: GenerateOptions) => StreamChunk[] {
  let calls = 0
  return (request) => {
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

async function harness(plans: ReadonlyMap<string, TurnPlan>): Promise<{ ctx: Context; adapter: MockAdapter }> {
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
  await ctx.plugin(SkillRouterService, { mode: 'dynamic', historyWindow: 6 })
  await ctx.plugin(A2uiService)
  await ctx.plugin(financeAgent)
  const script = scriptFor(plans)
  const adapter = new MockAdapter(Array.from({ length: 80 }, () => script))
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return { ctx, adapter }
}

async function send(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

type ResultMeta = { lyteboat?: { card?: { payload: Record<string, unknown> } }; finance?: { state?: Record<string, unknown>; extraCards?: { area: string; payload: Record<string, unknown> }[] } }

/** Every finance tool result the tools returned (replacement nodes excluded), in order. */
function results(agent: Agent): { text: string; meta: ResultMeta }[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result' && event.surfaceOp === 'append')
    .map(event => ({ text: textOf(event.data.message), meta: event.data.meta as unknown as ResultMeta }))
}

/** The surface ids of a result's cards, first card first. */
function cardsOf(result: { meta: ResultMeta }): string[] {
  const first = result.meta.lyteboat?.card?.payload['surfaceId']
  return [...first === undefined ? [] : [String(first)], ...(result.meta.finance?.extraCards ?? []).map(card => String(card.payload['surfaceId']))]
}

function payloadsOf(agent: Agent): Record<string, unknown>[] {
  return results(agent).flatMap(result => [
    ...result.meta.lyteboat?.card === undefined ? [] : [result.meta.lyteboat.card.payload],
    ...(result.meta.finance?.extraCards ?? []).map(card => card.payload),
  ])
}

describe('the finance agent across turns (in process, scripted model)', () => {
  it('overview, diagnosis, a horizon, a drill-down, and a reported asset added then withdrawn, on one session', async () => {
    process.env['LYTEBOAT_FINANCE_CUSTOMER'] = 'young-idle-cash'
    const plans = new Map<string, TurnPlan>([
      ['看看我的资产', { skill: 'asset-overview', tool: 'asset_overview' }],
      ['诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' }],
      ['这些钱 5 年以上都用不到', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis', args: { investment_horizon: '5年以上' } }],
      ['进取收益那块细看一下', { skill: 'bucket-diagnosis', tool: 'bucket_diagnosis', args: { bucket: '进取收益' } }],
      ['我在别的银行还有 20 万定期，重新诊断', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis', args: { external_assets: [{ source: '别的银行的定期', amount: '20万' }] } }],
      ['那笔定期去掉吧', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis', args: { external_assets: [{ source: '别的银行的定期', remove: true }] } }],
    ])
    const { ctx, adapter } = await harness(plans)
    const agent = await ctx.agentLoop.create(SessionId('finance-turns'), { provider: 'mock', model: 'mock' })
    const state = () => ctx.sessionProjections.stateOf(agent.session, 'financeState')

    await send(agent, '看看我的资产')
    const loops = adapter.requests.filter(request => !isRouter(request))
    expect((loops[0]?.tools ?? []).map(tool => tool.name).sort()).toEqual(['asset_overview'])
    expect(loops[0]?.temperature).toBe(0)
    expect(results(agent)[0]?.text).toMatch(/^\[tool:asset_overview status=ok auth=full areas=asset_overview\]/u)
    expect(results(agent)[0]?.text).toContain('日常开销 54,400.00 元（约 5.44 万元），占 68.0%')
    expect(cardsOf(results(agent)[0]!)).toEqual([expect.stringMatching(/^asset_overview-/u) as string])
    expect(state()?.diagnosisSeq).toBe(0)

    await send(agent, '诊断一下我的配置')
    const diagnosis = results(agent)[1]!
    expect(diagnosis.text).toMatch(/^\[tool:allocation_diagnosis status=ok state=rich seq=1 areas=allocation_diagnosis,allocation_plan\]/u)
    expect(diagnosis.text).toContain('日常开销 54,400.00 元（约 5.44 万元），占 68.0%，建议 18%–28%，偏高')
    expect(diagnosis.text).toContain('大概多久用不到')
    expect(cardsOf(diagnosis)).toEqual([expect.stringMatching(/^allocation_diagnosis-/u) as string, expect.stringMatching(/^allocation_plan-/u) as string])
    expect(state()).toMatchObject({ diagnosisSeq: 1, asked: ['investmentHorizon'] })
    // Turn 1's result reached turn 2 in its past form: facts kept, its answer guidance gone.
    const turn2 = JSON.stringify(adapter.requests.filter(request => !isRouter(request)).at(-2)?.messages)
    expect(turn2).toContain('[tool:asset_overview 已完成 status=ok auth=full]')
    expect(turn2).toContain('日常开销 54,400.00 元（约 5.44 万元），占 68.0%')
    expect(turn2).not.toContain('卡片前再用一句话收尾')
    expect(turn2).not.toContain('先用一句话回应用户')
    const replacements = agent.session.snapshotEvents().filter(event => event.type === 'tool/result' && event.surfaceOp !== 'append')
    expect(replacements).toHaveLength(1)
    // The replacement carries the original's meta; lyteboatCards folds appended results only, so each card shows once.
    expect(ctx.a2ui.cardsOf(agent).map(card => card.surfaceId.split('-')[0])).toEqual(['asset_overview', 'allocation_diagnosis'])

    await send(agent, '这些钱 5 年以上都用不到')
    const withHorizon = results(agent)[2]!
    expect(withHorizon.text).toContain('seq=2')
    expect(withHorizon.text).toContain('投资期限：5年以上')
    expect(withHorizon.text).not.toContain('大概多久用不到')
    expect(state()).toMatchObject({ diagnosisSeq: 2, facts: { investmentHorizon: '5年以上' } })

    await send(agent, '进取收益那块细看一下')
    const drill = results(agent)[3]!
    expect(drill.text).toMatch(/^\[tool:bucket_diagnosis status=ok bucket=进取收益 areas=bucket_detail\]/u)
    expect(drill.text).toContain('账户：示例证券 · 股票账户 · 25,600.00 元（约 2.56 万元）')
    expect(cardsOf(drill)).toEqual([expect.stringMatching(/^bucket_detail-/u) as string, expect.stringMatching(/^next_step-/u) as string])
    const drillRequest = adapter.requests.filter(request => !isRouter(request)).at(-2)
    expect((drillRequest?.tools ?? []).map(tool => tool.name)).toEqual(['bucket_diagnosis'])

    await send(agent, '我在别的银行还有 20 万定期，重新诊断')
    expect(results(agent)[4]?.text).toContain('参与诊断的资产合计 280,000.00 元（约 28.00 万元），其中您告知的其他机构资产 200,000.00 元（约 20.00 万元）')
    expect(state()).toMatchObject({ diagnosisSeq: 3, facts: { externalAssets: [{ source: '别的银行的定期', amount: '200000.00', bucket: 'steady' }] } })

    await send(agent, '那笔定期去掉吧')
    expect(results(agent)[5]?.text).toContain('参与诊断的资产合计 80,000.00 元（约 8.00 万元）')
    expect(state()).toMatchObject({ diagnosisSeq: 4, facts: { externalAssets: [], investmentHorizon: '5年以上' } })

    for (const payload of payloadsOf(agent)) {
      expect(validateFullPayload(payload, { strict: true }).errors, JSON.stringify(payload['surfaceId'])).toEqual([])
    }
  })
})

describe('the finance agent by customer situation', () => {
  async function diagnoseOnce(customer: string, text: string, plan: TurnPlan): Promise<{ agent: Agent; adapter: MockAdapter; ctx: Context }> {
    process.env['LYTEBOAT_FINANCE_CUSTOMER'] = customer
    const { ctx, adapter } = await harness(new Map([[text, plan]]))
    const agent = await ctx.agentLoop.create(SessionId(`finance-${customer}`), { provider: 'mock', model: 'mock' })
    await send(agent, text)
    return { agent, adapter, ctx }
  }

  it('nothing authorized: the unauthorized card concludes the turn with no further model request', async () => {
    const { agent, adapter } = await diagnoseOnce('none-authorized', '看看我的资产', { skill: 'asset-overview', tool: 'asset_overview' })
    const [result] = results(agent)
    expect(result?.text).toMatch(/^\[tool:asset_overview status=unauthorized areas=unauthorized\]/u)
    expect(cardsOf(result!)).toEqual([expect.stringMatching(/^unauthorized-/u) as string])
    expect(adapter.requests.filter(request => !isRouter(request))).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
  })

  it('one bucket authorized: the diagnosis card says it cannot diagnose, and the drill-down refuses without a card', async () => {
    const single = await diagnoseOnce('one-bucket', '诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' })
    expect(results(single.agent)[0]?.text).toMatch(/state=single seq=1 areas=allocation_diagnosis\]/u)
    const card = results(single.agent)[0]!.meta.lyteboat?.card?.payload
    expect(JSON.stringify(card)).toContain('暂时无法判断配置')
    const drill = await diagnoseOnce('one-bucket', '日常开销细看一下', { skill: 'bucket-diagnosis', tool: 'bucket_diagnosis', args: { bucket: '日常开销' } })
    expect(results(drill.agent)[0]?.text).toMatch(/^\[tool:bucket_diagnosis status=blocked areas=none\]/u)
  })

  it('two buckets: one diagnosis card with the caveat; too little money: no card, the emergency fund first', async () => {
    const thin = await diagnoseOnce('two-buckets', '诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' })
    expect(results(thin.agent)[0]?.text).toMatch(/state=thin seq=1 areas=allocation_diagnosis\]/u)
    expect(results(thin.agent)[0]?.text).toContain('进取收益：未授权，无法判断')
    const runway = await diagnoseOnce('low-assets', '诊断一下我的配置', { skill: 'allocation-diagnosis', tool: 'allocation_diagnosis' })
    expect(results(runway.agent)[0]?.text).toMatch(/state=runway seq=1 areas=none\]/u)
    expect(cardsOf(results(runway.agent)[0]!)).toEqual([])
  })

  it('investor education: a known concept and a fallback, never a card', async () => {
    const found = await diagnoseOnce('healthy', '什么是再平衡', { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '再平衡' } })
    expect(results(found.agent)[0]?.text).toMatch(/^\[tool:lookup_knowledge status=ok topic=再平衡 areas=none\]/u)
    const missing = await diagnoseOnce('healthy', '区块链是什么', { skill: 'investor-education', tool: 'lookup_knowledge', args: { topic: '区块链' } })
    expect(results(missing.agent)[0]?.text).toContain('status=fallback')
    expect(payloadsOf(missing.agent)).toEqual([])
  })
})
