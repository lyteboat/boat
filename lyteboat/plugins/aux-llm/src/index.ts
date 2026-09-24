/**
 * @lyteboat/aux-llm — the side model calls a plugin makes for an agent: a
 * routing decision, an intake classification. One host service, `ctx.auxLlm`,
 * sends one prompt under its own deadline and records the call in the agent's
 * session as a `lyteboat/aux-llm-call` record: route, system, prompt, answer
 * or failure, duration. No reader needs the record to rebuild the session, so
 * it is appended ignorable (the kernel extension `session-append-ignorable`)
 * and the official release reads the log past it.
 * @module @lyteboat/aux-llm
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BlockAssembler, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { LYTEBOAT_AUX_LLM_SOURCE } from '@lyteboat/contracts'
import type { LyteboatAuxLlmCallRecord } from '@lyteboat/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    auxLlm: AuxLlmService
  }
}

/** Timeout reason code of one side call. */
export const AUX_LLM_TIMEOUT_CODE = 'LYTEBOAT_AUX_LLM_TIMEOUT'

/** The model a side call goes to. */
export interface AuxLlmRoute {
  provider: string
  model: string
}

/** One side call. */
export interface AuxLlmCall {
  /** The agent the call serves: its session records the call, its model is the default route. */
  agent: Agent
  /** What the call is for (`skill-router`, `intake`, …); the record keeps it. */
  purpose: string
  /** Absent: the agent's own model. */
  route?: AuxLlmRoute
  system: string
  prompt: string
  maxTokens: number
  /** Defaults to 0. */
  temperature?: number
  timeoutMs: number
  /** The caller's signal: its abort propagates; the call's own timeout does not. */
  signal: AbortSignal
}

/** What a side call came back with. A failure is an outcome, not an exception: the caller decides the fallback. */
export type AuxLlmOutcome =
  | { kind: 'answer'; text: string; route: AuxLlmRoute; durationMs: number }
  | { kind: 'failed'; reason: string; message: string; durationMs: number }

function routeOf(agent: Agent): AuxLlmRoute | undefined {
  const { provider, model } = agent.options
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

function recordOf(call: AuxLlmCall, route: AuxLlmRoute, temperature: number, outcome: AuxLlmOutcome): LyteboatAuxLlmCallRecord {
  return {
    purpose: call.purpose,
    route,
    system: call.system,
    prompt: call.prompt,
    maxTokens: call.maxTokens,
    temperature,
    ...outcome.kind === 'answer' ? { output: outcome.text } : { failure: { reason: outcome.reason, message: outcome.message } },
    durationMs: outcome.durationMs,
  }
}

/** Host service: one audited side call at a time per caller. */
export class AuxLlmService extends Service {
  // lyteboatDistro: the record rides the kernel extension session-append-ignorable.
  static inject = ['llm', 'lyteboatDistro']

  constructor(ctx: Context) {
    super(ctx, 'auxLlm')
  }

  /**
   * Send one side call and record it in the agent's session.
   * @param call - the agent, purpose, route, prompt, and limits.
   * @returns the answer, or why there is none (`no-route` is not recorded: nothing was sent).
   * @throws when the caller's signal aborts.
   */
  async generate(call: AuxLlmCall): Promise<AuxLlmOutcome> {
    const route = call.route ?? routeOf(call.agent)
    if (route === undefined) {
      return { kind: 'failed', reason: 'no-route', message: 'no route for the side call: pass one, or give the agent a model', durationMs: 0 }
    }
    const temperature = call.temperature ?? 0
    const started = performance.now()
    let outcome: AuxLlmOutcome
    {
      using callDeadline = deadline(call.signal, call.timeoutMs, AUX_LLM_TIMEOUT_CODE)
      try {
        const text = await this.stream(call, route, temperature, callDeadline.signal)
        outcome = { kind: 'answer', text, route, durationMs: Math.round(performance.now() - started) }
      } catch (error: unknown) {
        call.signal.throwIfAborted()
        const reason = timeoutOf(callDeadline.signal, AUX_LLM_TIMEOUT_CODE) !== undefined ? 'timeout' : error instanceof Error ? error.name : 'error'
        const message = error instanceof Error ? error.message : String(error)
        outcome = { kind: 'failed', reason, message, durationMs: Math.round(performance.now() - started) }
      }
    }
    call.agent.session.append('lyteboat/aux-llm-call', recordOf(call, route, temperature, outcome), { ignorable: true })
    return outcome
  }

  private async stream(call: AuxLlmCall, route: AuxLlmRoute, temperature: number, signal: AbortSignal): Promise<string> {
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: call.prompt }], source: { kind: LYTEBOAT_AUX_LLM_SOURCE } })],
      system: call.system,
      maxTokens: call.maxTokens,
      temperature,
      sessionId: call.agent.session.id,
      signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) {
      signal.throwIfAborted()
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new Error(finish.failure.message)
    return assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
  }
}

export default AuxLlmService
