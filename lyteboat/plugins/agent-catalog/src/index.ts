/**
 * @lyteboat/agent-catalog — the agents a lyteboat process serves. It scans
 * the configured roots (each direct subdirectory holding `agent.cordis.yml` is
 * an agent, its directory name the id), declares every agent to dsh's agent
 * preset registry with its directory as the base URL, and reports the agents
 * that fail to read or mount, using the registry's own diagnostics. It answers
 * only which agents there are and where each one works (its working directory,
 * the `cwd` its sessions are recorded under); driving them is the caller's
 * (`lyteboat try`, `/chat`, eval, and Studio).
 *
 * The declarations are made once the host tree has settled: the registry's
 * diagnostics wait for that settlement, so they cannot run inside this row's
 * own activation. `whenReady()` resolves when they are made. `reload()`
 * withdraws every declaration and makes them again from what the roots hold
 * now (a session already running keeps the agent it started with), and
 * `watch` reloads whenever a root changes.
 * @module @lyteboat/agent-catalog
 */

import { watch as watchPath } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import type { LyteboatAgentModel } from '@lyteboat/contracts'
import { locateAgents, readAgentDefinition } from './agent-directory.ts'
import type { AgentCatalogLocation, AgentDirectoryDefinition } from './agent-directory.ts'

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
  /**
   * The agent's working directory, the `cwd` its sessions are recorded under,
   * wherever the process started; not created until a session needs it, and
   * shown to the model by no prompt of lyteboat's.
   */
  readonly workdir: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  /** The version the agent's `agent.yml` declares. */
  readonly version?: string
  /** The model the agent's `agent.yml` declares. */
  readonly model?: LyteboatAgentModel
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
  /** Reload whenever a file under a root changes. */
  watch?: boolean
  /** How long a change waits for the next before it reloads. */
  watchDelayMs?: number
  /** Where each agent's working directory is (`<workdirsDir>/<id>`); default `$LYTEBOAT_HOME/agent-workdirs`. */
  workdirsDir?: string
}

export const Config: z<Config> = z.object({
  roots: z.array(z.string()).required(),
  include: z.array(z.string()),
  strict: z.boolean().default(true),
  watch: z.boolean().default(false),
  watchDelayMs: z.natural().default(300),
  workdirsDir: z.string(),
})

/** Host service: the agent roster and its failures. */
export class AgentCatalogService extends Service {
  static inject = ['agentPresets']
  // The loader applies a class plugin's static Config, not the module's.
  static Config = Config

  private readonly entries = new Map<string, AgentCatalogEntry>()
  private readonly problems = new Map<string, AgentCatalogFailure>()
  /** The disposers that withdraw each declaration, by id. */
  private readonly declared = new Map<string, () => Promise<void>>()
  private ready: Promise<void>

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'agentCatalog')
    this.ready = this.settle(this.ctx.get('loader')?.await().then(() => this.declareAll()) ?? this.declareAll())
    if (config.watch === true) this.watchRoots()
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

  /**
   * Withdraw every declaration and declare the agents the roots hold now,
   * after any declaration already under way.
   * @returns what `whenReady()` returns from now on.
   */
  reload(): Promise<void> {
    this.ready = this.settle(this.ready.catch(() => {}).then(async () => {
      for (const withdraw of this.declared.values()) await withdraw()
      this.declared.clear()
      this.entries.clear()
      this.problems.clear()
      await this.declareAll()
    }))
    return this.ready
  }

  /** A caller observes the outcome through whenReady(); an unobserved one must not crash the process. */
  private settle(outcome: Promise<void>): Promise<void> {
    outcome.catch(() => {})
    return outcome
  }

  private watchRoots(): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        this.reload().catch((error: unknown) => {
          this.ctx.logger.warn(`agent-catalog: reloading after a change failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      }, this.config.watchDelayMs ?? 300)
    }
    this.ctx.effect(() => {
      const watchers = this.config.roots.map(root => watchPath(resolve(root), { recursive: true }, changed))
      return () => {
        clearTimeout(timer)
        for (const watcher of watchers) watcher.close()
      }
    }, 'agent-catalog: watch the roots')
  }

  private async declareAll(): Promise<void> {
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
    let definition: AgentDirectoryDefinition
    try {
      definition = readAgentDefinition(id, dir)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    // The registry takes the declaration's base URL from its caller's context.
    const presets = this.ctx.extend({ baseUrl: pathToFileURL(join(dir, sep)).href }).agentPresets
    try {
      this.declared.set(id, this.ctx.effect(() => presets.register(definition.preset), `agent-catalog.declare(${id})`))
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
    const preset = await this.ctx.agentPresets.resolve(id)
    if (preset.broken !== undefined) return fail(preset.broken)
    const { preset: { name, description, order }, version, model } = definition
    this.entries.set(id, {
      id, dir,
      workdir: join(this.config.workdirsDir ?? dshHomePath('agent-workdirs'), id),
      ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...order === undefined ? {} : { order },
      ...version === undefined ? {} : { version },
      ...model === undefined ? {} : { model },
    })
  }
}

export default AgentCatalogService
