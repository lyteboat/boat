/**
 * @lyteboat/eval-runner — run an agent's eval cases and check what each turn
 * shows. Every case is a new session under the agent, and every turn goes
 * through dsh's session controller as a `/chat` message does, with its
 * request on the source; after the turn ends, the session is read for the
 * active skill, the tools called, the cards shown, the outcome, the answer
 * text, and the loop's model calls, and each expectation of the case is a
 * check. A real run records every case's session; a replay run answers every
 * model call from those recordings, with no provider and no key, so the same
 * recording replays into the same results. The run is written to its
 * directory (`run.json`, `results.jsonl`, `sessions/`, `report.md`).
 * @module @lyteboat/eval-runner
 */

import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-llm'
import type { AgentCatalogEntry } from '@lyteboat/agent-catalog'
import type {} from '@lyteboat/request-context'
import { loadEvalCases, type EvalCase } from './eval-case.ts'
import { checkTurn } from './eval-check.ts'
import { EvalReplay } from './eval-replay.ts'
import { compareEvalResults, readEvalResults, recordedSessionFile, writeEvalRun, writeRecordedSession, type EvalChange, type EvalRunRecord, type EvalTurnResult } from './eval-report.ts'
import { runEvalTurn } from './eval-turn.ts'

export type { EvalCase, EvalExpect, EvalTurn } from './eval-case.ts'
export type { EvalCheck, EvalObservation } from './eval-check.ts'
export type { EvalChange, EvalRunRecord, EvalTurnResult } from './eval-report.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evalRunner: EvalRunnerService
  }
}

export interface Config {
  /** How long a turn may run before it is cancelled. */
  turnTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  turnTimeoutMs: z.natural().default(300_000),
})

/** One eval run. */
export interface EvalRunOptions {
  /** The agent the cases talk to, by catalog id. */
  agentId: string
  /** Case files or directories; none: the agent directory's `evals/`. */
  cases: readonly string[]
  /** `real` calls the model and records the sessions; `replay` answers from the recordings of `from`. */
  mode: 'real' | 'replay'
  /** The run directory whose `sessions/` a replay plays back. */
  from?: string
  /** The directory the run is written to. */
  out: string
  /** Hears each case as it finishes. */
  onCase?: (evalCase: EvalCase, results: readonly EvalTurnResult[]) => void
}

/** The run a replay plays back; a replay without one cannot start. */
function replaySourceOf(options: EvalRunOptions): string {
  if (options.from === undefined) throw new Error('eval-runner: a replay needs the run to play back (from)')
  return options.from
}

/** Host service: run an agent's eval cases, and compare two runs. */
export class EvalRunnerService extends Service {
  static inject = ['sessionController', 'agentCatalog', 'requestContext', 'a2ui', 'llm']
  // The loader applies a class plugin's static Config, not the module's.
  static Config = Config

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'evalRunner')
  }

  /**
   * Run the cases one after another and write the run.
   * @returns what ran and how it went.
   * @throws when the agent is unknown, a case file is invalid, or a replay has no recording of a case.
   */
  async run(options: EvalRunOptions): Promise<{ record: EvalRunRecord; results: EvalTurnResult[] }> {
    await this.ctx.agentCatalog.whenReady()
    const agent = this.ctx.agentCatalog.get(options.agentId)
    if (agent === undefined) throw new Error(`eval-runner: no agent ${JSON.stringify(options.agentId)}`)
    const cases = loadEvalCases(options.cases.length > 0 ? options.cases : [join(agent.dir, 'evals')])
    const startedAt = new Date()
    const replay = options.mode === 'replay' ? new EvalReplay() : undefined
    // A replay answers every call itself: nothing behind it may reach a provider.
    const stopReplay = replay === undefined ? () => {} : this.ctx.on('llm/stream', (generate, _next) => replay.stream(generate))
    const results: EvalTurnResult[] = []
    try {
      for (const evalCase of cases) {
        const caseResults = await this.runCase(evalCase, agent, options, replay)
        results.push(...caseResults)
        options.onCase?.(evalCase, caseResults)
      }
    } finally {
      stopReplay()
    }
    const record: EvalRunRecord = {
      agent: options.agentId,
      mode: options.mode,
      ...options.from === undefined ? {} : { from: options.from },
      cases: cases.map(evalCase => ({ id: evalCase.id, pass: results.filter(result => result.case === evalCase.id).every(result => result.pass) })),
      turns: { total: results.length, passed: results.filter(result => result.pass).length },
      checks: { total: results.flatMap(result => result.checks).length, passed: results.flatMap(result => result.checks).filter(check => check.pass).length },
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    }
    writeEvalRun(options.out, record, results)
    return { record, results }
  }

  /**
   * The checks whose results differ between two runs.
   * @param before - the earlier run's directory.
   * @param after - the later run's directory.
   */
  compare(before: string, after: string): EvalChange[] {
    return compareEvalResults(readEvalResults(before), readEvalResults(after))
  }

  private async runCase(evalCase: EvalCase, agent: AgentCatalogEntry, options: EvalRunOptions, replay: EvalReplay | undefined): Promise<EvalTurnResult[]> {
    const { sessionId } = await this.ctx.sessionController.create({ cwd: agent.workdir, agentPreset: agent.id })
    if (replay !== undefined) replay.bind(sessionId, recordedSessionFile(replaySourceOf(options), evalCase.id))
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new Error(`eval-runner: case ${evalCase.id}: ${resolved.error.message}`)
    const results: EvalTurnResult[] = []
    for (const [index, turn] of evalCase.turns.entries()) {
      const context = turn.context ?? (index === 0 ? evalCase.context : undefined)
      const requestId = `${evalCase.id}-${String(index + 1)}`
      const observed = await runEvalTurn(this.ctx, {
        agent: resolved.agent,
        sessionId,
        requestId,
        text: turn.message,
        sourceFields: this.ctx.requestContext.sourceFields({ requestId, owner: { kind: 'system', id: 'eval' }, ...context === undefined ? {} : { context } }),
        timeoutMs: this.config.turnTimeoutMs ?? 300_000,
      })
      const checks = checkTurn(turn.expect, observed)
      results.push({ case: evalCase.id, turn: index + 1, message: turn.message, observed, checks, pass: checks.every(check => check.pass) })
    }
    if (options.mode === 'real') {
      const inspection = await this.ctx.sessionController.inspect(sessionId)
      writeRecordedSession(recordedSessionFile(options.out, evalCase.id), inspection)
    }
    return results
  }
}

export default EvalRunnerService
