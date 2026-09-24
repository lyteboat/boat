/**
 * The built launcher boots the demo agent from `--agents ./agents`: the one
 * bin-level smoke over an agent directory. Behavior of the agent itself is
 * agents/demo's composition test; this proves the installation closure, the
 * profile, and the agent directory load together from the published artifact.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eventTypes, findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'
import { runLyteboat } from './support/lyteboat-process.ts'

const AGENTS = fileURLToPath(new URL('../../../agents', import.meta.url))

function script(request: RecordedRequest) {
  if (request.purpose === 'router') return { text: JSON.stringify({ skill_id: 'asset-overview', reason: '观察类' }) }
  const offered = request.toolNames.includes('asset_overview')
  return offered && !request.calledTools.includes('asset_overview') ? { toolCall: { name: 'asset_overview', arguments: {}, id: 'call-overview' } } : { text: 'DEMO-SMOKE-OK' }
}

describe('lyteboat run --agents ./agents --agent demo (built bin, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-demo-smoke-'))
    model = await startScriptedModel(withTitle(script), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('routes, calls the demo tool, renders its card, and answers', async () => {
    const home = join(root, 'home')
    const workspace = mkdtempSync(join(root, 'workspace-'))
    writeFileSync(join(workspace, 'README.md'), '# demo smoke\n')
    const result = await runLyteboat(['run', '--agents', AGENTS, '--agent', 'demo', '看看资产'], {
      cwd: workspace,
      env: { LYTEBOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('DEMO-SMOKE-OK')
    const types = eventTypes(readSessionLog(findSessionLogs(home)[0] ?? ''))
    expect(types).toContain('lyteboat/skill-routed')
    expect(types).toContain('tool/result')
    expect(types.at(-1)).toBe('turn/end')
  })
})
