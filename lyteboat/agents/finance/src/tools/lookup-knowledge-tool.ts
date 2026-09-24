/**
 * `lookup_knowledge`: investor education from the agent's public knowledge
 * base. No card and no customer data: a concept is explained the same way to
 * everyone.
 * @module @lyteboat/agent-finance/tools/lookup-knowledge-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { lookupKnowledge } from '../capabilities/investor-knowledge.ts'
import { composeFinanceDigest } from '../digest/finance-digest.ts'
import { FINANCE_TOOL_OUTPUT, type FinanceToolDeps, type FinanceToolValue } from './finance-tool-support.ts'

/**
 * Define the tool.
 * @param deps - the finance tool dependencies.
 */
export function defineLookupKnowledgeTool(deps: FinanceToolDeps): ToolDefinition {
  return defineTool({
    name: 'lookup_knowledge',
    description: '查投资者教育知识库，解释一个理财概念（如再平衡、复利、应急金、分散投资、定投、风险等级、通货膨胀）。只讲概念，不涉及用户本人的资产。',
    parameters: {
      topic: { type: 'string', required: true, description: '用户想了解的概念，如「再平衡」「定投」。' },
    },
    output: FINANCE_TOOL_OUTPUT,
    execute: async (args): Promise<FinanceToolValue> => {
      const found = lookupKnowledge(deps.knowledge, args.topic)
      if (found.status === 'fallback') {
        return {
          status: 'fallback',
          digest: composeFinanceDigest({
            tool: 'lookup_knowledge',
            status: 'fallback',
            tags: { topic: args.topic },
            areas: [],
            facts: [`知识库里没有「${args.topic}」这个主题。可以讲的主题有：${found.topics.join('、')}。`],
            guidance: ['如实说明没有找到，列出可以讲的主题请用户选。'],
            leads: found.topics.slice(0, 3).map(topic => `什么是${topic}`),
          }),
          cards: [],
        }
      }
      return {
        status: 'ok',
        digest: composeFinanceDigest({
          tool: 'lookup_knowledge',
          status: 'ok',
          tags: { topic: found.entry.topic },
          areas: [],
          facts: [found.entry.text],
          guidance: ['用通俗的话解释，可以举一个简单的例子；不要把概念套到用户本人的资产上，也不要推荐产品。'],
          leads: ['诊断一下我的配置', '看看我的资产'],
        }),
        cards: [],
      }
    },
  })
}
