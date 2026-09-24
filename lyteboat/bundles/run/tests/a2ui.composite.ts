import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pluginFileRow } from '@lyteboat/testing/composition'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'
import { FIXTURES, runComposition } from './support/run-composition.ts'

/** Card fidelity against the reference implementation is plugins/a2ui's job; this fixture only proves the rows are wired. */
const PLUGIN = pluginFileRow(join(FIXTURES, 'plugins', 'a2ui', 'plugin.mjs'))
const ANSWER = 'A2UI-OK'

interface LogRecord { type: string; data?: Record<string, unknown> }

describe('@lyteboat/a2ui in the run composition (in process, scripted model)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-a2ui-'))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): { home: string; workspace: string } {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# a2ui\n')
    return { home, workspace }
  }

  function env(model: ScriptedModel): Record<string, string> {
    return { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' }
  }

  it('renders a card from the state a tool folded in, puts it on tool/result.meta, and shows only the digest to the model', async () => {
    const model = await startScriptedModel(withTitle((request: RecordedRequest) => {
      const calls = request.calledTools
      if (!calls.includes('query_profile')) return { toolCall: { name: 'query_profile', arguments: {}, id: 'call-query' } }
      if (!calls.includes('render_a2ui')) return { toolCall: { name: 'render_a2ui', arguments: { template: 'summary' }, id: 'call-render' } }
      return { text: ANSWER }
    }), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('card')
      const result = await runComposition(['show my profile'], { cwd: workspace, home, env: env(model) }, [PLUGIN])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(ANSWER)
      const loop = model.loopRequests()
      expect(loop).toHaveLength(3)
      expect(loop[0]?.toolNames).toEqual(expect.arrayContaining(['query_profile', 'render_a2ui']))
      const shown = JSON.stringify(loop[2]?.body.messages)
      expect(shown).toContain('[card:summary] profile summary shown')
      expect(shown).not.toContain('rootComponentId')
      const records = readSessionLog(findSessionLogs(home)[0] ?? '') as unknown as LogRecord[]
      const [queried, rendered] = records.filter(record => record.type === 'tool/result')
      expect(queried?.data?.['meta']).toMatchObject({ lyteboat: { stateDelta: { profile: { name: 'Composite Tester' } } } })
      expect(records.map(record => record.type).filter(type => type.startsWith('lyteboat/'))).toEqual([])
      const meta = rendered?.data?.['meta'] as { lyteboat: { card: { surfaceId: string; payload: Record<string, unknown> } }; a2ui: { warnings: string[] } }
      expect(meta.a2ui.warnings).toEqual([])
      expect(meta.lyteboat.card.surfaceId).toMatch(/^summary-/u)
      expect(meta.lyteboat.card.payload['rootComponentId']).toBe('root')
      expect(JSON.stringify(meta.lyteboat.card.payload)).toContain('Composite Tester')
    } finally {
      await model.close()
    }
  })

  it('ends the turn on a terminal card', async () => {
    const model = await startScriptedModel(withTitle(() => ({ toolCall: { name: 'render_a2ui', arguments: { template: 'finish' }, id: 'call-finish' } })), { apiKey: 'mock-key' })
    try {
      const { home, workspace } = fresh('terminal')
      const result = await runComposition(['wrap up'], { cwd: workspace, home, env: env(model) }, [PLUGIN])
      expect(result.code, result.stderr).toBe(0)
      expect(model.loopRequests()).toHaveLength(1)
      const records = readSessionLog(findSessionLogs(home)[0] ?? '') as unknown as LogRecord[]
      const rendered = records.find(record => record.type === 'tool/result')
      const meta = rendered?.data?.['meta'] as { lyteboat: { card: { payload: Record<string, unknown> } } }
      expect(meta.lyteboat.card.payload['rootComponentId']).toBe('root')
      expect(records.filter(record => record.type === 'turn/end').at(-1)?.data?.['reason']).toEqual({ kind: 'completed' })
    } finally {
      await model.close()
    }
  })
})
