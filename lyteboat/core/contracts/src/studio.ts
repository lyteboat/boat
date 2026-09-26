/**
 * The Studio API's wire contract: what `/api/studio/*` takes and answers, for
 * the workshop's host face (`@lyteboat/studio-api`) and its browser face
 * (`@lyteboat/studio-web`) alike. Types, constants, and the zod schemas of the
 * requests a host validates; no other runtime behavior. A request body that
 * fails its schema, an unknown key included, is refused as `invalid_request`.
 * @module @lyteboat/contracts/studio
 */

import { z } from 'zod'

/** The Studio roles, from the most to the least capable. */
export const STUDIO_ROLES = ['admin', 'editor', 'viewer'] as const

/** A Studio role: admin (users, hot-fixes), editor (eval runs), viewer (reads). */
export type StudioRole = typeof STUDIO_ROLES[number]

/** The schema of {@link StudioRole}. */
export const studioRoleSchema: z.ZodType<StudioRole> = z.enum(STUDIO_ROLES)

/** Who a request speaks for. */
export type StudioPrincipal = {
  userId: string
  displayName: string
  role: StudioRole
}

/** How a Studio signs people in: its own accounts, or the identity an authorizing gateway puts on each request. */
export type StudioAuthMode = 'internal' | 'gateway'

/** `GET auth/config`. */
export type StudioAuthConfigAnswer = {
  mode: StudioAuthMode
  /** Whether the login page asks for a password (internal mode). */
  loginRequired: boolean
  /** Whether a request without a token reads as an anonymous viewer. */
  anonymousViewer: boolean
}

/** `POST auth/login`. */
export type StudioLoginRequest = {
  username: string
  password: string
}

/** The schema of {@link StudioLoginRequest}. */
export const studioLoginRequestSchema: z.ZodType<StudioLoginRequest> = z.strictObject({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1000),
})

/** `POST auth/login`, and `GET auth/session` in gateway mode (without a token). */
export type StudioLoginAnswer = StudioPrincipal & {
  /** The bearer token, absent in gateway mode. */
  token?: string
  /** When the token expires (epoch ms). */
  expiresAt?: number
}

/** One user's role grant, as the Users page lists it. */
export type StudioGrant = {
  userId: string
  role: StudioRole
  createdAt: number
  updatedAt: number
  createdBy: string
  updatedBy: string
}

/** `GET users`: one page of grants, filtered. */
export type StudioUsersAnswer = {
  users: StudioGrant[]
  total: number
}

/** `POST users`: grant or change a role. */
export type StudioGrantRequest = {
  userId: string
  role: StudioRole
}

/** The schema of {@link StudioGrantRequest}. */
export const studioGrantRequestSchema: z.ZodType<StudioGrantRequest> = z.strictObject({
  userId: z.string().min(1).max(200),
  role: studioRoleSchema,
})

/** An environment variable as the System page shows it: secrets masked. */
export type StudioEnvEntry = {
  name: string
  value: string
}

/** `GET system/properties`. */
export type StudioSystemAnswer = {
  os: { [key: string]: string | number }
  runtime: { [key: string]: string | number }
  lyteboat: {
    /** The launcher's version; absent when no launcher booted this Studio (an embedding host). */
    version?: string
    dshBase: string
    extensions: string[]
    home: string
    agentRoots: string[]
  }
  properties: { [key: string]: string | number | string[] }
  env: StudioEnvEntry[]
}

/** `GET config/trace-link`: the template an external trace id fills (`{trace_id}`), when one is configured. */
export type StudioTraceLinkAnswer = {
  template?: string
}

/** One agent as the radar lists it. */
export type StudioAgent = {
  id: string
  name?: string
  description?: string
  order?: number
  version?: string
  digest: string
  /** The release lock beside the agent, when there is one. */
  release?: { version: string; digest: string }
  /** Whether the agent's directory differs from its release lock. */
  deviates: boolean
  /** Why the release lock beside the agent could not be read; the agent is listed without one. */
  releaseProblem?: string
}

/** One agent the catalog could not serve. */
export type StudioAgentFailure = {
  id: string
  reason: string
}

/** `GET agents`, `POST agents/reload`. */
export type StudioAgentsAnswer = {
  agents: StudioAgent[]
  failures: StudioAgentFailure[]
}

/** Why a Studio request was refused. */
export type StudioErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'too_many_requests'
  | 'payload_too_large'
  | 'misdirected'
  | 'internal'

/** The body of every refused Studio request. */
export type StudioErrorAnswer = {
  error: { code: StudioErrorCode; message: string }
}
