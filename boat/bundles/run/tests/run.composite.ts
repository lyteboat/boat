import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { bootComposition } from '@boat/testing/composition'
import { eventTypes, findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const RUN = ['@deepseek-ai/dsh-base', '@boat/host', '@boat/run']
const SUCCESS_TEXT = 'BOAT-RUN-COMPOSITE-OK'

describe('@boat/run composition (in process, mock model)', () => {
  let mock: MockLlmServer
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
    workspace = mkdtempSync(join(tmpdir(), 'boat-run-'))
    writeFileSync(join(workspace, 'README.md'), '# composite workspace\n')
  })

  afterAll(async () => {
    await mock.close()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('answers one task through the real tool path, prints the answer, and exits 0', async () => {
    const result = await bootComposition({
      bundles: RUN,
      // The title provider's request would consume the scripted mock sequence.
      patches: [{ id: 'session-title-llm', disabled: true }],
      args: ['read the readme and report'],
      cwd: workspace,
      env: { DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    const logs = findSessionLogs(result.home)
    expect(logs).toHaveLength(1)
    const types = eventTypes(readSessionLog(logs[0] ?? ''))
    expect(types.filter(type => type === 'step/start')).toHaveLength(2)
    expect(types).toContain('tool/result')
    expect(types.at(-1)).toBe('turn/end')
    rmSync(result.home, { recursive: true, force: true })
  })

  it('sends the model no session log: @boat/host keeps dsh-base\'s session-log upload off', async () => {
    const before = mock.requests.length
    const result = await bootComposition({
      bundles: RUN,
      patches: [{ id: 'session-title-llm', disabled: true }],
      args: ['read the readme and report'],
      cwd: workspace,
      env: { DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    const sent = mock.requests.slice(before)
    expect(sent.length).toBeGreaterThan(0)
    for (const request of sent) expect(request.body).not.toHaveProperty('dsh_session_log')
    expect(eventTypes(readSessionLog(findSessionLogs(result.home)[0] ?? ''))).not.toContain('session-log-deepseek/delivery-accepted')
    rmSync(result.home, { recursive: true, force: true })
  })

  it('rejects a missing task as a usage error without a model request', async () => {
    const before = mock.requests.length
    const result = await bootComposition({
      bundles: RUN,
      args: [],
      cwd: workspace,
      env: { DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('a task is required')
    expect(mock.requests.length).toBe(before)
    rmSync(result.home, { recursive: true, force: true })
  })
})
