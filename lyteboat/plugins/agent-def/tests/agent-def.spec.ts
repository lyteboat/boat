import { join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { defineContentToolFixture, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import A2uiService from '@lyteboat/a2ui'
import { lyteboatAgentDef, type LyteboatAgentDef, type LyteboatAgentHost, type LyteboatAgentPlugin } from '@lyteboat/agent-def'
import AuxLlmService from '@lyteboat/aux-llm'
import LyteboatDistroService from '@lyteboat/distro'
import IntakeGuardService from '@lyteboat/intake-guard'
import RequestContextService from '@lyteboat/request-context'
import SkillRouterService from '@lyteboat/skill-router'
import { MockAdapter, createLyteboatUnitHost, followUpAndWait as send, textResponse } from '@lyteboat/testing'
import ToolPolicyService from '@lyteboat/tool-policy'

const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = await createLyteboatUnitHost(adapter)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(LyteboatDistroService)
  await ctx.plugin(ToolPolicyService)
  await ctx.plugin(AuxLlmService)
  await ctx.plugin(SkillRouterService)
  await ctx.plugin(A2uiService)
  await ctx.plugin(RequestContextService)
  await ctx.plugin(IntakeGuardService)
  return ctx
}

function echo(name: string): ToolDefinition {
  return defineContentToolFixture({ name, description: name, parameters: {}, execute: async () => [{ type: 'text', text: `${name} ran` }] })
}

/** A standing scope, mounted as the preset registry mounts an agent's rows: its base URL is the agent directory. */
async function mountAgent(ctx: Context, agentPlugin: LyteboatAgentPlugin, agentDir: string): Promise<{ standingKey: object }> {
  const standingKey = {}
  const standing = createScope(ctx, standingKey)
  await standing.ctx.extend({ baseUrl: pathToFileURL(join(agentDir, sep)).href }).plugin(agentPlugin)
  return { standingKey }
}

/** An agent joined to a standing scope in its setup window, as a session of that agent is. */
async function agentUnder(ctx: Context, standingKey: object, sessionId: string): Promise<Agent> {
  const { agent } = await ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: (agentCtx) => {
      const key = scopeOf(agentCtx)
      if (key === undefined) throw new Error('agent context has no scope')
      bindScopeParent(key, standingKey)
    },
  })
  return agent
}

const toolNames = (request: GenerateOptions): string[] => (request.tools ?? []).map(tool => tool.name).sort()
/** A loop request carries its system prompt as leading system-role messages. */
const systemText = (request: GenerateOptions | undefined): string => JSON.stringify(request?.messages.filter(message => message.role === 'system') ?? [])

const DESK_DEF: LyteboatAgentDef = {
  agentId: 'desk',
  agentName: 'Desk',
  persona: { prefix: 'You are DESK.' },
  skillRouting: { mode: 'full' },
  toolPolicy: { inherited: 'hidden' },
  modelRequest: { temperature: 0, maxTokens: 321 },
  tools: () => [{ definition: echo('lookup_quote'), visibility: 'auto' }],
  admission: () => ({ name: 'desk-admission', admit: async () => ({ decision: 'pass', verdict: 'in-scope' }) }),
  a2uiRenderTool: { templatesDir: 'assets/a2ui', name: 'render_notice' },
}

describe('lyteboatAgentDef', () => {
  it('mounts every declaration on the service that owns it, and a session of the agent sees them', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    ctx.tools.register(echo('host_tool'))
    const hosts: LyteboatAgentHost[] = []
    const requestTurns: number[] = []
    const DeskAgent = lyteboatAgentDef({
      ...DESK_DEF,
      eventListeners: (host) => {
        hosts.push(host)
        return { 'agent/request': async (payload, next) => { requestTurns.push(payload.turn); return await next() } }
      },
    })
    const { standingKey } = await mountAgent(ctx, DeskAgent, join(AGENTS, 'desk'))
    const agent = await agentUnder(ctx, standingKey, 'desk-session')

    await send(agent, 'quote ABC')

    const request = adapter.requests[0]
    expect(systemText(request)).toContain('You are DESK.')
    // full routing puts the default skill directory's skill in the prompt and activates the tool it requires.
    expect(systemText(request)).toContain('Call lookup_quote with the code the user names.')
    expect(request === undefined ? [] : toolNames(request)).toEqual(['lookup_quote', 'render_notice'])
    expect(request?.temperature).toBe(0)
    expect(request?.maxTokens).toBe(321)
    expect(requestTurns).toEqual([1])
    expect(ctx.intakeGuard.admissionFor(agent)?.name).toBe('desk-admission')
    expect(hosts[0]?.agentPath('assets/a2ui')).toBe(join(AGENTS, 'desk', 'assets', 'a2ui'))
  })

  it('reaches only the sessions of its own agent', async () => {
    const adapter = new MockAdapter([textResponse('desk'), textResponse('other')])
    const ctx = await harness(adapter)
    ctx.tools.register(echo('host_tool'))
    const requestTurns: string[] = []
    const DeskAgent = lyteboatAgentDef({
      ...DESK_DEF,
      eventListeners: () => ({ 'agent/request': async (payload, next) => { requestTurns.push(payload.agent.session.id); return await next() } }),
    })
    const { standingKey } = await mountAgent(ctx, DeskAgent, join(AGENTS, 'desk'))
    const desk = await agentUnder(ctx, standingKey, 'desk-session')
    const other = await ctx.agentLoop.create(SessionId('other-session'), { provider: 'mock', model: 'mock' })

    await send(desk, 'hello')
    await send(other, 'hello')

    expect(requestTurns).toEqual([desk.session.id])
    expect(systemText(adapter.requests[1])).not.toContain('You are DESK.')
    expect(adapter.requests[1] === undefined ? [] : toolNames(adapter.requests[1])).toEqual(['host_tool'])
    expect(adapter.requests[1]?.temperature).toBeUndefined()
  })

  it('computes the services it injects from the fields it has', () => {
    expect(lyteboatAgentDef({ agentId: 'minimal', agentName: 'Minimal', skillDirs: [] }).inject).toEqual([])
    expect(lyteboatAgentDef({ agentId: 'minimal', agentName: 'Minimal', persona: { prefix: 'hi' } }).inject).toEqual(['systemPrompt', 'skills'])
    expect([...lyteboatAgentDef(DESK_DEF).inject].sort()).toEqual(['a2ui', 'auxLlm', 'intakeGuard', 'requestContext', 'skillRouter', 'skills', 'systemPrompt', 'toolPolicy'])
  })

  it('carries the identity the agent catalog reads, and names its fibers after the agent', () => {
    const DeskAgent = lyteboatAgentDef(DESK_DEF)
    expect(DeskAgent.lyteboatAgentDefIdentity).toEqual({ agentId: 'desk', agentName: 'Desk' })
    expect(DeskAgent.name).toBe('lyteboat-agent:desk')
  })

  it('mounts no skills when the default skill directory does not exist', async () => {
    const ctx = await harness(new MockAdapter([]))
    const { standingKey } = await mountAgent(ctx, lyteboatAgentDef({ agentId: 'bare', agentName: 'Bare' }), join(AGENTS, 'bare'))
    expect((await ctx.skills.snapshot({ scope: standingKey })).skills).toEqual([])
  })

  it('fails to mount on a key the definition does not have, at every level it owns', async () => {
    const ctx = await harness(new MockAdapter([]))
    const desk = join(AGENTS, 'desk')
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, skilRouting: { mode: 'full' } } as never), desk)).rejects.toThrow(/lyteboat agent def: unknown key "skilRouting"/u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, toolPolicy: { inherited: 'hidden', undeclared: 'auto' } } as never), desk)).rejects.toThrow(/toolPolicy: unknown key "undeclared"/u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, toolPolicy: { tools: { skill: { visibility: 'always', requiresConfirmation: true } } } } as never), desk)).rejects.toThrow(/toolPolicy\.tools\.skill: unknown key "requiresConfirmation"/u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, a2uiRenderTool: { templatesDir: 'assets/a2ui', stateKey: ['x'] } } as never), desk)).rejects.toThrow(/a2uiRenderTool: unknown key "stateKey"/u)
  })

  it('fails to mount on a malformed value or a missing identity', async () => {
    const ctx = await harness(new MockAdapter([]))
    const desk = join(AGENTS, 'desk')
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, skillRouting: { mode: 'dynamc' } } as never), desk)).rejects.toThrow(/skillRouting\.mode/u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, agentId: 'Desk Agent' }), desk)).rejects.toThrow(/agentId: must be kebab-case/u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ agentId: 'desk' } as never), desk)).rejects.toThrow(/agentName/u)
  })

  it('names the field whose service refuses it', async () => {
    const ctx = await harness(new MockAdapter([]))
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, persona: {} as never }), join(AGENTS, 'desk'))).rejects.toThrow(/lyteboat agent def desk: persona: /u)
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, skillRouting: { provider: 'mock' } }), join(AGENTS, 'desk'))).rejects.toThrow(/lyteboat agent def desk: skillRouting: .*provider and model are declared together/u)
  })

  it('refuses a row config, which it would otherwise drop', async () => {
    const ctx = await harness(new MockAdapter([]))
    const standing = createScope(ctx, {})
    const scoped = standing.ctx.extend({ baseUrl: pathToFileURL(join(AGENTS, 'bare', sep)).href })
    await expect(scoped.plugin(lyteboatAgentDef({ agentId: 'bare', agentName: 'Bare' }), { temperature: 0 })).rejects.toThrow(/its row takes no config/u)
  })

  it('fails to mount when agentId is not the name of its directory', async () => {
    const ctx = await harness(new MockAdapter([]))
    await expect(mountAgent(ctx, lyteboatAgentDef({ ...DESK_DEF, agentId: 'wealth' }), join(AGENTS, 'desk')))
      .rejects.toThrow(/agentId "wealth" is declared in the agent directory "desk"/u)
  })

  it('fails to mount when a listed skill directory does not exist', async () => {
    const ctx = await harness(new MockAdapter([]))
    await expect(mountAgent(ctx, lyteboatAgentDef({ agentId: 'bare', agentName: 'Bare', skillDirs: ['skills'] }), join(AGENTS, 'bare')))
      .rejects.toThrow(/lyteboat agent def bare: skillDirs: skill directory not found: .*bare\/skills/u)
  })

  it('fails to mount outside an agent directory', async () => {
    const ctx = await harness(new MockAdapter([]))
    const standing = createScope(ctx, {})
    await expect(standing.ctx.plugin(lyteboatAgentDef({ agentId: 'bare', agentName: 'Bare' }))).rejects.toThrow(/the row has no agent directory/u)
  })
})
