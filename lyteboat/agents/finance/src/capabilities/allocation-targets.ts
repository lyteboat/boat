/**
 * Target shares for the three buckets from public rules of thumb, simplified on
 * purpose: an emergency fund of 3 months of spending (6 with a child or from age
 * 50) sets the daily share; "100 minus age" sets the growth share, capped by the
 * investor's risk tier and by how long the money can stay invested; the rest is
 * steady. Each target has a ±5-point band. The numbers illustrate the method;
 * they are no one's investment advice.
 * @module @lyteboat/agent-finance/capabilities/allocation-targets
 */

import type { CustomerProfile, FinanceBucket, RiskTier } from '../data/finance-customer.ts'
import { centsOf } from './money-text.ts'

/** How long the money can stay invested, as the user answers it. */
export const INVESTMENT_HORIZONS = ['1年以内', '1-3年', '3-5年', '5年以上'] as const
export type InvestmentHorizon = (typeof INVESTMENT_HORIZONS)[number]

/** The most growth each risk tier takes on, in percent. */
export const GROWTH_CAP_BY_TIER: Readonly<Record<RiskTier, number>> = { C1: 10, C2: 30, C3: 50, C4: 70, C5: 80 }

/** Money needed within a short horizon should not ride the stock market. */
export const GROWTH_CAP_BY_HORIZON: Readonly<Record<InvestmentHorizon, number>> = { '1年以内': 10, '1-3年': 30, '3-5年': 60, '5年以上': 100 }

/** The daily share stays between these, whatever the spending. */
export const DAILY_SHARE_RANGE = { min: 5, max: 30 } as const

/** Half-width of every band, in percentage points. */
export const TARGET_BAND = 5

export interface AllocationTarget {
  bucket: FinanceBucket
  /** Target share in percent, a whole number. */
  target: number
  low: number
  high: number
}

/** Months of spending the emergency fund should cover. */
export function emergencyMonths(profile: CustomerProfile): 3 | 6 {
  return profile.hasChild || profile.age >= 50 ? 6 : 3
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function band(bucket: FinanceBucket, target: number): AllocationTarget {
  return { bucket, target, low: Math.max(0, target - TARGET_BAND), high: Math.min(100, target + TARGET_BAND) }
}

/**
 * The three targets for one customer.
 * @param profile - age, tier, monthly spending, child.
 * @param totalCents - the visible total; zero puts the whole daily range at its minimum.
 * @param horizon - the user's answer, when given.
 */
export function allocationTargets(profile: CustomerProfile, totalCents: number, horizon?: InvestmentHorizon): Record<FinanceBucket, AllocationTarget> {
  const reserve = emergencyMonths(profile) * centsOf(profile.monthlyExpense)
  const dailyRaw = totalCents === 0 ? DAILY_SHARE_RANGE.min : Math.round((reserve / totalCents) * 100)
  const daily = clamp(dailyRaw, DAILY_SHARE_RANGE.min, DAILY_SHARE_RANGE.max)
  const growthCap = Math.min(GROWTH_CAP_BY_TIER[profile.riskTier], horizon === undefined ? 100 : GROWTH_CAP_BY_HORIZON[horizon])
  const growth = clamp(Math.min(100 - profile.age, growthCap), 0, 100 - daily)
  return {
    daily: band('daily', daily),
    steady: band('steady', 100 - daily - growth),
    growth: band('growth', growth),
  }
}
