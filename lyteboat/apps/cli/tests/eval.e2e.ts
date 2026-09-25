/**
 * `lyteboat eval` on the built launcher: a real run of the agent's own cases
 * against the scripted model, then a replay of that run with no model and no
 * key, which reproduces its results.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLyteboatScratch } from '@lyteboat/testing/scratch'
import { scriptedModelEnv, startScriptedModel, withTitle, type ScriptedModel } from '@lyteboat/testing/scripted-model'
import { runLyteboat } from './support/lyteboat-process.ts'

const AGENTS = fileURLToPath(new URL('./fixtures/agents', import.meta.url))

const runDirOf = (stdout: string): string => /; report: (\S+)\/report\.md$/mu.exec(stdout)?.[1] ?? ''

describe('lyteboat eval (built bin, scripted model)', () => {
  const scratch = createLyteboatScratch('eval-smoke')
  let model: ScriptedModel

  beforeAll(async () => {
    model = await startScriptedModel(withTitle(() => ({ text: 'SMOKE-OK' })), { apiKey: 'mock-key' })
  })

  afterAll(async () => {
    await model.close()
    scratch.remove()
  })

  it('records a run against the model, then replays it without one into the same results', async () => {
    const { home, workspace } = scratch.run('eval')
    const real = await runLyteboat(['eval', '--agents', AGENTS, '--agent', 'echo'], { cwd: workspace, env: { LYTEBOAT_HOME: home, ...scriptedModelEnv(model) } })
    expect(real.code, real.stderr).toBe(0)
    const before = model.requests.length

    const replay = await runLyteboat(['eval', '--agents', AGENTS, '--agent', 'echo', '--model', 'replay', '--from', runDirOf(real.stdout)], {
      cwd: workspace,
      env: { LYTEBOAT_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: undefined, DEEPSEEK_BASE_URL: undefined },
    })

    expect(real.stdout).toMatch(/^✓ smoke \(1 turn\)\nlyteboat eval: 1\/1 cases passed/u)
    expect(replay.code, replay.stderr).toBe(0)
    expect(model.requests.length).toBe(before)
    expect(readFileSync(join(runDirOf(replay.stdout), 'results.jsonl'), 'utf8')).toBe(readFileSync(join(runDirOf(real.stdout), 'results.jsonl'), 'utf8'))
  })
})
