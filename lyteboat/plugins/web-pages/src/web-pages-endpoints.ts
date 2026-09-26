/**
 * The endpoints the web pages call and what each answers: the one contract
 * between the Host face and the pages. Each endpoint is an exact route
 * `/api/lyteboat/<endpoint>` on dsh's connection, behind the same trust fence
 * and login as every dsh web request, and the pages call it through dsh's own
 * browser transport: `connection.rpc.call('/api', 'lyteboat/<endpoint>', payload)`.
 * @module @lyteboat/web-pages/web-pages-endpoints
 */

import type { JsonValue } from '@lyteboat/contracts'
import type { LyteboatEvalRunRecord } from '@lyteboat/contracts'

/** The first segment of every endpoint's method on dsh's `/api` channel. */
export const WEB_PAGES_METHOD_PREFIX = 'lyteboat'

/** The endpoints, each registered at `/api/lyteboat/<endpoint>`. */
export const WEB_PAGES_ENDPOINTS = ['agents', 'agents/reload', 'session/send', 'evals', 'evals/report'] as const

/** One endpoint of {@link WEB_PAGES_ENDPOINTS}. */
export type WebPagesEndpoint = typeof WEB_PAGES_ENDPOINTS[number]

/** `agents` and `agents/reload`: the agents the catalog serves, and the ones it cannot. */
export interface WebPagesAgentsAnswer {
  agents: { id: string; name: string; description?: string }[]
  failures: { id: string; reason: string }[]
}

/** `session/send`: a message for a session, with the request context it answers to. */
export interface WebPagesSendRequest {
  sessionId: string
  text: string
  context?: { [key: string]: JsonValue }
}

/** `session/send`: the request id the message records. */
export interface WebPagesSendAnswer {
  requestId: string
}

/** One run as the Evals page lists it. */
export interface WebPagesEvalRun {
  /** The run's directory name, its id. */
  id: string
  agent: string
  mode: LyteboatEvalRunRecord['mode']
  cases: number
  passedCases: number
  startedAt: string
}

/** `evals`: the runs under the evals directory, newest first. */
export interface WebPagesEvalsAnswer {
  runs: WebPagesEvalRun[]
}

/** `evals/report`: one run's `report.md`. */
export interface WebPagesEvalReportAnswer {
  run: string
  report: string
}
