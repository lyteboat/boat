/**
 * The pages' calls to the Host face, through dsh's own browser transport:
 * `connection.rpc.call('/api', 'lyteboat/<endpoint>', payload)`, which carries
 * the login and the trust fence every dsh web request does.
 * @module @lyteboat/studio-pages/client/studio-pages-client
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  STUDIO_PAGES_METHOD_PREFIX,
  type StudioAgentsAnswer, type StudioEvalReportAnswer, type StudioEvalsAnswer, type StudioPagesEndpoint, type StudioSendAnswer, type StudioSendRequest,
} from '../studio-endpoints.ts'

/** The Host face's endpoints as the pages call them; a refusal rejects with its message. */
export interface StudioPagesClient {
  agents(): Promise<StudioAgentsAnswer>
  reloadAgents(): Promise<StudioAgentsAnswer>
  send(request: StudioSendRequest): Promise<StudioSendAnswer>
  evals(): Promise<StudioEvalsAnswer>
  evalReport(run: string): Promise<StudioEvalReportAnswer>
}

/**
 * Bind the endpoints to the page's connection.
 * @param connection - dsh's browser connection.
 * @returns the calls the pages make.
 */
export function studioPagesClient(connection: ConnectionHandle): StudioPagesClient {
  async function call<T>(endpoint: StudioPagesEndpoint, payload: unknown): Promise<T> {
    const result = await connection.rpc.call('/api', `${STUDIO_PAGES_METHOD_PREFIX}/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    // The Host face answers each endpoint with the type studio-endpoints.ts names for it.
    return result.value as T
  }
  return {
    agents: () => call<StudioAgentsAnswer>('agents', {}),
    reloadAgents: () => call<StudioAgentsAnswer>('agents/reload', {}),
    send: request => call<StudioSendAnswer>('session/send', request),
    evals: () => call<StudioEvalsAnswer>('evals', {}),
    evalReport: run => call<StudioEvalReportAnswer>('evals/report', { run }),
  }
}

/** What an error says, for a page to show. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
