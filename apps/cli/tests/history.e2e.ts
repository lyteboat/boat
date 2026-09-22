import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '../../../scripts/session-log.ts'
import { runBoat } from './support/boat-process.ts'
import { startScriptedModel, withTitle, type ScriptedModel } from './support/scripted-model.ts'

const HISTORY = fileURLToPath(new URL('../../../examples/history/sa.json', import.meta.url))
const ANSWER = 'HISTORY-OK'

interface LogRecord { type: string; data?: Record<string, unknown>; isSeeded?: boolean }

describe('boat run --history (built bin, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'boat-history-'))
    model = await startScriptedModel(withTitle(() => ({ text: ANSWER })), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# history\n')
    return { home, workspace }
  }

  function env(home: string): Record<string, string> {
    return { BOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it.each(['boat', 'dsh'])('seeds the session from the file under --driver %s: two complete rounds, the task as turn 3, the rounds in the first request', async (driver) => {
    const { home, workspace } = fresh(driver)
    const before = model.requests.length
    const result = await runBoat(['run', '--driver', driver, '--history', HISTORY, '继续刚才的话题'], { cwd: workspace, env: env(home) })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(ANSWER)
    expect(result.stderr).toContain('imported 2 history round(s) from sa.json')
    const loop = model.requests.slice(before).filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    const roles = loop[0]!.body.messages.map(message => message.role)
    expect(roles.slice(0, 5)).toEqual(['system', 'user', 'assistant', 'user', 'assistant'])
    const text = JSON.stringify(loop[0]!.body.messages)
    expect(text).toContain('帮我看看我的资产分布')
    expect(text).toContain('建议把稳健提高到 25% 左右')
    expect(text).not.toContain('那具体怎么调')
    expect(text).toContain('继续刚才的话题')
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!) as unknown as LogRecord[]
    expect(records[0]).toMatchObject({ type: 'session', isSeeded: true })
    const turns = records.filter(record => record.type === 'turn/start').map(record => record.data?.['turn'])
    expect(turns).toEqual([1, 2, 3])
    const imported = records.find(record => record.type === 'boat/history-imported')
    expect(imported?.data).toEqual({ source: 'sa.json', traceIds: ['trace-0001', 'trace-0002'], rounds: 2 })
    const types = records.map(record => record.type)
    expect(types.indexOf('session/end-seed')).toBeGreaterThan(types.indexOf('boat/history-imported'))
    expect(types.indexOf('session/end-seed')).toBeLessThan(types.lastIndexOf('turn/start'))
    expect(records.filter(record => record.type === 'turn/end').at(-1)?.data).toEqual({ turn: 3, reason: { kind: 'completed' } })
  })

  it('rejects a missing history file as a usage error', async () => {
    const { home, workspace } = fresh('missing')
    const result = await runBoat(['run', '--history', join(workspace, 'nope.json'), 'hi'], { cwd: workspace, env: env(home) })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('--history file not found')
  })
})
