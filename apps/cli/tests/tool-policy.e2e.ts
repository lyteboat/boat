import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSessionLogs, readSessionLog } from '../../../scripts/session-log.ts'
import { runBoat } from './support/boat-process.ts'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from './support/scripted-model.ts'

const PLUGIN = fileURLToPath(new URL('../../../examples/tools/plugin.mjs', import.meta.url))
const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))
const ANSWER = 'TOOL-POLICY-OK'

/** One tool call on the first loop request, the answer once a tool result is in the transcript. */
function callThenAnswer(name: string, args: unknown) {
  return withTitle((request: RecordedRequest) => request.body.messages.some(message => message.role === 'tool')
    ? { text: ANSWER }
    : { toolCall: { name, arguments: args, id: `call-${name}` } })
}

function toolNames(request: RecordedRequest): string[] {
  return (request.body.tools ?? []).map(tool => tool.function?.name ?? '')
}

describe('@boat/tool-policy under boat run --driver boat (built bin, scripted model)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'boat-tool-policy-'))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# tool policy\n')
    return { home, workspace }
  }

  function env(home: string, model: ScriptedModel): Record<string, string> {
    return { BOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('shows always tools, hides unactivated auto tools, and folds a state delta into the next request', async () => {
    const model = await startScriptedModel(callThenAnswer('lookup_assets', {}), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('state')
      const result = await runBoat(['run', '--driver', 'boat', '--plugin', PLUGIN, '查一下资产'], { cwd: workspace, env: env(home, model) })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(ANSWER)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      const first = toolNames(loop[0]!)
      expect(first).toContain('lookup_assets')
      expect(first).toContain('bash')
      expect(first).not.toContain('rebalance')
      expect(JSON.stringify(loop[0]!.body.messages)).not.toContain('Session state')
      const second = JSON.stringify(loop[1]!.body.messages)
      expect(second).toContain('Session state, accumulated from tool results')
      expect(second).toContain('1234')
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as { type: string; data?: Record<string, unknown> }[]
      const state = records.find(record => record.type === 'boat/state')
      expect(state?.data).toEqual({ callId: 'call-lookup_assets', delta: { 'assets.total': 1234, 'assets.currency': 'CNY' } })
      const toolResult = records.find(record => record.type === 'tool/result')
      expect(toolResult?.data?.['meta']).toEqual({ boat: { stateDelta: { 'assets.total': 1234, 'assets.currency': 'CNY' } } })
      expect(records.map(record => record.type)).not.toContain('approval/asked')
    } finally {
      await model.close()
    }
  })

  it('activates an auto tool from boat/pre-assemble for the same step and denies its confirmation without an answerer', async () => {
    const model = await startScriptedModel(callThenAnswer('rebalance', { target: '股债均衡' }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('confirm')
      const result = await runBoat(['run', '--driver', 'boat', '--plugin', PLUGIN, '帮我调仓'], { cwd: workspace, env: env(home, model) })
      expect(result.code, result.stderr).toBe(0)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      expect(toolNames(loop[0]!)).toContain('rebalance')
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as { type: string; data?: Record<string, unknown> }[]
      const types = records.map(record => record.type)
      expect(types).toContain('approval/asked')
      expect(types).toContain('approval/decided')
      const asked = records.find(record => record.type === 'approval/asked')
      expect(asked?.data).toMatchObject({ toolName: 'rebalance', reason: 'tool "rebalance" requires confirmation' })
      const decided = records.find(record => record.type === 'approval/decided')
      expect(decided?.data).toMatchObject({ outcome: 'unavailable' })
      const toolResult = records.find(record => record.type === 'tool/result')
      expect(JSON.stringify(toolResult)).toContain('requires approval, but no approval channel is available')
      expect(types).not.toContain('boat/state')
    } finally {
      await model.close()
    }
  })

  it('applies a preset\'s declared policy to the official tools it inherits', async () => {
    const model = await startScriptedModel(callThenAnswer('bash', { command: 'echo hi' }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('preset')
      const result = await runBoat(
        ['run', '--driver', 'boat', '--agents', AGENTS, '--preset', 'policy', 'list the files'],
        { cwd: workspace, env: env(home, model) },
      )
      expect(result.code, result.stderr).toBe(0)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      expect(loop[0]!.systemText).toContain('POLICY-PRESET-PERSONA')
      const first = toolNames(loop[0]!)
      expect(first).toContain('bash')
      expect(first).not.toContain('todo_write')
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as { type: string; data?: Record<string, unknown> }[]
      const asked = records.find(record => record.type === 'approval/asked')
      expect(asked?.data).toMatchObject({ toolName: 'bash' })
      expect(records.find(record => record.type === 'approval/decided')?.data).toMatchObject({ outcome: 'unavailable' })
    } finally {
      await model.close()
    }
  })
})
