import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { runBoat } from './support/boat-process.ts'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@boat/testing/scripted-model'

const PLUGIN = fileURLToPath(new URL('../../../examples/a2ui/plugin.mjs', import.meta.url))
const BASELINE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../plugins/a2ui/tests/fixtures/baseline/asset_overview-full.json', import.meta.url)), 'utf8')) as {
  payload: Record<string, unknown>; digest: string
}
const ANSWER = 'A2UI-OK'

interface Record_ { type: string; data?: Record<string, unknown> }

function toolCalls(request: RecordedRequest): string {
  return JSON.stringify(request.body.messages.filter(message => message.role === 'assistant').map(message => message.tool_calls))
}

describe('@boat/a2ui under boat run --driver boat (built bin, scripted model)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'boat-a2ui-'))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# a2ui\n')
    return { home, workspace }
  }

  function env(home: string, model: ScriptedModel): Record<string, string> {
    return { BOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('queries state, renders the asset card into tool/result.meta field-for-field with ark, and shows the digest to the model', async () => {
    const model = await startScriptedModel(withTitle((request: RecordedRequest) => {
      const calls = toolCalls(request)
      if (!calls.includes('query_assets')) return { toolCall: { name: 'query_assets', arguments: {}, id: 'call-query' } }
      if (!calls.includes('render_a2ui')) return { toolCall: { name: 'render_a2ui', arguments: { template: 'asset_overview' }, id: 'call-render' } }
      return { text: ANSWER }
    }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('card')
      const result = await runBoat(['run', '--driver', 'boat', '--plugin', PLUGIN, '看看我的资产'], { cwd: workspace, env: env(home, model) })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(ANSWER)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(3)
      expect((loop[0]!.body.tools ?? []).map(tool => tool.function?.name)).toEqual(expect.arrayContaining(['query_assets', 'render_a2ui']))
      expect(JSON.stringify(loop[2]!.body.messages)).toContain(BASELINE.digest)
      expect(JSON.stringify(loop[2]!.body.messages)).not.toContain('rootComponentId')
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as unknown as Record_[]
      const [queried, rendered] = records.filter(record => record.type === 'tool/result')
      expect(queried?.data?.['meta']).toMatchObject({ boat: { stateDelta: { yl_assets: { auth_state: 'full' } } } })
      expect(records.map(record => record.type).filter(type => type.startsWith('boat/'))).toEqual([])
      const meta = rendered?.data?.['meta'] as { boat: { card: { surfaceId: string; payload: Record<string, unknown> } }; a2ui: { warnings: string[] } }
      expect(meta.a2ui.warnings).toEqual([])
      expect(meta.boat.card.surfaceId).toMatch(/^asset_overview-session--[0-9a-f]{6}$/u)
      const expected = { ...BASELINE.payload }
      delete expected['surfaceId']
      const actual = { ...meta.boat.card.payload }
      delete actual['surfaceId']
      expect(actual).toEqual(expected)
    } finally {
      await model.close()
    }
  })

  it('ends the turn on a terminal card', async () => {
    const model = await startScriptedModel(withTitle(() => ({ toolCall: { name: 'render_a2ui', arguments: { template: 'unauthorized' }, id: 'call-auth' } })), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('terminal')
      const result = await runBoat(['run', '--driver', 'boat', '--plugin', PLUGIN, '我要授权'], { cwd: workspace, env: env(home, model) })
      expect(result.code, result.stderr).toBe(0)
      expect(model.loopRequests()).toHaveLength(1)
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as unknown as Record_[]
      const rendered = records.find(record => record.type === 'tool/result')
      const meta = rendered?.data?.['meta'] as { boat: { card: { payload: Record<string, unknown> } } }
      expect(meta.boat.card.payload['rootComponentId']).toBe('root-container')
      expect((meta.boat.card.payload['businessPayload'] as Record<string, unknown>)['auth_link']).toBe('')
      const turnEnd = records.filter(record => record.type === 'turn/end').at(-1)
      expect(turnEnd?.data?.['reason']).toEqual({ kind: 'completed' })
    } finally {
      await model.close()
    }
  })
})
