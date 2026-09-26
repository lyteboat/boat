/**
 * The Studio's eval jobs across a restart: a job still running when the
 * Studio starts is interrupted, keeping the cases its output shows finished,
 * and its run shows the result its process went on to write; a job file cut
 * short is skipped.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EvalRunListing } from '@lyteboat/eval-runner/records'
import { StudioEvalJobs, type StudioEvalJob } from '../src/studio-eval-jobs.ts'
import { studioEvalRunOf } from '../src/studio-eval-runs.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-eval-jobs-'))
  dirs.push(dir)
  return dir
}

const RUNNING: StudioEvalJob = {
  runId: '20260926T000000Z-abcd', agentId: 'alpha', mode: 'real', startedAt: 1_000, startedBy: 'root', pid: 999_999,
  status: 'running', casesTotal: 2, casesDone: 0, casesPassed: 0,
}

describe('the Studio\'s eval jobs', () => {
  it('marks a job still running when the Studio starts as interrupted, with the cases its output shows finished, and skips a torn file', () => {
    const studioDir = scratch()
    mkdirSync(join(studioDir, 'eval-jobs'))
    writeFileSync(join(studioDir, 'eval-jobs', `${RUNNING.runId}.json`), JSON.stringify(RUNNING))
    writeFileSync(join(studioDir, 'eval-jobs', `${RUNNING.runId}.log`), '✓ first (1 turn)\n')
    writeFileSync(join(studioDir, 'eval-jobs', 'torn.json'), '{"runId":')
    const warnings: string[] = []

    const jobs = new StudioEvalJobs(studioDir, undefined, message => warnings.push(message))

    expect(jobs.list()).toEqual([{ ...RUNNING, status: 'interrupted', casesDone: 1, casesPassed: 1 }])
    expect(warnings).toEqual([])
    expect(jobs.get('../escape')).toBeUndefined()
  })

  it('shows an interrupted job\'s run by the result its process wrote, and as interrupted until it does', () => {
    const job: StudioEvalJob = { ...RUNNING, status: 'interrupted', casesDone: 1, casesPassed: 1 }
    const written: EvalRunListing = {
      runId: job.runId, dir: '/evals/x', modifiedAt: 2_000,
      record: {
        agent: { id: 'alpha', digest: `sha256:${'0'.repeat(64)}` }, mode: 'real', cases: [{ id: 'first', pass: true }, { id: 'second', pass: false }],
        turns: { total: 2, passed: 1 }, checks: { total: 2, passed: 1 }, startedAt: '2026-09-26T00:00:00.000Z', durationMs: 5,
      },
    }

    expect(studioEvalRunOf(job.runId, undefined, job)).toMatchObject({ status: 'interrupted', cases: { total: 2, done: 1 } })
    expect(studioEvalRunOf(job.runId, written, job)).toMatchObject({ status: 'failed', startedBy: 'root', cases: { total: 2, passed: 1, done: 2 } })
    expect(studioEvalRunOf(job.runId, { runId: job.runId, dir: '/evals/x', modifiedAt: 2_000 }, undefined).status).toBe('incomplete')
  })
})
