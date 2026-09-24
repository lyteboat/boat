/**
 * The allocation diagnosis: each visible bucket's share judged against its band,
 * the two largest deviations ranked as the problems to talk about, and a card
 * state that decides what the agent can say at all (nothing authorized, one
 * bucket only, too little money to allocate, a partial or a full picture).
 * @module @lyteboat/agent-finance/capabilities/allocation-diagnosis
 */

import { FINANCE_BUCKETS, FINANCE_BUCKET_LABEL, type CustomerProfile, type FinanceBucket } from '../data/finance-customer.ts'
import { allocationTargets, emergencyMonths, type InvestmentHorizon } from './allocation-targets.ts'
import type { FinanceHoldings } from './finance-holdings.ts'
import { centsOf } from './money-text.ts'

/**
 * - `zero`: nothing authorized; `single`: one bucket, too little to compare;
 * - `runway`: the visible total is under three months of spending, so the
 *   emergency fund comes before any allocation;
 * - `thin`: two buckets, diagnosed with a caveat; `rich`: all three, with a
 *   deviation; `healthy`: all three, every share inside its band.
 */
export type DiagnosisCardState = 'zero' | 'single' | 'runway' | 'thin' | 'rich' | 'healthy'

export type BucketJudge = 'under' | 'ok' | 'over' | 'unknown'

export const BUCKET_JUDGE_TEXT: Readonly<Record<BucketJudge, string>> = { under: '偏低', ok: '在区间内', over: '偏高', unknown: '未授权，无法判断' }

export interface BucketDiagnosis {
  bucket: FinanceBucket
  label: string
  cents: number
  pct: number
  target: number
  low: number
  high: number
  judge: BucketJudge
}

export interface AllocationProblem {
  bucket: FinanceBucket
  judge: 'under' | 'over'
  /** Distance from the target, in percentage points. */
  gap: number
}

export interface AllocationDiagnosis {
  cardState: DiagnosisCardState
  totalCents: number
  /** Months of spending the emergency fund should cover (3 or 6). */
  emergencyMonths: number
  /** Months of spending the daily bucket covers today, one decimal. */
  monthsCovered: number
  horizon: InvestmentHorizon | undefined
  buckets: BucketDiagnosis[]
  /** At most two, largest gap first. */
  problems: AllocationProblem[]
}

/** Below this many months of spending in total, allocation waits for the emergency fund. */
const RUNWAY_MONTHS = 3

function judgeOf(pct: number, low: number, high: number): BucketJudge {
  if (pct < low) return 'under'
  if (pct > high) return 'over'
  return 'ok'
}

function cardStateOf(holdings: FinanceHoldings, expenseCents: number, judges: readonly BucketJudge[]): DiagnosisCardState {
  const authorized = holdings.authorizedBuckets.length
  if (authorized === 0) return 'zero'
  if (authorized === 1) return 'single'
  if (holdings.totalCents < RUNWAY_MONTHS * expenseCents) return 'runway'
  if (authorized < FINANCE_BUCKETS.length) return 'thin'
  return judges.every(judge => judge === 'ok') ? 'healthy' : 'rich'
}

/**
 * Diagnose one customer's allocation.
 * @param holdings - the visible holdings, reported assets included.
 * @param profile - the customer profile, with any spending the user corrected.
 * @param horizon - the user's investment horizon, when given.
 */
export function diagnoseAllocation(holdings: FinanceHoldings, profile: CustomerProfile, horizon?: InvestmentHorizon): AllocationDiagnosis {
  const targets = allocationTargets(profile, holdings.totalCents, horizon)
  const buckets: BucketDiagnosis[] = FINANCE_BUCKETS.map((bucket) => {
    const holding = holdings.buckets[bucket]
    const target = targets[bucket]
    return {
      bucket,
      label: FINANCE_BUCKET_LABEL[bucket],
      cents: holding.cents,
      pct: holding.pct,
      target: target.target,
      low: target.low,
      high: target.high,
      judge: holding.authorized || holding.cents > 0 ? judgeOf(holding.pct, target.low, target.high) : 'unknown',
    }
  })
  const expenseCents = centsOf(profile.monthlyExpense)
  const cardState = cardStateOf(holdings, expenseCents, buckets.map(bucket => bucket.judge))
  const problems = cardState === 'rich' || cardState === 'thin'
    ? buckets
      .filter((bucket): bucket is BucketDiagnosis & { judge: 'under' | 'over' } => bucket.judge === 'under' || bucket.judge === 'over')
      .map(bucket => ({ bucket: bucket.bucket, judge: bucket.judge, gap: Math.round(Math.abs(bucket.pct - bucket.target) * 10) / 10 }))
      .sort((left, right) => right.gap - left.gap)
      .slice(0, 2)
    : []
  return {
    cardState,
    totalCents: holdings.totalCents,
    emergencyMonths: emergencyMonths(profile),
    monthsCovered: expenseCents === 0 ? 0 : Math.round((holdings.buckets.daily.cents / expenseCents) * 10) / 10,
    horizon,
    buckets,
    problems,
  }
}
