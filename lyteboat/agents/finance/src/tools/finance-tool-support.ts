/**
 * What the four finance tools share: their dependencies, their output shape
 * (status, digest, prepared cards, the state keys they change), how a card is
 * prepared through the a2ui service, and the unauthorized answer every data
 * tool falls back to when the agent can see no account at all.
 * @module @lyteboat/agent-finance/tools/finance-tool-support
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { A2uiService } from '@lyteboat/a2ui'
import type { JsonValue, LyteboatResultCard } from '@lyteboat/contracts'
import type { CustomerProfile, FinanceCustomer, FinanceCustomerSource } from '../data/finance-customer.ts'
import type { KnowledgeEntry } from '../capabilities/investor-knowledge.ts'
import { centsOfSpoken, amountOf } from '../capabilities/money-text.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'
import { EMPTY_FINANCE_STATE, type FinanceState, type FinanceStateDelta } from '../state/finance-state.ts'

/** Everything a finance tool reads from outside the capability layer. */
export interface FinanceToolDeps {
  customers: FinanceCustomerSource
  /** The customer the calling session serves: its request context names it. */
  customerId: (agent: Agent) => string
  /** Absolute path of the agent's a2ui templates root. */
  templates: string
  knowledge: readonly KnowledgeEntry[]
  a2ui: A2uiService
  projections: SessionProjectionRegistry
}

/** The value every finance tool returns. */
export type FinanceToolValue = { status: string; digest: string; cards: LyteboatResultCard[]; state?: FinanceStateDelta }

/** The output schema and presentation every finance tool shares. */
export const FINANCE_TOOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', required: true },
      digest: { type: 'string', required: true },
      cards: { type: 'array', required: true, items: { type: 'json' } },
      state: { type: 'json' },
    },
  },
  render: (_args: unknown, value: { digest: string }) => [{ type: 'text' as const, text: value.digest }],
  presentationMeta: (_args: unknown, value: { cards: JsonValue[]; state?: JsonValue }): JsonValue => financeResultMeta(value.cards, value.state),
} as const

/**
 * The result's presentation meta: its cards where a2ui reads them
 * (`lyteboat.cards`), the state delta under `finance`.
 * @param cards - the prepared cards, in answer order.
 * @param state - the state keys this result changes.
 */
export function financeResultMeta(cards: readonly JsonValue[], state: JsonValue | undefined): JsonValue {
  return {
    ...cards.length === 0 ? {} : { lyteboat: { cards: [...cards] } },
    ...state === undefined ? {} : { finance: { state } },
  }
}

/**
 * The calling agent; a finance tool reads the session it runs in.
 * @param exec - the tool's run context.
 * @param tool - the tool name, for the error.
 */
export function callingAgent(exec: ToolRunContext, tool: string): Agent {
  if (exec.agent === undefined) throw new Error(`${tool} needs a calling agent: the finance state lives on its session`)
  return exec.agent
}

/** The session's finance state, empty before any finance tool ran. */
export function financeStateOf(deps: FinanceToolDeps, agent: Agent): FinanceState {
  return deps.projections.stateOf(agent.session, 'financeState') ?? EMPTY_FINANCE_STATE
}

/** The profile with the monthly spending the user corrected in this session. */
export function profileWithFacts(customer: FinanceCustomer, state: FinanceState): CustomerProfile {
  return state.facts.monthlyExpense === null ? customer.profile : { ...customer.profile, monthlyExpense: state.facts.monthlyExpense }
}

/** A spoken monthly-spending amount as a statement amount; undefined when it is not one. */
export function statementAmountOf(spoken: string): string | undefined {
  const cents = centsOfSpoken(spoken)
  return cents === undefined || cents <= 0 ? undefined : amountOf(cents)
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
 * @param state - state keys to keep from this call (facts the user gave on the way).
 */
export async function unauthorizedResult(deps: FinanceToolDeps, agent: Agent, exec: ToolRunContext, tool: string, customer: FinanceCustomer, state?: FinanceStateDelta): Promise<FinanceToolValue> {
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
    ...state === undefined ? {} : { state },
  }
}
