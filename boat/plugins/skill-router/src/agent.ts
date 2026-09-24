/**
 * The agent row: declares the skill router's settings for one agent (its
 * standing scope, mounted by dsh-agent-preset-registry), overriding the host row's
 * defaults for every session of that agent. An agent that wants dynamic routing turns it on
 * here; the host default is `off`.
 *
 * ```yaml
 * - id: boat-skill-router
 *   name: '@boat/skill-router/agent'
 *   config:
 *     mode: dynamic
 *     historyWindow: 6
 *     timeoutMs: 10000
 * ```
 * @module @boat/skill-router/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SkillRouterSettings } from './index.ts'
import type {} from './index.ts'

/** Stable Cordis plugin name. */
export const name = 'boat-skill-router-agent'

/** The host service the declaration goes to. */
export const inject = ['skillRouter']

/** Plugin config: every setting optional; absent ones keep the host defaults. */
export type Config = Partial<SkillRouterSettings>

export const Config: z<Config> = z.object({
  mode: z.union(['off', 'full', 'dynamic'] as const),
  historyWindow: z.natural(),
  timeoutMs: z.natural(),
  provider: z.string(),
  model: z.string(),
})

/**
 * Declare the configured settings in the calling scope.
 * @param ctx - the row's context (the agent's standing scope when dsh-agent-preset-registry mounts it).
 * @param config - validated partial settings.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.skillRouter.declare(config)
}
