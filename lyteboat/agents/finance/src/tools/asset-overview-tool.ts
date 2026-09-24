/**
 * `asset_overview`: the customer's holdings summed into a total, a steady part
 * and a part at market risk, one asset overview card, and a digest of the
 * facts the model may quote. Nothing authorized answers with the unauthorized
 * card instead, which ends the turn.
 * @module @lyteboat/agent-finance/tools/asset-overview-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { summarizeHoldings, type FinanceHoldings } from '../capabilities/finance-holdings.ts'
import { moneyForModel, pctText, yuanPlain } from '../capabilities/money-text.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'
import { FINANCE_TOOL_OUTPUT, callingAgent, prepareCard, unauthorizedResult, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'

/** The card's raw data: every line already worded, so the template only binds. */
export function overviewCardData(holdings: FinanceHoldings): Record<string, unknown> {
  return {
    overview: {
      total_line: `${yuanPlain(holdings.totalCents)} 元`,
      steady_line: `稳健资产 ${yuanPlain(holdings.steadyCents)} 元 · ${pctText(holdings.steadyPct)}`,
      risky_line: `风险资产 ${yuanPlain(holdings.riskyCents)} 元 · ${pctText(holdings.riskyPct)}`,
    },
  }
}

/** The facts the model may quote about the overview. */
export function overviewFacts(holdings: FinanceHoldings): string[] {
  return [
    `已授权资产合计 ${moneyForModel(holdings.totalCents)}`,
    `稳健资产（存款、货币基金、债券） ${moneyForModel(holdings.steadyCents)}，占 ${pctText(holdings.steadyPct)}`,
    `风险资产（股票、股票基金） ${moneyForModel(holdings.riskyCents)}，占 ${pctText(holdings.riskyPct)}`,
  ]
}

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineAssetOverviewTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'asset_overview',
    description: '查看用户已授权账户里的资产总览：总额、稳健资产和风险资产各有多少、各占多少，并出一张资产总览卡。无参数。',
    parameters: {},
    output: FINANCE_TOOL_OUTPUT,
    execute: async (_args, exec): Promise<FinanceToolValue> => {
      const agent = callingAgent(exec, 'asset_overview')
      const customer = deps.customers.customer(deps.customerId(agent))
      const holdings = summarizeHoldings(customer)
      if (!holdings.authorized) return unauthorizedResult(deps, agent, exec, 'asset_overview', customer)
      const card = await prepareCard(deps, agent, 'asset_overview', overviewCardData(holdings))
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'asset_overview',
          status: 'ok',
          areas: ['asset_overview'],
          facts: overviewFacts(holdings),
          guidance: [
            `先用一句话回应用户（不超过 25 字），然后单独一行写 ${cardMarker('asset_overview')}，卡片后再用一句话收尾（不超过 25 字）。`,
            '卡片里已经有全部数字，正文不要复述金额和占比。',
          ],
          leads: ['诊断一下我的配置', '什么是资产配置'],
        }),
        cards: [card],
      }
    },
  })
}
