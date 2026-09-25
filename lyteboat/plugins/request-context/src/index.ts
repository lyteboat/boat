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
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { JsonValue, LyteboatRequest } from '@lyteboat/contracts'
import { lyteboatRequestOf, lyteboatRequestProjectionDefinition } from './request-projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    requestContext: RequestContextService
  }
}

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

  /**
   * The request a message carries, beside `kind: 'user'` on its source.
   * @throws when the carried request fails the contract's schema.
   */
  requestOf(message: UserMessage): LyteboatRequest | undefined {
    return lyteboatRequestOf(message.source)
  }

  /** The session's request context: the latest a request carried, empty before any. */
  contextOf(agent: Agent): { [key: string]: JsonValue } {
    return this.ctx.sessionProjections.stateOf(agent.session, 'lyteboatRequest')?.context ?? {}
  }
}

export default RequestContextService
