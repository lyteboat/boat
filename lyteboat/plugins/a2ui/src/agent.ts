/**
 * The agent row: composes a `render_a2ui` tool over the agent's own
 * templates directory, in the agent's standing scope (mounted by
 * dsh-agent-preset-registry). A relative `templates` path resolves against the
 * composition file's directory.
 *
 * ```yaml
 * - id: lyteboat-a2ui
 *   name: '@lyteboat/a2ui/agent'
 *   config:
 *     templates: ./a2ui
 *     stateKeys: [assets_view, assets_raw]
 *     terminalCards: [unauthorized]
 * ```
 * @module @lyteboat/a2ui/agent
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { RenderToolOptions } from './index.ts'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-a2ui-agent'

/** The host service the tool is composed through. */
export const inject = ['a2ui']

/**
 * Plugin config: the render tool's options, with a relative `templates` path.
 * `components` is restated only because schemastery validates into mutable
 * arrays, where the catalog type is read-only.
 */
export type Config = Omit<RenderToolOptions, 'components'> & {
  components?: { types: string[]; bindingFields: Record<string, string[]> }
}

export const Config: z<Config> = z.object({
  templates: z.string().required(),
  stateKeys: z.array(z.string()),
  terminalCards: z.array(z.string()),
  cardDescriptions: z.dict(z.string()),
  name: z.string(),
  visibility: z.union(['always', 'auto'] as const),
  validation: z.union(['warn', 'enforce'] as const),
  components: z.object({
    types: z.array(z.string()).required(),
    bindingFields: z.dict(z.array(z.string())).default({}),
  }),
})

/** The composition directory the loader stamps on a row's context, when it did. */
function compositionDir(ctx: Context): string | undefined {
  const { baseUrl } = ctx
  return typeof baseUrl === 'string' && baseUrl.startsWith('file:') ? fileURLToPath(baseUrl) : undefined
}

/**
 * Compose the tool from the row's config.
 * @param ctx - the row's context (the agent's standing scope when dsh-agent-preset-registry mounts it).
 * @param config - validated options.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const templates = resolve(compositionDir(ctx) ?? process.cwd(), config.templates)
  await ctx.a2ui.registerRenderTool({ ...config, templates })
}
