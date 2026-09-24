/**
 * M2 integration acceptance over the demo preset: a routed skill activates
 * its tool for the same step, the tool renders a card into the log and the
 * projection, the diagnosis skill routes to its own tool, and the intake
 * gate answers without any model request.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootComposition } from '@lyteboat/testing/composition'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { startScriptedModel, withTitle, type ChatBlock, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'

/** The agents/ root this package lives in, as `--agents ./agents` names it. */
const AGENTS = fileURLToPath(new URL('../..', import.meta.url))
/** The run profile's bundle layers, in the order apps/cli's template lists them. */
const RUN_BUNDLES = ['@deepseek-ai/dsh-base', '@lyteboat/host', '@lyteboat/run']
const ANSWER = 'DEMO-OK'

interface LogRecord { type: string; data?: Record<string, unknown> }

/** The raw text of every message block, tool results included, unescaped (JSON.stringify would escape the quotes in skill tags). */
function messageTexts(request: RecordedRequest): string {
  const text = (block: ChatBlock): string => block.text ?? (Array.isArray(block.content) ? (block.content as ChatBlock[]).map(text).join('') : '')
  return request.body.messages.flatMap(message => message.content.map(text)).join('\n')
}

/** The router prompt quotes the candidates' descriptions; only the latest input decides. */
function latestInput(request: RecordedRequest): string {
  return /<latest_user_input>([\s\S]*?)<\/latest_user_input>/u.exec(request.lastUser)?.[1] ?? ''
}

/** The router picks by the latest input; the loop calls the routed skill's tool once, then answers. */
function script(request: RecordedRequest) {
  if (request.purpose === 'router') {
    const diagnosis = /合理|健康|诊断|优化/u.test(latestInput(request))
    return { text: JSON.stringify({ skill_id: diagnosis ? 'asset-diagnosis' : 'asset-overview', reason: diagnosis ? '评价类' : '观察类' }) }
  }
  const tools = request.toolNames
  const called = request.calledTools
  if (tools.includes('asset_overview') && !called.includes('asset_overview')) return { toolCall: { name: 'asset_overview', arguments: {}, id: 'call-overview' } }
  if (tools.includes('diagnose_assets') && !called.includes('diagnose_assets')) return { toolCall: { name: 'diagnose_assets', arguments: {}, id: 'call-diagnose' } }
  return { text: ANSWER }
}

describe('demo agent in the run composition (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-demo-'))
    model = await startScriptedModel(withTitle(script), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# demo\n')
    return { home, workspace }
  }

  function env(): Record<string, string> {
    return { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  async function run(label: string, task: string): Promise<{ requests: RecordedRequest[]; records: LogRecord[]; stdout: string; stderr: string }> {
    const { home, workspace } = fresh(label)
    const before = model.requests.length
    const result = await bootComposition({ bundles: RUN_BUNDLES, args: ['--agents', AGENTS, '--agent', 'demo', task], cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    const [log] = findSessionLogs(home)
    return { requests: model.requests.slice(before), records: readSessionLog(log!) as unknown as LogRecord[], stdout: result.stdout, stderr: result.stderr }
  }

  it('"看看资产": routes to asset-overview, exposes only its tool, renders the card into the log and shows the digest to the model', async () => {
    const { requests, records, stdout } = await run('overview', '看看资产')
    expect(stdout).toContain(ANSWER)
    expect(requests.filter(request => request.purpose === 'router')).toHaveLength(1)
    const loop = requests.filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(2)
    expect(loop[0]!.systemText).toContain('DEMO-ASSET-PERSONA')
    expect(loop[0]!.toolNames).toContain('asset_overview')
    expect(loop[0]!.toolNames).not.toContain('diagnose_assets')
    expect(messageTexts(loop[0]!)).toContain('<skill_content name="asset-overview">')
    const digest = messageTexts(loop[1]!)
    expect(digest).toContain('status=ok')
    expect(digest).toContain('[卡片:资产/full]')
    expect(digest).not.toContain('rootComponentId')
    const types = records.map(record => record.type)
    expect(records.find(record => record.type === 'lyteboat/skill-routed')?.data).toMatchObject({ skill: 'asset-overview', source: 'router' })
    const result = records.find(record => record.type === 'tool/result')
    const meta = result?.data?.['meta'] as { lyteboat: { card: { surfaceId: string; payload: Record<string, unknown> }; stateDelta: Record<string, unknown> } }
    expect(meta.lyteboat.stateDelta).toMatchObject({ yl_assets: { auth_state: 'full', total_display: '300,000.00' } })
    expect(meta.lyteboat.card.surfaceId).toMatch(/^asset_overview-session--[0-9a-f]{6}$/u)
    expect(meta.lyteboat.card.payload['rootComponentId']).toBe('root-container')
    expect((meta.lyteboat.card.payload['businessPayload'] as Record<string, unknown>)['total_display']).toBe('300,000.00')
    expect(types.indexOf('lyteboat/skill-routed')).toBeLessThan(types.indexOf('request/header'))
    expect(types.filter(type => type === 'turn/end')).toHaveLength(1)
  })

  it('"我的配置合理吗": routes to asset-diagnosis and its tool asks for the assets first in a fresh session', async () => {
    const { requests, records } = await run('diagnosis', '我的配置合理吗')
    const loop = requests.filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(2)
    expect(loop[0]!.toolNames).toContain('diagnose_assets')
    expect(loop[0]!.toolNames).not.toContain('asset_overview')
    expect(messageTexts(loop[0]!)).toContain('<skill_content name="asset-diagnosis">')
    expect(records.find(record => record.type === 'lyteboat/skill-routed')?.data).toMatchObject({ skill: 'asset-diagnosis' })
    expect(JSON.stringify(records.find(record => record.type === 'tool/result'))).toContain('请先查看资产')
    expect(JSON.stringify(records.find(record => record.type === 'tool/result'))).not.toContain('stateDelta')
  })

  it('"帮我炒股": the intake gate answers with zero model requests', async () => {
    const { requests, records, stdout } = await run('gate', '帮我炒股')
    expect(requests.filter(request => request.purpose !== 'title')).toHaveLength(0)
    expect(stdout).toContain('不提供股票买卖建议')
    const types = records.map(record => record.type)
    expect(types).toContain('assistant/message')
    expect(types).not.toContain('request/header')
    expect(types).not.toContain('lyteboat/route-request')
  })
})
