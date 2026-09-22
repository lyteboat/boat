/**
 * @boat/tool-policy — boat's tool policy over the dsh tool registry. One host
 * service, `ctx.toolPolicy`, holds boat-side metadata for tools registered in
 * the global layer or a preset's standing layer, and enforces it at three dsh
 * seams:
 *
 * - visibility: an `auto` tool stays out of the model's schemas until a
 *   plugin activates it for the agent (`activate`); the agent's restriction
 *   is recomputed after every `boat/pre-assemble` and reissued only when the
 *   denied set changed;
 * - confirmation: a `requiresConfirmation` tool answers `tools/pre-execute`
 *   with `ask`, so the approval seam decides (and denies when no answerer is
 *   composed);
 * - state: a tool registered with `stateDelta` carries its delta on the
 *   result's presentation meta (`meta.boat.stateDelta`); an accepted result
 *   appends `boat/state`, folded into the `boatState` projection and rendered
 *   to the model as the `boat:state` runtime context.
 *
 * Only inherited tools can be hidden — dsh's `restrict` never filters an
 * agent's own layer — so register and declare through the host or a preset
 * row, never through `agent.ctx`.
 * @module @boat/tool-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NamedEntries, ScopedLayers, scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { PostToolDecision, PreToolDecision, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { BoatToolMeta, JsonValue } from '@boat/contracts'
import { boatStateProjectionDefinition, isJsonObject, renderBoatState } from './state.ts'

export { boatStateProjectionDefinition, boatStateSchema, mergeStateDelta, renderBoatState } from './state.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolPolicy: ToolPolicyService
  }
}

/** Where the `boat:state` runtime context sits among dsh's (sandbox 110, approval 115, delegation 120). */
export const BOAT_STATE_CONTEXT_ORDER = 130

/** Metadata a composition file can declare for a tool registered elsewhere: everything but the code-only delta. */
export type BoatToolPolicy = Omit<BoatToolMeta, 'stateDelta'>

/** One scope's policy contribution. */
class PolicyLayer implements ScopeLayer {
  readonly metas: NamedEntries<BoatToolMeta>

  constructor(scope: ScopeKey | undefined) {
    this.metas = new NamedEntries(name => new Error(scope === undefined
      ? `boat tool policy for "${name}" is already declared globally`
      : `boat tool policy for "${name}" is already declared in this scope`))
  }

  isEmpty(): boolean {
    return this.metas.isEmpty()
  }
}

interface AgentPolicyState {
  readonly activated: Set<string>
  /** The denied names behind the live restriction, sorted; empty when none is issued. */
  deny: string[]
  dispose: (() => void) | undefined
}

/** Wrap a definition so its presentation meta carries the boat state delta beside the tool's own meta. */
function withStateDelta(definition: ToolDefinition, stateDelta: NonNullable<BoatToolMeta['stateDelta']>): ToolDefinition {
  const output = definition.output
  const inner = output.presentationMeta?.bind(output)
  return {
    ...definition,
    output: {
      ...output,
      presentationMeta(args: unknown, value: JsonValue): JsonValue {
        const base = inner?.(args, value)
        const delta = stateDelta(args, value)
        const boat = delta === undefined ? {} : { stateDelta: delta }
        if (base === undefined) return { boat }
        if (isJsonObject(base)) return { ...base, boat }
        return { presentation: base, boat }
      },
    },
  }
}

/** The delta a result's presentation meta carries, when it is a JSON object. */
function stateDeltaOf(meta: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(meta)) return undefined
  const boat = meta['boat']
  if (!isJsonObject(boat)) return undefined
  return boat['stateDelta']
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

/** Host service: boat tool metadata plus its enforcement at the dsh tool seams. */
export class ToolPolicyService extends Service {
  static inject = ['tools', 'sessionProjections', 'systemPrompt']

  private readonly layers = new ScopedLayers(scope => new PolicyLayer(scope), () => {})
  private readonly agents = new WeakMap<Agent, AgentPolicyState>()

  constructor(ctx: Context) {
    super(ctx, 'toolPolicy')
    ctx.sessionProjections.register(boatStateProjectionDefinition)
    ctx.systemPrompt.context({
      name: 'boat:state',
      order: BOAT_STATE_CONTEXT_ORDER,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        return renderBoatState(ctx.sessionProjections.stateOf(agent.session, 'boatState'))
      },
    })
    // After `next()`: listeners registered later (a `--plugin` row, a preset
    // row) activate inside the same waterfall, and the restriction they need
    // is computed once they returned.
    ctx.on('boat/pre-assemble', async (payload, next) => {
      await next()
      this.reconcile(payload.agent)
    })
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const decision = await next()
      if (decision.kind !== 'allow') return decision
      const meta = this.metaOf(exec.name, exec.agent)
      return meta?.requiresConfirmation === true
        ? { kind: 'ask', reason: `tool "${exec.name}" requires confirmation` }
        : decision
    })
    ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
      const decision = await next()
      if (decision.kind !== 'accept' || result.isError || exec.agent === undefined || exec.parent !== undefined) return decision
      const delta = stateDeltaOf(result.meta)
      if (delta === undefined) return decision
      if (!isJsonObject(delta)) {
        ctx.logger.warn(`boat tool policy: tool "${exec.name}" produced a non-object state delta; ignored`)
        return decision
      }
      exec.agent.session.append('boat/state', { callId: exec.callId, delta })
      return decision
    })
  }

  /**
   * Register a tool in the calling scope's layer together with its boat
   * metadata. A `stateDelta` is folded into the tool's presentation meta.
   * @param definition - the dsh tool definition.
   * @param meta - boat-side metadata; `visibility` defaults to `always`.
   * @returns the exact disposer that unregisters both.
   */
  register(definition: ToolDefinition, meta: BoatToolMeta = {}): () => void {
    const wrapped = meta.stateDelta === undefined ? definition : withStateDelta(definition, meta.stateDelta)
    const disposeTool = this.ctx.tools.register(wrapped)
    let disposeMeta: () => void
    try {
      disposeMeta = this.declare(definition.name, meta)
    } catch (error: unknown) {
      disposeTool()
      throw error
    }
    return () => {
      disposeMeta()
      disposeTool()
    }
  }

  /**
   * Declare metadata for a tool registered elsewhere (an official dsh tool, a
   * preset row's tool), in the calling scope's layer. Nearest scope wins.
   * @param name - the tool name as registered.
   * @param meta - boat-side metadata.
   * @returns the exact disposer that withdraws the declaration.
   */
  declare(name: string, meta: BoatToolMeta): () => void {
    return this.layers.effect(
      this.ctx,
      layer => layer.metas.insert(name, meta),
      { label: 'toolPolicy.declare()', notify: false },
    )
  }

  /**
   * The metadata one agent resolves for a tool: its own chain, nearest scope last.
   * @param name - the tool name.
   * @param agent - the viewing agent; omitted for the global view.
   */
  metaOf(name: string, agent?: Agent): BoatToolMeta | undefined {
    return this.layers.merge(agent === undefined ? undefined : scopeOf(agent.ctx), layer => layer.metas).get(name)
  }

  /**
   * Make `auto` tools visible to one agent from its next assembly on (or this
   * step's, when called inside `boat/pre-assemble`). Names must be declared.
   * @param agent - the agent whose visibility changes.
   * @param names - declared tool names.
   */
  activate(agent: Agent, names: readonly string[]): void {
    const known = this.layers.merge(scopeOf(agent.ctx), layer => layer.metas)
    const unknown = names.filter(name => !known.has(name))
    if (unknown.length > 0) {
      throw new Error(`boat tool policy: cannot activate undeclared tool${unknown.length > 1 ? 's' : ''} ${unknown.map(name => JSON.stringify(name)).join(', ')}; declared: ${[...known.keys()].sort().join(', ') || '(none)'}`)
    }
    const state = this.stateOf(agent)
    for (const name of names) state.activated.add(name)
    this.reconcile(agent)
  }

  /**
   * Withdraw every activation of one agent; its `auto` tools hide again.
   * @param agent - the agent to reset.
   */
  clear(agent: Agent): void {
    const state = this.agents.get(agent)
    if (state === undefined) return
    state.activated.clear()
    this.reconcile(agent)
  }

  /** The names one agent activated, sorted. */
  activated(agent: Agent): string[] {
    return [...this.agents.get(agent)?.activated ?? []].sort()
  }

  /** The tool names the model currently sees for one agent, in registry order. */
  visible(agent: Agent): string[] {
    return this.ctx.tools.schemas(scopeOf(agent.ctx)).map(schema => schema.name)
  }

  private stateOf(agent: Agent): AgentPolicyState {
    let state = this.agents.get(agent)
    if (state === undefined) {
      state = { activated: new Set(), deny: [], dispose: undefined }
      this.agents.set(agent, state)
    }
    return state
  }

  /**
   * Recompute one agent's restriction: every `auto` tool it inherits and has
   * not activated is denied. A declared name no row registered is skipped
   * (`restrict` rejects unknown names). Reissued only when the set changed.
   */
  private reconcile(agent: Agent): void {
    const key = scopeOf(agent.ctx)
    if (key === undefined) return
    const state = this.stateOf(agent)
    const inheritedView = scopeParentOf(key)
    const deny = [...this.layers.merge(key, layer => layer.metas)]
      .filter(([name, meta]) => meta.visibility === 'auto'
        && !state.activated.has(name)
        && this.ctx.tools.get(name, inheritedView) !== undefined)
      .map(([name]) => name)
      .sort()
    if (sameNames(deny, state.deny)) return
    state.dispose?.()
    state.dispose = deny.length === 0 ? undefined : agent.ctx.tools.restrict({ deny })
    state.deny = deny
  }
}

export default ToolPolicyService
