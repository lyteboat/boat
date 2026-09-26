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
const ANNOUNCE_PLUGIN = fileURLToPath(new URL('./fixtures/plugins/announce.mjs', import.meta.url))

/** A --patch overlay the smoke proves applied: the persona it sets reaches the model. */
const PERSONA_OVERLAY = '- id: system-prompt\n  config:\n    personaPrefix: LYTEBOAT-PATCHED-PERSONA\n    includeHarnessIdentity: false\n'

describe('lyteboat headless (built bin, mock model)', () => {
  const scratch = createLyteboatScratch('run-smoke')
  let mock: MockLlmServer

  beforeAll(async () => {
    mock = await startMockLlmServer({
      port: 0,
      apiKey: 'mock-key',
      sequence: ['tool_call_success', 'success', 'success'],
      repeatLast: true,
      toolName: 'announce_status',
      toolArguments: '{}',
      successText: SUCCESS_TEXT,
    })
    writeFileSync(join(scratch.root, 'persona.patch.yml'), PERSONA_OVERLAY)
  })

  afterAll(async () => {
    await mock.close()
    scratch.remove()
  })

  it('answers one task through the real tool path and persists the turn when a --plugin file and a --patch join the tree', async () => {
    const { home, workspace } = scratch.run('smoke')
    const result = await runLyteboat(
      ['headless', '--plugin', ANNOUNCE_PLUGIN, '--patch', join(scratch.root, 'persona.patch.yml'), 'check the status and report'],
      { cwd: workspace, env: { LYTEBOAT_HOME: home, ...scriptedModelEnv(mock) } },
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    // The plugin file's row was applied once, and no row failed to import or apply.
    expect(result.stderr.split('\n').filter(line => line === 'fixture-announce: applied')).toHaveLength(1)
    expect(result.stderr).not.toContain('did not activate')

    // The world, not the self-report: the persisted log carries the tool round trip.
    const logs = findSessionLogs(home)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/session\.v4\.jsonl\.zstd$/u)
    const records = readSessionLog(logs[0]!)
    expect(records[0]).toMatchObject({ type: 'session', version: 4 })
    const types = eventTypes(records)
    // The business base composes no permission or approval rows, so the session opens on the message.
    expect(types[0]).toBe('agent/inbox/spliced')
    expect(types.filter(type => type.startsWith('permission/') || type.startsWith('approval/'))).toEqual([])
    expect(types).toContain('turn/start')
    expect(types).toContain('request/header')
    expect(types.filter(type => type === 'step/start')).toHaveLength(2)
    expect(types).not.toContain('session/title-llm-request')
    expect(types.at(-1)).toBe('turn/end')
    const toolCall = records.find(record => record['type'] === 'tool/call') as { data: { name: string; arguments: string } } | undefined
    expect(toolCall?.data).toMatchObject({ name: 'announce_status', arguments: '{}' })
    const toolResult = records.find(record => record['type'] === 'tool/result') as { data: { message: { role: string; isError: boolean } } } | undefined
    expect(toolResult?.data.message).toMatchObject({ role: 'tool', isError: false })
    expect(JSON.stringify(toolResult)).toContain('fixture-announce: status ok')
    const turnEnd = records.at(-1) as { data: { reason: { kind: string } } }
    expect(turnEnd.data.reason.kind).toBe('completed')

    // Two model requests reached the mock: the tool-call step and the final answer; the patched persona is in them.
    expect(mock.requests).toHaveLength(2)
    expect(JSON.stringify(mock.requests[0])).toContain('LYTEBOAT-PATCHED-PERSONA')

    // The profile's plugins resolved through the installation's runtime resolution; nothing is linked into the profiles tree.
    expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
  })
})
