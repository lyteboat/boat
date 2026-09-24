/**
 * Money arithmetic in integer cents and the wording the model quotes verbatim.
 * Amounts enter as statement strings (`"54400.00"`) and leave as text the digest
 * carries (`"54,400.00 元（约 5.44 万元）"`), so the model never converts units.
 * @module @lyteboat/agent-finance/capabilities/money-text
 */

const CENTS_PER_WAN = 1_000_000

/**
 * Parse a statement amount into cents.
 * @param amount - a decimal string with two fraction digits.
 * @throws when the string is not such an amount.
 */
export function centsOf(amount: string): number {
  const match = /^(\d+)\.(\d{2})$/u.exec(amount)
  if (match === null) throw new Error(`finance: amount ${JSON.stringify(amount)} is not a decimal string with two fraction digits`)
  return Number(match[1]) * 100 + Number(match[2])
}

/** `54,400.00` */
export function yuanPlain(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString('en-US')
  return `${whole}.${String(cents % 100).padStart(2, '0')}`
}

/** `54,400.00 元（约 5.44 万元）`, the ten-thousand gloss only from ten thousand up. */
export function moneyForModel(cents: number): string {
  const yuan = `${yuanPlain(cents)} 元`
  if (cents < CENTS_PER_WAN) return yuan
  return `${yuan}（约 ${(cents / CENTS_PER_WAN).toFixed(2)} 万元）`
}

/** A share in percent with one decimal: `68.0%`. */
export function pctText(pct: number): string {
  return `${pct.toFixed(1)}%`
}

/**
 * A part's share of a total, in percent, rounded to one decimal.
 * @param part - cents.
 * @param total - cents; zero gives zero.
 */
export function shareOf(part: number, total: number): number {
  if (total === 0) return 0
  return Math.round((part / total) * 1000) / 10
}
