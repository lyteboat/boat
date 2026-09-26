/**
 * The Evals endpoints. Any signed-in role reads: an agent's case files
 * (`agents/:id/evals/cases`), the runs (`evals/runs`, of one agent when
 * asked, newest first), one run with its cases, and two runs compared
 * (`evals/compare`). An editor or admin starts a run (`POST evals/runs`, a
 * `lyteboat eval` process; a replay plays back a real run of the same
 * agent), stops one, and deletes one that is not running; each is audited.
 * @module @lyteboat/studio-api/studio-eval-routes
 */

import { relative, sep } from 'node:path'
import type { AgentCatalogService } from '@lyteboat/agent-catalog'
import { studioEvalRunRequestSchema, type StudioEvalCasesAnswer, type StudioEvalRun, type StudioEvalRunDeleted, type StudioEvalRunDetail, type StudioEvalRunRequest, type StudioEvalRunsAnswer } from '@lyteboat/contracts/studio'
import type { EvalRecordsService, EvalTurnResult } from '@lyteboat/eval-runner/records'
import type { StudioAudit } from './studio-audit.ts'
import { studioCallerOf, studioRequestOf } from './studio-auth-routes.ts'
import { StudioApiError, type StudioApiCall, type StudioApiRoute } from './studio-api-router.ts'
import type { StudioEvalJobRequest, StudioEvalJobs } from './studio-eval-jobs.ts'
import { studioEvalCasesOf, studioEvalCompareOf, studioEvalRunOf } from './studio-eval-runs.ts'
import { settledAgentOf } from './studio-workspace-routes.ts'

/** What the Evals endpoints read and start. */
interface StudioEvalServices {
  catalog: AgentCatalogService
  records: EvalRecordsService
  jobs: StudioEvalJobs
  audit: StudioAudit
}

function runOf(services: StudioEvalServices, runId: string): { run: StudioEvalRun; results: EvalTurnResult[] } {
  const listing = services.records.run(runId)
  const job = services.jobs.get(runId)
  if (listing === undefined && job === undefined) throw new StudioApiError('not_found', `no eval run ${runId}`)
  return { run: studioEvalRunOf(runId, listing, job), results: listing?.results ?? [] }
}

function runs(services: StudioEvalServices, agentId: string | null): StudioEvalRun[] {
  const listings = new Map(services.records.runs().map(listing => [listing.runId, listing]))
  const jobs = new Map(services.jobs.list().map(job => [job.runId, job]))
  return [...new Set([...listings.keys(), ...jobs.keys()])]
    .map(runId => studioEvalRunOf(runId, listings.get(runId), jobs.get(runId)))
    // A directory without run.json or a job names no agent; the list cannot place it.
    .filter(run => run.agentId !== '' && (agentId === null || run.agentId === agentId))
    .sort((a, b) => b.startedAt - a.startedAt || (a.runId < b.runId ? 1 : -1))
}

async function casesAnswer(services: StudioEvalServices, agentId: string): Promise<StudioEvalCasesAnswer> {
  const agent = await settledAgentOf(services.catalog, agentId)
  return {
    files: services.records.cases(agent.dir).map(file => ({
      file: relative(agent.dir, file.file).split(sep).join('/'),
      cases: file.cases,
      ...file.error === undefined ? {} : { error: file.error },
    })),
  }
}

/** A run request checked against the agent, its cases, and the run a replay plays back. */
async function jobRequestOf(services: StudioEvalServices, request: StudioEvalRunRequest): Promise<StudioEvalJobRequest> {
  const agent = await settledAgentOf(services.catalog, request.agentId)
  const files = services.records.cases(agent.dir)
  const broken = files.find(file => file.error !== undefined)
  if (broken?.error !== undefined) throw new StudioApiError('invalid_request', `the agent's case files do not load: ${broken.error}`)
  const ids = files.flatMap(file => file.cases.map(evalCase => evalCase.id))
  if (ids.length === 0) throw new StudioApiError('invalid_request', `agent ${agent.id} has no eval cases under evals/`)
  const unknown = (request.caseIds ?? []).filter(id => !ids.includes(id))
  if (unknown.length > 0) throw new StudioApiError('invalid_request', `agent ${agent.id} has no case ${unknown.join(', ')}`)
  const casesTotal = request.caseIds === undefined ? ids.length : new Set(request.caseIds).size
  if (request.mode === 'real') {
    if (request.from !== undefined) throw new StudioApiError('invalid_request', 'from is for a replay')
    return { agentId: agent.id, mode: 'real', ...request.caseIds === undefined ? {} : { caseIds: request.caseIds }, casesTotal }
  }
  const from = request.from === undefined ? undefined : services.records.run(request.from)
  if (from?.record === undefined || from.record.mode !== 'real' || from.record.agent.id !== agent.id) {
    throw new StudioApiError('invalid_request', `a replay plays back a written real run of agent ${agent.id}; ${request.from ?? 'none'} is not one`)
  }
  return { agentId: agent.id, mode: 'replay', from: { runId: from.runId, dir: from.dir }, ...request.caseIds === undefined ? {} : { caseIds: request.caseIds }, casesTotal }
}

async function startRun(services: StudioEvalServices, call: StudioApiCall): Promise<StudioEvalRun> {
  const request = await jobRequestOf(services, await studioRequestOf(call, studioEvalRunRequestSchema))
  const actor = studioCallerOf(call).userId
  const job = services.jobs.start(request, actor)
  await services.audit.record({ actor, action: 'eval.start', runId: job.runId, agentId: job.agentId, mode: job.mode, ...job.from === undefined ? {} : { from: job.from } })
  return studioEvalRunOf(job.runId, undefined, job)
}

async function stopRun(services: StudioEvalServices, call: StudioApiCall): Promise<StudioEvalRun> {
  const runId = call.params['runId'] ?? ''
  runOf(services, runId)
  const job = services.jobs.stop(runId)
  await services.audit.record({ actor: studioCallerOf(call).userId, action: 'eval.stop', runId, agentId: job.agentId })
  return studioEvalRunOf(runId, services.records.run(runId), job)
}

async function deleteRun(services: StudioEvalServices, call: StudioApiCall): Promise<StudioEvalRunDeleted> {
  const runId = call.params['runId'] ?? ''
  const { run } = runOf(services, runId)
  if (run.status === 'running') throw new StudioApiError('conflict', `eval run ${runId} is running; stop it first`)
  services.records.remove(runId)
  services.jobs.remove(runId)
  await services.audit.record({ actor: studioCallerOf(call).userId, action: 'eval.delete', runId, agentId: run.agentId })
  return { runId }
}

function compare(services: StudioEvalServices, query: URLSearchParams): ReturnType<typeof studioEvalCompareOf> {
  const [a, b] = ['a', 'b'].map((side) => {
    const runId = query.get(side) ?? ''
    if (runId === '') throw new StudioApiError('invalid_request', 'a and b name the two runs to compare')
    const found = runOf(services, runId)
    if (found.results.length === 0) throw new StudioApiError('invalid_request', `eval run ${runId} has no results to compare`)
    return { runId, ...found }
  })
  if (a === undefined || b === undefined) throw new StudioApiError('invalid_request', 'a and b name the two runs to compare')
  return studioEvalCompareOf(a, b, services.records.compare(a.runId, b.runId))
}

/**
 * The routes.
 * @param services - the agent catalog, the eval records, the Studio's eval jobs, and the audit log.
 */
export function studioEvalRoutes(services: StudioEvalServices): StudioApiRoute[] {
  return [
    { method: 'GET', path: 'agents/:id/evals/cases', access: 'viewer', handle: call => casesAnswer(services, call.params['id'] ?? '') },
    { method: 'GET', path: 'evals/runs', access: 'viewer', handle: (call): StudioEvalRunsAnswer => ({ runs: runs(services, call.query.get('agent')) }) },
    { method: 'POST', path: 'evals/runs', access: 'editor', handle: call => startRun(services, call) },
    {
      method: 'GET', path: 'evals/runs/:runId', access: 'viewer',
      handle: (call): StudioEvalRunDetail => {
        const { run, results } = runOf(services, call.params['runId'] ?? '')
        return { run, cases: studioEvalCasesOf(results) }
      },
    },
    { method: 'POST', path: 'evals/runs/:runId/stop', access: 'editor', handle: call => stopRun(services, call) },
    { method: 'DELETE', path: 'evals/runs/:runId', access: 'editor', handle: call => deleteRun(services, call) },
    { method: 'GET', path: 'evals/compare', access: 'viewer', handle: call => compare(services, call.query) },
  ]
}
