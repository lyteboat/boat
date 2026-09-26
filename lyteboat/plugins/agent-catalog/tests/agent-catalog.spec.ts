/**
 * The agent catalog: scan the roots, declare each agent to the preset
 * registry, and report the ones that cannot be served. A row that fails to
 * mount needs the host's loader tree; the try composition covers it.
 */
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
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
  it('declares every agent the roots hold to the preset registry, with its manifest and working directory', async () => {
    const ctx = await catalogHost({ roots: [fixture('good')], workdirsDir: '/srv/lyteboat/workdirs' })

    await ctx.agentCatalog.whenReady()

    expect(ctx.agentCatalog.list()).toEqual([
      { id: 'alpha', dir: fixture('good/alpha'), workdir: '/srv/lyteboat/workdirs/alpha', name: 'Alpha', description: 'the first fixture agent', order: 1, version: '0.3.1', model: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      { id: 'beta', dir: fixture('good/beta'), workdir: '/srv/lyteboat/workdirs/beta' },
    ])
    expect(await ctx.agentPresets.resolve('alpha')).toEqual({ id: 'alpha' })
    expect(ctx.agentCatalog.failures()).toEqual([])
  })

  it('puts an agent\'s working directory under the home\'s agent-workdirs by default, without creating it', async () => {
    const ctx = await catalogHost({ roots: [fixture('good')] })

    await ctx.agentCatalog.whenReady()

    const workdir = ctx.agentCatalog.get('beta')?.workdir
    expect(workdir).toBe(dshHomePath('agent-workdirs', 'beta'))
    expect(existsSync(workdir ?? '')).toBe(false)
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

  describe('an agent\'s manifest', () => {
    const roots: string[] = []
    afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

    /** A root holding a copy of the fixture agent beta with the given files added. */
    function rootWithBeta(files: Record<string, string>): string {
      const root = mkdtempSync(join(tmpdir(), 'agent-catalog-manifest-'))
      roots.push(root)
      cpSync(fixture('good/beta'), join(root, 'beta'), { recursive: true })
      for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'beta', name), text)
      return root
    }

    async function failureOf(files: Record<string, string>): Promise<string | undefined> {
      const ctx = await catalogHost({ roots: [rootWithBeta(files)], strict: false })
      await ctx.agentCatalog.whenReady()
      expect(ctx.agentCatalog.get('beta')).toBeUndefined()
      return ctx.agentCatalog.failures().find(problem => problem.id === 'beta')?.reason
    }

    it('fails an agent whose manifest has a key it does not know, or a version that is not one', async () => {
      expect(await failureOf({ 'agent.yml': 'name: Beta\nundeclared: hidden\n' })).toMatch(/agent\.yml: .*"undeclared"/u)
      expect(await failureOf({ 'agent.yml': 'version: latest\n' })).toContain('agent.yml: version: must look like 1.2.3 or 1.2.3-rc.1')
      expect(await failureOf({ 'agent.yml': 'model: { provider: deepseek-official }\n' })).toContain('agent.yml: model.model:')
    })

    it('fails an agent that still has preset.yml, naming the rename', async () => {
      expect(await failureOf({ 'preset.yml': 'name: Beta\n' })).toBe(`agent-catalog: ${join(roots[0] ?? '', 'beta', 'preset.yml')} is now agent.yml: rename it (name, description, and order stay; version and model are new)`)
    })
  })

  describe('when the roots change', () => {
    const roots: string[] = []
    afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

    /** A root holding copies of the named fixture agents. */
    function rootWith(...ids: string[]): string {
      const root = mkdtempSync(join(tmpdir(), 'agent-catalog-'))
      roots.push(root)
      for (const id of ids) cpSync(fixture(`good/${id}`), join(root, id), { recursive: true })
      return root
    }

    it('reloads what the roots hold now: a new agent is declared, a removed one withdrawn', async () => {
      const root = rootWith('alpha')
      const ctx = await catalogHost({ roots: [root] })
      await ctx.agentCatalog.whenReady()

      cpSync(fixture('good/beta'), join(root, 'beta'), { recursive: true })
      rmSync(join(root, 'alpha'), { recursive: true })
      await ctx.agentCatalog.reload()

      expect(ctx.agentCatalog.list().map(agent => agent.id)).toEqual(['beta'])
      expect(await ctx.agentPresets.resolve('beta')).toEqual({ id: 'beta' })
      expect((await ctx.agentPresets.list()).map(preset => preset.id)).not.toContain('alpha')
    })

    it('reloads by itself when watching and an agent appears under a root', async () => {
      const root = rootWith('alpha')
      const ctx = await catalogHost({ roots: [root], watch: true, watchDelayMs: 20 })
      await ctx.agentCatalog.whenReady()

      cpSync(fixture('good/beta'), join(root, 'beta'), { recursive: true })

      await vi.waitFor(() => { expect(ctx.agentCatalog.list().map(agent => agent.id)).toEqual(['alpha', 'beta']) }, { timeout: 5000 })
    })
  })
})
