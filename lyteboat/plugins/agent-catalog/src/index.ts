/**
 * @lyteboat/agent-catalog — the agents a lyteboat process serves. It scans
 * the configured roots (each direct subdirectory holding `agent.cordis.yml` is
 * an agent, its directory name the id), declares every agent to dsh's agent
 * preset registry with its directory as the base URL, and reports the agents
 * that fail to read or mount, using the registry's own diagnostics. It answers
 * only which agents there are; driving them is the caller's (`lyteboat
 * headless`, later `/chat`, eval, and Studio).
 *
 * The declarations are made once the host tree has settled: the registry's
 * diagnostics wait for that settlement, so they cannot run inside this row's
 * own activation. `whenReady()` resolves when they are made.
 * @module @lyteboat/agent-catalog
 */

import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { locateAgents, readAgentDefinition } from './agent-directory.ts'
import type { AgentCatalogLocation } from './agent-directory.ts'

export { agentIds } from './agent-directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentCatalog: AgentCatalogService
  }
}

/** One agent the catalog declared and the registry mounted. */
export interface AgentCatalogEntry {
  readonly id: string
  /** The agent directory, the base its rows resolve against. */
  readonly dir: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
}

/** One agent the catalog cannot serve, and why. */
export interface AgentCatalogFailure {
  readonly id: string
  readonly dir: string
  readonly reason: string
}

export interface Config {
  /** Directories whose subdirectories are agents; each must exist. */
  roots: string[]
  /** Declare only these ids (in this order); empty or absent declares every agent the roots hold. */
  include?: string[]
  /** A failure fails `whenReady()`; false only reports it through `failures()`. */
  strict?: boolean
}

export const Config: z<Config> = z.object({
  roots: z.array(z.string()).required(),
  include: z.array(z.string()),
  strict: z.boolean().default(true),
})

/** Host service: the agent roster and its failures. */
export class AgentCatalogService extends Service {
  static inject = ['agentPresets']
  // The loader applies a class plugin's static Config, not the module's.
  static Config = Config

  private readonly entries = new Map<string, AgentCatalogEntry>()
  private readonly problems = new Map<string, AgentCatalogFailure>()
  private readonly ready: Promise<void>

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'agentCatalog')
    this.ready = this.declareAll()
    // A caller observes the outcome through whenReady(); an unobserved one must not crash the process.
    this.ready.catch(() => {})
  }

  /**
   * Settles once every agent is declared and its mount diagnosed.
   * @throws when the roots cannot be read, or, in strict mode, when any agent failed.
   */
  whenReady(): Promise<void> {
    return this.ready
  }

  /** The agents that mounted, by id. */
  list(): AgentCatalogEntry[] {
    return [...this.entries.values()]
  }

  /** One mounted agent; undefined for an unknown or failed id. */
  get(id: string): AgentCatalogEntry | undefined {
    return this.entries.get(id)
  }

  /** The agents that failed to read, declare, or mount. */
  failures(): AgentCatalogFailure[] {
    return [...this.problems.values()]
  }

  private async declareAll(): Promise<void> {
    await this.ctx.get('loader')?.await()
    const locations = locateAgents(this.config.roots.map(root => resolve(root)), this.config.include)
    for (const location of locations) await this.declare(location)
    if (this.config.strict !== false && this.problems.size > 0) {
      const lines = this.failures().map(failure => `  ${failure.id}: ${failure.reason}`)
      throw new Error(`agent-catalog: ${String(this.problems.size)} agent(s) failed:\n${lines.join('\n')}`)
    }
  }

  private async declare({ id, dir }: AgentCatalogLocation): Promise<void> {
    const fail = (reason: string): void => { this.problems.set(id, { id, dir, reason }) }
    if (!isSkillName(id)) return fail(`"${id}" is not a kebab-case id; rename the directory`)
    let definition: PresetDefinition
    try {
      definition = readAgentDefinition(id, dir)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    // The registry takes the declaration's base URL from its caller's context.
    const presets = this.ctx.extend({ baseUrl: pathToFileURL(join(dir, sep)).href }).agentPresets
    try {
      await this.ctx.effect(() => presets.register(definition), `agent-catalog.declare(${id})`)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    const preset = await this.ctx.agentPresets.resolve(id)
    if (preset.broken !== undefined) return fail(preset.broken)
    const { name, description, order } = definition
    this.entries.set(id, {
      id, dir,
      ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...order === undefined ? {} : { order },
    })
  }
}

export default AgentCatalogService
