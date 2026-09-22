/**
 * The demo preset's intake gate: stock-trading requests get a fixed reply
 * and never reach the router or the model.
 * @module @boat/agent-demo/hooks
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IntakeDecision, IntakeReply } from '@boat/contracts'

export const name = 'demo-hooks'

const OUT_OF_SCOPE = /炒股|股票|买卖|涨停|荐股/u

const REPLY: IntakeReply = {
  kind: 'reply',
  plugin: name,
  reason: 'out-of-scope',
  content: [{ type: 'text', text: '抱歉，我只负责资产配置相关的问题，不提供股票买卖建议。' }],
}

export function apply(ctx: Context): void {
  ctx.on('boat/intake', async (payload, next): Promise<IntakeDecision> => {
    const text = payload.messages
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .join('\n')
    return OUT_OF_SCOPE.test(text) ? REPLY : next()
  })
}
