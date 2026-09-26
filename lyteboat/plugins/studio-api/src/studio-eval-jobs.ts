/**
 * The eval runs the Studio starts. Each is a `lyteboat eval` process, the
 * launcher's bin under this Node with `--run-id`, detached in a process group
 * of its own so a Studio that restarts does not take it down; its output goes
 * to `<studio dir>/eval-jobs/<run id>.log` and its job to `<run id>.json`: the
 * request, who started it, the process id, the status, the cases finished and
 * passed (the ✓ / ✗ lines the process prints per case), the exit code, and
 * the last error line. One run per agent at a time, two overall. Stopping
 * sends SIGINT to the process group, which the launcher answers by exiting
 * 130 (SIGTERM would exit 0, which reads as a pass); the run is `stopped`. A
 * job still `running` when the Studio starts is `interrupted`; while its
 * process still runs the run (its pid alive, its command line naming the run,
 * read from /proc where the system has one) it reads as running and can be
 * stopped, and the run it writes shows in the run list.
 * @module @lyteboat/studio-api/studio-eval-jobs
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { LYTEBOAT_EVAL_RUN_ID_PATTERN } from '@lyteboat/contracts'
import { StudioApiError } from './studio-api-router.ts'

const MAX_RUNNING = 2
const LAUNCHER_INTERRUPTED_EXIT = 130

/** What a job's process is asked to run. */
export interface StudioEvalJobRequest {
  agentId: string
  mode: 'real' | 'replay'
  /** The run a replay plays back: its id, and its directory for the process. */
  from?: { runId: string; dir: string }
  caseIds?: string[]
  /** How many cases the run holds, known from the agent's case files. */
  casesTotal: number
}

/** A job as its file holds it. */
export interface StudioEvalJob {
  runId: string
  agentId: string
  mode: 'real' | 'replay'
  from?: string
  caseIds?: string[]
  startedAt: number
  startedBy: string
  pid?: number
  status: 'running' | 'passed' | 'failed' | 'error' | 'stopped' | 'interrupted'
  casesTotal: number
  casesDone: number
  casesPassed: number
  exitCode?: number
  stopRequested?: boolean
  error?: string
}

const studioEvalJobSchema: z.ZodType<StudioEvalJob> = z.object({
  runId: z.string().regex(LYTEBOAT_EVAL_RUN_ID_PATTERN),
  agentId: z.string(),
  mode: z.enum(['real', 'replay']),
  from: z.string().exactOptional(),
  caseIds: z.array(z.string()).exactOptional(),
  startedAt: z.number(),
  startedBy: z.string(),
  pid: z.number().exactOptional(),
  status: z.enum(['running', 'passed', 'failed', 'error', 'stopped', 'interrupted']),
  casesTotal: z.number(),
  casesDone: z.number(),
  casesPassed: z.number(),
  exitCode: z.number().exactOptional(),
  stopRequested: z.boolean().exactOptional(),
  error: z.string().exactOptional(),
})

/** How a job's process is started. */
interface StudioEvalCommand {
  /** The launcher's bin (`lyteboat/apps/cli/lib/bin.js` in the repository). */
  bin: string
  agentRoots: readonly string[]
  /** The process's environment: the Studio's own, without its secrets, with its lyteboat home. */
  env: NodeJS.ProcessEnv
}

/** A new run's id, as `lyteboat eval` makes one: its UTC start to the second, and four random hex digits. */
function newStudioRunId(now: number): string {
  return `${new Date(now).toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')}-${randomBytes(2).toString('hex')}`
}

/** The ✓ / ✗ lines a run printed, one per finished case. */
function progressOf(log: string): { done: number; passed: number } {
  const lines = log.split('\n')
  const passed = lines.filter(line => line.startsWith('✓ ')).length
  return { done: passed + lines.filter(line => line.startsWith('✗ ')).length, passed }
}

/** The process's last line that says what went wrong, or its last line. */
function errorLineOf(log: string): string | undefined {
  const lines = log.split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.findLast(line => /error|lyteboat:/iu.test(line)) ?? lines.at(-1)
}

/**
 * Whether an interrupted job's process still runs its run. The command line
 * must name the run, so a pid the system gave to another process since never
 * passes; without /proc nothing can be told, and nothing passes.
 */
function stillRunning(job: StudioEvalJob): boolean {
  if (job.pid === undefined) return false
  let args: string[]
  try {
    args = readFileSync(`/proc/${String(job.pid)}/cmdline`, 'utf8').split('\0')
  } catch {
    // The process is gone, or the system has no /proc to ask.
    return false
  }
  return args.some((arg, index) => arg === '--run-id' && args[index + 1] === job.runId)
}

/** The Studio's eval jobs. */
export class StudioEvalJobs {
  private readonly dir: string
  /** The runs this Studio started, whose exits it hears. */
  private readonly children = new Set<string>()

  /**
   * @param studioDir - the Studio directory; jobs live in its `eval-jobs/`.
   * @param command - how to start a run; undefined when this Studio was not started by the launcher, so it cannot.
   * @param warn - where a job file that does not read is reported.
   */
  constructor(studioDir: string, private readonly command: StudioEvalCommand | undefined, private readonly warn: (message: string) => void) {
    this.dir = join(studioDir, 'eval-jobs')
    for (const job of this.list()) {
      if (job.status === 'running') this.save({ ...this.withProgress(job), status: 'interrupted' })
    }
  }

  /** Every job, its progress read from its output while it runs. */
  list(): StudioEvalJob[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir).filter(name => name.endsWith('.json')).flatMap(name => this.read(name.slice(0, -'.json'.length)) ?? [])
  }

  /** One job, or undefined. */
  get(runId: string): StudioEvalJob | undefined {
    return LYTEBOAT_EVAL_RUN_ID_PATTERN.test(runId) ? this.read(runId) : undefined
  }

  /**
   * Start a run.
   * @throws StudioApiError `conflict` when the agent has a run running, two runs are, or this Studio cannot start one.
   */
  start(request: StudioEvalJobRequest, startedBy: string, now = Date.now()): StudioEvalJob {
    const command = this.command
    if (command === undefined) throw new StudioApiError('conflict', 'this Studio was not started by the lyteboat launcher, so it cannot start an eval process; run lyteboat eval instead')
    const running = this.list().filter(job => job.status === 'running')
    if (running.some(job => job.agentId === request.agentId)) throw new StudioApiError('conflict', `agent ${request.agentId} has an eval run running; stop it or wait for it`)
    if (running.length >= MAX_RUNNING) throw new StudioApiError('conflict', `${String(MAX_RUNNING)} eval runs are running; wait for one to end`)
    const runId = newStudioRunId(now)
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const log = openSync(join(this.dir, `${runId}.log`), 'a', 0o600)
    const args = [command.bin, 'eval', ...command.agentRoots.flatMap(root => ['--agents', root]), '--agent', request.agentId, '--run-id', runId]
    if (request.from !== undefined) args.push('--model', 'replay', '--from', request.from.dir)
    for (const id of request.caseIds ?? []) args.push('--case', id)
    const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], env: command.env })
    closeSync(log)
    this.children.add(runId)
    const job: StudioEvalJob = {
      runId, agentId: request.agentId, mode: request.mode,
      ...request.from === undefined ? {} : { from: request.from.runId },
      ...request.caseIds === undefined ? {} : { caseIds: request.caseIds },
      startedAt: now, startedBy,
      ...child.pid === undefined ? {} : { pid: child.pid },
      status: 'running', casesTotal: request.casesTotal, casesDone: 0, casesPassed: 0,
    }
    this.save(job)
    child.on('exit', (code, signal) => { this.finish(runId, code, signal) })
    child.on('error', (error) => { this.finish(runId, null, null, error.message) })
    // The Studio may stop while the run goes on; its exit is the run's business.
    child.unref()
    return job
  }

  /**
   * Stop a running run.
   * @throws StudioApiError `conflict` when it is not running.
   */
  stop(runId: string): StudioEvalJob {
    const job = this.get(runId)
    if (job === undefined || job.status !== 'running' || job.pid === undefined) throw new StudioApiError('conflict', `eval run ${runId} is not running`)
    try {
      process.kill(-job.pid, 'SIGINT')
    } catch {
      // The process group is gone: its exit handler, or the next read, records how it ended.
    }
    // A run an earlier Studio started has no exit handler here; SIGINT ends it before it writes anything.
    const stopping: StudioEvalJob = this.children.has(runId) ? { ...job, stopRequested: true } : { ...job, stopRequested: true, status: 'stopped' }
    this.save(stopping)
    return stopping
  }

  /** Forget a job and its output. */
  remove(runId: string): void {
    if (!LYTEBOAT_EVAL_RUN_ID_PATTERN.test(runId)) return
    rmSync(join(this.dir, `${runId}.json`), { force: true })
    rmSync(join(this.dir, `${runId}.log`), { force: true })
  }

  private finish(runId: string, code: number | null, signal: NodeJS.Signals | null, spawnError?: string): void {
    this.children.delete(runId)
    const job = this.read(runId)
    if (job === undefined || job.status !== 'running') return
    const log = this.log(runId)
    const { done, passed } = progressOf(log)
    const status: StudioEvalJob['status'] = job.stopRequested === true || code === LAUNCHER_INTERRUPTED_EXIT || signal === 'SIGINT'
      ? 'stopped'
      : code === 0 ? 'passed' : code === 1 ? 'failed' : 'error'
    const error = status === 'error' ? spawnError ?? errorLineOf(log) : undefined
    this.save({ ...job, status, casesDone: done, casesPassed: passed, ...code === null ? {} : { exitCode: code }, ...error === undefined ? {} : { error } })
  }

  private read(runId: string): StudioEvalJob | undefined {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(this.dir, `${runId}.json`), 'utf8'))
    } catch {
      // A job removed while listed, or cut short by a crash mid-write, is none.
      return undefined
    }
    const parsed = studioEvalJobSchema.safeParse(raw)
    if (!parsed.success) {
      this.warn(`lyteboat studio api: eval job ${runId} does not read and is skipped`)
      return undefined
    }
    const job = parsed.data
    if (job.status === 'running') return this.withProgress(job)
    // An interrupted job's process may outlive the Studio that started it; while it runs, so does the run.
    return job.status === 'interrupted' && stillRunning(job) ? { ...this.withProgress(job), status: 'running' } : job
  }

  /** A job with the cases its output shows finished; a finished job keeps the count it ended with. */
  private withProgress(job: StudioEvalJob): StudioEvalJob {
    const { done, passed } = progressOf(this.log(job.runId))
    return { ...job, casesDone: done, casesPassed: passed }
  }

  private log(runId: string): string {
    const file = join(this.dir, `${runId}.log`)
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  private save(job: StudioEvalJob): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    // Written whole through a rename, so a reader never sees half a job.
    const file = join(this.dir, `${job.runId}.json`)
    writeFileSync(`${file}.tmp`, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
}
