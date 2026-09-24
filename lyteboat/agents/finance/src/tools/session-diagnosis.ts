/**
 * One diagnosis of the calling session's customer with the facts the session
 * has gathered: the diagnosis tool runs it after folding in this call's
 * arguments, the drill-down tool runs it as the session stands.
 * @module @lyteboat/agent-finance/tools/session-diagnosis
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { FINANCE_BUCKET_LABEL, type CustomerProfile, type FinanceCustomer } from '../data/finance-customer.ts'
import { diagnoseAllocation, BUCKET_JUDGE_TEXT, type AllocationDiagnosis } from '../capabilities/allocation-diagnosis.ts'
import { mergeExternalAssets, type ExternalAssetReport } from '../capabilities/external-assets.ts'
import { summarizeHoldings, type FinanceHoldings } from '../capabilities/finance-holdings.ts'
import type { InvestmentHorizon } from '../capabilities/allocation-targets.ts'
import { coverageLine } from '../capabilities/insurance-coverage.ts'
import { moneyForModel, pctText } from '../capabilities/money-text.ts'
import type { FinanceState } from '../state/finance-state.ts'
import { profileWithFacts, statementAmountOf, type FinanceToolDeps } from './finance-tool-support.ts'

export interface SessionDiagnosis {
  customer: FinanceCustomer
  profile: CustomerProfile
  holdings: FinanceHoldings
  diagnosis: AllocationDiagnosis
}

/** A diagnosis call's arguments, as the model extracts them. */
export interface DiagnosisArguments {
  investment_horizon?: InvestmentHorizon
  monthly_expense?: string
  external_assets?: ExternalAssetReport[]
}

/**
 * The session facts after one call's arguments: a stated horizon or spending
 * replaces the earlier one, reported assets merge by source.
 * @param facts - the facts so far.
 * @param args - this call's arguments.
 */
export function factsWithArguments(facts: FinanceState['facts'], args: DiagnosisArguments): FinanceState['facts'] {
  const spending = args.monthly_expense === undefined ? undefined : statementAmountOf(args.monthly_expense)
  return {
    investmentHorizon: args.investment_horizon ?? facts.investmentHorizon,
    monthlyExpense: spending ?? facts.monthlyExpense,
    externalAssets: args.external_assets === undefined ? facts.externalAssets : mergeExternalAssets(facts.externalAssets, args.external_assets),
  }
}

/**
 * Diagnose the session's customer.
 * @param deps - the finance tool dependencies.
 * @param agent - the calling agent, whose request context names the customer.
 * @param state - the session state, with the facts to diagnose under.
 */
export function diagnoseSession(deps: FinanceToolDeps, agent: Agent, state: FinanceState): SessionDiagnosis {
  const customer = deps.customers.customer(deps.customerId(agent))
  const profile = profileWithFacts(customer, state)
  const holdings = summarizeHoldings(customer, state.facts.externalAssets)
  return { customer, profile, holdings, diagnosis: diagnoseAllocation(holdings, profile, state.facts.investmentHorizon ?? undefined) }
}

/** The facts a diagnosis digest quotes, bucket by bucket. */
export function diagnosisFacts(session: SessionDiagnosis, seq: number): string[] {
  const { diagnosis, holdings, customer } = session
  const total = `诊断 #${String(seq)}：参与诊断的资产合计 ${moneyForModel(diagnosis.totalCents)}`
  const facts = [holdings.reportedCents > 0 ? `${total}，其中您告知的其他机构资产 ${moneyForModel(holdings.reportedCents)}` : total]
  // A blocked diagnosis states shares only: a band next to a share would read as a judgement it cannot make.
  const judged = diagnosis.cardState !== 'single' && diagnosis.cardState !== 'runway'
  for (const bucket of diagnosis.buckets) {
    if (bucket.judge === 'unknown') facts.push(`${bucket.label}：${BUCKET_JUDGE_TEXT.unknown}`)
    else if (!judged) facts.push(`${bucket.label} ${moneyForModel(bucket.cents)}，占 ${pctText(bucket.pct)}`)
    else facts.push(`${bucket.label} ${moneyForModel(bucket.cents)}，占 ${pctText(bucket.pct)}，建议 ${String(bucket.low)}%–${String(bucket.high)}%，${BUCKET_JUDGE_TEXT[bucket.judge]}`)
  }
  facts.push(`应急金：建议留出 ${String(diagnosis.emergencyMonths)} 个月支出，目前日常开销约够 ${diagnosis.monthsCovered.toFixed(1)} 个月`)
  if (diagnosis.horizon !== undefined) facts.push(`投资期限：${diagnosis.horizon}`)
  facts.push(`基础保障：${coverageLine(customer.coverage)}`)
  return facts
}

/** `日常开销偏高、进取收益偏低` */
export function problemsText(diagnosis: AllocationDiagnosis): string {
  return diagnosis.problems.map(problem => `${FINANCE_BUCKET_LABEL[problem.bucket]}${BUCKET_JUDGE_TEXT[problem.judge]}`).join('、')
}
