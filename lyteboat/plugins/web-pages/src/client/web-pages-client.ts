/**
 * The pages' calls to the Host face, through dsh's own browser transport:
 * `connection.rpc.call('/api', 'lyteboat/<endpoint>', payload)`, which carries
 * the login and the trust fence every dsh web request does.
 * @module @lyteboat/web-pages/client/web-pages-client
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  WEB_PAGES_METHOD_PREFIX,
  type WebPagesAgentsAnswer, type WebPagesEvalReportAnswer, type WebPagesEvalsAnswer, type WebPagesEndpoint, type WebPagesSendAnswer, type WebPagesSendRequest,
} from '../web-pages-endpoints.ts'

/** The Host face's endpoints as the pages call them; a refusal rejects with its message. */
export interface WebPagesClient {
  agents(): Promise<WebPagesAgentsAnswer>
  reloadAgents(): Promise<WebPagesAgentsAnswer>
  send(request: WebPagesSendRequest): Promise<WebPagesSendAnswer>
  evals(): Promise<WebPagesEvalsAnswer>
  evalReport(run: string): Promise<WebPagesEvalReportAnswer>
}

/**
 * Bind the endpoints to the page's connection.
 * @param connection - dsh's browser connection.
 * @returns the calls the pages make.
 */
export function webPagesClient(connection: ConnectionHandle): WebPagesClient {
  async function call<T>(endpoint: WebPagesEndpoint, payload: unknown): Promise<T> {
    const result = await connection.rpc.call('/api', `${WEB_PAGES_METHOD_PREFIX}/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    // The Host face answers each endpoint with the type web-pages-endpoints.ts names for it.
    return result.value as T
  }
  return {
    agents: () => call<WebPagesAgentsAnswer>('agents', {}),
    reloadAgents: () => call<WebPagesAgentsAnswer>('agents/reload', {}),
    send: request => call<WebPagesSendAnswer>('session/send', request),
    evals: () => call<WebPagesEvalsAnswer>('evals', {}),
    evalReport: run => call<WebPagesEvalReportAnswer>('evals/report', { run }),
  }
}

/** What an error says, for a page to show. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
