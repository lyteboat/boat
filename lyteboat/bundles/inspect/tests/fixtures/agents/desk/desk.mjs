// The desk agent's own skills and tools, as a real agent's code mounts them in
// its standing scope: `desk_clock` always reaches the model, `lookup_quote`
// only once the quote-lookup skill (which requires it) is active.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'desk'
export const inject = ['skills', 'toolPolicy']

const TEXT = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

export async function apply(ctx) {
  await ctx.plugin(skillFilesystem, { providerName: 'desk', includeDefaultRoots: false, customSkillDirs: [join(dirname(fileURLToPath(import.meta.url)), 'skills')], watch: false })
  ctx.toolPolicy.register(defineTool({
    name: 'desk_clock',
    description: '报当前时间。',
    parameters: {},
    output: TEXT,
    execute: async () => '09:30',
  }), { visibility: 'always' })
  ctx.toolPolicy.register(defineTool({
    name: 'lookup_quote',
    description: '按代码查报价。',
    parameters: { code: { type: 'string', required: true, description: '代码' } },
    output: TEXT,
    execute: async args => `${args.code}: 1.00`,
  }), { visibility: 'auto' })
}
