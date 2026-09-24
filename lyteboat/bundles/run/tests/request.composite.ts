/**
 * The request a task carries: `--context` (inline or a file) rides the human
 * message's source, a continued session keeps it, and an admission function
 * decides before the loop, its verdict and card recorded on the request and its
 * reply printed without a model request.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pluginFileRow } from '@lyteboat/testing/composition'
import { findSessionLogs, readSessionLog } from '@lyteboat/testing/session-log'
import { FIXTURES, runComposition, type RunTarget } from './support/run-composition.ts'
import { startScriptedModel, withTitle, type ScriptedModel } from '@lyteboat/testing/scripted-model'

const ADMISSION = pluginFileRow(join(FIXTURES, 'plugins', 'admission.mjs'))

interface LogRecord { type: string; data?: Record<string, unknown> }

/** The sources of the human messages the stored log holds, in order. */
function humanSources(home: string): unknown[] {
  const records = readSessionLog(findSessionLogs(home)[0] ?? '') as unknown as LogRecord[]
  return records.filter(record => record.type === 'user/message').map(record => record.data?.['source']).filter(source => (source as { kind?: unknown }).kind === 'user')
}

describe('lyteboat run --context and admission (in process, scripted model)', () => {
  let root: string
  let model: ScriptedModel

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'lyteboat-request-'))
    model = await startScriptedModel(withTitle(() => ({ text: 'REQUEST-OK' })), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  function fresh(label: string): RunTarget {
    const home = join(root, `home-${label}`)
    const workspace = join(root, `workspace-${label}`)
    for (const dir of [home, workspace]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) }
    writeFileSync(join(workspace, 'README.md'), '# request\n')
    return { cwd: workspace, home, env: { DEEPSEEK_BASE_URL: `${model.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key', DSH_TELEMETRY_DISABLED: '1' } }
  }

  it('records the context on the human message, and a continued session without one keeps it', async () => {
    const target = fresh('context')
    const file = join(target.cwd, 'context.json')
    writeFileSync(file, JSON.stringify({ customer: 'c-2' }))

    const first = await runComposition(['--context', '{"customer":"c-1","channel":"app"}', 'hello'], target)
    expect(first.code, first.stderr).toBe(0)
    const id = /^lyteboat: session (\S+)$/mu.exec(first.stderr)?.[1] ?? ''
    const second = await runComposition(['--session-id', id, 'again'], target)
    expect(second.code, second.stderr).toBe(0)
    const third = await runComposition(['--session-id', id, '--context', file, 'and again'], target)
    expect(third.code, third.stderr).toBe(0)

    expect(humanSources(target.home)).toEqual([
      { kind: 'user', lyteboatRequest: { context: { customer: 'c-1', channel: 'app' } } },
      { kind: 'user' },
      { kind: 'user', lyteboatRequest: { context: { customer: 'c-2' } } },
    ])
  })

  it('refuses a context that is not a JSON object', async () => {
    const target = fresh('bad-context')
    const result = await runComposition(['--context', '[1, 2]', 'hello'], target)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('--context file not found')
    const inline = await runComposition(['--context', '{"broken"', 'hello'], target)
    expect(inline.code).not.toBe(0)
    expect(inline.stderr).toContain('--context is not JSON')
  })

  it('admits before the loop: a reply verdict and its card are recorded on the request, and printed without a model request', async () => {
    const target = fresh('admission')
    const before = model.requests.length
    const result = await runComposition(['--context', '{"channel":"本渠道"}', '帮我炒股'], target, [ADMISSION])
    expect(result.code, result.stderr).toBe(0)
    expect(model.requests.slice(before).filter(request => request.purpose === 'loop')).toEqual([])
    expect(result.stdout).toBe('[card scope]\n抱歉，本渠道不提供股票买卖建议。\n')
    expect(humanSources(target.home)).toEqual([{
      kind: 'user',
      lyteboatRequest: {
        context: { channel: '本渠道' },
        intake: { by: 'example-admission', decision: 'reply', verdict: 'out_of_scope', text: '抱歉，本渠道不提供股票买卖建议。', cards: [{ surfaceId: 'scope-card', area: 'scope', emission: 'immediate', payload: { rootComponentId: 'root' } }] },
      },
    }])
  })

  it('records a pass verdict and lets the model answer', async () => {
    const target = fresh('admitted')
    const result = await runComposition(['看看我的资产'], target, [ADMISSION])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe('REQUEST-OK\n')
    expect(humanSources(target.home)).toEqual([{ kind: 'user', lyteboatRequest: { intake: { by: 'example-admission', decision: 'pass' } } }])
  })
})
