/**
 * The customer's holdings summed: the total, the part at market risk and the
 * steady part, each with its share. No holdings means nothing is authorized.
 * @module @lyteboat/agent-finance/capabilities/finance-holdings
 */

import type { FinanceCustomer } from '../data/finance-customer.ts'
import { centsOf, shareOf } from './money-text.ts'

export interface FinanceHoldings {
  /** Whether the agent can see any holding. */
  authorized: boolean
  totalCents: number
  steadyCents: number
  riskyCents: number
  steadyPct: number
  riskyPct: number
}

/** Sum a customer's holdings. */
export function summarizeHoldings(customer: FinanceCustomer): FinanceHoldings {
  let steadyCents = 0
  let riskyCents = 0
  for (const holding of customer.holdings) {
    if (holding.risky) riskyCents += centsOf(holding.amount)
    else steadyCents += centsOf(holding.amount)
  }
  const totalCents = steadyCents + riskyCents
  return {
    authorized: customer.holdings.length > 0,
    totalCents,
    steadyCents,
    riskyCents,
    steadyPct: shareOf(steadyCents, totalCents),
    riskyPct: shareOf(riskyCents, totalCents),
  }
}
