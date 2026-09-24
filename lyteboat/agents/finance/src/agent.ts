/**
 * The finance agent's row: the one place its world is composed. It mounts the
 * agent's skills directory, registers the session-state projection, pins
 * temperature 0 on the agent's model requests (tool choice favors a stable
 * decision over varied wording), ages earlier turns' digests when a turn
 * starts, registers its admission, and registers the four tools over one
 * customer source, knowledge base, and templates root. The customer is the one
 * the session's request context names (`customer`).
 * @module @lyteboat/agent-finance/agent
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@lyteboat/a2ui'
import type {} from '@lyteboat/aux-llm'
import type {} from '@lyteboat/contracts'
import type {} from '@lyteboat/intake-guard'
import type {} from '@lyteboat/request-context'
import { FixtureCustomerSource } from './data/finance-customer.ts'
import { loadKnowledge } from './capabilities/investor-knowledge.ts'
import { ageFinanceDigests } from './digest/digest-aging.ts'
import { customerOfContext, financeAdmission } from './intake/finance-admission.ts'
import { financeStateProjectionDefinition } from './state/finance-state.ts'
import { registerFinanceTools } from './tools/finance-tools.ts'

export const name = 'finance-agent'
export const inject = ['tools', 'toolPolicy', 'a2ui', 'skills', 'sessionProjections', 'requestContext', 'intakeGuard', 'auxLlm']

/** The agent directory (this file is lib/agent.js or, under test, src/agent.ts). */
const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function apply(ctx: Context): Promise<void> {
  const customers = new FixtureCustomerSource(join(AGENT_DIR, 'fixtures', 'customers'))
  const templates = join(AGENT_DIR, 'a2ui')
  const customerId = (agent: Agent): string => {
    const customer = customerOfContext(ctx.requestContext.contextOf(agent))
    if (customer === undefined) throw new Error('finance: the request context names no customer (context.customer)')
    return customer
  }
  await ctx.plugin(skillFilesystem, { providerName: 'finance', includeDefaultRoots: false, customSkillDirs: [join(AGENT_DIR, 'skills')], watch: false })
  ctx.sessionProjections.register(financeStateProjectionDefinition)
  ctx.on('agent/request', async (_payload, next) => ({ ...await next(), temperature: 0 }))
  // Before `next()`: the turn's first assembly already sees the earlier digests aged.
  ctx.on('lyteboat/pre-assemble', async (payload, next) => {
    if (payload.step === 1) ageFinanceDigests(payload.agent.session, payload.turn)
    return next()
  })
  ctx.intakeGuard.register(financeAdmission({ customers, auxLlm: ctx.auxLlm, a2ui: ctx.a2ui, templates }))
  registerFinanceTools(ctx, {
    customers,
    customerId,
    templates,
    knowledge: loadKnowledge(join(AGENT_DIR, 'fixtures', 'knowledge.json')),
    a2ui: ctx.a2ui,
    projections: ctx.sessionProjections,
  })
}
