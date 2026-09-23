import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { FIXTURES, runComposition } from './support/run-composition.ts'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@boat/testing/scripted-model'

const AGENTS = join(FIXTURES, 'agents')
const ANSWER = 'SKILL-ROUTER-OK'

const ASSET_SKILL = `---
name: asset-overview
description: 资产总览与配置诊断：查看总资产、持仓结构与配置建议。
metadata:
  boat:
    requiredTools: [todo_write]
---
ASSET-OVERVIEW-BODY: 先列出持仓，再给出配置建议。
`
const NEWS_SKILL = `---
name: market-news
description: 市场行情与新闻解读。
---
MARKET-NEWS-BODY: 只解读公开行情。
`

function toolNames(request: RecordedRequest): string[] {
  return (request.body.tools ?? []).map(tool => tool.function?.name ?? '')
}

describe('@boat/skill-router in the run composition (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'boat-skill-router-'))
    model = await startScriptedModel(withTitle((request: RecordedRequest) => request.purpose === 'router'
      ? { text: '{"skill_id": "asset-overview", "reason": "看资产"}' }
      : { text: ANSWER }), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# skill router\n')
    for (const [name, text] of [['asset-overview', ASSET_SKILL], ['market-news', NEWS_SKILL]] as const) {
      mkdirSync(join(workspace, '.dsh/skills', name), { recursive: true })
      writeFileSync(join(workspace, '.dsh/skills', name, 'SKILL.md'), text)
    }
    return { home, workspace }
  }

  function env(): Record<string, string> {
    return { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('routes the task through the router model and puts the skill body and its tool into the same request', async () => {
    const { home, workspace } = fresh('dynamic')
    const before = model.requests.length
    const result = await runComposition(
      ['--agents', AGENTS, '--preset', 'routed', '看看我的资产'],
      { cwd: workspace, home, env: env() },
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(ANSWER)
    const requests = model.requests.slice(before)
    const router = requests.filter(request => request.purpose === 'router')
    expect(router).toHaveLength(1)
    expect(router[0]!.lastUser).toContain('<available_skills>')
    expect(router[0]!.lastUser).toContain('id: asset-overview')
    expect(router[0]!.lastUser).toContain('id: market-news')
    expect(router[0]!.lastUser).toContain('<latest_user_input>看看我的资产</latest_user_input>')
    const loop = requests.filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    expect(loop[0]!.systemText).toContain('ROUTED-PRESET-PERSONA')
    expect(toolNames(loop[0]!)).toContain('todo_write')
    const messages = JSON.stringify(loop[0]!.body.messages)
    expect(messages).toContain('ASSET-OVERVIEW-BODY')
    expect(messages).not.toContain('MARKET-NEWS-BODY')
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!) as { type: string; data?: Record<string, unknown> }[]
    const routeRequest = records.find(record => record.type === 'boat/route-request')
    expect(routeRequest?.data).toMatchObject({ turn: 1, candidates: ['asset-overview', 'market-news'], decision: 'asset-overview', reason: '看资产' })
    expect(routeRequest?.data?.['route']).toMatchObject({ provider: 'deepseek-official', model: expect.any(String) })
    const routedNode = records.find(record => record.type === 'boat/skill-routed')
    expect(routedNode?.data).toEqual({ turn: 1, skill: 'asset-overview', reason: '看资产', source: 'router' })
    expect(records.map(record => record.type).indexOf('boat/skill-routed')).toBeLessThan(records.map(record => record.type).indexOf('request/header'))
  })

  it('leaves the host composition alone without the preset: no router call, no boat nodes', async () => {
    const { home, workspace } = fresh('off')
    const before = model.requests.length
    const result = await runComposition(['看看我的资产'], { cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    const requests = model.requests.slice(before)
    expect(requests.filter(request => request.purpose === 'router')).toHaveLength(0)
    const loop = requests.filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    expect(JSON.stringify(loop[0]!.body.messages)).not.toContain('ASSET-OVERVIEW-BODY')
    const [log] = findSessionLogs(home)
    const types = readSessionLog(log!).map(record => (record as { type: string }).type)
    expect(types).not.toContain('boat/route-request')
    expect(types).not.toContain('boat/skill-routed')
  })
})
