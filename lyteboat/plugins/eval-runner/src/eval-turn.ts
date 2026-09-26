/**
 * One eval turn through dsh's session controller, the way `/chat` sends a
 * message: it is queued with its request on the source, the turn that answers
 * it is followed from its `user/message` (matched by the request id as its
 * `rpcId`) to `turn/end`, and the session then shows what the turn did. A
 * turn that does not end within the deadline is cancelled and ends aborted.
 * @module @lyteboat/eval-runner/eval-turn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionSeq, type SessionEvent, type SessionId, type SessionLogOffset, type TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@lyteboat/a2ui'
import { LYTEBOAT_ASSISTANT_PROVIDER, LYTEBOAT_TURN_OUTCOME_OF_REASON, type JsonValue, type LyteboatTurnOutcome } from '@lyteboat/contracts'
import type { EvalObservation } from './eval-check.ts'

/** One message to send. */
interface EvalTurnInput {
  agent: Agent
  sessionId: SessionId
  requestId: string
  text: string
  /** The request on the message's source (`requestContext.sourceFields`). */
  sourceFields: { readonly [key: string]: JsonValue }
  timeoutMs: number
}

/**
 * The outcome of a turn from its `turn/end` reason.
 * @param reason - the reason's kind.
 * @param answeredInLoop - whether the answer came from the admission in the loop.
 */
function turnOutcome(reason: TurnEndReason['kind'], answeredInLoop: boolean): LyteboatTurnOutcome {
  const outcome = LYTEBOAT_TURN_OUTCOME_OF_REASON[reason] ?? 'errored'
  return outcome === 'completed' && answeredInLoop ? 'rejected' : outcome
}

/** The request id a human message's source carries, when the session controller wrote it. */
function rpcIdOf(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const source = event.data.source as { kind: string; rpcId?: unknown }
  return typeof source.rpcId === 'string' ? source.rpcId : undefined
}

/** Resolve with the `turn/end` of the turn that answers `requestId` in `agent`'s session. */
function turnEndOf(ctx: Context, agent: Agent, requestId: string): { ended: Promise<SessionEvent<'turn/end'>>; dispose(): void } {
  let turn: number | undefined
  let turnStart = 0
  let settle: (event: SessionEvent<'turn/end'>) => void = () => {}
  const ended = new Promise<SessionEvent<'turn/end'>>((resolve) => { settle = resolve })
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') turnStart = event.data.turn
    else if (turn === undefined && rpcIdOf(event) === requestId) turn = turnStart
    else if (event.type === 'turn/end' && event.data.turn === turn) settle(event)
  })
  return { ended, dispose }
}

/** What the session shows of the turn that started at `fromSeq`. */
async function observe(ctx: Context, agent: Agent, sessionId: SessionId, fromSeq: SessionLogOffset, end: SessionEvent<'turn/end'>): Promise<EvalObservation> {
  const tools: string[] = []
  let modelRequests = 0
  let answeredInLoop = false
  for (let seq = fromSeq; seq < agent.session.seq; seq++) {
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type === 'assistant/attempt' && event.data.stream.length > 0) modelRequests++
    if (event?.type !== 'assistant/message') continue
    if (event.data.stream.length > 0) modelRequests++
    if (event.data.message.source.provider === LYTEBOAT_ASSISTANT_PROVIDER) answeredInLoop = true
    for (const block of event.data.message.content) if (block.type === 'tool-call') tools.push(block.name)
  }
  const parts = ctx.a2ui.turnParts(agent.session, fromSeq)
  const projections = await ctx.sessionController.projections({ sessionId }, new AbortController().signal)
  // The projection's wire view is the active skill's name, or null.
  const active = projections?.values['lyteboatActiveSkill']
  const skill = typeof active === 'string' ? active : null
  return {
    skill,
    tools,
    cards: parts.flatMap(part => part.kind === 'card' ? [part.card.area] : []),
    outcome: turnOutcome(end.data.reason.kind, answeredInLoop),
    text: parts.map(part => part.kind === 'text' ? part.text : '').join(''),
    modelRequests,
  }
}

/**
 * Send one message and observe the turn that answers it.
 * @param ctx - the eval runner's context: the session controller, a2ui, and the session events.
 * @param input - the agent, the session, the message, and the deadline.
 * @returns what the turn showed.
 */
export async function runEvalTurn(ctx: Context, input: EvalTurnInput): Promise<EvalObservation> {
  const { agent, sessionId, requestId } = input
  const fromSeq = agent.session.seq
  const watch = turnEndOf(ctx, agent, requestId)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await ctx.sessionController.prompt({
      requestId: brandString<SessionRequestId>(requestId),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: input.text }],
      sourceFields: input.sourceFields,
    }, new AbortController().signal)
    timer = setTimeout(() => {
      ctx.logger.warn(`eval-runner: the turn answering ${requestId} did not end within ${String(input.timeoutMs)}ms; cancelling it`)
      try {
        ctx.sessionController.cancel({ sessionId })
      } catch (error: unknown) {
        ctx.logger.warn(`eval-runner: cancelling ${sessionId} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, input.timeoutMs)
    const end = await watch.ended
    return await observe(ctx, agent, sessionId, fromSeq, end)
  } finally {
    clearTimeout(timer)
    watch.dispose()
  }
}
