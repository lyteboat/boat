import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { pluginFileRow } from '@lyteboat/testing/composition'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, runComposition } from './support/run-composition.ts'

const PLUGIN = pluginFileRow(join(FIXTURES, 'plugins', 'distro-aware.mjs'))

describe('@lyteboat/distro in the run composition (in process, mock model)', () => {
  let mock: MockLlmServer
  let root: string

  beforeAll(async () => {
    mock = await startMockLlmServer({ port: 0, apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'MODEL' })
    root = mkdtempSync(join(tmpdir(), 'lyteboat-distro-'))
  })

  afterAll(async () => {
    await mock.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('serves a plugin that injects lyteboatDistro and answers through the intake extension', async () => {
    const result = await runComposition(['which lyteboat is this'], {
      cwd: root,
      home: join(root, 'home'),
      env: { DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    }, [{ id: 'session-title-llm', disabled: true }, PLUGIN])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('lyteboat on dsh 0.1.7-rc.1: agent-loop-intake, agent-loop-pre-assemble, session-append-ignorable')
    expect(mock.requests).toHaveLength(0)
  })
})
