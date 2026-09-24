import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { FIXTURES, runComposition } from './support/run-composition.ts'
import { startScriptedModel, withTitle, type ScriptedModel } from '@lyteboat/testing/scripted-model'

const HISTORY = join(FIXTURES, 'history', 'rounds.json')
const ANSWER = 'HISTORY-OK'

interface LogRecord { type: string; data?: Record<string, unknown>; isSeeded?: boolean }

describe('lyteboat run --history (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-history-'))
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

  function env(): Record<string, string> {
    return { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('seeds the session from the file: two complete rounds, the task as turn 3, the rounds in the first request', async () => {
    const { home, workspace } = fresh('seed')
    const before = model.requests.length
    const result = await runComposition(['--history', HISTORY, '继续刚才的话题'], { cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(ANSWER)
    expect(result.stderr).toContain('imported 2 history round(s) from rounds.json')
    const loop = model.requests.slice(before).filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    const roles = loop[0]!.body.messages.map(message => message.role)
    expect(roles.slice(0, 4)).toEqual(['user', 'assistant', 'user', 'assistant'])
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
    const types = records.map(record => record.type)
    expect(types.filter(type => type.startsWith('lyteboat/'))).toEqual([])
    expect(types.indexOf('session/end-seed')).toBeGreaterThan(types.indexOf('turn/end'))
    expect(types.indexOf('session/end-seed')).toBeLessThan(types.lastIndexOf('turn/start'))
    expect(records.filter(record => record.type === 'turn/end').at(-1)?.data).toEqual({ turn: 3, reason: { kind: 'completed' } })
  })

  it('rejects a missing history file as a usage error', async () => {
    const { home, workspace } = fresh('missing')
    const result = await runComposition(['--history', join(workspace, 'nope.json'), 'hi'], { cwd: workspace, home, env: env() })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('--history file not found')
  })
})
