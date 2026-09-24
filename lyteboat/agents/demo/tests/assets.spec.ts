import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { authState, buildAssetsBundle, diagnose, loadPersona } from '@lyteboat/agent-demo/assets'

const PERSONAS = fileURLToPath(new URL('../fixtures/personas', import.meta.url))

describe('buildAssetsBundle', () => {
  it('folds the healthy persona into a fully authorized bundle with bucket shares', () => {
    const { assets_view, assets_raw } = buildAssetsBundle(loadPersona(PERSONAS, 'healthy'))
    expect(assets_view).toMatchObject({
      total: '300000.00', total_display: '300,000.00', policy_count: 4, auth_state: 'full', is_authorized: true,
      insurance_authorized: true, unauth_main_group_count: 0, auth_link: 'https://example.test/auth',
    })
    const buckets = assets_view['buckets'] as Record<string, { pct: number; amount: string; authorized: boolean }>
    expect(buckets['日常']).toEqual({ amount: '45000.00', amount_display: '¥45,000.00', pct: 15, authorized: true })
    expect(buckets['稳健']!.pct).toBe(58)
    expect(buckets['进取']!.pct).toBe(27)
    expect(assets_raw.accounts).toHaveLength(3)
  })

  it('leaves unauthorized areas out of the totals and counts the missing main groups', () => {
    const { assets_view, assets_raw } = buildAssetsBundle(loadPersona(PERSONAS, 'partial'))
    expect(assets_view).toMatchObject({ total: '42000.00', auth_state: 'multi', insurance_authorized: false, unauth_main_group_count: 2, policy_count: 0 })
    const buckets = assets_view['buckets'] as Record<string, { pct: number; authorized: boolean }>
    expect(buckets['进取']).toMatchObject({ pct: 0, authorized: false })
    expect(assets_raw.accounts.map(account => account.name)).toEqual(['活期', '理财'])
  })

  it('maps the authorized bucket count to the auth state', () => {
    expect([0, 1, 2, 3].map(authState)).toEqual(['none', 'one', 'multi', 'full'])
  })
})

describe('diagnose', () => {
  it('judges each bucket against its band and marks unauthorized buckets', () => {
    const healthy = diagnose(buildAssetsBundle(loadPersona(PERSONAS, 'healthy')).assets_view)
    expect(healthy.map(verdict => verdict.judge)).toEqual(['ok', 'ok', 'ok'])
    const partial = diagnose(buildAssetsBundle(loadPersona(PERSONAS, 'partial')).assets_view)
    expect(partial.map(verdict => [verdict.bucket, verdict.judge])).toEqual([['日常', 'over'], ['稳健', 'over'], ['进取', 'unauthorized']])
  })
})
