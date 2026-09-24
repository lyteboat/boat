/**
 * `asset_overview`: the authorized accounts summed into the three buckets, one
 * asset overview card, and a digest of the facts the model may quote. Nothing
 * authorized answers with the unauthorized card instead, which ends the turn.
 * @module @lyteboat/agent-finance/tools/asset-overview-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { FINANCE_BUCKETS, FINANCE_BUCKET_LABEL } from '../data/finance-customer.ts'
import { summarizeHoldings, type FinanceHoldings } from '../capabilities/finance-holdings.ts'
import { moneyForModel, pctText, yuanPlain } from '../capabilities/money-text.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'
import { FINANCE_TOOL_OUTPUT, callingAgent, prepareCard, unauthorizedResult, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'

/** The card's raw data: every line already worded, so the template only binds. */
export function overviewCardData(holdings: FinanceHoldings): Record<string, unknown> {
  const lines = Object.fromEntries(FINANCE_BUCKETS.map((bucket) => {
    const holding = holdings.buckets[bucket]
    return [`${bucket}_line`, holding.authorized || holding.cents > 0 ? `${yuanPlain(holding.cents)} 元 · ${pctText(holding.pct)}` : '未授权']
  }))
  const unauthorized = holdings.unauthorizedInstitutions
  return {
    overview: {
      total_display: yuanPlain(holdings.totalCents),
      ...lines,
      policy_count: holdings.policyCount,
      policy_hide: holdings.policyCount === 0,
      auth_tip_text: unauthorized.length === 0 ? '' : `还有 ${String(unauthorized.length)} 家机构未授权（${unauthorized.join('、')}），授权后可查看更全的资产`,
      auth_tip_hide: unauthorized.length === 0,
    },
  }
}

/** The facts the model may quote about the overview. */
export function overviewFacts(holdings: FinanceHoldings): string[] {
  const facts = [`已授权资产合计 ${moneyForModel(holdings.totalCents)}`]
  for (const bucket of FINANCE_BUCKETS) {
    const holding = holdings.buckets[bucket]
    facts.push(holding.authorized
      ? `${FINANCE_BUCKET_LABEL[bucket]} ${moneyForModel(holding.cents)}，占 ${pctText(holding.pct)}`
      : `${FINANCE_BUCKET_LABEL[bucket]}：所在机构未授权，看不到`)
  }
  if (holdings.policyCount > 0) facts.push(`已授权的保险机构里有 ${String(holdings.policyCount)} 份保单`)
  if (holdings.unauthorizedInstitutions.length > 0) facts.push(`还有 ${String(holdings.unauthorizedInstitutions.length)} 家机构未授权：${holdings.unauthorizedInstitutions.join('、')}`)
  return facts
}

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineAssetOverviewTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'asset_overview',
    description: '查看用户已授权账户里的资产总览：总额、三笔钱（日常开销、稳健投资、进取收益）的金额与占比、还有哪些机构没授权，并出一张资产总览卡。无参数。',
    parameters: {},
    output: FINANCE_TOOL_OUTPUT,
    execute: async (_args, exec): Promise<FinanceToolValue> => {
      const agent = callingAgent(exec, 'asset_overview')
      const customer = deps.customers.customer(deps.customerId(agent))
      // The overview shows what the authorized accounts hold; reported assets join only the diagnosis.
      const holdings = summarizeHoldings(customer)
      if (holdings.authState === 'none') return unauthorizedResult(deps, agent, exec, 'asset_overview', customer)
      const card = await prepareCard(deps, agent, 'asset_overview', overviewCardData(holdings))
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'asset_overview',
          status: 'ok',
          tags: { auth: holdings.authState },
          areas: ['asset_overview'],
          facts: overviewFacts(holdings),
          guidance: [
            `先用一句话回应用户（不超过 25 字），然后单独一行写 ${cardMarker('asset_overview')}，卡片后再用一句话收尾（不超过 25 字）。`,
            '卡片里已经有全部数字，正文不要复述金额和占比。',
          ],
          leads: ['诊断一下我的配置', '看看日常开销这笔钱的明细', '什么是资产配置'],
        }),
        cards: [card],
      }
    },
  })
}
