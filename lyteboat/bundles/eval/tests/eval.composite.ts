/**
 * The eval composition in process (dsh-base, @lyteboat/host, @lyteboat/eval)
 * over a fixture agent and the scripted model: a real run sends the agent's
 * own cases through dsh's session controller, checks every turn, writes the
 * run, and records the sessions; a replay of that run needs no model and
 * reproduces the same results; a failed check exits 1 and the report says
 * why; compare finds a regression; usage errors exit 2.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LYTEBOAT_EVAL_BUNDLES, bootComposition, type CompositionRun } from '@lyteboat/testing/composition'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'
import { scriptedModelEnv, startScriptedModel, withTitle, type RecordedRequest, type ScriptedModel } from '@lyteboat/testing/scripted-model'

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))
const AGENTS = join(FIXTURES, 'agents')

/**
 * What the caller wrote last. Consecutive human messages share one request
 * message, and dsh appends its runtime context to it.
 */
function latestMessage(request: RecordedRequest): string {
  const users = request.body.messages.filter(message => message.role === 'user' && message.content.some(block => block.type === 'text'))
  const texts = users.at(-1)?.content.filter(block => block.type === 'text').map(block => block.text ?? '') ?? []
  return texts.filter(text => !text.startsWith('Current runtime context.')).at(-1) ?? ''
}

/** The run directory a run's summary line names. */
function runDirOf(run: CompositionRun): string {
  const report = /^lyteboat eval: .*; report: (\S+)\/report\.md$/mu.exec(run.stdout)?.[1]
  if (report === undefined) throw new Error(`no summary line in stdout:\n${run.stdout}\nstderr:\n${run.stderr}`)
  return report
}

describe('lyteboat eval (in process, scripted model)', () => {
  const scratch = createLyteboatScratch('eval')
  let model: ScriptedModel
  let home: string
  let workspace: string
  let realRun: string

  const evalRun = (args: readonly string[], env: Record<string, string>): Promise<CompositionRun> =>
    bootComposition({ bundles: LYTEBOAT_EVAL_BUNDLES, args, cwd: workspace, home, env })

  beforeAll(async () => {
    model = await startScriptedModel(withTitle(request => ({ text: `OK:${latestMessage(request)}` })), { apiKey: 'mock-key' })
    ;({ home, workspace } = scratch.run('eval'))
  })

  afterAll(async () => {
    await model.close()
    scratch.remove()
  })

  it('runs the agent\'s own cases through the session controller, checks every turn, and records the sessions', async () => {
    const run = await evalRun(['--agents', AGENTS, '--agent', 'greeter'], scriptedModelEnv(model))

    expect(run.code, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/^✓ hello \(2 turns\)\n✓ short \(1 turn\)\nlyteboat eval: 2\/2 cases passed \(turns 3\/3, checks 10\/10\); report: /u)
    realRun = runDirOf(run)
    const greeter = { id: 'greeter', digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) as string }
    expect(JSON.parse(readFileSync(join(realRun, 'run.json'), 'utf8'))).toMatchObject({ agent: greeter, model: { provider: 'deepseek-official', model: 'deepseek-flash' }, mode: 'real', cases: [{ id: 'hello', pass: true }, { id: 'short', pass: true }] })
    // Every recorded human message names the agent it went to.
    const recorded = readFileSync(join(realRun, 'sessions', 'hello', 'session.v4.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type?: string; data?: { source?: { lyteboatRequest?: { agent?: unknown } } } })
    expect(recorded.filter(line => line.type === 'user/message').map(line => line.data?.source?.lyteboatRequest?.agent)).toEqual([greeter, greeter])
    const results = readFileSync(join(realRun, 'results.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { case: string; turn: number; observed: unknown })
    expect(results.map(result => [result.case, result.turn, result.observed])).toEqual([
      ['hello', 1, { skill: null, tools: [], cards: [], outcome: 'completed', text: 'OK:hello', modelRequests: 1 }],
      ['hello', 2, { skill: null, tools: [], cards: [], outcome: 'completed', text: 'OK:again', modelRequests: 1 }],
      ['short', 1, { skill: null, tools: [], cards: [], outcome: 'completed', text: 'OK:bye', modelRequests: 1 }],
    ])
    expect(existsSync(join(realRun, 'sessions', 'hello', 'session.v4.jsonl'))).toBe(true)
    expect(readFileSync(join(realRun, 'report.md'), 'utf8')).toContain('# Eval greeter: 2/2 cases passed')
  })

  it('replays the recorded run without a model into the same results', async () => {
    const before = model.requests.length

    const run = await evalRun(['--agents', AGENTS, '--agent', 'greeter', '--model', 'replay', '--from', realRun], { DSH_TELEMETRY_DISABLED: '1' })

    expect(run.code, run.stderr).toBe(0)
    expect(model.requests.length).toBe(before)
    expect(readFileSync(join(runDirOf(run), 'results.jsonl'), 'utf8')).toBe(readFileSync(join(realRun, 'results.jsonl'), 'utf8'))
    const replayed = JSON.parse(readFileSync(join(runDirOf(run), 'run.json'), 'utf8')) as Record<string, unknown>
    expect(replayed).toMatchObject({ mode: 'replay', from: realRun })
    // A replay's answers are recordings: it names no model.
    expect(replayed).not.toHaveProperty('model')
  })

  it('exits 1 when a check fails, and the report says what was expected and what the turn showed', async () => {
    const run = await evalRun(['--agents', AGENTS, '--agent', 'greeter', '--cases', join(FIXTURES, 'cases', 'failing.yml')], scriptedModelEnv(model))

    expect(run.code, run.stderr).toBe(1)
    expect(run.stdout).toContain('✗ expects-too-much: turn 1 cards.count, text.includes\n')
    expect(readFileSync(join(runDirOf(run), 'report.md'), 'utf8')).toContain('- `cards.count`: expected 1, got 0\n- `text.includes`: expected ["something the model never says"], got "OK:hello"\n')
  })

  it('compares two runs: none changed, then a regression', async () => {
    const same = await evalRun(['compare', realRun, realRun], {})
    const worse = mkdtempSync(join(scratch.root, 'worse-'))
    cpSync(realRun, worse, { recursive: true })
    const results = readFileSync(join(worse, 'results.jsonl'), 'utf8')
    writeFileSync(join(worse, 'results.jsonl'), results.replace('"check":"outcome","expected":"completed","actual":"completed","pass":true', '"check":"outcome","expected":"completed","actual":"errored","pass":false'))

    const regressed = await evalRun(['compare', realRun, worse], {})

    expect(same.code, same.stderr).toBe(0)
    expect(same.stdout).toBe('lyteboat eval compare: 0 changes, 0 regressions\n')
    expect(regressed.code).toBe(1)
    expect(regressed.stdout).toBe('✗ hello turn 1 outcome: pass → fail\nlyteboat eval compare: 1 change, 1 regression\n')
  })

  it('refuses a replay without a recorded run, and a run without an agent, as usage errors', async () => {
    const replay = await evalRun(['--agents', AGENTS, '--agent', 'greeter', '--model', 'replay'], {})
    const noAgent = await evalRun(['--agents', AGENTS], {})

    expect(replay.code).toBe(2)
    expect(replay.stderr).toContain('error: --model replay needs --from, the recorded run to play back')
    expect(noAgent.code).toBe(2)
    expect(noAgent.stderr).toContain('error: --agent is required')
  })
})
