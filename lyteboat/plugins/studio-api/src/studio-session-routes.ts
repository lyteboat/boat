/**
 * An agent's sessions, read through sessionIndex for any signed-in role:
 * `agents/:id/sessions` (newest first, a page within a time window, of one
 * owner if asked), `agents/:id/sessions/find` (the bounded search), one
 * session's timeline, and one session as stored. Studio never writes a
 * session: they are end users' business records.
 * @module @lyteboat/studio-api/studio-session-routes
 */

import type { LyteboatRequestOwner } from '@lyteboat/contracts'
import type { SessionIndexQuery, SessionIndexService } from '@lyteboat/session-index'
import { studioWholeNumberOf } from './studio-auth-routes.ts'
import { StudioApiError, type StudioApiCall, type StudioApiRoute } from './studio-api-router.ts'

const SESSIONS_PAGE_LIMIT = 200
const SESSIONS_FIND_TEXT_MAX = 200
const OWNER_KINDS: readonly LyteboatRequestOwner['kind'][] = ['user', 'operator', 'system']

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new StudioApiError('not_found', `no ${what}`)
  return value
}

/** `owner=<kind>:<id>`, as the Sessions page groups by it. */
function ownerOf(query: URLSearchParams): LyteboatRequestOwner | undefined {
  const text = query.get('owner')
  if (text === null || text === '') return undefined
  const split = text.indexOf(':')
  const kind = OWNER_KINDS.find(candidate => candidate === text.slice(0, split))
  if (split < 0 || kind === undefined || split === text.length - 1) throw new StudioApiError('invalid_request', `owner must be <kind>:<id>, the kind one of ${OWNER_KINDS.join(', ')}`)
  return { kind, id: text.slice(split + 1) }
}

function sessionQueryOf(query: URLSearchParams): SessionIndexQuery {
  const owner = ownerOf(query)
  return {
    ...query.has('since') ? { since: studioWholeNumberOf(query, 'since', 0, Number.MAX_SAFE_INTEGER) } : {},
    ...query.has('until') ? { until: studioWholeNumberOf(query, 'until', 0, Number.MAX_SAFE_INTEGER) } : {},
    ...owner === undefined ? {} : { owner },
    limit: Math.max(1, studioWholeNumberOf(query, 'limit', 50, SESSIONS_PAGE_LIMIT)),
    offset: studioWholeNumberOf(query, 'offset', 0, Number.MAX_SAFE_INTEGER),
  }
}

function findTextOf(query: URLSearchParams): string {
  const text = (query.get('q') ?? '').trim()
  if (text === '' || text.length > SESSIONS_FIND_TEXT_MAX) throw new StudioApiError('invalid_request', `q must hold 1 to ${String(SESSIONS_FIND_TEXT_MAX)} characters`)
  return text
}

/**
 * The routes.
 * @param sessions - the sessionIndex service.
 */
export function studioSessionRoutes(sessions: SessionIndexService): StudioApiRoute[] {
  const idOf = (call: StudioApiCall): string => call.params['id'] ?? ''
  const sessionIdOf = (call: StudioApiCall): string => call.params['sid'] ?? ''
  return [
    { method: 'GET', path: 'agents/:id/sessions', access: 'viewer', handle: async call => found(await sessions.list(idOf(call), sessionQueryOf(call.query)), `agent ${idOf(call)}`) },
    // Before `sessions/:sid`: the first route that matches answers.
    {
      method: 'GET', path: 'agents/:id/sessions/find', access: 'viewer',
      handle: async call => found(await sessions.find(idOf(call), findTextOf(call.query), sessionQueryOf(call.query)), `agent ${idOf(call)}`),
    },
    {
      method: 'GET', path: 'agents/:id/sessions/:sid', access: 'viewer',
      handle: async call => found(await sessions.detail(idOf(call), sessionIdOf(call)), `session ${sessionIdOf(call)} of agent ${idOf(call)}`),
    },
    {
      method: 'GET', path: 'agents/:id/sessions/:sid/raw', access: 'viewer',
      handle: async call => found(await sessions.raw(idOf(call), sessionIdOf(call)), `session ${sessionIdOf(call)} of agent ${idOf(call)}`),
    },
  ]
}
