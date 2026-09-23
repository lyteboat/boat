/**
 * @boat/skill-router — the reference skill loading and routing over the dsh skill
 * registry. One host service, `ctx.skillRouter`, with per-scope settings
 * (host row defaults, overridden by a preset's registrar row):
 *
 * - `off`: nothing.
 * - `full`: every model-invocable skill's body is a system prompt section
 *   (`boat:skills`) and every tool the skills require is activated; no
 *   routing.
 * - `dynamic`: each user input is routed by a side model call (the reference
 *   LLMSkillRouter prompt and rules, sticky on null / errors / timeouts);
 *   the active skill's body reaches the same step through the `boat:skill`
 *   runtime context, its `metadata.boat.requiredTools` are activated
 *   through `ctx.toolPolicy` (replacing the previous skill's), and the model
 *   loading a skill through the `skill` tool switches the active skill too.
 *
 * Decisions are durable: `boat/route-request` audits every router call,
 * `boat/skill-routed` records every activation (source `router` or
 * `model`), and the `boatActiveSkill` projection folds the latter.
 * @module @boat/skill-router
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { AnonymousEntries, ScopedLayers, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import { isModelInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@boat/tool-policy'
import type { BoatSkillMeta, BoatStepPayload } from '@boat/contracts'
import { SKILL_ROUTER_SYSTEM_PROMPT, buildRoutePrompt, renderHistory, resolveRouteDecision } from './router.ts'
import type { RouteCandidate, RouteDecision } from './router.ts'

export { SKILL_ROUTER_SYSTEM_PROMPT, buildRoutePrompt, renderHistory, resolveRouteDecision } from './router.ts'
export type { RouteCandidate, RouteDecision, RoutePromptInput } from './router.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillRouter: SkillRouterService
  }
}

/** Where the active skill's body sits among the runtime contexts (after boat:state at 130). */
export const BOAT_SKILL_CONTEXT_ORDER = 140
/** Where the full-mode skill bodies sit among the system prompt sections (before PLAN_POLICY at 500). */
export const BOAT_SKILLS_SECTION_ORDER = 450
/** Timeout reason code of one router call. */
export const SKILL_ROUTE_TIMEOUT_CODE = 'BOAT_SKILL_ROUTE_TIMEOUT'
/** Output budget of one router call: strict JSON with a ≤30-character reason. */
const ROUTE_MAX_TOKENS = 200
/** Plugin name recorded on the router's own messages. */
const PLUGIN = 'boat-skill-router'

export type SkillLoadMode = 'off' | 'full' | 'dynamic'

/** The resolved settings one agent runs under. */
export interface SkillRouterSettings {
  mode: SkillLoadMode
  /** Conversation lines shown to the router; 0 shows none. */
  historyWindow: number
  timeoutMs: number
  /** Router route; absent uses the agent's own model. Declared together (`declare` rejects one without the other). */
  provider?: string
  model?: string
}

/** Plugin config (the host row): the process-wide defaults. */
export type Config = Partial<SkillRouterSettings>

export const Config: z<Config> = z.object({
  mode: z.union(['off', 'full', 'dynamic'] as const).default('off'),
  historyWindow: z.natural().default(6),
  timeoutMs: z.natural().default(10_000),
  provider: z.string(),
  model: z.string(),
})

const DEFAULT_SETTINGS: SkillRouterSettings = { mode: 'off', historyWindow: 6, timeoutMs: 10_000 }

/** Drop undefined fields so a partial declaration never erases an inherited one; a route is declared whole or not at all. */
function compact(settings: Partial<SkillRouterSettings>): Partial<SkillRouterSettings> {
  if ((settings.provider === undefined) !== (settings.model === undefined)) {
    throw new Error(`boat skill router: provider and model are declared together; got provider=${JSON.stringify(settings.provider)} model=${JSON.stringify(settings.model)}`)
  }
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)) as Partial<SkillRouterSettings>
}

class SettingsLayer implements ScopeLayer {
  readonly entries = new AnonymousEntries<Partial<SkillRouterSettings>>()

  isEmpty(): boolean {
    return this.entries.isEmpty()
  }
}

/** The `boat` object of a skill's frontmatter metadata, when it is one. */
export function boatSkillMeta(metadata: Readonly<Record<string, unknown>> | undefined): BoatSkillMeta | undefined {
  const boat = metadata?.['boat']
  if (typeof boat !== 'object' || boat === null || Array.isArray(boat)) return undefined
  const record = boat as Record<string, unknown>
  const requiredTools = record['requiredTools']
  return {
    ...typeof record['group'] === 'string' ? { group: record['group'] } : {},
    ...Array.isArray(requiredTools) ? { requiredTools: requiredTools.filter((tool): tool is string => typeof tool === 'string') } : {},
    ...typeof record['version'] === 'string' ? { version: record['version'] } : {},
    ...Array.isArray(record['tags']) ? { tags: (record['tags'] as unknown[]).filter((tag): tag is string => typeof tag === 'string') } : {},
  }
}

const activeSkillSchema = zod.string().nullable()

export const boatActiveSkillProjectionDefinition = {
  key: 'boatActiveSkill',
  stateSchema: activeSkillSchema,
  init: (): string | null => null,
  apply(state: string | null, event) {
    return event.type === 'boat/skill-routed' ? event.data.skill : state
  },
  wire: { viewSchema: activeSkillSchema, view: (state: string | null) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'boatActiveSkill', string | null>

interface AgentSkillState {
  /** The rendered body of the active skill, when loaded. */
  body: { name: string; text: string } | undefined
  /** Full mode: the rendered bodies of every skill, keyed by the catalog digest that produced them. */
  full: { digest: string; text: string } | undefined
  /** The turn last seen at pre-assembly, for nodes appended outside a step payload. */
  turn: number
  /** A model-initiated activation still loading; awaited before the next assembly. */
  pending: Promise<void> | undefined
}

function userText(messages: BoatStepPayload['messages']): string {
  return messages
    .filter(message => message.source.kind === 'user')
    .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    .filter(text => text !== '')
    .join('\n')
}

/** Host service: skill load modes, LLM routing, and the active skill's presence in the prompt. */
export class SkillRouterService extends Service {
  static inject = ['skills', 'llm', 'sessionProjections', 'systemPrompt', 'tools', 'toolPolicy']

  private readonly layers = new ScopedLayers(() => new SettingsLayer(), () => {})
  private readonly agents = new WeakMap<Agent, AgentSkillState>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillRouter')
    this.layers.global.entries.append(compact(config))
    ctx.sessionProjections.register(boatActiveSkillProjectionDefinition)
    ctx.systemPrompt.context({
      name: 'boat:skill',
      order: BOAT_SKILL_CONTEXT_ORDER,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        const body = this.agents.get(agent)?.body
        return body === undefined ? '' : `The following skill is active for the current task. Follow its instructions.\n${body.text}`
      },
    })
    ctx.systemPrompt.section({
      name: 'boat:skills',
      order: BOAT_SKILLS_SECTION_ORDER,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        return this.agents.get(agent)?.full?.text ?? ''
      },
    })
    // Before `next()`: routing and activation happen first, so plugins later
    // in the waterfall can still override, and tool-policy's own listener
    // (registered before this one) reconciles the restriction at the end.
    ctx.on('boat/pre-assemble', async (payload, next) => {
      await this.prepare(payload)
      return next()
    })
    ctx.on('tools/result', (exec, result) => {
      if (exec.name !== 'skill' || result.isError || exec.agent === undefined || exec.parent !== undefined) return
      const agent = exec.agent
      if (this.settingsFor(agent).mode !== 'dynamic') return
      const args = exec.arguments as { name?: unknown }
      if (typeof args.name !== 'string' || this.activeOf(agent) === args.name) return
      const skillName = args.name
      const state = this.stateOf(agent)
      // The call's own signal ends with the call, so the lookup runs without one;
      // the next assembly awaits `pending` and checks its own signal.
      const lookup: SkillViewOptions = { cwd: agent.session.header.cwd, scope: agent }
      // Chained, not replaced: two skill loads in one step activate in order,
      // and the next assembly waits for both.
      const pending: Promise<void> = (state.pending ?? Promise.resolve())
        .then(() => this.activate(agent, skillName, 'model', 'loaded through the skill tool', state.turn, lookup))
        .catch((error: unknown) => {
          ctx.logger.warn(`boat skill router: model-initiated activation of "${skillName}" failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => { if (state.pending === pending) state.pending = undefined })
      state.pending = pending
    })
  }

  /**
   * Declare settings in the calling scope's layer; nearer scopes override
   * farther ones, and absent fields keep what they inherit. `provider` and
   * `model` come together or not at all.
   * @param settings - the fields to override.
   * @returns the exact disposer that withdraws the declaration.
   * @throws when only one of `provider` and `model` is given.
   */
  declare(settings: Partial<SkillRouterSettings>): () => void {
    const compacted = compact(settings)
    return this.layers.effect(
      this.ctx,
      layer => layer.entries.append(compacted),
      { label: 'skillRouter.declare()', notify: false },
    )
  }

  /** The settings one agent runs under: defaults, then every layer on its chain, nearest last. */
  settingsFor(agent: Agent): SkillRouterSettings {
    return this.settingsOf(scopeOf(agent.ctx))
  }

  private settingsOf(scope: ScopeKey | undefined): SkillRouterSettings {
    let settings: SkillRouterSettings = { ...DEFAULT_SETTINGS }
    for (const layer of [this.layers.global, ...this.layers.chainLayers(scope)]) {
      for (const entry of layer.entries.values()) settings = { ...settings, ...entry }
    }
    return settings
  }

  /** The skill active for one agent, as the log records it. */
  activeOf(agent: Agent): string | null {
    return this.ctx.sessionProjections.stateOf(agent.session, 'boatActiveSkill') ?? null
  }

  private stateOf(agent: Agent): AgentSkillState {
    let state = this.agents.get(agent)
    if (state === undefined) {
      state = { body: undefined, full: undefined, turn: 0, pending: undefined }
      this.agents.set(agent, state)
    }
    return state
  }

  private async prepare(payload: BoatStepPayload): Promise<void> {
    const { agent, messages, signal, turn } = payload
    const settings = this.settingsFor(agent)
    if (settings.mode === 'off') return
    const state = this.stateOf(agent)
    state.turn = turn
    if (state.pending !== undefined) await state.pending
    signal.throwIfAborted()
    const lookup: SkillViewOptions = { cwd: agent.session.header.cwd, signal, scope: agent }
    if (settings.mode === 'full') {
      await this.prepareFull(agent, lookup)
      return
    }
    const input = userText(messages)
    if (input !== '') await this.route(agent, settings, lookup, input, turn, signal)
    await this.refreshActive(agent, lookup)
  }

  /** Full mode: every model-invocable skill's body in one section, every required tool activated. */
  private async prepareFull(agent: Agent, lookup: SkillViewOptions): Promise<void> {
    const snapshot = await this.ctx.skills.snapshot(lookup)
    lookup.signal?.throwIfAborted()
    const names = snapshot.skills.filter(isModelInvocable).map(skill => skill.name)
    const digest = names.join('\n')
    const state = this.stateOf(agent)
    if (state.full?.digest === digest) return
    const definitions: SkillDefinition[] = []
    for (const name of names) {
      const definition = await this.ctx.skills.get(name, lookup)
      lookup.signal?.throwIfAborted()
      if (definition !== undefined) definitions.push(definition)
    }
    const text = definitions.length === 0
      ? ''
      : ['The following skills apply to this session. Follow their instructions.', ...definitions.map(renderSkillContent)].join('\n\n')
    state.full = { digest, text }
    this.activateTools(agent, definitions.flatMap(definition => boatSkillMeta(definition.metadata)?.requiredTools ?? []))
  }

  /** Dynamic mode: one router call per user input, sticky on everything but a valid new id. */
  private async route(
    agent: Agent,
    settings: SkillRouterSettings,
    lookup: SkillViewOptions,
    userInput: string,
    turn: number,
    signal: AbortSignal,
  ): Promise<void> {
    const snapshot = await this.ctx.skills.snapshot(lookup)
    signal.throwIfAborted()
    const candidates: RouteCandidate[] = snapshot.skills.filter(isModelInvocable)
      .map(skill => ({ name: skill.name, description: skill.description }))
    if (candidates.length === 0) return
    const provider = settings.provider ?? agent.options.provider
    const model = settings.model ?? agent.options.model
    if (provider === undefined || model === undefined) {
      this.ctx.logger.warn('boat skill router: no route for the router call (set provider and model, or give the agent a model)')
      return
    }
    const current = this.activeOf(agent)
    const prompt = buildRoutePrompt({
      candidates,
      history: renderHistory(agent.session.deriveMessages(), settings.historyWindow),
      current,
      userInput,
    })
    const names = candidates.map(candidate => candidate.name)
    const started = performance.now()
    const decision = await this.decide(agent, { provider, model }, prompt, names, current, settings.timeoutMs, signal)
    const durationMs = Math.round(performance.now() - started)
    agent.session.append('boat/route-request', {
      turn, route: { provider, model }, candidates: names, decision: decision.skill, reason: decision.reason, durationMs,
    })
    if (decision.skill !== null && decision.skill !== current) {
      await this.activate(agent, decision.skill, 'router', decision.reason, turn, lookup)
    }
  }

  /** One router call under its own deadline; every failure keeps the current skill. */
  private async decide(
    agent: Agent,
    route: { provider: string; model: string },
    prompt: string,
    candidates: readonly string[],
    current: string | null,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<RouteDecision> {
    using callDeadline = deadline(signal, timeoutMs, SKILL_ROUTE_TIMEOUT_CODE)
    try {
      const text = await this.generate(agent, route, prompt, callDeadline.signal)
      return resolveRouteDecision(text, candidates, current)
    } catch (error: unknown) {
      signal.throwIfAborted()
      const timeout = timeoutOf(callDeadline.signal, SKILL_ROUTE_TIMEOUT_CODE)
      const reason = timeout !== undefined ? 'timeout' : error instanceof Error ? error.name : 'error'
      this.ctx.logger.warn(`boat skill router: router call failed (${reason}): ${error instanceof Error ? error.message : String(error)}`)
      return { skill: current, reason }
    }
  }

  private async generate(agent: Agent, route: { provider: string; model: string }, prompt: string, signal: AbortSignal): Promise<string> {
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: PLUGIN } })],
      system: SKILL_ROUTER_SYSTEM_PROMPT,
      maxTokens: ROUTE_MAX_TOKENS,
      temperature: 0,
      sessionId: agent.session.id,
      signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) {
      signal.throwIfAborted()
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
    return assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
  }

  /** Make one skill the active skill: body cached, node appended, its required tools replacing the previous set. */
  private async activate(
    agent: Agent,
    name: string,
    source: 'router' | 'model',
    reason: string,
    turn: number,
    lookup: SkillViewOptions,
  ): Promise<void> {
    const definition = await this.ctx.skills.get(name, lookup)
    lookup.signal?.throwIfAborted()
    if (definition === undefined) {
      this.ctx.logger.warn(`boat skill router: skill "${name}" is not available to this agent; activation skipped`)
      return
    }
    this.stateOf(agent).body = { name, text: renderSkillContent(definition) }
    agent.session.append('boat/skill-routed', { turn, skill: name, reason, source })
    this.activateTools(agent, boatSkillMeta(definition.metadata)?.requiredTools ?? [])
  }

  /** The reference rule: visible = always + the active skills' required tools, so earlier activations are replaced. */
  private activateTools(agent: Agent, required: readonly string[]): void {
    const policy = this.ctx.toolPolicy
    policy.clear(agent)
    const known = required.filter(name => policy.metaOf(name, agent) !== undefined)
    const unknown = required.filter(name => !known.includes(name))
    if (unknown.length > 0) {
      this.ctx.logger.warn(`boat skill router: required tool${unknown.length > 1 ? 's' : ''} ${unknown.map(name => JSON.stringify(name)).join(', ')} not declared to the tool policy; skipped`)
    }
    if (known.length > 0) policy.activate(agent, known)
  }

  /**
   * Keep the in-process state in step with the durable active skill: a
   * resumed session (or one whose activation this process never saw) starts
   * with no body cached and no tools activated, so both are restored from the
   * projection, the way the reference implementation re-derives visibility from
   * `current_active_skill_id` every turn.
   */
  private async refreshActive(agent: Agent, lookup: SkillViewOptions): Promise<void> {
    const state = this.stateOf(agent)
    const active = this.activeOf(agent)
    if (active === null) {
      state.body = undefined
      return
    }
    if (state.body?.name === active) return
    const definition = await this.ctx.skills.get(active, lookup)
    lookup.signal?.throwIfAborted()
    if (definition === undefined) {
      state.body = undefined
      this.ctx.logger.warn(`boat skill router: active skill "${active}" is not available to this agent; its body and tools are not restored`)
      return
    }
    state.body = { name: active, text: renderSkillContent(definition) }
    this.activateTools(agent, boatSkillMeta(definition.metadata)?.requiredTools ?? [])
  }
}

export default SkillRouterService
