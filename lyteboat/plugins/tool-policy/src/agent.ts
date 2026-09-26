/**
 * The agent row: declares lyteboat tool metadata from an agent's composition
 * file, in the agent's standing scope (dsh-agent-preset-registry mounts it), for
 * tools other rows register (an official dsh tool made `auto`), and whether the
 * inherited tools it does not declare reach the model (`inherited`; absent:
 * `visible`). Code-only metadata (`stateDelta`) belongs to
 * `ctx.toolPolicy.register` in a plugin.
 *
 * ```yaml
 * - id: lyteboat-tool-policy
 *   name: '@lyteboat/tool-policy/agent'
 *   config:
 *     inherited: hidden
 *     tools:
 *       skill: { visibility: always }
 * ```
 * @module @lyteboat/tool-policy/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LyteboatInheritedToolVisibility } from '@lyteboat/contracts'
import type { LyteboatToolPolicy } from './index.ts'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-tool-policy-agent'

/** The host service the declarations go to. */
export const inject = ['toolPolicy']

/** Plugin config: tool name → policy, and whether the inherited tools it does not name reach the model. */
export interface Config {
  /** Absent: `visible`, as such tools are without a declaration. `hidden` hides them for good. */
  inherited?: LyteboatInheritedToolVisibility
  tools: Record<string, LyteboatToolPolicy>
}

export const Config: z<Config> = z.object({
  inherited: z.union(['visible', 'hidden'] as const),
  tools: z.dict(z.object({
    visibility: z.union(['always', 'auto'] as const),
  })).required(),
})

const CONFIG_KEYS = new Set(['inherited', 'tools'])
const POLICY_KEYS = new Set(['visibility'])

/**
 * Declare every configured policy in the calling scope.
 * @param ctx - the row's context (the agent's standing scope when dsh-agent-preset-registry mounts it).
 * @param config - validated tool policies.
 * @throws on a key the row or a policy does not have: schemastery passes unknown keys through, and a misspelt or retired one must not silently declare nothing.
 */
export function apply(ctx: Context, config: Config): void {
  const unknownRowKeys = Object.keys(config).filter(key => !CONFIG_KEYS.has(key))
  if (unknownRowKeys.length > 0) {
    throw new Error(`lyteboat tool policy agent row: unknown key${unknownRowKeys.length > 1 ? 's' : ''} ${unknownRowKeys.map(key => JSON.stringify(key)).join(', ')}; allowed: ${[...CONFIG_KEYS].join(', ')}`)
  }
  if (config.inherited !== undefined) ctx.toolPolicy.declareInherited(config.inherited)
  for (const [toolName, policy] of Object.entries(config.tools)) {
    const unknown = Object.keys(policy).filter(key => !POLICY_KEYS.has(key))
    if (unknown.length > 0) {
      throw new Error(`lyteboat tool policy agent row: tool "${toolName}" has unknown key${unknown.length > 1 ? 's' : ''} ${unknown.map(key => JSON.stringify(key)).join(', ')}; allowed: ${[...POLICY_KEYS].join(', ')}`)
    }
    ctx.toolPolicy.declare(toolName, policy)
  }
}
