// compute.js — the asset_overview card's imperative escape hatch, ported from
// the reference implementation's templates_v2/asset_overview/compute.py (with the yinglong helpers it
// imported inlined: fmt_plain, fmt_money_llm, ASSET_BUCKETS, BUCKET_LABEL,
// ASSET_BUCKET_COLOR). Named exports are referenced by manifest.yaml
// `computed.fn`; `digest` is the card's LLM digest hook.

const ASSET_BUCKETS = ['日常', '稳健', '进取']
const BUCKET_LABEL = { 日常: '日常开销', 稳健: '稳健投资', 进取: '进取收益' }
const ASSET_BUCKET_COLOR = { 日常: '#FFB759', 稳健: '#4872D6', 进取: '#E51414' }
const WAN_YUAN = 10000

function toNumber(raw) {
  const value = Number(String(raw ?? '0'))
  return Number.isFinite(value) ? value : 0
}

/** `f"{value:,.2f}"` */
function fmtPlain(raw) {
  return toNumber(raw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 「182,173.94元（约18.22万元）」; below 10,000 only 「200.00元」. */
function fmtMoneyLlm(raw) {
  const value = toNumber(raw)
  const base = `${fmtPlain(value)}元`
  if (Math.abs(value) < WAN_YUAN) return base
  return `${base}（约${fmtPlain(value / WAN_YUAN)}万元）`
}

function childrenForBucket(accounts, bucket) {
  const rolled = new Map()
  for (const account of accounts) {
    if (typeof account !== 'object' || account === null || account.bucket !== bucket) continue
    const bu = String(account.bu || account.name || '账户')
    rolled.set(bu, (rolled.get(bu) ?? 0) + toNumber(account.amount))
  }
  return [...rolled].map(([name, amount]) => ({ name, amount: fmtPlain(amount) }))
}

export function assets_list(bundle, raw) {
  bundle = bundle ?? {}
  const buckets = bundle.buckets ?? {}
  const accounts = raw && typeof raw === 'object' && Array.isArray(raw.accounts) ? raw.accounts : []
  const authUrl = String(bundle.auth_link || '')
  return ASSET_BUCKETS.map((name) => {
    const b = buckets[name] ?? {}
    return {
      name: BUCKET_LABEL[name],
      percent: `${Math.round(Number(b.pct ?? 0) || 0).toFixed(0)}%`,
      amount: fmtPlain(b.amount ?? 0),
      color: ASSET_BUCKET_COLOR[name],
      authorization: Boolean(b.authorized ?? false),
      auth_url: authUrl,
      children: childrenForBucket(accounts, name),
    }
  })
}

export function insurance_unauth_hide(insuranceAuthorized) {
  return Boolean(insuranceAuthorized)
}

export function insurance_auth_hide(insuranceAuthorized) {
  return !insuranceAuthorized
}

export function auth_btn_hide(authState) {
  return String(authState) !== 'one'
}

export function diag_btn_hide(authState) {
  return !['multi', 'full'].includes(String(authState))
}

export function auth_tip_hide(authState, unauthCount) {
  return !((Number(unauthCount) || 0) > 0 && ['multi', 'full'].includes(String(authState)))
}

export function auth_tip_text(bundle) {
  const n = Number((bundle ?? {}).unauth_main_group_count) || 0
  return `还有 ${Math.max(n, 1)} 家未授权，去授权查看更全资产`
}

function missingBucketCount(bundle) {
  const buckets = (bundle ?? {}).buckets ?? {}
  const authorized = Object.values(buckets).filter(value => typeof value === 'object' && value !== null && value.authorized).length
  return Math.max(0, ASSET_BUCKETS.length - authorized)
}

export function digest(raw, _flat) {
  const bundle = (raw ?? {}).yl_assets ?? {}
  const missing = missingBucketCount(bundle)
  return `[卡片:资产/${bundle.auth_state ?? 'none'}] 总额${fmtMoneyLlm(bundle.total ?? '0')} · 保单${Number(bundle.policy_count) || 0}份 · 已授权${ASSET_BUCKETS.length - missing}/${ASSET_BUCKETS.length}桶 · 卡后一句简短收尾（≤25字），不复述卡内数字`
}
