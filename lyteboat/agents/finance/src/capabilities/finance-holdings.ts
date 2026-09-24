/**
 * What the agent can see of a customer's money: the authorized institutions'
 * accounts summed per bucket, plus the assets the user reported in this
 * session. A bucket counts as authorized when an authorized institution holds
 * an account in it; reported assets add to the amounts, never to authorization.
 * @module @lyteboat/agent-finance/capabilities/finance-holdings
 */

import { FINANCE_BUCKETS, type FinanceBucket, type FinanceCustomer } from '../data/finance-customer.ts'
import type { ExternalAsset } from './external-assets.ts'
import { centsOf, shareOf } from './money-text.ts'

/** How many buckets the authorized accounts reach. */
export type FinanceAuthState = 'none' | 'one' | 'multi' | 'full'

export interface HoldingAccount {
  institution: string
  name: string
  cents: number
  /** Reported by the user in this session rather than read from an authorized account. */
  reported: boolean
}

export interface BucketHolding {
  bucket: FinanceBucket
  cents: number
  /** Share of the visible total, in percent, one decimal. */
  pct: number
  authorized: boolean
  accounts: HoldingAccount[]
}

export interface FinanceHoldings {
  totalCents: number
  /** The part of the total the user reported. */
  reportedCents: number
  buckets: Record<FinanceBucket, BucketHolding>
  authorizedBuckets: FinanceBucket[]
  authState: FinanceAuthState
  /** Institutions whose accounts the agent cannot see yet, by name. */
  unauthorizedInstitutions: string[]
  /** Policies held at authorized insurers. */
  policyCount: number
}

function authStateOf(authorized: number): FinanceAuthState {
  if (authorized === 0) return 'none'
  if (authorized === 1) return 'one'
  return authorized === FINANCE_BUCKETS.length ? 'full' : 'multi'
}

/**
 * Sum a customer's visible holdings.
 * @param customer - the customer snapshot.
 * @param reported - assets the user reported in this session.
 */
export function summarizeHoldings(customer: FinanceCustomer, reported: readonly ExternalAsset[] = []): FinanceHoldings {
  const accounts: Record<FinanceBucket, HoldingAccount[]> = { daily: [], steady: [], growth: [] }
  const authorized = new Set<FinanceBucket>()
  let policyCount = 0
  for (const institution of customer.institutions) {
    if (!institution.authorized) continue
    policyCount += institution.policyCount ?? 0
    for (const account of institution.accounts) {
      authorized.add(account.bucket)
      accounts[account.bucket].push({ institution: institution.name, name: account.name, cents: centsOf(account.amount), reported: false })
    }
  }
  for (const asset of reported) {
    accounts[asset.bucket].push({ institution: '其他机构（您告知）', name: asset.source, cents: centsOf(asset.amount), reported: true })
  }
  const bucketCents = (bucket: FinanceBucket): number => accounts[bucket].reduce((sum, account) => sum + account.cents, 0)
  const totalCents = FINANCE_BUCKETS.reduce((sum, bucket) => sum + bucketCents(bucket), 0)
  const buckets = Object.fromEntries(FINANCE_BUCKETS.map(bucket => [bucket, {
    bucket,
    cents: bucketCents(bucket),
    pct: shareOf(bucketCents(bucket), totalCents),
    authorized: authorized.has(bucket),
    accounts: accounts[bucket],
  }])) as Record<FinanceBucket, BucketHolding>
  const authorizedBuckets = FINANCE_BUCKETS.filter(bucket => authorized.has(bucket))
  return {
    totalCents,
    reportedCents: reported.reduce((sum, asset) => sum + centsOf(asset.amount), 0),
    buckets,
    authorizedBuckets,
    authState: authStateOf(authorizedBuckets.length),
    unauthorizedInstitutions: customer.institutions.filter(institution => !institution.authorized).map(institution => institution.name),
    policyCount,
  }
}
