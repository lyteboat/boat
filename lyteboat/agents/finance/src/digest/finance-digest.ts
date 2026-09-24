/**
 * The text a finance tool hands the model. A one-line header the skill texts
 * refer to (`[tool:<name> status=<status> ... areas=<cards>]`), then labelled
 * sections: 【事实】 the lines the model may quote verbatim, 【回答要点】 how to
 * shape this turn's answer, 【可引导】 the follow-ups the closing line picks from,
 * and 【不可答】 the fixed boundary. Cards appear in the answer where the model
 * writes their markers, one per line.
 * @module @lyteboat/agent-finance/digest/finance-digest
 */

/** The boundary every finance digest restates, so no turn forgets it. */
export const FINANCE_BOUNDARY = '收益预测、具体产品推荐、个股能不能买、买卖时点：说明不在服务范围内，建议咨询持牌理财顾问。'

export interface FinanceDigest {
  tool: string
  status: string
  /** Extra header fields in order (`state=rich`, `seq=2`). */
  tags?: Readonly<Record<string, string | number>>
  /** The cards this result prepared, by marker name; none leaves `areas=none`. */
  areas: readonly string[]
  facts: readonly string[]
  guidance: readonly string[]
  leads: readonly string[]
}

/** The line the answer carries where a card should appear: `[[card:asset_overview]]`. */
export function cardMarker(area: string): string {
  return `[[card:${area}]]`
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`【${title}】`, ...lines.map(line => `- ${line}`)]
}

const HEADER = /^\[tool:(\S+) ([^\]]*?) areas=[^\]]*\]$/u

/**
 * A digest from an earlier turn, as later turns should see it: the header
 * without its cards and the facts, marked as done. How-to-answer guidance and
 * follow-ups belonged to that turn; left in view they compete with the current
 * turn's. Undefined when `text` is not a current finance digest.
 * @param text - a tool result's text.
 */
export function pastFinanceDigest(text: string): string | undefined {
  const [header, ...lines] = text.split('\n')
  const match = HEADER.exec(header ?? '')
  if (match === null) return undefined
  const facts: string[] = []
  let current = ''
  for (const line of lines) {
    const title = /^【(.+)】$/u.exec(line)?.[1]
    if (title !== undefined) current = title
    else if (current === '事实') facts.push(line)
  }
  return [`[tool:${match[1] ?? ''} 已完成 ${match[2] ?? ''}]`, ...facts.length === 0 ? [] : ['【事实】', ...facts]].join('\n')
}

/**
 * Lay a digest out.
 * @param digest - the header fields and the section lines.
 */
export function composeFinanceDigest(digest: FinanceDigest): string {
  const tags = Object.entries(digest.tags ?? {}).map(([key, value]) => ` ${key}=${String(value)}`).join('')
  const areas = digest.areas.length === 0 ? 'none' : digest.areas.join(',')
  return [
    `[tool:${digest.tool} status=${digest.status}${tags} areas=${areas}]`,
    ...section('事实', digest.facts),
    ...section('回答要点', digest.guidance),
    ...section('可引导', digest.leads),
    ...section('不可答', [FINANCE_BOUNDARY]),
  ].join('\n')
}
