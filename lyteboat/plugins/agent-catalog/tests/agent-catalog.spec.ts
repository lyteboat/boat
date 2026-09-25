/**
 * The agent catalog: scan the roots, declare each agent to the preset
 * registry, and report the ones that cannot be served. A row that fails to
 * mount needs the host's loader tree; the headless composition covers it.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { MockAdapter, createLyteboatUnitHost } from '@lyteboat/testing'
import AgentCatalogService from '@lyteboat/agent-catalog'
import type { Config } from '@lyteboat/agent-catalog'

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

async function catalogHost(config: Config): Promise<Context> {
  const ctx = await createLyteboatUnitHost(new MockAdapter([]))
  // The unit host has no loader tree; the registry only waits on it to settle, and here it has.
  ctx.provide('loader', { await: () => Promise.resolve() } as never)
  await ctx.plugin(AgentPresetRegistry, { default: 'none' })
  await ctx.plugin(AgentCatalogService, config)
  return ctx
}

describe('the agent catalog', () => {
  it('declares every agent the roots hold to the preset registry, with its display fields', async () => {
    const ctx = await catalogHost({ roots: [fixture('good')] })

    await ctx.agentCatalog.whenReady()

    expect(ctx.agentCatalog.list()).toEqual([
      { id: 'alpha', dir: fixture('good/alpha'), name: 'Alpha', description: 'the first fixture agent', order: 1 },
      { id: 'beta', dir: fixture('good/beta') },
    ])
    expect(await ctx.agentPresets.resolve('alpha')).toEqual({ id: 'alpha' })
    expect(ctx.agentCatalog.failures()).toEqual([])
  })

  it('declares only the included agents when include names them', async () => {
    const ctx = await catalogHost({ roots: [fixture('good')], include: ['beta'] })

    await ctx.agentCatalog.whenReady()

    expect(ctx.agentCatalog.list().map(agent => agent.id)).toEqual(['beta'])
    expect(ctx.agentCatalog.get('alpha')).toBeUndefined()
  })

  it('fails whenReady naming every agent it cannot serve when strict', async () => {
    const ctx = await catalogHost({ roots: [fixture('good'), fixture('broken')] })

    const failure = await ctx.agentCatalog.whenReady().then(() => undefined, (error: unknown) => error)

    expect(String(failure)).toContain('agent-catalog: 2 agent(s) failed')
    expect(ctx.agentCatalog.failures().map(problem => problem.id).sort()).toEqual(['Not_Kebab', 'bad-yaml'])
  })

  it('reports the failures and serves the rest when not strict', async () => {
    const ctx = await catalogHost({ roots: [fixture('good'), fixture('broken')], strict: false })

    await ctx.agentCatalog.whenReady()

    expect(ctx.agentCatalog.list().map(agent => agent.id)).toEqual(['alpha', 'beta'])
    const reasons = Object.fromEntries(ctx.agentCatalog.failures().map(problem => [problem.id, problem.reason]))
    expect(reasons['Not_Kebab']).toBe('"Not_Kebab" is not a kebab-case id; rename the directory')
    expect(reasons['bad-yaml']).toContain('agent-catalog: cannot read')
  })

  it('fails whenReady when two roots hold the same id, or no root holds an included one', async () => {
    const duplicated = await catalogHost({ roots: [fixture('good'), fixture('dup')], strict: false })
    const unknown = await catalogHost({ roots: [fixture('good')], include: ['gamma'] })

    await expect(duplicated.agentCatalog.whenReady()).rejects.toThrow(`agent-catalog: agent "alpha" is in two roots: ${fixture('good')} and ${fixture('dup')}`)
    await expect(unknown.agentCatalog.whenReady()).rejects.toThrow('agent-catalog: no root holds "gamma" (available: alpha, beta)')
  })
})
