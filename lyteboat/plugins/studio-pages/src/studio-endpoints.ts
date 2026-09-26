/**
 * The endpoints the Studio pages call and what each answers: the one contract
 * between the Host face and the pages. Each endpoint is an exact route
 * `/api/lyteboat/<endpoint>` on dsh's connection, behind the same trust fence
 * and login as every dsh web request, and the pages call it through dsh's own
 * browser transport: `connection.rpc.call('/api', 'lyteboat/<endpoint>', payload)`.
 * @module @lyteboat/studio-pages/studio-endpoints
 */

import type { JsonValue } from '@lyteboat/contracts'
import type { LyteboatEvalRunRecord } from '@lyteboat/contracts'

/** The first segment of every endpoint's method on dsh's `/api` channel. */
export const STUDIO_PAGES_METHOD_PREFIX = 'lyteboat'

/** The endpoints, each registered at `/api/lyteboat/<endpoint>`. */
export const STUDIO_PAGES_ENDPOINTS = ['agents', 'agents/reload', 'session/send', 'evals', 'evals/report'] as const

/** One endpoint of {@link STUDIO_PAGES_ENDPOINTS}. */
export type StudioPagesEndpoint = typeof STUDIO_PAGES_ENDPOINTS[number]

/** `agents` and `agents/reload`: the agents the catalog serves, and the ones it cannot. */
export interface StudioAgentsAnswer {
  agents: { id: string; name: string; description?: string }[]
  failures: { id: string; reason: string }[]
}

/** `session/send`: a message for a session, with the request context it answers to. */
export interface StudioSendRequest {
  sessionId: string
  text: string
  context?: { [key: string]: JsonValue }
}

/** `session/send`: the request id the message records. */
export interface StudioSendAnswer {
  requestId: string
}

/** One run as the Evals page lists it. */
export interface StudioEvalRun {
  /** The run's directory name, its id. */
  id: string
  agent: string
  mode: LyteboatEvalRunRecord['mode']
  cases: number
  passedCases: number
  startedAt: string
}

/** `evals`: the runs under the evals directory, newest first. */
export interface StudioEvalsAnswer {
  runs: StudioEvalRun[]
}

/** `evals/report`: one run's `report.md`. */
export interface StudioEvalReportAnswer {
  run: string
  report: string
}
