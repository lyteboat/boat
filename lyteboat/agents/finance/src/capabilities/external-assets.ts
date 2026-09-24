/**
 * Assets a customer reports outside the authorized accounts (「我在别的银行还有
 * 20 万定期」): each lands in a bucket by the kind of product the user names, and
 * later reports about the same source replace or remove the earlier one.
 * @module @lyteboat/agent-finance/capabilities/external-assets
 */

import type { FinanceBucket } from '../data/finance-customer.ts'
import { amountOf, centsOfSpoken } from './money-text.ts'

/** One reported asset, as the session keeps it. */
export interface ExternalAsset {
  /** What the user called it (「别的银行的定期」); the key later reports match on. */
  source: string
  /** A statement amount in yuan. */
  amount: string
  bucket: FinanceBucket
}

/** One report as the model extracts it from the user's words. */
export interface ExternalAssetReport {
  source: string
  /** As the user said it: `200000`, `20万`, `8,000.50`. */
  amount?: string
  /** The user withdrew this source. */
  remove?: boolean
}

// Checked in order: money-market funds are cash, bond funds are steady, other funds grow.
const BUCKET_KEYWORDS: readonly (readonly [FinanceBucket, RegExp])[] = [
  ['daily', /活期|货币基金|货基|余额|零钱|现金|随取/u],
  ['steady', /定期|存款|存单|国债|债|理财|固收|保本|年金/u],
  ['growth', /股票|股|基金|指数|ETF|权益|期权|黄金/iu],
]

/**
 * The bucket a reported asset belongs to, by the product the user named;
 * anything unrecognized counts as steady, the bucket that misjudges least.
 * @param source - the user's description.
 */
export function bucketOfExternalSource(source: string): FinanceBucket {
  for (const [bucket, pattern] of BUCKET_KEYWORDS) if (pattern.test(source)) return bucket
  return 'steady'
}

/**
 * Fold new reports into the session's list: a report replaces the entry with the
 * same source, `remove` deletes it, and a report without a usable amount is ignored.
 * @param existing - the list so far.
 * @param reports - this call's reports, in the order the user gave them.
 * @returns the new list, in first-report order.
 */
export function mergeExternalAssets(existing: readonly ExternalAsset[], reports: readonly ExternalAssetReport[]): ExternalAsset[] {
  const bySource = new Map(existing.map(asset => [asset.source, asset] as const))
  for (const report of reports) {
    const source = report.source.trim()
    if (source === '') continue
    if (report.remove === true) {
      bySource.delete(source)
      continue
    }
    const cents = report.amount === undefined ? undefined : centsOfSpoken(report.amount)
    if (cents === undefined || cents <= 0) continue
    bySource.set(source, { source, amount: amountOf(cents), bucket: bucketOfExternalSource(source) })
  }
  return [...bySource.values()]
}
