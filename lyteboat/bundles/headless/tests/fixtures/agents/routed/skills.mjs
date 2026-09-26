// The agent's own skills: a business composition lends an agent no skill root,
// so the agent mounts its skills/ directory in its standing scope, as a real
// agent's code does.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'

export const name = 'routed-skills'
export const inject = ['skills']

export async function apply(ctx) {
  const skills = join(dirname(fileURLToPath(import.meta.url)), 'skills')
  await ctx.plugin(skillFilesystem, { providerName: 'routed', includeDefaultRoots: false, customSkillDirs: [skills], watch: false })
}
