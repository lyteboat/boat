/**
 * The preset registrar row: declares boat tool metadata from a composition
 * file, in the preset's standing scope, for tools other rows register (an
 * official dsh tool made `auto`, or one that must be confirmed). Code-only
 * metadata (`stateDelta`) belongs to `ctx.toolPolicy.register` in a plugin.
 *
 * ```yaml
 * - id: boat-tool-policy
 *   name: '@boat/tool-policy/preset'
 *   config:
 *     tools:
 *       bash: { requiresConfirmation: true }
 *       todo_write: { visibility: auto }
 * ```
 * @module @boat/tool-policy/preset
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { BoatToolMeta } from '@boat/contracts'
import type {} from './index.ts'

/** Stable Cordis plugin name. */
export const name = 'boat-tool-policy-preset'

/** The host service the declarations go to. */
export const inject = ['toolPolicy']

/** One tool's declared policy, as a composition file states it. */
export interface DeclaredToolPolicy {
  visibility?: 'always' | 'auto'
  group?: string
  requiresConfirmation?: boolean
}

/** Plugin config: tool name → policy. */
export interface Config {
  tools: Record<string, DeclaredToolPolicy>
}

export const Config: z<Config> = z.object({
  tools: z.dict(z.object({
    visibility: z.union(['always', 'auto'] as const),
    group: z.string(),
    requiresConfirmation: z.boolean(),
  })).required(),
})

/**
 * Declare every configured policy in the calling scope.
 * @param ctx - the row's context (the preset's standing scope when mounted by agent-presets).
 * @param config - validated tool policies.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [toolName, policy] of Object.entries(config.tools)) {
    const meta: BoatToolMeta = {
      ...policy.visibility === undefined ? {} : { visibility: policy.visibility },
      ...policy.group === undefined ? {} : { group: policy.group },
      ...policy.requiresConfirmation === undefined ? {} : { requiresConfirmation: policy.requiresConfirmation },
    }
    ctx.toolPolicy.declare(toolName, meta)
  }
}
