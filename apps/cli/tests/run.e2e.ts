import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eventTypes, findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { runBoat } from './support/boat-process.ts'

const SUCCESS_TEXT = 'BOAT-M0-SMOKE-OK'

/**
 * The session-title provider issues its own model request whose events land at
 * timing-dependent positions and whose request would consume the scripted mock
 * sequence; the smoke disables that row through the ordinary --patch path.
 */
const TITLE_LLM_OVERLAY = '- id: session-title-llm\n  disabled: true\n'

describe('boat run (built bin, mock model)', () => {
  let mock: MockLlmServer
  let home: string
  let workspace: string

  beforeAll(async () => {
    mock = await startMockLlmServer({
      port: 0,
      apiKey: 'mock-key',
      sequence: ['tool_call_success', 'success', 'success'],
      repeatLast: true,
      toolName: 'read',
      toolArguments: JSON.stringify({ file_path: 'README.md' }),
      successText: SUCCESS_TEXT,
    })
    home = mkdtempSync(join(tmpdir(), 'boat-home-'))
    workspace = mkdtempSync(join(tmpdir(), 'boat-workspace-'))
    writeFileSync(join(workspace, 'README.md'), '# smoke workspace\n')
    writeFileSync(join(home, 'disable-title-llm.patch.yml'), TITLE_LLM_OVERLAY)
  })

  afterAll(async () => {
    await mock.close()
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  it('answers one task through the real tool path and persists the turn', async () => {
    const result = await runBoat(
      ['run', '--patch', join(home, 'disable-title-llm.patch.yml'), 'read the readme and report'],
      {
        cwd: workspace,
        env: {
          BOAT_HOME: home,
          DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
          DEEPSEEK_API_KEY: 'mock-key',
          DSH_TELEMETRY_DISABLED: '1',
        },
      },
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)

    // The world, not the self-report: the persisted log carries the tool round trip.
    const logs = findSessionLogs(home)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/session\.v3\.jsonl\.zstd$/u)
    const records = readSessionLog(logs[0]!)
    expect(records[0]).toMatchObject({ type: 'session', version: 3 })
    const types = eventTypes(records)
    expect(types[0]).toBe('permission/preset')
    expect(types).toContain('turn/start')
    expect(types).toContain('request/header')
    expect(types.filter(type => type === 'step/start')).toHaveLength(2)
    expect(types).not.toContain('session/title-llm-request')
    expect(types.at(-1)).toBe('turn/end')
    const toolCall = records.find(record => record['type'] === 'tool/call') as { data: { name: string; arguments: string } } | undefined
    expect(toolCall?.data).toMatchObject({ name: 'read', arguments: JSON.stringify({ file_path: 'README.md' }) })
    const toolResult = records.find(record => record['type'] === 'tool/result') as { data: { message: { content: { isError: boolean; content: { text: string }[] }[] } } } | undefined
    expect(toolResult?.data.message.content[0]).toMatchObject({ isError: false })
    expect(JSON.stringify(toolResult)).toContain('smoke workspace')
    const turnEnd = records.at(-1) as { data: { reason: { kind: string } } }
    expect(turnEnd.data.reason.kind).toBe('completed')

    // Two model requests reached the mock: the tool-call step and the final answer.
    expect(mock.requests).toHaveLength(2)

    // The installation closure was linked for the profile's plugin resolution.
    const linked = readdirSync(join(home, 'profiles', 'node_modules', '@deepseek-ai'))
    expect(linked.length).toBeGreaterThanOrEqual(200)
  })
})
