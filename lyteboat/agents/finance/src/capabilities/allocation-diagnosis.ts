/**
 * The allocation diagnosis, by one public rule of thumb: the share at market
 * risk should be about 100 minus the customer's age, in percent, give or take
 * ten points. Below the band the allocation is cautious, above it aggressive.
 * @module @lyteboat/agent-finance/capabilities/allocation-diagnosis
 */

import type { FinanceHoldings } from './finance-holdings.ts'

/** How far the risky share may stray from its target before the verdict changes, in points. */
export const TARGET_BAND = 10

export type AllocationVerdict = 'cautious' | 'balanced' | 'aggressive'

export const VERDICT_TEXT: Readonly<Record<AllocationVerdict, string>> = {
  cautious: '偏保守',
  balanced: '比较合适',
  aggressive: '偏激进',
}

export interface AllocationDiagnosis {
  verdict: AllocationVerdict
  riskyPct: number
  /** The rule's target and band for this age, in percent. */
  targetPct: number
  lowPct: number
  highPct: number
  /** The direction to move, one sentence. */
  direction: string
}

/**
 * Diagnose the holdings for a customer of this age.
 * @param holdings - the summed holdings; an unauthorized summary is not diagnosed.
 * @param age - the customer's age.
 */
export function diagnoseAllocation(holdings: FinanceHoldings, age: number): AllocationDiagnosis {
  const targetPct = Math.min(100, Math.max(0, 100 - age))
  const lowPct = Math.max(0, targetPct - TARGET_BAND)
  const highPct = Math.min(100, targetPct + TARGET_BAND)
  const verdict: AllocationVerdict = holdings.riskyPct < lowPct ? 'cautious' : holdings.riskyPct > highPct ? 'aggressive' : 'balanced'
  const direction = verdict === 'cautious'
    ? `可以把一部分稳健资产逐步转到风险资产，让风险资产占比靠近 ${String(targetPct)}%。`
    : verdict === 'aggressive'
      ? `可以把一部分风险资产逐步转到稳健资产，让风险资产占比回到 ${String(highPct)}% 以内。`
      : '保持现在的比例，每年检查一次，偏离较多时再平衡。'
  return { verdict, riskyPct: holdings.riskyPct, targetPct, lowPct, highPct, direction }
}
