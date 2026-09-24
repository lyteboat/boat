/**
 * @lyteboat/run — lyteboat's one-shot direct Agent driver. The bundle patch rides over
 * dsh-base; this runner creates one Agent through the core registry — composed
 * from an agent preset when the invocation named one — drives the task to
 * quiescence, streams provider reasoning to stderr, flushes its Session,
 * prints the final assistant text to stdout, and exits.
 *
 * Modeled on deepseek-ai/deepseek-harness packages/bundle/headless/src/index.ts
 * @ dsh-v0.1.5-alpha.2 (b2e3b2a0), MIT — see THIRD_PARTY_NOTICES.md. Differences:
 * preset composition (the selected agent directory declared to the preset
 * registry, then joined through `agentPresets.mount` in the setup window), and
 * the `lyteboat:` diagnostic prefix.
 * @module @lyteboat/run
 */

import { randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentSetup, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@lyteboat/history-import'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SeedResult } from '@lyteboat/history-import'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { readAgentDefinition } from './agent-directory.ts'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-run'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'historyImport']

/** Plugin config: the task and preset resolved from the startup provider service. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
  /** The preset to compose the agent from; absent runs the host composition alone. */
  preset?: string
  /** The agent directory the preset is declared from; absent resolves `preset` among the declared presets. */
  agentDir?: string
  /** An external history file (entries grouped into rounds) seeded into the session as closed turns before the task. */
  history?: string
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
  preset: z.string(),
  agentDir: z.string(),
  history: z.string(),
})

interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

interface RunIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: RunIo['stdout']; stderr: RunIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(session: Session, firstSeq: SessionLogOffset): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) {
      throw new Error(`lyteboat run summary cannot read seq ${String(seq)} below captured length ${String(length)}`)
    }
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Project provider-reported reasoning from one owned run to stderr as it streams. */
function streamReasoning(ctx: Context, agent: Agent, stderr: RunIo['stderr']): () => void {
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return
    if (frame.type === 'start' || frame.type === 'end') {
      close()
      return
    }
    const chunk = frame.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('lyteboat: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'lyteboat run reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/**
 * Declare one agent directory as a preset for as long as the runner row lives.
 * The directory is the declaration's base URL, so `./lib/x.js` rows and
 * relative paths in row config resolve against it.
 * @param ctx - the runner's context, which owns the declaration.
 * @param id - the agent id.
 * @param dir - the agent directory.
 */
async function declareAgent(ctx: Context, id: string, dir: string): Promise<void> {
  const definition = readAgentDefinition(id, dir)
  // The registry takes the declaration's base URL from its caller's context.
  const presets = ctx.extend({ baseUrl: pathToFileURL(join(dir, sep)).href }).get('agentPresets')
  if (presets === undefined) throw new Error(`agent ${JSON.stringify(id)} requested but no preset registry is composed`)
  await ctx.effect(() => presets.register(definition), 'lyteboat-run.declareAgent()')
}

function fail(io: RunIo, error: unknown): void {
  io.stderr.write(`lyteboat: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - the task and optional preset.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: RunIo): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const historyImport = ctx.get('historyImport')
  if (agents === undefined || defaultModel === undefined || sessions === undefined || historyImport === undefined) return

  const selection = defaultModel.currentSelection()
  const presets = ctx.get('agentPresets')
  let agentPreset: string | undefined
  if (config.preset !== undefined) {
    if (presets === undefined) throw new Error(`preset ${JSON.stringify(config.preset)} requested but no preset registry is composed`)
    if (config.agentDir !== undefined) await declareAgent(ctx, config.preset, config.agentDir)
    agentPreset = (await presets.resolve(config.preset)).id
  }
  const setup: AgentSetup = async (agentCtx) => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
    if (agentPreset !== undefined && presets !== undefined) await presets.mount(agentCtx, agentPreset)
  }
  // History arrives as a seed: closed turns the driver counts from, so the task
  // becomes turn N+1 and the first request already derives the imported rounds.
  let seed: SeedResult | undefined
  if (config.history !== undefined) {
    const history = historyImport.readFile(config.history)
    seed = historyImport.seed(history.rounds)
    io.stderr.write(`lyteboat: imported ${String(seed.imported.length)} history round(s) from ${history.source}\n`)
  }
  const seeded = seed !== undefined && seed.events.length > 0
  const { agent } = await agents.create({
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
    meta: { cwd: process.cwd(), ...agentPreset === undefined ? {} : { agentPreset }, ...seeded ? { isSeeded: true } : {} },
    ...seeded && seed !== undefined ? { seed: seed.events, inheritedEventCount: SessionLogOffset(seed.events.length) } : {},
    agentOptions: { provider: selection.provider, model: selection.model },
    setup,
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const stopReasoning = streamReasoning(ctx, agent, io.stderr)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopReasoning()
  }
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`lyteboat: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('lyteboat-run: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: RunIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
