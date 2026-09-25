import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pluginFileRow } from '@lyteboat/testing/composition'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { reopenRefusal } from '@lyteboat/testing/session-reopen'
import { FIXTURES, headlessComposition } from './support/headless-composition.ts'
import { scriptedModelEnv, startScriptedModel, withTitle, type RecordedRequest } from '@lyteboat/testing/scripted-model'

const PLUGIN = join(FIXTURES, 'plugins', 'tools.mjs')
const AGENTS = join(FIXTURES, 'agents')
const ANSWER = 'TOOL-POLICY-OK'

/** One tool call on the first loop request, the answer once a tool result is in the transcript. */
function callThenAnswer(name: string, args: unknown) {
  return withTitle((request: RecordedRequest) => request.body.messages.some(message => message.content.some(block => block.type === 'tool_result'))
    ? { text: ANSWER }
    : { toolCall: { name, arguments: args, id: `call-${name}` } })
}

describe('@lyteboat/tool-policy in the headless composition (in process, scripted model)', () => {
  const scratch = createLyteboatScratch('tool-policy')

  afterAll(() => {
    scratch.remove()
  })

  it('shows always tools, hides unactivated auto tools, and folds a state delta into the next request', async () => {
    const model = await startScriptedModel(callThenAnswer('lookup_assets', {}), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = scratch.run('state')
      const result = await headlessComposition(['查一下资产'], { cwd: workspace, home, env: scriptedModelEnv(model) }, [pluginFileRow(PLUGIN)])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(ANSWER)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      const first = loop[0]!.toolNames
      expect(first).toContain('lookup_assets')
      expect(first).toContain('bash')
      expect(first).not.toContain('rebalance')
      expect(JSON.stringify(loop[0]!.body.messages)).not.toContain('Session state')
      const second = JSON.stringify(loop[1]!.body.messages)
      expect(second).toContain('Session state, accumulated from tool results')
      expect(second).toContain('1234')
      const [log] = findSessionLogs(home)
      const records = readSessionLog(log!) as { type: string; data?: Record<string, unknown> }[]
      expect(records.map(record => record.type).filter(type => type.startsWith('lyteboat/'))).toEqual([])
      const toolResult = records.find(record => record.type === 'tool/result')
      expect(toolResult?.data?.['meta']).toEqual({ lyteboat: { stateDelta: { 'assets.total': 1234, 'assets.currency': 'CNY' } } })
      expect(records.map(record => record.type)).not.toContain('approval/asked')
      // The delta rides tool/result.meta, a dsh envelope, so dsh's persistence reopens the log.
      expect(reopenRefusal(records)).toBeUndefined()
    } finally {
      await model.close()
    }
  })

  it('activates an auto tool from lyteboat/pre-assemble for the same step and denies its confirmation without an answerer', async () => {
    const model = await startScriptedModel(callThenAnswer('rebalance', { target: '股债均衡' }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = scratch.run('confirm')
      const result = await headlessComposition(['帮我调仓'], { cwd: workspace, home, env: scriptedModelEnv(model) }, [pluginFileRow(PLUGIN)])
      expect(result.code, result.stderr).toBe(0)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      expect(loop[0]!.toolNames).toContain('rebalance')
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
      expect(JSON.stringify(toolResult)).not.toContain('stateDelta')
    } finally {
      await model.close()
    }
  })

  it('applies a preset\'s declared policy to the official tools it inherits', async () => {
    const model = await startScriptedModel(callThenAnswer('bash', { command: 'echo hi' }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = scratch.run('preset')
      const result = await headlessComposition(
        ['--agents', AGENTS, '--agent', 'policy', 'list the files'],
        { cwd: workspace, home, env: scriptedModelEnv(model) },
      )
      expect(result.code, result.stderr).toBe(0)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(2)
      expect(loop[0]!.systemText).toContain('POLICY-PRESET-PERSONA')
      const first = loop[0]!.toolNames
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
