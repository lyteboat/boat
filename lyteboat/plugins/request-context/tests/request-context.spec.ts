/**
 * The request on a human message: written by the service, read back with
 * validation, and folded into the session's request state.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, createLyteboatUnitHost, followUpAndWait as send, textResponse } from '@lyteboat/testing'
import RequestContextService, { lyteboatRequestOf } from '@lyteboat/request-context'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = await createLyteboatUnitHost(adapter)
  await ctx.plugin(RequestContextService)
  return ctx
}

describe('the request on a human message', () => {
  it('rides the source beside kind user, and a request with nothing to record leaves the source as dsh writes it', async () => {
    const ctx = await harness(new MockAdapter([]))

    const carried = ctx.requestContext.message('看看我的资产', { requestId: 'r-1', context: { customer: 'c-1' } })
    const plain = ctx.requestContext.message('你好', {})

    expect(carried.source).toEqual({ kind: 'user', lyteboatRequest: { requestId: 'r-1', context: { customer: 'c-1' } } })
    expect(ctx.requestContext.requestOf(carried)).toEqual({ requestId: 'r-1', context: { customer: 'c-1' } })
    expect(plain.source).toEqual({ kind: 'user' })
    expect(ctx.requestContext.requestOf(plain)).toBeUndefined()
  })

  it('reads nothing from a malformed request or from another kind of source', () => {
    const malformed = createUserMessage({ content: [], source: { kind: 'user', lyteboatRequest: { context: 'not an object' } } as never })
    const otherKind = createUserMessage({ content: [], source: { kind: 'runtime-context', lyteboatRequest: { context: {} } } as never })

    expect(lyteboatRequestOf(malformed.source)).toBeUndefined()
    expect(lyteboatRequestOf(otherKind.source)).toBeUndefined()
  })

  it('folds the session context: the latest request that carried one wins, and one without keeps it', async () => {
    const ctx = await harness(new MockAdapter([textResponse('一'), textResponse('二'), textResponse('三')]))
    const agent = await ctx.agentLoop.create(SessionId('context'), { provider: 'mock', model: 'mock' })
    const verdict = { by: 'gate', decision: 'pass' as const }

    await send(agent, ctx.requestContext.message('第一句', { context: { customer: 'c-1', channel: 'app' }, intake: verdict }))
    await send(agent, ctx.requestContext.message('第二句', { intake: verdict }))
    expect(ctx.requestContext.contextOf(agent)).toEqual({ customer: 'c-1', channel: 'app' })

    await send(agent, ctx.requestContext.message('第三句', { context: { customer: 'c-2' } }))
    expect(ctx.sessionProjections.stateOf(agent.session, 'lyteboatRequest')).toEqual({ requests: 3, context: { customer: 'c-2' }, intake: null })
  })
})
