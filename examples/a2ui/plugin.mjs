// A2UI cards over `ctx.a2ui`. `query_assets` returns the yinglong asset bundle
// (ark's engine test fixture) and folds it into the session state through the
// tool policy's delta; `render_a2ui` renders a card from that state, returns
// the digest to the model, and puts the card on the tool result's meta. Run it
// with the boat driver:
//   boat run --driver boat --plugin examples/a2ui/plugin.mjs "看看我的资产"
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'example-a2ui'
export const inject = ['toolPolicy', 'a2ui']

const AUTH = { 日常: true, 稳健: true, 进取: true }
const ASSETS = {
  yl_assets: {
    total_display: '293,828.93', auth_state: 'full', policy_count: 3, is_aigc: true,
    unauth_main_group_count: 0, insurance_authorized: true,
    auth_link: 'https://pama/auth', assets_sub_page_link: 'https://pama/policies',
    buckets: {
      日常: { pct: 62.0, amount: '182173.94', amount_display: '¥182,173.94', authorized: AUTH.日常 },
      稳健: { pct: 13.0, amount: '38197.76', amount_display: '¥38,197.76', authorized: AUTH.稳健 },
      进取: { pct: 25.0, amount: '73457.23', amount_display: '¥73,457.23', authorized: AUTH.进取 },
    },
  },
  yl_assets_raw: { accounts: [
    { bucket: '日常', bu: '平安银行', name: '活期', amount: '82173.94' },
    { bucket: '日常', bu: '平安证券', name: '可用', amount: '100000' },
    { bucket: '稳健', bu: '平安银行', name: '理财', amount: '38197.76' },
  ] },
}

export async function apply(ctx) {
  ctx.toolPolicy.register(defineTool({
    name: 'query_assets',
    description: '查询当前用户的资产分布，结果进入会话状态，供卡片渲染使用。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `资产已查询：总额 ${value.yl_assets.total_display}，授权状态 ${value.yl_assets.auth_state}` }],
    },
    execute: async () => ASSETS,
  }), { visibility: 'always', group: 'assets', stateDelta: (_args, value) => value })

  await ctx.a2ui.registerRenderTool({
    templates: fileURLToPath(new URL('./templates', import.meta.url)),
    stateKeys: ['yl_assets', 'yl_assets_raw'],
    terminalCards: ['unauthorized'],
    cardDescriptions: {
      asset_overview: '资产总览卡：总额、三桶占比与明细、授权与诊断入口。先调 query_assets。',
      unauthorized: '未授权引导卡：出示授权按钮后本轮结束。',
    },
  })
}
