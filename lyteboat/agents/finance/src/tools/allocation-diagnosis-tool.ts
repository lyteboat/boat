/**
 * `allocation_diagnosis`: the whole-portfolio diagnosis. It folds the facts the
 * user just gave (horizon, monthly spending, assets elsewhere) into the session,
 * diagnoses, numbers the diagnosis, and prepares zero, one or two cards by the
 * card state: the diagnosis card, plus the adjustment plan when all three
 * buckets are visible and something is off.
 * @module @lyteboat/agent-finance/tools/allocation-diagnosis-tool
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LyteboatResultCard } from '@lyteboat/contracts'
import { FINANCE_BUCKET_LABEL } from '../data/finance-customer.ts'
import { BUCKET_JUDGE_TEXT, type AllocationDiagnosis, type BucketDiagnosis } from '../capabilities/allocation-diagnosis.ts'
import { INVESTMENT_HORIZONS } from '../capabilities/allocation-targets.ts'
import { nextFollowUp } from '../capabilities/follow-up-questions.ts'
import { coverageLine, hasCoverageGap } from '../capabilities/insurance-coverage.ts'
import { pctText } from '../capabilities/money-text.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'
import type { FinanceState } from '../state/finance-state.ts'
import { FINANCE_TOOL_OUTPUT, callingAgent, financeStateOf, prepareCard, unauthorizedResult, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'
import { diagnoseSession, diagnosisFacts, factsWithArguments, problemsText, type SessionDiagnosis } from './session-diagnosis.ts'

const PLAN_DIRECTION: Readonly<Record<BucketDiagnosis['judge'], string>> = { over: '建议调低', under: '建议调高', ok: '保持', unknown: '未授权，暂不判断' }

function summaryOf(diagnosis: AllocationDiagnosis): string {
  switch (diagnosis.cardState) {
    case 'healthy': return '三笔钱都在建议区间内'
    case 'rich': return `主要问题：${problemsText(diagnosis)}`
    case 'thin': return diagnosis.problems.length === 0 ? '看得到的两类钱包都在建议区间内' : `主要问题：${problemsText(diagnosis)}`
    case 'single': return '暂时无法诊断配置'
    case 'runway':
    case 'zero':
      return ''
  }
}

/** The diagnosis card's raw data. */
export function diagnosisCardData(diagnosis: AllocationDiagnosis, seq: number, coverage: string): Record<string, unknown> {
  const buckets = Object.fromEntries(diagnosis.buckets.flatMap(bucket => [
    [`${bucket.bucket}_share`, bucket.judge === 'unknown' ? '—' : pctText(bucket.pct)],
    [`${bucket.bucket}_band`, `建议 ${String(bucket.low)}%–${String(bucket.high)}%`],
    [`${bucket.bucket}_judge`, BUCKET_JUDGE_TEXT[bucket.judge]],
  ]))
  return {
    diagnosis: {
      title: `配置诊断 #${String(seq)}`,
      summary: summaryOf(diagnosis),
      ...buckets,
      grid_hide: diagnosis.cardState === 'single',
      blocked_text: '已授权的资产只覆盖一类钱包，暂时无法判断配置，授权更多机构后再看。',
      blocked_hide: diagnosis.cardState !== 'single',
      caveat_text: '只看到了两类钱包，结论仅供参考。',
      caveat_hide: diagnosis.cardState !== 'thin',
      coverage_text: `基础保障：${coverage}`,
    },
  }
}

/** The adjustment plan card's raw data. */
export function planCardData(diagnosis: AllocationDiagnosis): Record<string, unknown> {
  const lines = Object.fromEntries(diagnosis.buckets.map(bucket => [
    `${bucket.bucket}_plan`,
    `${bucket.label}：${bucket.judge === 'unknown' ? '—' : pctText(bucket.pct)} → ${String(bucket.low)}%–${String(bucket.high)}%，${PLAN_DIRECTION[bucket.judge]}`,
  ]))
  return { plan: { ...lines, note: '以上为按公开理财常识估算的方向性参考，不构成投资建议。' } }
}

async function cardsFor(deps: FinanceToolDeps, agent: Agent, session: SessionDiagnosis, seq: number): Promise<LyteboatResultCard[]> {
  const { diagnosis } = session
  if (diagnosis.cardState === 'runway') return []
  const card = await prepareCard(deps, agent, 'allocation_diagnosis', diagnosisCardData(diagnosis, seq, coverageLine(session.customer.coverage)))
  if (diagnosis.cardState !== 'rich') return [card]
  return [card, await prepareCard(deps, agent, 'allocation_plan', planCardData(diagnosis))]
}

function guidanceFor(session: SessionDiagnosis, cards: readonly LyteboatResultCard[]): string[] {
  const { diagnosis } = session
  const markers = cards.map(card => cardMarker(card.area))
  switch (diagnosis.cardState) {
    case 'rich':
      return [
        `先用一句话给结论，再解释偏离最大的两项：${problemsText(diagnosis)}。`,
        `现状部分单独一行写 ${markers[0] ?? ''}，调整建议部分单独一行写 ${markers[1] ?? ''}。`,
        ...hasCoverageGap(session.customer.coverage) ? ['提醒用户：基础保障有缺口时，先补保障，再加大进取投资。'] : [],
      ]
    case 'healthy':
      return [`告诉用户三笔钱都在建议区间内，单独一行写 ${markers[0] ?? ''}；建议定期（比如每年）再平衡一次。`]
    case 'thin':
      return [`说明只看到了两类钱包，结论仅供参考；单独一行写 ${markers[0] ?? ''}。建议授权更多机构后重新诊断。`]
    case 'single':
      return [`说明已授权的资产只覆盖一类钱包，暂时无法诊断配置；单独一行写 ${markers[0] ?? ''}，建议授权更多机构。`]
    case 'runway':
      return ['说明目前的资产还不到 3 个月支出，建议先攒够应急金，再谈配置。本轮没有卡片，不写卡片标记。']
    case 'zero':
      return []
  }
}

function leadsFor(diagnosis: AllocationDiagnosis): string[] {
  const worst = diagnosis.problems[0]
  switch (diagnosis.cardState) {
    case 'rich':
    case 'thin':
      return [`看看${FINANCE_BUCKET_LABEL[worst?.bucket ?? 'growth']}这笔钱的明细`, '什么是再平衡', '什么是应急金']
    case 'healthy':
      return ['看看进取收益这笔钱的明细', '什么是再平衡']
    case 'single':
      return ['什么是资产配置']
    case 'runway':
    case 'zero':
      return ['什么是应急金']
  }
}

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineAllocationDiagnosisTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'allocation_diagnosis',
    description: '按公开理财常识诊断三笔钱的配置：每笔钱的占比、建议区间、偏高或偏低，并给出方向性的调整建议；按情况出诊断卡和调整方案卡。用户在对话里给出投资期限、每月支出、已授权账户以外的资产时，把它们填进参数；没说过的不要填。',
    parameters: {
      investment_horizon: { type: 'string', enum: INVESTMENT_HORIZONS, description: '用户说过的投资期限：用于投资的钱多久用不到。' },
      monthly_expense: { type: 'string', description: '用户纠正或补充的每月支出，照原话写数字，如 "8000" 或 "1.2万"。' },
      external_assets: {
        type: 'array',
        description: '用户告知的、已授权账户以外的资产，一句话里有几笔填几笔；用户撤回某一笔时对那一笔填 remove=true。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', required: true, description: '用户对这笔钱的叫法，如「别的银行的定期」。' },
            amount: { type: 'string', description: '金额，照原话写，如 "200000" 或 "20万"。' },
            remove: { type: 'boolean', description: '用户撤回这一笔时为 true。' },
          },
        },
      },
    },
    output: FINANCE_TOOL_OUTPUT,
    execute: async (args, exec): Promise<FinanceToolValue> => {
      const agent = callingAgent(exec, 'allocation_diagnosis')
      const before = financeStateOf(deps, agent)
      const facts = factsWithArguments(before.facts, args)
      const session = diagnoseSession(deps, agent, { ...before, facts })
      const seq = before.diagnosisSeq + 1
      if (session.diagnosis.cardState === 'zero') {
        return unauthorizedResult(deps, agent, exec, 'allocation_diagnosis', session.customer, { facts })
      }
      const answerable = ['rich', 'thin', 'healthy'].includes(session.diagnosis.cardState)
      const followUp = answerable ? nextFollowUp(facts.investmentHorizon ?? undefined, before.asked) : undefined
      const state: Partial<FinanceState> = {
        facts,
        asked: followUp === undefined ? before.asked : [...before.asked, followUp.field],
        diagnosisSeq: seq,
      }
      const cards = await cardsFor(deps, agent, session, seq)
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'allocation_diagnosis',
          status: 'ok',
          tags: { state: session.diagnosis.cardState, seq },
          areas: cards.map(card => card.area),
          facts: diagnosisFacts(session, seq),
          guidance: [
            ...guidanceFor(session, cards),
            ...followUp === undefined ? [] : [`回答最后只问这一个问题，照原话问：「${followUp.question}」`],
          ],
          leads: leadsFor(session.diagnosis),
        }),
        cards,
        state,
      }
    },
  })
}
