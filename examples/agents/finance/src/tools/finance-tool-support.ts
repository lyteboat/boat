/**
 * What the finance tools share: their dependencies, their output shape
 * (status, digest, prepared cards), how a card is prepared through the a2ui
 * service, and the unauthorized answer the data tools fall back to when the
 * agent can see no holding at all.
 * @module @lyteboat/agent-finance/tools/finance-tool-support
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { A2uiService } from '@lyteboat/a2ui'
import type { JsonValue, LyteboatResultCard } from '@lyteboat/contracts'
import type { FinanceCustomer, FinanceCustomerSource } from '../data/finance-customer.ts'
import type { KnowledgeEntry } from '../capabilities/investor-knowledge.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'

/** Everything a finance tool reads from outside the capability layer. */
export interface FinanceToolDeps {
  customers: FinanceCustomerSource
  /** The customer the calling session serves: its request context names it. */
  customerId: (agent: Agent) => string
  /** Absolute path of the agent's a2ui templates root. */
  templates: string
  knowledge: readonly KnowledgeEntry[]
  a2ui: A2uiService
}

/** The value every finance tool returns. */
export type FinanceToolValue = { status: string; digest: string; cards: LyteboatResultCard[] }

/** The output schema and presentation every finance tool shares: the digest for the model, the cards where a2ui reads them. */
export const FINANCE_TOOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', required: true },
      digest: { type: 'string', required: true },
      cards: { type: 'array', required: true, items: { type: 'json' } },
    },
  },
  render: (_args: unknown, value: { digest: string }) => [{ type: 'text' as const, text: value.digest }],
  presentationMeta: (_args: unknown, value: { cards: JsonValue[] }): JsonValue => value.cards.length === 0 ? {} : { lyteboat: { cards: [...value.cards] } },
} as const

/**
 * The calling agent; a finance tool reads the customer its session serves.
 * @param exec - the tool's run context.
 * @param tool - the tool name, for the error.
 */
export function callingAgent(exec: ToolRunContext, tool: string): Agent {
  if (exec.agent === undefined) throw new Error(`${tool} needs a calling agent: its request context names the customer`)
  return exec.agent
}

/**
 * Render one card from the agent's templates.
 * @param deps - the card renderer and the templates root.
 * @param agent - the calling agent (its session names the surface).
 * @param area - the card, which is also its marker name.
 * @param raw - the card's raw data namespace.
 */
export async function prepareCard(deps: Pick<FinanceToolDeps, 'a2ui' | 'templates'>, agent: Agent, area: string, raw: Record<string, unknown>): Promise<LyteboatResultCard> {
  const rendered = await deps.a2ui.render(deps.templates, area, raw, { sessionId: agent.session.id })
  // The engine's payload is JSON built from the template file and the raw data, typed loosely at its boundary.
  return { area, surfaceId: String(rendered.payload['surfaceId'] ?? ''), emission: rendered.emission, payload: rendered.payload as unknown as JsonValue }
}

/**
 * Nothing authorized: the unauthorized card, which concludes the turn.
 * @param deps - the tool dependencies.
 * @param agent - the calling agent.
 * @param exec - the tool's run context, whose turn the card concludes.
 * @param tool - the tool answering.
 * @param customer - the customer, for the authorization link.
 */
export async function unauthorizedResult(deps: FinanceToolDeps, agent: Agent, exec: ToolRunContext, tool: string, customer: FinanceCustomer): Promise<FinanceToolValue> {
  const card = await prepareCard(deps, agent, 'unauthorized', { access: { authorize_link: customer.links.authorize } })
  exec.concludeTurn()
  return {
    status: 'unauthorized',
    digest: composeFinanceDigest({
      tool,
      status: 'unauthorized',
      areas: ['unauthorized'],
      facts: ['还没有获取到任何已授权的资产。'],
      guidance: [`卡片（${cardMarker('unauthorized')}）已经提示用户去授权，本轮到此结束，不再输出正文。`],
      leads: [],
    }),
    cards: [card],
  }
}
