import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eventTypes, findSessionLogs, normalizeSessionLog, readSessionLog } from '@boat/testing/session-log'
import { runBoat } from './support/boat-process.ts'

const SUCCESS_TEXT = 'BOAT-M1-EQUIVALENCE-OK'
const TITLE_LLM_OVERLAY = '- id: session-title-llm\n  disabled: true\n'

/**
 * M1's gate: the forked driver and the official driver, given the same scripted
 * model, must write the same session log event for event once run-specific
 * values are normalized away.
 */
describe('driver equivalence (built bin, mock model)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'boat-equivalence-'))
    writeFileSync(join(root, 'disable-title-llm.patch.yml'), TITLE_LLM_OVERLAY)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Each run gets its own scripted model: the sequence is consumed per request, so a shared server would hand the second run the tail of the first run's script. */
  async function startMock(): Promise<MockLlmServer> {
    return startMockLlmServer({
      port: 0,
      apiKey: 'mock-key',
      sequence: ['tool_call_success', 'success', 'success'],
      repeatLast: true,
      toolName: 'read',
      toolArguments: JSON.stringify({ file_path: 'README.md' }),
      successText: SUCCESS_TEXT,
    })
  }

  async function runWith(driver: 'dsh' | 'boat'): Promise<{ stdout: string; normalized: Record<string, unknown>[]; types: string[]; dump: string }> {
    const home = join(root, `home-${driver}`)
    const workspace = join(root, `workspace-${driver}`)
    for (const dir of [home, workspace]) rmSync(dir, { recursive: true, force: true })
    mkdirSync(home, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'README.md'), '# equivalence workspace\n')
    const mock = await startMock()
    const env = {
      BOAT_HOME: home,
      DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
      DSH_TELEMETRY_DISABLED: '1',
    }
    const overlay = join(root, 'disable-title-llm.patch.yml')
    let result
    try {
      result = await runBoat(['run', '--driver', driver, '--patch', overlay, 'read the readme and report'], { cwd: workspace, env })
    } finally {
      await mock.close()
    }
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(SUCCESS_TEXT)
    const [log] = findSessionLogs(home)
    expect(log).toBeDefined()
    const records = readSessionLog(log!)
    const dump = (await runBoat(['config', 'dump', '--profile', 'run', '--driver', driver, '--patch', overlay], { env })).stdout
    return { stdout: result.stdout, normalized: normalizeSessionLog(records, { cwd: workspace, home }), types: eventTypes(records), dump }
  }

  it('produces event-for-event identical session logs under both drivers', async () => {
    const dsh = await runWith('dsh')
    const boat = await runWith('boat')
    expect(boat.stdout).toBe(dsh.stdout)
    expect(boat.types).toEqual(dsh.types)
    expect(boat.types).toContain('tool/call')
    expect(boat.normalized).toEqual(dsh.normalized)
    // The switch is visible in the composed tree: dsh's row disabled, boat's row inserted.
    expect(boat.dump).toMatch(/id: agent-loop[\s\S]*?disabled: true/u)
    expect(boat.dump).toContain('@boat/agentic-loop')
    expect(dsh.dump).not.toContain('@boat/agentic-loop')
    // Both drivers mounted through the same profile directory contents.
    expect(readFileSync(join(root, 'home-boat', 'profiles', 'run', 'package.json'), 'utf8'))
      .toBe(readFileSync(join(root, 'home-dsh', 'profiles', 'run', 'package.json'), 'utf8'))
  })
})
