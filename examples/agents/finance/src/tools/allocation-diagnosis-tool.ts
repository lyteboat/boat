/**
 * `allocation_diagnosis`: the share at market risk against the 100-minus-age
 * rule. Two cards: where the allocation stands, and which way to move. Nothing
 * authorized answers with the unauthorized card instead, which ends the turn.
 * @module @lyteboat/agent-finance/tools/allocation-diagnosis-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { cardMarker } from '@lyteboat/a2ui'
import { VERDICT_TEXT, diagnoseAllocation, type AllocationDiagnosis } from '../capabilities/allocation-diagnosis.ts'
import { summarizeHoldings, type FinanceHoldings } from '../capabilities/finance-holdings.ts'
import { moneyForModel, pctText } from '../capabilities/money-text.ts'
import { composeFinanceDigest } from '../digest/finance-digest.ts'
import { FINANCE_TOOL_OUTPUT, callingAgent, unauthorizedResult, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'

const bandText = (diagnosis: AllocationDiagnosis): string => `${String(diagnosis.lowPct)}%–${String(diagnosis.highPct)}%`

/** The two cards' raw data. */
function diagnosisCardData(diagnosis: AllocationDiagnosis, holdings: FinanceHoldings, age: number): { diagnosis: Record<string, unknown>; plan: Record<string, unknown> } {
  return {
    diagnosis: {
      diagnosis: {
        verdict_line: `您的配置${VERDICT_TEXT[diagnosis.verdict]}`,
        risky_line: `风险资产占 ${pctText(holdings.riskyPct)}，按「100 减年龄」，${String(age)} 岁建议 ${bandText(diagnosis)}`,
        steady_line: `稳健资产占 ${pctText(holdings.steadyPct)}`,
      },
    },
    plan: { plan: { direction: diagnosis.direction, note: '以上只是按公开理财常识的方向性建议，不构成具体产品推荐。' } },
  }
}

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineAllocationDiagnosisTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'allocation_diagnosis',
    description: '按「100 减年龄」的公开常识诊断用户的资产配置：风险资产占比是否在建议区间内，并给出方向性的调整建议；出一张诊断卡和一张调整方向卡。无参数。',
    parameters: {},
    output: FINANCE_TOOL_OUTPUT,
    execute: async (_args, exec): Promise<FinanceToolValue> => {
      const agent = callingAgent(exec, 'allocation_diagnosis')
      const customer = deps.customers.customer(deps.customerId(agent))
      const holdings = summarizeHoldings(customer)
      if (!holdings.authorized) return unauthorizedResult(deps, agent, exec, 'allocation_diagnosis', customer)
      const diagnosis = diagnoseAllocation(holdings, customer.age)
      const data = diagnosisCardData(diagnosis, holdings, customer.age)
      const cards = [await deps.a2ui.renderCard(deps.templates, 'allocation_diagnosis', data.diagnosis, { agent }), await deps.a2ui.renderCard(deps.templates, 'allocation_plan', data.plan, { agent })]
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'allocation_diagnosis',
          status: 'ok',
          tags: { verdict: diagnosis.verdict },
          areas: ['allocation_diagnosis', 'allocation_plan'],
          facts: [
            `结论：配置${VERDICT_TEXT[diagnosis.verdict]}`,
            `参与诊断的资产合计 ${moneyForModel(holdings.totalCents)}`,
            `风险资产占 ${pctText(holdings.riskyPct)}；按「100 减年龄」，${String(customer.age)} 岁的建议区间是 ${bandText(diagnosis)}`,
            `调整方向：${diagnosis.direction}`,
          ],
          guidance: [
            `第一句给出结论，然后单独一行写 ${cardMarker('allocation_diagnosis')}，用一两句话解释为什么；再单独一行写 ${cardMarker('allocation_plan')}，最后一句收尾。`,
            '数字只照抄【事实】，不推荐具体产品。',
          ],
          leads: ['什么是再平衡', '看看我的资产'],
        }),
        cards,
      }
    },
  })
}
