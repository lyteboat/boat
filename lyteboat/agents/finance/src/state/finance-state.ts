/**
 * The finance agent's session state: facts the user added (investment horizon,
 * corrected monthly spending, assets outside the authorized accounts), the
 * follow-up questions already asked, and how many diagnoses the session has
 * run. A finance tool returns the keys it changes on its result's presentation
 * meta (`meta.finance.state`); the `financeState` projection folds them from the
 * session log with replace semantics per key, so the state survives a reopen and
 * never reaches the model, which sees only the digest.
 * @module @lyteboat/agent-finance/state/finance-state
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@lyteboat/contracts'
import { FINANCE_BUCKETS } from '../data/finance-customer.ts'
import { INVESTMENT_HORIZONS } from '../capabilities/allocation-targets.ts'

const financeStateSchema = z.object({
  facts: z.object({
    investmentHorizon: z.enum(INVESTMENT_HORIZONS).nullable(),
    monthlyExpense: z.string().regex(/^\d+\.\d{2}$/u).nullable(),
    externalAssets: z.array(z.object({
      source: z.string(),
      amount: z.string().regex(/^\d+\.\d{2}$/u),
      bucket: z.enum(FINANCE_BUCKETS),
    }).strict()),
  }).strict(),
  asked: z.array(z.string()),
  diagnosisSeq: z.number().int().min(0),
}).strict()

export type FinanceState = z.infer<typeof financeStateSchema>
export type FinanceStateDelta = Partial<FinanceState>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The finance agent's session state; host only, folded from `tool/result.meta.finance.state`. */
    financeState: FinanceState
  }
}

export const EMPTY_FINANCE_STATE: FinanceState = {
  facts: { investmentHorizon: null, monthlyExpense: null, externalAssets: [] },
  asked: [],
  diagnosisSeq: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The state keys a result's presentation meta carries, when it carries any. */
export function financeStateDeltaOf(meta: JsonValue | undefined): unknown {
  if (!isRecord(meta) || !isRecord(meta['finance'])) return undefined
  return meta['finance']['state']
}

export const financeStateProjectionDefinition = {
  key: 'financeState',
  stateSchema: financeStateSchema,
  init: (): FinanceState => EMPTY_FINANCE_STATE,
  apply(state: FinanceState, event) {
    // A replace node (a pruner or compaction rewriting the surface) copies the
    // original result's meta; folding it again would roll newer keys back.
    if (event.type !== 'tool/result' || event.surfaceOp !== 'append' || event.data.message.isError === true) return state
    const delta = financeStateDeltaOf(event.data.meta)
    if (delta === undefined) return state
    const parsed = financeStateSchema.partial().safeParse(delta)
    if (!parsed.success) throw new Error(`finance: tool result at session seq ${String(event.seq)} carries a malformed state delta`)
    return {
      facts: parsed.data.facts ?? state.facts,
      asked: parsed.data.asked ?? state.asked,
      diagnosisSeq: parsed.data.diagnosisSeq ?? state.diagnosisSeq,
    }
  },
  stateVersion: 1,
} satisfies Omit<ProjectionDefinition<'financeState', FinanceState>, 'wire'>
