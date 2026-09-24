/**
 * `bucket_diagnosis`: one bucket in detail — its share against the band and the
 * accounts it is made of — as a bucket card, followed by a next-step button card.
 * It diagnoses the session as it stands; facts come in through the diagnosis tool.
 * @module @lyteboat/agent-finance/tools/bucket-diagnosis-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { FINANCE_BUCKETS, FINANCE_BUCKET_LABEL, type FinanceBucket } from '../data/finance-customer.ts'
import { BUCKET_JUDGE_TEXT, type BucketDiagnosis } from '../capabilities/allocation-diagnosis.ts'
import type { FinanceHoldings } from '../capabilities/finance-holdings.ts'
import { moneyForModel, pctText, yuanPlain } from '../capabilities/money-text.ts'
import { cardMarker, composeFinanceDigest } from '../digest/finance-digest.ts'
import { FINANCE_TOOL_OUTPUT, callingAgent, financeStateOf, prepareCard, unauthorizedResult, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'
import { diagnoseSession } from './session-diagnosis.ts'

const BUCKET_NAMES = FINANCE_BUCKETS.map(bucket => FINANCE_BUCKET_LABEL[bucket])

function bucketOfLabel(label: string): FinanceBucket {
  const bucket = FINANCE_BUCKETS.find(candidate => FINANCE_BUCKET_LABEL[candidate] === label)
  if (bucket === undefined) throw new Error(`bucket_diagnosis: unknown bucket ${JSON.stringify(label)}; one of ${BUCKET_NAMES.join(', ')}`)
  return bucket
}

/** The bucket card's raw data. */
export function bucketCardData(entry: BucketDiagnosis, holdings: FinanceHoldings): Record<string, unknown> {
  const accounts = holdings.buckets[entry.bucket].accounts
  return {
    bucket: {
      title: `${entry.label}明细`,
      share_text: `${pctText(entry.pct)}（建议 ${String(entry.low)}%–${String(entry.high)}%）`,
      judge: entry.judge,
      amount_text: `${yuanPlain(entry.cents)} 元`,
      accounts_text: accounts.length === 0 ? '暂无账户' : accounts.map(account => `${account.institution} · ${account.name} · ${yuanPlain(account.cents)} 元`).join('\n'),
    },
  }
}

function bucketFacts(entry: BucketDiagnosis, holdings: FinanceHoldings): string[] {
  const accounts = holdings.buckets[entry.bucket].accounts
  return [
    `${entry.label} ${moneyForModel(entry.cents)}，占 ${pctText(entry.pct)}，建议 ${String(entry.low)}%–${String(entry.high)}%，${BUCKET_JUDGE_TEXT[entry.judge]}`,
    ...accounts.map(account => `账户：${account.institution} · ${account.name} · ${moneyForModel(account.cents)}`),
  ]
}

function blocked(tool: string, status: string, reason: string, leads: string[]): FinanceToolValue {
  return {
    status,
    digest: composeFinanceDigest({ tool, status, areas: [], facts: [reason], guidance: ['如实说明原因，本轮没有卡片，不写卡片标记。'], leads }),
    cards: [],
  }
}

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineBucketDiagnosisTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'bucket_diagnosis',
    description: `细看一笔钱：${BUCKET_NAMES.join('、')}之一的占比、建议区间和账户构成，出一张明细卡。用户没说清是哪一笔时先问清楚，不要猜。`,
    parameters: {
      bucket: { type: 'string', enum: BUCKET_NAMES, required: true, description: '要细看的那一笔钱。' },
    },
    output: FINANCE_TOOL_OUTPUT,
    execute: async (args, exec): Promise<FinanceToolValue> => {
      const agent = callingAgent(exec, 'bucket_diagnosis')
      const bucket = bucketOfLabel(args.bucket)
      const session = diagnoseSession(deps, agent, financeStateOf(deps, agent))
      const { diagnosis, holdings } = session
      if (diagnosis.cardState === 'zero') return unauthorizedResult(deps, agent, exec, 'bucket_diagnosis', session.customer)
      if (diagnosis.cardState === 'single') return blocked('bucket_diagnosis', 'blocked', '已授权的资产只覆盖一类钱包，暂时无法判断这笔钱是否合理。', ['什么是资产配置'])
      if (diagnosis.cardState === 'runway') return blocked('bucket_diagnosis', 'blocked', '目前的资产还不到 3 个月支出，先攒够应急金，再看每笔钱的配置。', ['什么是应急金'])
      const entry = diagnosis.buckets.find(candidate => candidate.bucket === bucket)
      if (entry === undefined || entry.judge === 'unknown') return blocked('bucket_diagnosis', 'unauthorized-bucket', `${FINANCE_BUCKET_LABEL[bucket]}所在的机构还没授权，看不到这笔钱。`, ['诊断一下我的配置'])
      const cards = [
        await prepareCard(deps, agent, 'bucket_detail', bucketCardData(entry, holdings)),
        await prepareCard(deps, agent, 'next_step', { next: { query: '诊断一下我的配置' } }),
      ]
      const others = FINANCE_BUCKETS.filter(candidate => candidate !== bucket).map(candidate => `看看${FINANCE_BUCKET_LABEL[candidate]}这笔钱的明细`)
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'bucket_diagnosis',
          status: 'ok',
          tags: { bucket: entry.label },
          areas: ['bucket_detail'],
          facts: bucketFacts(entry, holdings),
          guidance: [
            `先用一两句话说这笔钱的情况和原因，然后单独一行写 ${cardMarker('bucket_detail')}。`,
            '「下一步」按钮卡会自动附在回答末尾，不用写它的标记。',
          ],
          leads: [...others, '诊断一下我的配置'],
        }),
        cards,
      }
    },
  })
}
