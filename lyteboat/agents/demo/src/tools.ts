/**
 * The demo preset's tools and skills row: `asset_overview` (query the
 * persona, fold it into the session state, render the asset card in the same
 * call) and `diagnose_assets` (judge the state's buckets against their
 * bands), both `auto` tools the routed skill activates; the preset's skills
 * directory, mounted as a scoped skill-filesystem provider.
 * @module @lyteboat/agent-demo/tools
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as skillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@lyteboat/tool-policy'
import type {} from '@lyteboat/a2ui'
import type { JsonValue } from '@lyteboat/contracts'
import { buildAssetsBundle, diagnose, loadPersona } from './assets.ts'

export const name = 'demo-tools'
export const inject = ['tools', 'toolPolicy', 'a2ui', 'skills', 'sessionProjections']

/** The preset directory (this file is lib/tools.js). */
const PRESET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PERSONAS = join(PRESET_DIR, 'fixtures', 'personas')
const TEMPLATES = join(PRESET_DIR, 'a2ui')
const SKILLS = join(PRESET_DIR, 'skills')

/** Which persona `asset_overview` reads; the demo has no user identity. */
function personaName(): string {
  return process.env['LYTEBOAT_DEMO_PERSONA'] ?? 'healthy'
}

const JUDGE_TEXT = { ok: '在区间内', over: '偏高', under: '偏低', unauthorized: '未授权' } as const

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(skillFilesystem, { providerName: 'demo', includeDefaultRoots: false, customSkillDirs: [SKILLS], watch: false })

  ctx.toolPolicy.register(defineTool({
    name: 'asset_overview',
    description: '查询用户已授权账户里的资产（三笔钱的占比与金额、授权态），写入会话状态，并渲染一张资产总览卡。无参数。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          auth_state: { type: 'string', required: true },
          digest: { type: 'string', required: true },
          card: { type: 'json', required: true },
          stateDelta: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `status=${value.status} · ${value.digest}` }],
      presentationMeta: (_args, value) => ({
        lyteboat: { card: { surfaceId: String((value.card as Record<string, unknown>)['surfaceId'] ?? ''), payload: value.card } },
      }),
    },
    execute: async (_args, exec) => {
      const bundle = buildAssetsBundle(loadPersona(PERSONAS, personaName()))
      const rendered = await ctx.a2ui.render(TEMPLATES, 'asset_overview', { ...bundle.assets_view, ...bundle }, {
        sessionId: exec.agent?.session.id ?? '',
      })
      return {
        status: 'ok',
        auth_state: String(bundle.assets_view['auth_state']),
        digest: rendered.digest,
        card: rendered.payload as JsonValue,
        stateDelta: bundle as unknown as JsonValue,
      }
    },
  }), { visibility: 'auto', group: 'demo', stateDelta: (_args, value) => (value as { stateDelta: JsonValue }).stateDelta })

  ctx.toolPolicy.register(defineTool({
    name: 'diagnose_assets',
    description: '按三笔钱的目标区间诊断本会话已查询的资产配置；会话里还没有资产状态时会说明需要先查看资产。无参数。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          verdicts: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    execute: async (_args, exec) => {
      const agent = exec.agent
      const state = agent === undefined ? undefined : ctx.sessionProjections.stateOf(agent.session, 'lyteboatState')
      const assets = state?.['assets_view']
      if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) {
        return { status: 'no-assets', summary: '会话里还没有资产状态，请先查看资产（asset_overview）再诊断。', verdicts: [] }
      }
      const verdicts = diagnose(assets)
      const lines = verdicts.map(verdict => `${verdict.bucket} ${String(verdict.pct)}%（目标 ${String(verdict.band[0])}–${String(verdict.band[1])}%）${JUDGE_TEXT[verdict.judge]}`)
      const healthy = verdicts.every(verdict => verdict.judge === 'ok')
      return {
        status: healthy ? 'healthy' : 'deviated',
        summary: `${healthy ? '配置合理' : '配置有偏离'}：${lines.join('；')}。`,
        verdicts: verdicts as unknown as JsonValue[],
      }
    },
  }), { visibility: 'auto', group: 'demo' })
}
