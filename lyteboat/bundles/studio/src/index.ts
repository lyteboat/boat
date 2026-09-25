/**
 * @lyteboat/studio — dsh web with lyteboat's pages. The bundle patch rides
 * over dsh-base, @lyteboat/host, and dsh-web-app: its startup row takes
 * `--agents` beside dsh web's flags, the agent catalog declares every agent
 * of those directories and reloads them when they change, the Studio pages
 * (`@lyteboat/studio-pages`) join dsh web's own, and dsh's coding presets are
 * turned off. This row reports the agents once the catalog has declared them;
 * an agent that fails is reported, and the rest are served.
 * @module @lyteboat/studio
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@lyteboat/agent-catalog'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-studio'

/** The row this one reports on. */
export const inject = ['agentCatalog']

/**
 * Report the agents once the catalog has declared them.
 * @param ctx - plugin context carrying the catalog.
 */
export function apply(ctx: Context): void {
  void (async () => {
    await ctx.get('loader')?.await()
    try {
      await ctx.agentCatalog.whenReady()
    } catch (error: unknown) {
      // Not strict: only a root-level fault (two roots holding one id) rejects, and the page reports it too.
      process.stderr.write(`lyteboat studio: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    const agents = ctx.agentCatalog.list().map(agent => agent.id)
    process.stdout.write(`lyteboat studio: agents ${agents.join(', ') || 'none'}\n`)
    for (const failure of ctx.agentCatalog.failures()) process.stderr.write(`lyteboat studio: agent ${failure.id} failed: ${failure.reason}\n`)
  })()
}
