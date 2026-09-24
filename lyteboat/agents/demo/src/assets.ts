/**
 * The demo's asset bundle: a persona fixture (accounts with a bucket, an
 * authorization area and an amount) folded into the `yl_assets` /
 * `yl_assets_raw` shape the asset_overview card binds, a simplified port of
 * yinglong's query_assets.build_assets_bundle.
 * @module @lyteboat/agent-demo/assets
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonValue } from '@lyteboat/contracts'

export const ASSET_BUCKETS = ['日常', '稳健', '进取'] as const
export type AssetBucket = (typeof ASSET_BUCKETS)[number]

/** Main account groups; a bucket's coverage is one thing, an unauthorized group is another. */
const MAIN_GROUPS: Record<string, string[]> = { securities: ['A07', 'A17'], bank: ['A15'], insurance: ['A01'] }

export interface PersonaAccount {
  bucket: AssetBucket
  area: string
  bu: string
  name: string
  amount: string
}

export interface Persona {
  name: string
  policyCount: number
  authorizedAreas: string[]
  links: { authLink: string; assetsSubPageLink: string }
  accounts: PersonaAccount[]
}

export interface AssetsBundle {
  yl_assets: Record<string, JsonValue>
  yl_assets_raw: { accounts: { bucket: string; bu: string; name: string; amount: string }[] }
}

/** `f"{value:,.2f}"` */
export function fmtPlain(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toNumber(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

/** none / one / multi / full by how many buckets are authorized. */
export function authState(authorizedBuckets: number): 'none' | 'one' | 'multi' | 'full' {
  if (authorizedBuckets <= 0) return 'none'
  if (authorizedBuckets === 1) return 'one'
  return authorizedBuckets >= ASSET_BUCKETS.length ? 'full' : 'multi'
}

/** Read a persona fixture by name from a personas directory. */
export function loadPersona(dir: string, name: string): Persona {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Persona
}

/**
 * Fold a persona into the card's data namespace.
 * @param persona - the fixture.
 * @param isAigc - the channel flag the card's summary label switches on.
 */
export function buildAssetsBundle(persona: Persona, isAigc = true): AssetsBundle {
  const authorized = new Set(persona.authorizedAreas)
  const amounts: Record<AssetBucket, number> = { 日常: 0, 稳健: 0, 进取: 0 }
  const covered: Record<AssetBucket, boolean> = { 日常: false, 稳健: false, 进取: false }
  for (const account of persona.accounts) {
    if (!authorized.has(account.area)) continue
    amounts[account.bucket] += toNumber(account.amount)
    covered[account.bucket] = true
  }
  const total = ASSET_BUCKETS.reduce((sum, bucket) => sum + amounts[bucket], 0)
  const buckets = Object.fromEntries(ASSET_BUCKETS.map(bucket => [bucket, {
    amount: amounts[bucket].toFixed(2),
    amount_display: `¥${fmtPlain(amounts[bucket])}`,
    pct: total === 0 ? 0 : Math.round((amounts[bucket] / total) * 1000) / 10,
    authorized: covered[bucket],
  }]))
  const authorizedBuckets = ASSET_BUCKETS.filter(bucket => covered[bucket]).length
  const unauthorizedGroups = Object.values(MAIN_GROUPS).filter(areas => !areas.some(area => authorized.has(area))).length
  return {
    yl_assets: {
      total: total.toFixed(2),
      total_display: fmtPlain(total),
      buckets,
      policy_count: persona.policyCount,
      auth_state: authState(authorizedBuckets),
      is_authorized: authorizedBuckets > 0,
      is_aigc: isAigc,
      insurance_authorized: authorized.has('A01'),
      unauth_main_group_count: unauthorizedGroups,
      auth_link: persona.links.authLink,
      assets_sub_page_link: persona.links.assetsSubPageLink,
    },
    yl_assets_raw: {
      accounts: persona.accounts
        .filter(account => authorized.has(account.area))
        .map(({ bucket, bu, name, amount }) => ({ bucket, bu, name, amount })),
    },
  }
}

/** Target bands (percent of total) the diagnosis judges each bucket against. */
export const BUCKET_TARGETS: Record<AssetBucket, { low: number; high: number }> = {
  日常: { low: 9, high: 21 },
  稳健: { low: 48, high: 68 },
  进取: { low: 19, high: 35 },
}

export interface BucketVerdict {
  bucket: AssetBucket
  pct: number
  band: [number, number]
  judge: 'ok' | 'over' | 'under' | 'unauthorized'
}

/** Judge each bucket's share against its band. */
export function diagnose(assets: Record<string, JsonValue>): BucketVerdict[] {
  const buckets = assets['buckets']
  return ASSET_BUCKETS.map((bucket) => {
    const entry = typeof buckets === 'object' && buckets !== null && !Array.isArray(buckets) ? buckets[bucket] : undefined
    const record = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry : {}
    const pct = typeof record['pct'] === 'number' ? record['pct'] : 0
    const band = BUCKET_TARGETS[bucket]
    const judge: BucketVerdict['judge'] = record['authorized'] !== true
      ? 'unauthorized'
      : pct > band.high ? 'over' : pct < band.low ? 'under' : 'ok'
    return { bucket, pct, band: [band.low, band.high], judge }
  })
}
