// An intake gate: answers out-of-scope requests with a fixed reply and no model
// call. Run it with the boat driver, which dispatches `boat/intake`:
//   boat run --driver boat --plugin examples/intake-gate/plugin.mjs "帮我炒股"
export const name = 'example-intake-gate'

const OUT_OF_SCOPE = /炒股|股票|买卖|涨停/u

function textOf(messages) {
  return messages
    .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    .join('\n')
}

export function apply(ctx) {
  ctx.on('boat/intake', async (payload, next) => {
    if (!OUT_OF_SCOPE.test(textOf(payload.messages))) return next()
    return {
      kind: 'reply',
      plugin: name,
      reason: 'out-of-scope',
      content: [{ type: 'text', text: '抱歉，我只负责资产配置相关的问题，不提供股票买卖建议。' }],
    }
  })
}
