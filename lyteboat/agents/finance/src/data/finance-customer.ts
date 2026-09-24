/**
 * The finance agent's data contract: what a customer source hands the capability
 * layer. A customer has an age and the holdings the agent can see; an empty
 * list means nothing is authorized yet. Each holding is either at market risk
 * (stocks, equity funds) or not (deposits, money funds, bonds). Amounts are
 * decimal strings in yuan with two fraction digits, as a statement prints them.
 * @module @lyteboat/agent-finance/data/finance-customer
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const amountSchema = z.string().regex(/^\d+\.\d{2}$/u, 'an amount is a decimal string with two fraction digits')

const financeHoldingSchema = z.object({
  institution: z.string().min(1),
  name: z.string().min(1),
  amount: amountSchema,
  /** Whether the holding moves with the market. */
  risky: z.boolean(),
}).strict()

const financeCustomerSchema = z.object({
  id: z.string().min(1),
  note: z.string(),
  age: z.number().int().min(18).max(100),
  holdings: z.array(financeHoldingSchema),
  links: z.object({ authorize: z.string().url() }).strict(),
}).strict()

export type FinanceHolding = z.infer<typeof financeHoldingSchema>
export type FinanceCustomer = z.infer<typeof financeCustomerSchema>

/** Where the agent reads a customer from; a deployment replaces the fixture source with its own. */
export interface FinanceCustomerSource {
  /**
   * One customer's snapshot.
   * @param id - the customer id.
   * @throws when the customer is unknown or its record is malformed.
   */
  customer(id: string): FinanceCustomer
  /**
   * One customer's snapshot, when the source knows the id.
   * @param id - the customer id.
   * @throws when the record exists but is malformed.
   */
  findCustomer(id: string): FinanceCustomer | undefined
}

/** A fixture file name: a customer id is one, so it can never reach outside the fixture directory. */
const FIXTURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Customers as JSON files, one per id, validated when read. */
export class FixtureCustomerSource implements FinanceCustomerSource {
  constructor(private readonly dir: string) {}

  customer(id: string): FinanceCustomer {
    if (!FIXTURE_ID.test(id)) throw new Error(`finance: customer id ${JSON.stringify(id)} is not a fixture name`)
    const customer = this.findCustomer(id)
    if (customer === undefined) throw new Error(`finance: cannot read customer ${JSON.stringify(id)} from ${join(this.dir, `${id}.json`)}: no such file`)
    return customer
  }

  findCustomer(id: string): FinanceCustomer | undefined {
    if (!FIXTURE_ID.test(id)) return undefined
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return undefined
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
