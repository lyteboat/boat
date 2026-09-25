/**
 * Admission ahead of the loop: a verdict recorded on the request is answered
 * in the loop without a model request, a pass is not admitted twice, and a
 * message that arrives unadmitted is admitted in the loop.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import LyteboatDistroService from '@lyteboat/distro'
import RequestContextService from '@lyteboat/request-context'
import { MockAdapter, createLyteboatUnitHost, followUpAndWait as sendAndWait, textResponse } from '@lyteboat/testing'
import IntakeGuardService, { type LyteboatAdmission } from '@lyteboat/intake-guard'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = await createLyteboatUnitHost(adapter)
  await ctx.plugin(LyteboatDistroService)
  await ctx.plugin(RequestContextService)
  await ctx.plugin(IntakeGuardService)
  return ctx
}

const CARD = { surfaceId: 'scope-1', area: 'scope', emission: 'immediate' as const, payload: { rootComponentId: 'root' } }

/** Replies to stock questions with a fixed text and card; counts its calls. */
function stockGate(): LyteboatAdmission & { calls: number } {
  const gate = {
    name: 'stock-gate',
    calls: 0,
    admit: async ({ text }: { text: string }) => {
      gate.calls += 1
      return /炒股/u.test(text)
        ? { decision: 'reply' as const, verdict: 'out_of_scope', text: '这个我帮不了。', cards: [CARD] }
        : { decision: 'pass' as const }
    },
  }
  return gate
}

const humanSources = (agent: Agent): unknown[] =>
  agent.session.snapshotEvents().filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message').map(event => event.data.source)
const replies = (agent: Agent): SessionEvent<'assistant/message'>[] =>
  agent.session.snapshotEvents().filter((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')

describe('admission ahead of the loop', () => {
  it('records a reply verdict on the request and answers it in the loop without a model request', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('reply'), { provider: 'mock', model: 'mock' })
    const gate = stockGate()
    agent.ctx.get('intakeGuard')!.register(gate)

    const intake = await ctx.intakeGuard.admit(agent, { text: '帮我炒股', context: {} }, AbortSignal.timeout(5000))
    await sendAndWait(agent, ctx.requestContext.message('帮我炒股', { context: { channel: 'app' }, ...intake === undefined ? {} : { intake } }))

    expect(intake).toEqual({ by: 'stock-gate', decision: 'reply', verdict: 'out_of_scope', text: '这个我帮不了。', cards: [CARD] })
    expect(adapter.requests).toEqual([])
    expect(gate.calls).toBe(1)
    expect(replies(agent).map(reply => [reply.data.message.source, reply.data.message.content])).toEqual([
      [{ kind: 'model', provider: 'lyteboat', model: 'stock-gate' }, [{ type: 'text', text: '这个我帮不了。' }]],
    ])
    expect(humanSources(agent)).toEqual([{ kind: 'user', lyteboatRequest: { context: { channel: 'app' }, intake } }])
  })

  it('lets a recorded pass reach the model without admitting the request again', async () => {
    const adapter = new MockAdapter([textResponse('好的')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('pass'), { provider: 'mock', model: 'mock' })
    const gate = stockGate()
    agent.ctx.get('intakeGuard')!.register(gate)

    const intake = await ctx.intakeGuard.admit(agent, { text: '看看我的资产', context: {} }, AbortSignal.timeout(5000))
    await sendAndWait(agent, ctx.requestContext.message('看看我的资产', { ...intake === undefined ? {} : { intake } }))

    expect(intake).toEqual({ by: 'stock-gate', decision: 'pass' })
    expect(adapter.requests).toHaveLength(1)
    expect(gate.calls).toBe(1)
  })

  it('admits in the loop a message that arrives without a verdict: the same reply, nothing recorded', async () => {
    const adapter = new MockAdapter([])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('unadmitted'), { provider: 'mock', model: 'mock' })
    const gate = stockGate()
    agent.ctx.get('intakeGuard')!.register(gate)

    await sendAndWait(agent, '帮我炒股')

    expect(adapter.requests).toEqual([])
    expect(gate.calls).toBe(1)
    expect(replies(agent).map(reply => reply.data.message.content)).toEqual([[{ type: 'text', text: '这个我帮不了。' }]])
    expect(humanSources(agent)).toEqual([{ kind: 'user' }])
  })

  it('admits everything for an agent whose chain registered nothing, and the nearest registration wins', async () => {
    const adapter = new MockAdapter([textResponse('好的')])
    const ctx = await harness(adapter)
    const plain = await ctx.agentLoop.create(SessionId('plain'), { provider: 'mock', model: 'mock' })
    const scoped = await ctx.agentLoop.create(SessionId('scoped'), { provider: 'mock', model: 'mock' })
    const agentGate = stockGate()
    scoped.ctx.get('intakeGuard')!.register(agentGate)

    expect(await ctx.intakeGuard.admit(plain, { text: '帮我炒股', context: {} }, AbortSignal.timeout(5000))).toBeUndefined()
    ctx.intakeGuard.register({ name: 'host-gate', admit: async () => ({ decision: 'pass' }) })
    expect(ctx.intakeGuard.admissionFor(plain)?.name).toBe('host-gate')
    expect(ctx.intakeGuard.admissionFor(scoped)?.name).toBe('stock-gate')
  })
})
