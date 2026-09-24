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

/** A user-typed amount (`8000`, `8,000`, `8000.5`, `2万`, `0.5万元`) in cents; undefined when it is not one. */
export function centsOfSpoken(text: string): number | undefined {
  const normalized = text.replace(/[,，\s]/gu, '').replace(/元$/u, '')
  const wan = /^(\d+(?:\.\d+)?)万$/u.exec(normalized)
  if (wan !== null) return Math.round(Number(wan[1]) * CENTS_PER_WAN)
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return undefined
  return Math.round(Number(normalized) * 100)
}

/** `54,400.00` */
export function yuanPlain(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.floor(absolute / 100).toLocaleString('en-US')
  return `${sign}${whole}.${String(absolute % 100).padStart(2, '0')}`
}

/** A statement amount back from cents: `54400.00`. */
export function amountOf(cents: number): string {
  return `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`
}

/** `54,400.00 元（约 5.44 万元）`, the ten-thousand gloss only from ten thousand up. */
export function moneyForModel(cents: number): string {
  const yuan = `${yuanPlain(cents)} 元`
  if (Math.abs(cents) < CENTS_PER_WAN) return yuan
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
