/**
 * The eval runs the Evals page shows: the run directories under the evals directory
 * (`$LYTEBOAT_HOME/evals`), newest first, each with its `run.json` summary,
 * and one run's `report.md`. A directory without `run.json` is not a run.
 * @module @lyteboat/studio-pages/eval-runs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvalRunRecord } from '@lyteboat/eval-runner'
import type { StudioEvalRun } from './studio-endpoints.ts'

/** The run ids a request may name: a directory name, never a path. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/**
 * The runs in `evalsDir`, newest first.
 * @param evalsDir - the evals directory; absent: no runs.
 */
export function listEvalRuns(evalsDir: string): StudioEvalRun[] {
  if (!existsSync(evalsDir)) return []
  const runs: StudioEvalRun[] = []
  for (const id of readdirSync(evalsDir)) {
    const file = join(evalsDir, id, 'run.json')
    if (!RUN_ID.test(id) || !existsSync(file)) continue
    // run.json is the eval runner's own output.
    const run = JSON.parse(readFileSync(file, 'utf8')) as EvalRunRecord
    runs.push({ id, agent: run.agent, mode: run.mode, cases: run.cases.length, passedCases: run.cases.filter(evalCase => evalCase.pass).length, startedAt: run.startedAt })
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * One run's report.
 * @throws when the id is not a run's directory name, or the run has no report.
 */
export function readEvalReport(evalsDir: string, id: string): string {
  const file = join(evalsDir, id, 'report.md')
  if (!RUN_ID.test(id) || !existsSync(file)) throw new Error(`no eval run ${JSON.stringify(id)}`)
  return readFileSync(file, 'utf8')
}
