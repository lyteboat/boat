import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { pluginFileRow } from '@boat/testing/composition'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, runComposition } from './support/run-composition.ts'

const PLUGIN = pluginFileRow(join(FIXTURES, 'plugins', 'distro-aware.mjs'))

describe('@boat/distro in the run composition (in process, mock model)', () => {
  let mock: MockLlmServer
  let root: string

  beforeAll(async () => {
    mock = await startMockLlmServer({ port: 0, apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'MODEL' })
    root = mkdtempSync(join(tmpdir(), 'boat-distro-'))
  })

  afterAll(async () => {
    await mock.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('serves a plugin that injects boatDistro and answers through the intake extension', async () => {
    const result = await runComposition(['which boat is this'], {
      cwd: root,
      home: join(root, 'home'),
      env: { DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    }, [{ id: 'session-title-llm', disabled: true }, PLUGIN])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('boat on dsh 0.1.7-alpha.2: agent-loop-intake, agent-loop-pre-assemble')
    expect(mock.requests).toHaveLength(0)
  })
})
