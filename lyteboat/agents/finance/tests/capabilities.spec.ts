/**
 * The finance capability layer on the customer fixtures: money wording, the
 * holdings summed, the 100-minus-age diagnosis at each verdict and at the band's
 * edge, the knowledge base, and the customer source's refusals. The expected
 * numbers are worked out by hand from the fixtures.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FixtureCustomerSource, centsOf, diagnoseAllocation, loadKnowledge, lookupKnowledge, moneyForModel, summarizeHoldings } from '@lyteboat/agent-finance/capabilities'

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))
const customers = new FixtureCustomerSource(join(FIXTURES, 'customers'))
const diagnose = (id: string) => {
  const customer = customers.customer(id)
  return diagnoseAllocation(summarizeHoldings(customer), customer.age)
}

describe('money wording', () => {
  it('parses statement amounts and adds the ten-thousand gloss from ten thousand up', () => {
    expect(centsOf('54400.00')).toBe(5_440_000)
    expect(moneyForModel(5_440_000)).toBe('54,400.00 元（约 5.44 万元）')
    expect(moneyForModel(999_999)).toBe('9,999.99 元')
    expect(() => centsOf('54400')).toThrow(/two fraction digits/u)
  })
})

describe('summarizeHoldings', () => {
  it('sums the steady part and the part at market risk', () => {
    expect(summarizeHoldings(customers.customer('young-idle-cash'))).toEqual({
      authorized: true, totalCents: 8_000_000, steadyCents: 5_440_000, riskyCents: 2_560_000, steadyPct: 68, riskyPct: 32,
    })
  })

  it('reads a customer without holdings as nothing authorized', () => {
    expect(summarizeHoldings(customers.customer('none-authorized'))).toMatchObject({ authorized: false, totalCents: 0, riskyPct: 0 })
  })
})

describe('diagnoseAllocation', () => {
  it('holds the risky share against 100 minus age, ten points either way', () => {
    expect(diagnose('young-idle-cash')).toMatchObject({ verdict: 'cautious', riskyPct: 32, targetPct: 72, lowPct: 62, highPct: 82 })
    expect(diagnose('pre-retiree-risky')).toMatchObject({ verdict: 'aggressive', riskyPct: 85, targetPct: 42, highPct: 52 })
    expect(diagnose('pre-retiree-risky').direction).toContain('回到 52% 以内')
  })

  it('counts a share on the band\'s edge as inside it', () => {
    expect(diagnose('midlife-moderate')).toMatchObject({ verdict: 'balanced', riskyPct: 45, lowPct: 45 })
  })
})

describe('knowledge base', () => {
  const knowledge = loadKnowledge(join(FIXTURES, 'knowledge.json'))

  it('finds a topic by name or alias and falls back to the list of topics', () => {
    expect(lookupKnowledge(knowledge, '什么是再平衡')).toMatchObject({ status: 'ok', entry: { topic: '再平衡' } })
    expect(lookupKnowledge(knowledge, '鸡蛋放在一个篮子里')).toMatchObject({ status: 'ok', entry: { topic: '分散投资' } })
    expect(lookupKnowledge(knowledge, '区块链')).toEqual({ status: 'fallback', topics: ['资产配置', '再平衡', '分散投资'] })
  })
})

describe('FixtureCustomerSource', () => {
  it('refuses an id that is not a fixture name and a customer it does not have; findCustomer returns nothing for both', () => {
    expect(() => customers.customer('../secrets')).toThrow(/not a fixture name/u)
    expect(() => customers.customer('nobody')).toThrow(/cannot read customer "nobody"/u)
    expect(customers.findCustomer('../secrets')).toBeUndefined()
    expect(customers.findCustomer('nobody')).toBeUndefined()
  })
})
