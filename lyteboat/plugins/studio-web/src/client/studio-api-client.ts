/**
 * The pages' client of `/api/studio`: one method per endpoint the pages
 * call, typed by `@lyteboat/contracts/studio` (types only, so no schema code
 * reaches the browser). The bearer token is the one the auth context holds; a
 * 401 on anything but a login tells the auth context the sign-in is gone.
 * @module @lyteboat/studio-web/client/studio-api-client
 */

import type {
  StudioAgentsAnswer,
  StudioAuthConfigAnswer,
  StudioErrorAnswer,
  StudioErrorCode,
  StudioGrant,
  StudioGrantRequest,
  StudioLoginAnswer,
  StudioLoginRequest,
  StudioPrincipal,
  StudioRole,
  StudioSystemAnswer,
  StudioUsersAnswer,
} from '@lyteboat/contracts/studio'

/** A call the Studio refused, or one that did not reach it. */
class StudioApiCallError extends Error {
  constructor(readonly status: number, readonly code: StudioErrorCode | 'unreachable', message: string) {
    super(message)
  }
}

const studioApiSession: { token: string | undefined; unauthorized: () => void } = { token: undefined, unauthorized: () => {} }

/**
 * Set the token calls carry and what a 401 does.
 * @param token - the bearer token; undefined for gateway or anonymous access.
 * @param unauthorized - called when a call other than a login answers 401.
 */
export function configureStudioApi(token: string | undefined, unauthorized: () => void): void {
  studioApiSession.token = token
  studioApiSession.unauthorized = unauthorized
}

async function studioErrorOf(response: Response): Promise<StudioApiCallError> {
  try {
    const { error } = await response.json() as StudioErrorAnswer
    return new StudioApiCallError(response.status, error.code, error.message)
  } catch {
    return new StudioApiCallError(response.status, 'internal', `HTTP ${String(response.status)}`)
  }
}

async function studioCall<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, signingIn = false): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/studio/${path}`, {
      method,
      headers: {
        ...studioApiSession.token === undefined ? {} : { authorization: `Bearer ${studioApiSession.token}` },
        ...body === undefined ? {} : { 'content-type': 'application/json' },
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    })
  } catch (error: unknown) {
    throw new StudioApiCallError(0, 'unreachable', `the Studio did not answer: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    if (response.status === 401 && !signingIn) studioApiSession.unauthorized()
    throw await studioErrorOf(response)
  }
  return await response.json() as T
}

/** One page of the Users table. */
interface StudioUsersQuery {
  text: string
  role: StudioRole | undefined
  limit: number
  offset: number
}

function usersQueryString(query: StudioUsersQuery): string {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) })
  if (query.text !== '') params.set('text', query.text)
  if (query.role !== undefined) params.set('role', query.role)
  return params.toString()
}

/** The endpoints the pages call. */
export const studioApi = {
  authConfig: () => studioCall<StudioAuthConfigAnswer>('GET', 'auth/config'),
  login: (request: StudioLoginRequest) => studioCall<StudioLoginAnswer>('POST', 'auth/login', request, true),
  session: () => studioCall<StudioPrincipal>('GET', 'auth/session', undefined, true),
  logout: () => studioCall<Record<string, never>>('POST', 'auth/logout', {}, true),
  agents: () => studioCall<StudioAgentsAnswer>('GET', 'agents'),
  users: (query: StudioUsersQuery) => studioCall<StudioUsersAnswer>('GET', `users?${usersQueryString(query)}`),
  grant: (request: StudioGrantRequest) => studioCall<StudioGrant>('POST', 'users', request),
  revoke: (userId: string) => studioCall<StudioGrant>('DELETE', `users/${encodeURIComponent(userId)}`),
  system: () => studioCall<StudioSystemAnswer>('GET', 'system/properties'),
}

/** A caught error's message, for a page's error banner. */
export function studioErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
