// The ledger agent's standing scope, as its rows would build it: skills from
// its skills/ directory, one tool always visible and one a skill activates,
// the inherited tools hidden, and routed skills.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'ledger'
export const inject = ['skills', 'skillRouter', 'toolPolicy']

const tool = toolName => defineTool({
  name: toolName,
  description: `${toolName} tool`,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async () => toolName,
})

export async function apply(ctx) {
  await ctx.plugin(skillFilesystem, { providerName: 'ledger', includeDefaultRoots: false, customSkillDirs: [join(dirname(fileURLToPath(import.meta.url)), 'skills')], watch: false })
  ctx.toolPolicy.declareInherited('hidden')
  ctx.toolPolicy.register(tool('ledger_clock'), { visibility: 'always' })
  ctx.toolPolicy.register(tool('ledger_balance'), { visibility: 'auto' })
  ctx.skillRouter.declare({ mode: 'dynamic' })
}
