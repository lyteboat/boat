/**
 * The finance agent's data contract: what a customer source hands the capability
 * layer. A customer holds accounts at institutions, each institution authorized
 * (its accounts visible to the agent) or not; every account sits in one of the
 * three buckets. Amounts are decimal strings in yuan with two fraction digits,
 * as a statement prints them.
 * @module @lyteboat/agent-finance/data/finance-customer
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** The three buckets (「三笔钱」): money to spend, money to keep, money to grow. */
export const FINANCE_BUCKETS = ['daily', 'steady', 'growth'] as const
export type FinanceBucket = (typeof FINANCE_BUCKETS)[number]

export const FINANCE_BUCKET_LABEL: Readonly<Record<FinanceBucket, string>> = {
  daily: '日常开销',
  steady: '稳健投资',
  growth: '进取收益',
}

/** Investor risk tiers as suitability rules publish them, most cautious first. */
export const RISK_TIERS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const
export type RiskTier = (typeof RISK_TIERS)[number]

/** The three basic covers a household plan starts from. */
export const INSURANCE_KINDS = ['criticalIllness', 'medical', 'accident'] as const
export type InsuranceKind = (typeof INSURANCE_KINDS)[number]

export const INSURANCE_LABEL: Readonly<Record<InsuranceKind, string>> = {
  criticalIllness: '重疾险',
  medical: '医疗险',
  accident: '意外险',
}

export const COVERAGE_STATUSES = ['covered', 'gap', 'unknown'] as const
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number]

const amountSchema = z.string().regex(/^\d+\.\d{2}$/u, 'an amount is a decimal string with two fraction digits')

const financeAccountSchema = z.object({
  bucket: z.enum(FINANCE_BUCKETS),
  name: z.string().min(1),
  amount: amountSchema,
}).strict()

const financeInstitutionSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['bank', 'securities', 'fund', 'insurance']),
  authorized: z.boolean(),
  accounts: z.array(financeAccountSchema),
  policyCount: z.number().int().min(0).optional(),
}).strict()

const customerProfileSchema = z.object({
  age: z.number().int().min(18).max(100),
  riskTier: z.enum(RISK_TIERS),
  monthlyExpense: amountSchema,
  hasChild: z.boolean(),
}).strict()

const financeCustomerSchema = z.object({
  id: z.string().min(1),
  note: z.string(),
  profile: customerProfileSchema,
  institutions: z.array(financeInstitutionSchema),
  coverage: z.object({
    criticalIllness: z.enum(COVERAGE_STATUSES),
    medical: z.enum(COVERAGE_STATUSES),
    accident: z.enum(COVERAGE_STATUSES),
  }).strict(),
  links: z.object({ authorize: z.string().url() }).strict(),
}).strict()

export type FinanceAccount = z.infer<typeof financeAccountSchema>
export type FinanceInstitution = z.infer<typeof financeInstitutionSchema>
export type CustomerProfile = z.infer<typeof customerProfileSchema>
export type FinanceCustomer = z.infer<typeof financeCustomerSchema>

/** Where the agent reads a customer from; a deployment replaces the fixture source with its own. */
export interface FinanceCustomerSource {
  /**
   * One customer's snapshot.
   * @param id - the customer id.
   * @throws when the customer is unknown or its record is malformed.
   */
  customer(id: string): FinanceCustomer
}

/** Customers as JSON files, one per id, validated when read. */
export class FixtureCustomerSource implements FinanceCustomerSource {
  constructor(private readonly dir: string) {}

  customer(id: string): FinanceCustomer {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new Error(`finance: customer id ${JSON.stringify(id)} is not a fixture name`)
    const path = join(this.dir, `${id}.json`)
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error: unknown) {
      throw new Error(`finance: cannot read customer ${JSON.stringify(id)} from ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    const parsed = financeCustomerSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`finance: customer file ${path} is malformed: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
    if (parsed.data.id !== id) throw new Error(`finance: customer file ${path} holds id ${JSON.stringify(parsed.data.id)}`)
    return parsed.data
  }
}
