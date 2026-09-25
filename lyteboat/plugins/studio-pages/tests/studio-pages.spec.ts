/**
 * The `/lyteboat` channel the Studio pages call, answered in process: dsh's
 * connection and session controller are stood in for at their boundary (the
 * handler the page's call reaches, the prompts and projections it asks for);
 * the agent catalog and the request context are the real services.
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConnectionRpcHandler, ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { MockAdapter, createLyteboatUnitHost } from '@lyteboat/testing'
import AgentCatalogService from '@lyteboat/agent-catalog'
import RequestContextService from '@lyteboat/request-context'
import StudioPagesService, { STUDIO_RPC_CHANNEL } from '@lyteboat/studio-pages'

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

/** What a page's call reaches, and what the session controller was asked. */
interface StudioPagesHost {
  call(endpoint: string, payload?: unknown): Promise<ConnectionRpcHandlerResult>
  prompts: SessionPromptRequest[]
  ctx: Context
}

async function studioPagesHost(roots: string[], sessions: Record<string, Record<string, unknown>> = {}): Promise<StudioPagesHost> {
  const ctx = await createLyteboatUnitHost(new MockAdapter([]))
  const handlers = new Map<string, ConnectionRpcHandler>()
  const prompts: SessionPromptRequest[] = []
  // The unit host has no loader tree; the registry only waits on it to settle, and here it has.
  ctx.provide('loader', { await: () => Promise.resolve() } as never)
  // dsh's connection: the channel a page's call reaches once it is authenticated.
  ctx.provide('connection', { rpc: { handle: (channel: string, handler: ConnectionRpcHandler) => { handlers.set(channel, handler); return () => Promise.resolve(handlers.delete(channel)).then(() => {}) } } } as never)
  // dsh's session controller: a session's projections, and the prompts queued on it.
  ctx.provide('sessionController', {
    projections: ({ sessionId }: { sessionId: string }) => Promise.resolve(sessionId in sessions ? { asOfSeq: 1, values: sessions[sessionId] } : null),
    prompt: (request: SessionPromptRequest) => { prompts.push(request); return Promise.resolve() },
  } as never)
  await ctx.plugin(AgentPresetRegistry, { default: 'none' })
  await ctx.plugin(AgentCatalogService, { roots, strict: false })
  await ctx.plugin(RequestContextService)
  await ctx.plugin(StudioPagesService, { owner: 'studio', evalsDir: fixture('evals') })
  const call = async (endpoint: string, payload: unknown = {}): Promise<ConnectionRpcHandlerResult> => {
    const handler = handlers.get(STUDIO_RPC_CHANNEL)
    if (handler === undefined) throw new Error(`nothing handles ${STUDIO_RPC_CHANNEL}`)
    return handler(endpoint, payload, new AbortController().signal, {} as never)
  }
  return { call, prompts, ctx }
}

describe('the Studio pages\' channel', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  it('answers the agents the catalog serves, with their display fields, and the ones it cannot', async () => {
    const host = await studioPagesHost([fixture('agents')])

    const answer = await host.call('agents')

    expect(answer).toEqual({
      ok: true,
      value: {
        agents: [{ id: 'support', name: 'Support', description: 'a fixture agent' }],
        failures: [{ id: 'Bad_Id', reason: '"Bad_Id" is not a kebab-case id; rename the directory' }],
      },
    })
  })

  it('reloads the catalog and answers the agents the roots hold now', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-pages-'))
    roots.push(root)
    const host = await studioPagesHost([root])
    await host.ctx.agentCatalog.whenReady()
    cpSync(fixture('agents/support'), join(root, 'support'), { recursive: true })

    const answer = await host.call('agents/reload')

    expect(answer).toEqual({ ok: true, value: { agents: [{ id: 'support', name: 'Support', description: 'a fixture agent' }], failures: [] } })
  })

  it('queues a message through the session controller with its request context on the source', async () => {
    const host = await studioPagesHost([fixture('agents')])

    const answer = await host.call('session/send', { sessionId: 'sess-1', text: '看看我的资产', context: { customer: 'young-idle-cash' } })

    expect(answer.ok).toBe(true)
    const requestId = answer.ok ? (answer.value as { requestId: string }).requestId : ''
    expect(host.prompts).toEqual([{
      requestId,
      sessionId: 'sess-1',
      mode: 'queue',
      content: [{ type: 'text', text: '看看我的资产' }],
      sourceFields: { lyteboatRequest: { requestId, owner: 'studio', context: { customer: 'young-idle-cash' } } },
    }])
  })

  it('refuses a blank message or an unknown field, and queues nothing', async () => {
    const host = await studioPagesHost([fixture('agents')])

    const blank = await host.call('session/send', { sessionId: 'sess-1', text: '  ' })
    const unknown = await host.call('session/send', { sessionId: 'sess-1', text: 'hi', trace: 'x' })

    expect(blank).toEqual({ ok: false, error: { code: 'invalid_request', message: 'text: text must not be blank', details: {} } })
    expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    expect(host.prompts).toEqual([])
  })

  it('answers a session\'s lyteboat state from its projections, and refuses a session that does not exist', async () => {
    const request = { requests: 1, context: { customer: 'young-idle-cash' }, intake: null, owner: 'studio' }
    const host = await studioPagesHost([fixture('agents')], { 'sess-1': { agentPreset: 'support', lyteboatActiveSkill: 'asset-overview', lyteboatRequest: request } })

    const known = await host.call('session', { sessionId: 'sess-1' })
    const unknown = await host.call('session', { sessionId: 'sess-2' })

    expect(known).toEqual({ ok: true, value: { agent: 'support', skill: 'asset-overview', request, cards: null, state: null } })
    expect(unknown).toEqual({ ok: false, error: { code: 'session_not_found', message: 'session "sess-2" does not exist', details: {} } })
  })

  it('lists the eval runs newest first, skipping a directory that is not a run, and answers one run\'s report', async () => {
    const host = await studioPagesHost([fixture('agents')])

    const runs = await host.call('evals')
    const report = await host.call('evals/report', { run: '20260925T010000Z-aaaa' })

    expect(runs).toEqual({
      ok: true,
      value: {
        runs: [
          { id: '20260925T020000Z-bbbb', agent: 'support', mode: 'replay', cases: 2, passedCases: 2, startedAt: '2026-09-25T02:00:00.000Z' },
          { id: '20260925T010000Z-aaaa', agent: 'support', mode: 'real', cases: 2, passedCases: 1, startedAt: '2026-09-25T01:00:00.000Z' },
        ],
      },
    })
    expect(report).toEqual({ ok: true, value: { run: '20260925T010000Z-aaaa', report: '# Eval support: 1/2 cases passed\n' } })
  })

  it('refuses a report named by a path, and an endpoint it does not have', async () => {
    const host = await studioPagesHost([fixture('agents')])

    const escaped = await host.call('evals/report', { run: '../evals/20260925T010000Z-aaaa' })
    const missing = await host.call('sessions')

    expect(escaped).toEqual({ ok: false, error: { code: 'not_found', message: 'no eval run "../evals/20260925T010000Z-aaaa"', details: {} } })
    expect(missing).toEqual({ ok: false, error: { code: 'not_found', message: 'no endpoint "sessions"', details: {} } })
  })
})
