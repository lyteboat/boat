import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'
import { scriptedModelEnv } from '@lyteboat/testing/scripted-model'
import { eventTypes, findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { runLyteboat } from './support/lyteboat-process.ts'

const SUCCESS_TEXT = 'LYTEBOAT-RUN-SMOKE-OK'
const NOOP_PLUGIN = fileURLToPath(new URL('./fixtures/plugins/noop.mjs', import.meta.url))

/**
 * The session-title provider issues its own model request whose events land at
 * timing-dependent positions and whose request would consume the scripted mock
 * sequence; the smoke disables that row through the ordinary --patch path.
 */
const TITLE_LLM_OVERLAY = '- id: session-title-llm\n  disabled: true\n'

describe('lyteboat run (built bin, mock model)', () => {
  const scratch = createLyteboatScratch('run-smoke')
  let mock: MockLlmServer

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
    writeFileSync(join(scratch.root, 'disable-title-llm.patch.yml'), TITLE_LLM_OVERLAY)
  })

  afterAll(async () => {
    await mock.close()
    scratch.remove()
  })

  it('answers one task through the real tool path and persists the turn when a --plugin file joins the tree', async () => {
    const { home, workspace } = scratch.run('smoke')
    const result = await runLyteboat(
      ['run', '--plugin', NOOP_PLUGIN, '--patch', join(scratch.root, 'disable-title-llm.patch.yml'), 'read the readme and report'],
      { cwd: workspace, env: { LYTEBOAT_HOME: home, ...scriptedModelEnv(mock) } },
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    // The launcher reports a row that failed to import or apply; the plugin file's row activated.
    expect(result.stderr).not.toContain('did not activate')

    // The world, not the self-report: the persisted log carries the tool round trip.
    const logs = findSessionLogs(home)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/session\.v4\.jsonl\.zstd$/u)
    const records = readSessionLog(logs[0]!)
    expect(records[0]).toMatchObject({ type: 'session', version: 4 })
    const types = eventTypes(records)
    expect(types[0]).toBe('permission/preset')
    expect(types).toContain('turn/start')
    expect(types).toContain('request/header')
    expect(types.filter(type => type === 'step/start')).toHaveLength(2)
    expect(types).not.toContain('session/title-llm-request')
    expect(types.at(-1)).toBe('turn/end')
    const toolCall = records.find(record => record['type'] === 'tool/call') as { data: { name: string; arguments: string } } | undefined
    expect(toolCall?.data).toMatchObject({ name: 'read', arguments: JSON.stringify({ file_path: 'README.md' }) })
    const toolResult = records.find(record => record['type'] === 'tool/result') as { data: { message: { role: string; isError: boolean } } } | undefined
    expect(toolResult?.data.message).toMatchObject({ role: 'tool', isError: false })
    expect(JSON.stringify(toolResult)).toContain('# run-smoke workspace')
    const turnEnd = records.at(-1) as { data: { reason: { kind: string } } }
    expect(turnEnd.data.reason.kind).toBe('completed')

    // Two model requests reached the mock: the tool-call step and the final answer.
    expect(mock.requests).toHaveLength(2)

    // The profile's plugins resolved through the installation's runtime resolution; nothing is linked into the profiles tree.
    expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
  })
})
