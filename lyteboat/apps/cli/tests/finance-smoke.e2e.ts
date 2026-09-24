/**
 * The built launcher boots the finance agent from `--agents ./agents`. The
 * agent's behavior is agents/finance's own tests; this proves the installation
 * closure, the profile, and the agent directory load together from the built
 * artifact: the request context names the customer, the admission lets the
 * request in, and the routed tool's card is placed after the answer.
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
  if (request.systemText.includes('准入分类器')) return { text: JSON.stringify({ intent: 'asset', reason: '看资产' }) }
  if (request.purpose === 'router') return { text: JSON.stringify({ skill_id: 'asset-overview', reason: '看资产' }) }
  const offered = request.toolNames.includes('asset_overview')
  return offered && !request.calledTools.includes('asset_overview') ? { toolCall: { name: 'asset_overview', arguments: {}, id: 'call-overview' } } : { text: 'FINANCE-SMOKE-OK' }
}

describe('lyteboat run --agents ./agents --agent finance (built bin, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-finance-smoke-'))
    model = await startScriptedModel(withTitle(script), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('routes, calls the overview tool, renders its card, and answers', async () => {
    const home = join(root, 'home')
    const workspace = mkdtempSync(join(root, 'workspace-'))
    writeFileSync(join(workspace, 'README.md'), '# finance smoke\n')
    const result = await runLyteboat(['run', '--agents', AGENTS, '--agent', 'finance', '--context', '{"customer":"young-idle-cash"}', '看看我的资产'], {
      cwd: workspace,
      env: { LYTEBOAT_HOME: home, DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.code, result.stderr).toBe(0)
    // The answer wrote no marker, so the deferred card follows it.
    expect(result.stdout).toBe('FINANCE-SMOKE-OK\n[card asset_overview]\n')
    const records = readSessionLog(findSessionLogs(home)[0] ?? '')
    expect(eventTypes(records)).toContain('tool/result')
    expect(JSON.stringify(records)).toContain('"surfaceId":"asset_overview-')
    expect(eventTypes(records).at(-1)).toBe('turn/end')
  })
})
