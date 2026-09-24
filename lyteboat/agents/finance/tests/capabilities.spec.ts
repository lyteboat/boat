/**
 * The finance capability layer on the customer fixtures: money wording,
 * reported assets, holdings, targets from the rules of thumb, the diagnosis
 * card states, follow-up questions, coverage, and the knowledge base. The
 * expected numbers are worked out by hand from the rules in the module docs.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FixtureCustomerSource, allocationTargets, bucketOfExternalSource, centsOf, centsOfSpoken, coverageLine, diagnoseAllocation,
  loadKnowledge, lookupKnowledge, mergeExternalAssets, moneyForModel, nextFollowUp, summarizeHoldings, yuanPlain,
} from '@lyteboat/agent-finance/capabilities'

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))
const customers = new FixtureCustomerSource(join(FIXTURES, 'customers'))
const diagnose = (id: string) => {
  const customer = customers.customer(id)
  return diagnoseAllocation(summarizeHoldings(customer), customer.profile)
}

describe('money wording', () => {
  it('parses statement amounts and spoken amounts into cents', () => {
    expect(centsOf('54400.00')).toBe(5_440_000)
    expect(() => centsOf('54400')).toThrow(/two fraction digits/u)
    expect(centsOfSpoken('20万')).toBe(20_000_000)
    expect(centsOfSpoken('8,000.5 元')).toBe(800_050)
    expect(centsOfSpoken('很多')).toBeUndefined()
  })

  it('glosses ten thousand and up in 万 so the model never converts units', () => {
    expect(yuanPlain(5_440_000)).toBe('54,400.00')
    expect(moneyForModel(5_440_000)).toBe('54,400.00 元（约 5.44 万元）')
    expect(moneyForModel(350_000)).toBe('3,500.00 元')
  })
})

describe('reported assets', () => {
  it('lands each report in a bucket by the product the user named', () => {
    expect(bucketOfExternalSource('别的银行的活期')).toBe('daily')
    expect(bucketOfExternalSource('余额宝里的货币基金')).toBe('daily')
    expect(bucketOfExternalSource('债券基金')).toBe('steady')
    expect(bucketOfExternalSource('三年定期')).toBe('steady')
    expect(bucketOfExternalSource('指数基金')).toBe('growth')
    expect(bucketOfExternalSource('一笔说不清的钱')).toBe('steady')
  })

  it('replaces a report about the same source, removes a withdrawn one, and ignores one without an amount', () => {
    const first = mergeExternalAssets([], [{ source: '别的银行的定期', amount: '20万' }, { source: '股票', amount: '5万' }])
    expect(first).toEqual([
      { source: '别的银行的定期', amount: '200000.00', bucket: 'steady' },
      { source: '股票', amount: '50000.00', bucket: 'growth' },
    ])
    const corrected = mergeExternalAssets(first, [{ source: '别的银行的定期', amount: '300000' }, { source: '一笔钱' }])
    expect(corrected.map(asset => [asset.source, asset.amount])).toEqual([['别的银行的定期', '300000.00'], ['股票', '50000.00']])
    expect(mergeExternalAssets(corrected, [{ source: '股票', remove: true }]).map(asset => asset.source)).toEqual(['别的银行的定期'])
  })
})

describe('holdings', () => {
  it('sums the authorized accounts per bucket and names the institutions still unauthorized', () => {
    const holdings = summarizeHoldings(customers.customer('young-idle-cash'))
    expect(holdings.totalCents).toBe(8_000_000)
    expect(holdings.authState).toBe('full')
    expect([holdings.buckets.daily.pct, holdings.buckets.steady.pct, holdings.buckets.growth.pct]).toEqual([68, 0, 32])
    expect(holdings.unauthorizedInstitutions).toEqual(['示例保险'])
    // The insurer's policy is behind its missing authorization.
    expect(holdings.policyCount).toBe(0)
  })

  it('adds reported assets to the amounts without authorizing their bucket', () => {
    const holdings = summarizeHoldings(customers.customer('two-buckets'), [{ source: '股票', amount: '70000.00', bucket: 'growth' }])
    expect(holdings.totalCents).toBe(20_000_000)
    expect(holdings.reportedCents).toBe(7_000_000)
    expect(holdings.buckets.growth.authorized).toBe(false)
    expect(holdings.authorizedBuckets).toEqual(['daily', 'steady'])
  })
})

describe('allocation targets', () => {
  it('derives the daily share from the emergency fund and caps growth by age and risk tier', () => {
    const customer = customers.customer('young-idle-cash')
    // 3 months × 6,000 over 80,000 is 22.5% → 23; growth is min(100 − 28, C4's 70); steady takes the rest.
    expect(allocationTargets(customer.profile, 8_000_000)).toEqual({
      daily: { bucket: 'daily', target: 23, low: 18, high: 28 },
      steady: { bucket: 'steady', target: 7, low: 2, high: 12 },
      growth: { bucket: 'growth', target: 70, low: 65, high: 75 },
    })
  })

  it('caps growth further when the money is needed within a short horizon', () => {
    const customer = customers.customer('young-idle-cash')
    expect(allocationTargets(customer.profile, 8_000_000, '1-3年').growth.target).toBe(30)
    expect(allocationTargets(customer.profile, 8_000_000, '5年以上').growth.target).toBe(70)
  })

  it('keeps the daily share inside 5–30% whatever the spending', () => {
    const customer = customers.customer('midlife-moderate')
    // 6 months (a child) × 12,000 over 200,000 is 36%, capped at 30.
    expect(allocationTargets(customer.profile, 20_000_000).daily.target).toBe(30)
    expect(allocationTargets(customers.customer('pre-retiree-risky').profile, 235_000_000).daily.target).toBe(5)
  })
})

describe('diagnosis', () => {
  it('ranks the two largest deviations when all three buckets are visible', () => {
    const diagnosis = diagnose('young-idle-cash')
    expect(diagnosis.cardState).toBe('rich')
    expect(diagnosis.buckets.map(bucket => bucket.judge)).toEqual(['over', 'under', 'under'])
    expect(diagnosis.problems).toEqual([{ bucket: 'daily', judge: 'over', gap: 45 }, { bucket: 'growth', judge: 'under', gap: 38 }])
    expect(diagnosis.monthsCovered).toBe(9.1)
  })

  it('assigns each fixture customer its card state', () => {
    expect(Object.fromEntries(['midlife-moderate', 'pre-retiree-risky', 'starter-all-cash', 'healthy', 'none-authorized', 'one-bucket', 'two-buckets', 'low-assets']
      .map(id => [id, diagnose(id).cardState]))).toEqual({
      'midlife-moderate': 'rich',
      'pre-retiree-risky': 'rich',
      'starter-all-cash': 'rich',
      healthy: 'healthy',
      'none-authorized': 'zero',
      'one-bucket': 'single',
      'two-buckets': 'thin',
      'low-assets': 'runway',
    })
  })

  it('leaves an unauthorized bucket unjudged in a two-bucket diagnosis', () => {
    const diagnosis = diagnose('two-buckets')
    expect(diagnosis.buckets.map(bucket => [bucket.bucket, bucket.judge])).toEqual([['daily', 'ok'], ['steady', 'over'], ['growth', 'unknown']])
    expect(diagnosis.problems).toEqual([{ bucket: 'steady', judge: 'over', gap: 47.9 }])
  })

  it('reports no problems when every share is inside its band', () => {
    const diagnosis = diagnose('healthy')
    expect(diagnosis.buckets.every(bucket => bucket.judge === 'ok')).toBe(true)
    expect(diagnosis.problems).toEqual([])
  })
})

describe('follow-ups, coverage, knowledge', () => {
  it('asks for the investment horizon once, and not when it is known', () => {
    expect(nextFollowUp(undefined, [])?.field).toBe('investmentHorizon')
    expect(nextFollowUp(undefined, ['investmentHorizon'])).toBeUndefined()
    expect(nextFollowUp('3-5年', [])).toBeUndefined()
  })

  it('words the basic cover a customer holds and lacks', () => {
    expect(coverageLine(customers.customer('young-idle-cash').coverage)).toBe('医疗险已配置；重疾险、意外险暂未配置')
    expect(coverageLine(customers.customer('pre-retiree-risky').coverage)).toBe('重疾险、医疗险已配置；意外险情况未知')
  })

  it('finds a concept by its name or an alias, and falls back with the topics it has', () => {
    const knowledge = loadKnowledge(join(FIXTURES, 'knowledge.json'))
    const found = lookupKnowledge(knowledge, '什么是再平衡')
    expect(found.status === 'ok' && found.entry.topic).toBe('再平衡')
    const alias = lookupKnowledge(knowledge, 'C5 是什么意思')
    expect(alias.status === 'ok' && alias.entry.topic).toBe('风险等级')
    const missing = lookupKnowledge(knowledge, '区块链')
    expect(missing.status).toBe('fallback')
    expect(missing.status === 'fallback' && missing.topics).toContain('复利')
  })

  it('refuses a customer id that is not a fixture name', () => {
    expect(() => customers.customer('../secrets')).toThrow(/not a fixture name/u)
    expect(() => customers.customer('nobody')).toThrow(/cannot read customer "nobody"/u)
  })
})
