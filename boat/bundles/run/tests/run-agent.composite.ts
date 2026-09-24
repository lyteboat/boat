import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eventTypes, findSessionLogs, readSessionLog } from '@boat/testing/session-log'
import { FIXTURES, runComposition } from './support/run-composition.ts'
import { startScriptedModel, withTitle, type ScriptedModel } from '@boat/testing/scripted-model'

const AGENTS = join(FIXTURES, 'agents')
const ANSWER = 'PRESET-RUN-OK'

describe('boat run --agents --agent (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'boat-preset-'))
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
    writeFileSync(join(workspace, 'README.md'), '# preset run\n')
    return { home, workspace }
  }

  function env(): Record<string, string> {
    return { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('composes the named agent and records it in the session header', async () => {
    const { home, workspace } = fresh('preset')
    const before = model.requests.length
    const result = await runComposition(['--agents', AGENTS, '--agent', 'minimal', 'hello'], { cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(ANSWER)
    const loop = model.requests.slice(before).filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    expect(loop[0]!.systemText).toContain('MINIMAL-PRESET-PERSONA')
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!)
    expect(records[0]).toMatchObject({ type: 'session', agentPreset: 'minimal' })
    // A preset chosen at creation is recorded in the header; `agent-preset/selected`
    // is only logged for a switch made while the session was still blank.
    const types = eventTypes(records).filter(type => !type.startsWith('session/title'))
    expect(types).not.toContain('agent-preset/selected')
    expect(types.at(-1)).toBe('turn/end')
  })

  it('runs the host composition alone without --agents', async () => {
    const { home, workspace } = fresh('plain')
    const before = model.requests.length
    const result = await runComposition(['hello'], { cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(ANSWER)
    const loop = model.requests.slice(before).filter(request => request.purpose === 'loop')
    expect(loop).toHaveLength(1)
    expect(loop[0]!.systemText).not.toContain('MINIMAL-PRESET-PERSONA')
    const [log] = findSessionLogs(home)
    const records = readSessionLog(log!)
    expect(records[0]).not.toHaveProperty('agentPreset')
    expect(eventTypes(records)).not.toContain('agent-preset/selected')
  })

  it('still accepts --preset as a deprecated alias of --agent, but not both at once', async () => {
    const { home, workspace } = fresh('alias')
    const before = model.requests.length
    const result = await runComposition(['--agents', AGENTS, '--preset', 'minimal', 'hello'], { cwd: workspace, home, env: env() })
    expect(result.code, result.stderr).toBe(0)
    expect(model.requests.slice(before).find(request => request.purpose === 'loop')?.systemText).toContain('MINIMAL-PRESET-PERSONA')
    const both = await runComposition(['--agents', AGENTS, '--agent', 'minimal', '--preset', 'minimal', 'hello'], { cwd: workspace, home: join(root, 'home-alias-both'), env: env() })
    expect(both.code).not.toBe(0)
    expect(both.stderr).toContain('deprecated alias of --agent')
  })

  it('rejects an unknown agent and an agent without roots as usage errors', async () => {
    const { home, workspace } = fresh('errors')
    const unknown = await runComposition(['--agents', AGENTS, '--agent', 'nope', 'hello'], { cwd: workspace, home, env: env() })
    expect(unknown.code).not.toBe(0)
    expect(unknown.stderr).toMatch(/nope/u)
    const rootless = await runComposition(['--agent', 'minimal', 'hello'], { cwd: workspace, home, env: env() })
    expect(rootless.code).not.toBe(0)
    expect(rootless.stderr).toContain('--agents')
  })
})
