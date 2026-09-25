/**
 * @lyteboat/request-context — the request a human message answers to: the
 * caller's request id, the request context (who is asking, through which
 * channel, …), and the admission verdict when one ran before the loop. It
 * rides the message's own `source` beside `kind: 'user'`, so dsh reads the
 * message as human input as before and the log keeps the request with the
 * words it came with. One host service, `ctx.requestContext`, writes such a
 * message and reads it back; the `lyteboatRequest` projection keeps the
 * session's context, and a request that carries none keeps the earlier one.
 *
 * The context is logged as the caller passed it and never shown to the model:
 * a tool reads what it needs through `contextOf`. Credentials do not belong in
 * it.
 * @module @lyteboat/request-context
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type MessageSource, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { lyteboatRequestSchema, lyteboatRequestStateSchema } from '@lyteboat/contracts'
import type { JsonValue, LyteboatRequest, LyteboatRequestState } from '@lyteboat/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    requestContext: RequestContextService
  }
}

/**
 * The request a message source carries. The field sits beside `kind: 'user'`
 * (dsh's human-input kind), so it is read as data and validated against the
 * contract's schema; a2ui reads the admission's cards from the same field.
 * @param source - a user message's source.
 * @returns the request; undefined when the source carries none.
 * @throws when the carried request fails its schema.
 */
export function lyteboatRequestOf(source: MessageSource): LyteboatRequest | undefined {
  if (source.kind !== 'user') return undefined
  const carried = (source as { lyteboatRequest?: unknown }).lyteboatRequest
  if (carried === undefined) return undefined
  return lyteboatRequestSchema.parse(carried)
}

export const lyteboatRequestProjectionDefinition = {
  key: 'lyteboatRequest',
  stateSchema: lyteboatRequestStateSchema,
  init: (): LyteboatRequestState => ({ requests: 0, context: {}, intake: null }),
  apply(state: LyteboatRequestState, event) {
    if (event.type !== 'user/message' || event.surfaceOp !== 'append') return state
    let request: LyteboatRequest | undefined
    try {
      request = lyteboatRequestOf(event.data.source)
    } catch (error: unknown) {
      throw new Error(`human message at session seq ${String(event.seq)} carries an invalid source.lyteboatRequest`, { cause: error })
    }
    if (request === undefined) return state
    return { requests: state.requests + 1, context: request.context ?? state.context, intake: request.intake ?? null }
  },
  wire: { viewSchema: lyteboatRequestStateSchema, view: (state: LyteboatRequestState) => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'lyteboatRequest', LyteboatRequestState>

/** Host service: write a human message with its request, and read the session's request state. */
export class RequestContextService extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'requestContext')
    ctx.sessionProjections.register(lyteboatRequestProjectionDefinition)
  }

  /**
   * The human message for one request: the words as a plain user message, the
   * request on its source. A request with nothing to record leaves the source
   * as dsh writes it.
   * @param text - what the person wrote.
   * @param request - the request id, context, and verdict to record.
   */
  message(text: string, request: LyteboatRequest): UserMessage {
    const empty = request.requestId === undefined && request.context === undefined && request.intake === undefined
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: empty ? { kind: 'user' } : { kind: 'user', lyteboatRequest: request },
    })
  }

  /** The request a message carries; see {@link lyteboatRequestOf}. */
  requestOf(message: UserMessage): LyteboatRequest | undefined {
    return lyteboatRequestOf(message.source)
  }

  /** The session's request context: the latest a request carried, empty before any. */
  contextOf(agent: Agent): { [key: string]: JsonValue } {
    return this.ctx.sessionProjections.stateOf(agent.session, 'lyteboatRequest')?.context ?? {}
  }
}

export default RequestContextService
