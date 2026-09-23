import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eventTypes, findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { runBoat } from './support/boat-process.ts'

const SUCCESS_TEXT = 'MODEL-ANSWERED'
const TITLE_LLM_OVERLAY = '- id: session-title-llm\n  disabled: true\n'
const PLUGIN = fileURLToPath(new URL('../../../examples/intake-gate/plugin.mjs', import.meta.url))
const FIXED_REPLY = '抱歉，我只负责资产配置相关的问题，不提供股票买卖建议。'

describe('boat run --plugin examples/intake-gate (built bin, mock model)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'boat-intake-'))
    writeFileSync(join(root, 'disable-title-llm.patch.yml'), TITLE_LLM_OVERLAY)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function run(driver: 'boat' | 'dsh', task: string) {
    const home = join(root, `home-${driver}`)
    const workspace = join(root, `workspace-${driver}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# intake\n')
    const mock: MockLlmServer = await startMockLlmServer({
      port: 0, apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: SUCCESS_TEXT,
    })
    let result
    try {
      result = await runBoat(
        ['run', '--driver', driver, '--plugin', PLUGIN, '--patch', join(root, 'disable-title-llm.patch.yml'), task],
        { cwd: workspace, env: { BOAT_HOME: home, DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' } },
      )
    } finally {
      await mock.close()
    }
    const [log] = findSessionLogs(home)
    return { result, requests: mock.requests.length, types: log === undefined ? [] : eventTypes(readSessionLog(log)) }
  }

  it('answers an out-of-scope task with the fixed reply and zero model requests under the boat driver', async () => {
    const { result, requests, types } = await run('boat', '帮我炒股')
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(FIXED_REPLY)
    expect(requests).toBe(0)
    // The session-title plugin's fallback title lands wherever its listener runs; it is not part of the turn's shape.
    const turn = types.slice(types.indexOf('turn/start')).filter(type => !type.startsWith('agent/inbox/') && !type.startsWith('session/title'))
    expect(turn).toEqual([
      'turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end',
    ])
  })

  it('lets an in-scope task through to the model', async () => {
    const { result, requests } = await run('boat', '看看我的资产配置')
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    expect(requests).toBe(1)
  })

  it('never fires under the official driver, which sends the same task to the model', async () => {
    const { result, requests } = await run('dsh', '帮我炒股')
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    expect(requests).toBe(1)
  })
})
