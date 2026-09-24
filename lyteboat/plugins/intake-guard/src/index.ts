/**
 * @lyteboat/intake-guard — admission ahead of the loop. An agent registers an
 * admission function in its own scope. The caller (`lyteboat run`, later a
 * server) asks `ctx.intakeGuard.admit` before it follows a request up and
 * records the verdict on the request's human message
 * (`@lyteboat/request-context`), where the log keeps it with the words it
 * judged, cards included. In the loop, the `lyteboat/intake` listener answers
 * a recorded `reply` verdict with its text and no model request. A message
 * that arrives unadmitted (a client that does not admit first) is admitted in
 * the loop instead: the reply is the same, but its verdict and cards are not
 * recorded.
 * @module @lyteboat/intake-guard
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { AnonymousEntries, ScopedLayers, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { IntakeDecision, JsonValue, LyteboatIntakeVerdict, LyteboatStepPayload } from '@lyteboat/contracts'
import type {} from '@lyteboat/request-context'

declare module '@deepseek-ai/cordis' {
  interface Context {
    intakeGuard: IntakeGuardService
  }
}

/** What an admission function sees of one request. */
export interface LyteboatAdmissionInput {
  agent: Agent
  /** What the person wrote. */
  text: string
  /** The request context in force: the request's own, or the session's earlier one. */
  context: { [key: string]: JsonValue }
  signal: AbortSignal
}

/** An agent's admission function. */
export interface LyteboatAdmission {
  /** Recorded as the verdict's `by`, and as the author of its reply. */
  name: string
  admit(input: LyteboatAdmissionInput): Promise<Omit<LyteboatIntakeVerdict, 'by'>>
}

class AdmissionLayer implements ScopeLayer {
  readonly entries = new AnonymousEntries<LyteboatAdmission>()

  isEmpty(): boolean {
    return this.entries.isEmpty()
  }
}

function textOf(message: UserMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Host service: the admission registry, the pre-loop admission call, and the in-loop reply. */
export class IntakeGuardService extends Service {
  // lyteboatDistro: the in-loop reply rides the kernel extension agent-loop-intake.
  static inject = ['requestContext', 'lyteboatDistro']

  private readonly layers = new ScopedLayers(() => new AdmissionLayer(), () => {})

  constructor(ctx: Context) {
    super(ctx, 'intakeGuard')
    // After `next()`: a gate registered after this one decides first, and a
    // reply it made stands; admission only runs on a step that would pass.
    ctx.on('lyteboat/intake', async (payload, next): Promise<IntakeDecision> => {
      const decision = await next()
      if (decision.kind === 'reply' || payload.step !== 1) return decision
      const verdict = await this.verdictFor(payload)
      if (verdict?.decision !== 'reply') return decision
      return { kind: 'reply', plugin: verdict.by, content: [{ type: 'text', text: verdict.text ?? '' }] }
    })
  }

  /**
   * Register an admission function in the calling scope (an agent's standing
   * scope): the agents joined to it are admitted by it. Nearest scope wins.
   * @returns the exact disposer that withdraws it.
   */
  register(admission: LyteboatAdmission): () => void {
    return this.layers.effect(
      this.ctx,
      layer => layer.entries.append(admission),
      { label: 'intakeGuard.register()', notify: false },
    )
  }

  /** The admission function one agent answers to: the nearest registered on its chain, the host's last. */
  admissionFor(agent: Agent): LyteboatAdmission | undefined {
    let nearest: LyteboatAdmission | undefined
    for (const layer of [this.layers.global, ...this.layers.chainLayers(scopeOf(agent.ctx))]) {
      for (const admission of layer.entries.values()) nearest = admission
    }
    return nearest
  }

  /**
   * Admit one request before it enters the loop.
   * @param agent - the agent the request goes to.
   * @param request - what the person wrote, and the context in force.
   * @param signal - the caller's signal.
   * @returns the verdict to record on the request, or undefined when the agent admits everything.
   */
  async admit(agent: Agent, request: { text: string; context: { [key: string]: JsonValue } }, signal: AbortSignal): Promise<LyteboatIntakeVerdict | undefined> {
    const admission = this.admissionFor(agent)
    if (admission === undefined) return undefined
    const verdict = await admission.admit({ agent, text: request.text, context: request.context, signal })
    signal.throwIfAborted()
    return { ...verdict, by: admission.name }
  }

  /** The verdict a step's human message carries, or one made now for a message that arrived without it. */
  private async verdictFor(payload: LyteboatStepPayload): Promise<LyteboatIntakeVerdict | undefined> {
    const human = payload.messages.findLast(message => message.source.kind === 'user')
    if (human === undefined) return undefined
    const request = this.ctx.requestContext.requestOf(human)
    if (request?.intake !== undefined) return request.intake
    const context = request?.context ?? this.ctx.requestContext.contextOf(payload.agent)
    return this.admit(payload.agent, { text: textOf(human), context }, payload.signal)
  }
}

export default IntakeGuardService
