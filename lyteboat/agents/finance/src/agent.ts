/**
 * The finance agent's row: the one place its world is composed. It mounts the
 * agent's skills directory, registers the session-state projection, pins
 * temperature 0 on the agent's model requests (tool choice favors a stable
 * decision over varied wording), ages earlier turns' digests when a turn
 * starts, and registers the four tools over one customer source, knowledge
 * base, and templates root.
 * @module @lyteboat/agent-finance/agent
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@lyteboat/a2ui'
import type {} from '@lyteboat/contracts'
import { FixtureCustomerSource } from './data/finance-customer.ts'
import { loadKnowledge } from './capabilities/investor-knowledge.ts'
import { ageFinanceDigests } from './digest/digest-aging.ts'
import { financeStateProjectionDefinition } from './state/finance-state.ts'
import { registerFinanceTools } from './tools/finance-tools.ts'

export const name = 'finance-agent'
export const inject = ['tools', 'toolPolicy', 'a2ui', 'skills', 'sessionProjections']

/** The agent directory (this file is lib/agent.js or, under test, src/agent.ts). */
const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The customer a run serves until requests carry their own context. */
export function financeCustomerId(): string {
  return process.env['LYTEBOAT_FINANCE_CUSTOMER'] ?? 'young-idle-cash'
}

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(skillFilesystem, { providerName: 'finance', includeDefaultRoots: false, customSkillDirs: [join(AGENT_DIR, 'skills')], watch: false })
  ctx.sessionProjections.register(financeStateProjectionDefinition)
  ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0 }))
  // Before `next()`: the turn's first assembly already sees the earlier digests aged.
  ctx.on('lyteboat/pre-assemble', async (payload, next) => {
    if (payload.step === 1) ageFinanceDigests(payload.agent.session, payload.turn)
    return next()
  })
  registerFinanceTools(ctx, {
    customers: new FixtureCustomerSource(join(AGENT_DIR, 'fixtures', 'customers')),
    customerId: financeCustomerId,
    templates: join(AGENT_DIR, 'a2ui'),
    knowledge: loadKnowledge(join(AGENT_DIR, 'fixtures', 'knowledge.json')),
    a2ui: ctx.a2ui,
    projections: ctx.sessionProjections,
  })
}
