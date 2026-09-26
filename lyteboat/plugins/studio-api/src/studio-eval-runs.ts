/**
 * An eval run as the Studio shows it, from what is on disk (the run
 * directory's `run.json` and `results.jsonl`) and the Studio job that started
 * it, if one did: its state (running while its job's process lives; a written
 * run is passed or failed by its cases, unless its job ended otherwise; an
 * unwritten one is its job's state, or `incomplete`), its cases with their turns, and two runs compared case by
 * case the way the original Studio's comparison shows them.
 * @module @lyteboat/studio-api/studio-eval-runs
 */

import { basename } from 'node:path'
import type { StudioEvalCaseResult, StudioEvalCompareAnswer, StudioEvalCompareCase, StudioEvalCompareStatus, StudioEvalRun } from '@lyteboat/contracts/studio'
import type { EvalRunListing, EvalTurnResult } from '@lyteboat/eval-runner/records'
import type { StudioEvalJob } from './studio-eval-jobs.ts'

/**
 * A run's state: running while its process lives (it writes run.json a moment
 * before it exits, and until then the agent's next run is refused); a job that
 * ended keeps how it ended; otherwise a written run is judged by its cases.
 */
function statusOf(listing: EvalRunListing | undefined, job: StudioEvalJob | undefined): StudioEvalRun['status'] {
  if (job?.status === 'running') return 'running'
  const record = listing?.record
  if (record === undefined) return job?.status ?? 'incomplete'
  if (job !== undefined && job.status !== 'interrupted') return job.status
  return record.cases.every(evalCase => evalCase.pass) ? 'passed' : 'failed'
}

/**
 * One run.
 * @param runId - the run's id.
 * @param listing - its directory, if it has one.
 * @param job - the Studio job that started it, if one did.
 */
export function studioEvalRunOf(runId: string, listing: EvalRunListing | undefined, job: StudioEvalJob | undefined): StudioEvalRun {
  const record = listing?.record
  const status = statusOf(listing, job)
  const base = {
    runId,
    agentId: record?.agent.id ?? job?.agentId ?? '',
    status,
    ...job?.caseIds === undefined ? {} : { caseIds: job.caseIds },
    ...job === undefined ? {} : { startedBy: job.startedBy },
    ...job?.error === undefined ? {} : { error: job.error },
  }
  if (record === undefined) {
    return {
      ...base,
      mode: job?.mode ?? 'real',
      ...job?.from === undefined ? {} : { from: job.from },
      startedAt: job?.startedAt ?? listing?.modifiedAt ?? 0,
      cases: { total: job?.casesTotal ?? 0, passed: job?.casesPassed ?? 0, done: job?.casesDone ?? 0 },
    }
  }
  const passed = record.cases.filter(evalCase => evalCase.pass).length
  return {
    ...base,
    mode: record.mode,
    // run.json names the run a replay played back by its directory; the Studio names runs by id.
    ...record.from === undefined ? {} : { from: basename(record.from) },
    startedAt: Date.parse(record.startedAt),
    durationMs: record.durationMs,
    agent: record.agent,
    ...record.model === undefined ? {} : { model: record.model },
    cases: { total: record.cases.length, passed, done: record.cases.length },
    turns: record.turns,
    checks: record.checks,
  }
}

/** A run's results grouped by case, in their order. */
export function studioEvalCasesOf(results: readonly EvalTurnResult[]): StudioEvalCaseResult[] {
  const cases: StudioEvalCaseResult[] = []
  for (const { case: caseId, ...turn } of results) {
    let current = cases.at(-1)
    if (current?.caseId !== caseId) {
      current = { caseId, pass: true, turns: [] }
      cases.push(current)
    }
    current.turns.push(turn)
    current.pass &&= turn.pass
  }
  return cases
}

function failingChecksOf(evalCase: StudioEvalCaseResult | undefined): string[] {
  return [...new Set(evalCase?.turns.flatMap(turn => turn.checks.filter(check => !check.pass).map(check => check.check)) ?? [])]
}

function compareStatusOf(a: boolean | null, b: boolean | null): StudioEvalCompareStatus {
  if (a === null) return 'only_b'
  if (b === null) return 'only_a'
  if (a === b) return a ? 'unchanged_pass' : 'unchanged_fail'
  return b ? 'improved' : 'regressed'
}

function compareCaseOf(caseId: string, a: StudioEvalCaseResult | undefined, b: StudioEvalCaseResult | undefined): StudioEvalCompareCase {
  const aPass = a === undefined ? null : a.pass
  const bPass = b === undefined ? null : b.pass
  const turnCount = Math.max(a?.turns.length ?? 0, b?.turns.length ?? 0)
  const diverged = a === undefined || b === undefined ? -1 : Array.from({ length: turnCount }, (_, index) => index).findIndex(index => a.turns[index]?.pass !== b.turns[index]?.pass)
  return {
    caseId,
    message: (b ?? a)?.turns[0]?.message ?? '',
    turnCount,
    aPass,
    bPass,
    aPassedTurns: a?.turns.filter(turn => turn.pass).length ?? 0,
    bPassedTurns: b?.turns.filter(turn => turn.pass).length ?? 0,
    divergedAtTurn: diverged + 1,
    status: compareStatusOf(aPass, bPass),
    aFailingChecks: failingChecksOf(a),
    bFailingChecks: failingChecksOf(b),
  }
}

/**
 * Two runs compared case by case, in B's order and then the cases only A ran.
 * @param changes - the checks whose results differ, from eval-runner's comparison.
 */
export function studioEvalCompareOf(a: { run: StudioEvalRun; results: readonly EvalTurnResult[] }, b: { run: StudioEvalRun; results: readonly EvalTurnResult[] }, changes: StudioEvalCompareAnswer['changes']): StudioEvalCompareAnswer {
  const aCases = new Map(studioEvalCasesOf(a.results).map(evalCase => [evalCase.caseId, evalCase]))
  const bCases = new Map(studioEvalCasesOf(b.results).map(evalCase => [evalCase.caseId, evalCase]))
  const ids = [...new Set([...bCases.keys(), ...aCases.keys()])]
  const cases = ids.map(id => compareCaseOf(id, aCases.get(id), bCases.get(id)))
  const count = (status: StudioEvalCompareStatus): number => cases.filter(evalCase => evalCase.status === status).length
  return {
    a: a.run,
    b: b.run,
    cases,
    changes,
    breakdown: {
      improved: count('improved'),
      regressed: count('regressed'),
      unchangedPass: count('unchanged_pass'),
      unchangedFail: count('unchanged_fail'),
      onlyA: count('only_a'),
      onlyB: count('only_b'),
    },
  }
}
