/**
 * The agent row: declares lyteboat tool metadata from an agent's composition
 * file, in the agent's standing scope (dsh-agent-preset-registry mounts it), for
 * tools other rows register (an official dsh tool made `auto`, or one that
 * must be confirmed). Code-only metadata (`stateDelta`) belongs to
 * `ctx.toolPolicy.register` in a plugin.
 *
 * ```yaml
 * - id: lyteboat-tool-policy
 *   name: '@lyteboat/tool-policy/agent'
 *   config:
 *     tools:
 *       bash: { requiresConfirmation: true }
 *       todo_write: { visibility: auto }
 * ```
 * @module @lyteboat/tool-policy/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LyteboatToolPolicy } from './index.ts'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-tool-policy-agent'

/** The host service the declarations go to. */
export const inject = ['toolPolicy']

/** Plugin config: tool name → policy. */
export interface Config {
  tools: Record<string, LyteboatToolPolicy>
}

export const Config: z<Config> = z.object({
  tools: z.dict(z.object({
    visibility: z.union(['always', 'auto'] as const),
    requiresConfirmation: z.boolean(),
  })).required(),
})

const POLICY_KEYS = new Set(['visibility', 'requiresConfirmation'])

/**
 * Declare every configured policy in the calling scope.
 * @param ctx - the row's context (the agent's standing scope when dsh-agent-preset-registry mounts it).
 * @param config - validated tool policies.
 * @throws on a key no policy has: schemastery passes unknown keys through, and a misspelt one must not silently declare nothing.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [toolName, policy] of Object.entries(config.tools)) {
    const unknown = Object.keys(policy).filter(key => !POLICY_KEYS.has(key))
    if (unknown.length > 0) {
      throw new Error(`lyteboat tool policy agent row: tool "${toolName}" has unknown key${unknown.length > 1 ? 's' : ''} ${unknown.map(key => JSON.stringify(key)).join(', ')}; allowed: ${[...POLICY_KEYS].join(', ')}`)
    }
    ctx.toolPolicy.declare(toolName, policy)
  }
}
