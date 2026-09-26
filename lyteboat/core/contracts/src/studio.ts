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
  /** Admins among all grants, filter aside: the last one cannot lose the role. */
  adminCount: number
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

/** How an agent's tool policy declares a tool: `always` or `auto` by a declaration, `inherited` by none. */
export type StudioToolDeclaration = 'always' | 'auto' | 'inherited'

/**
 * Whether a tool reaches the model when an agent starts: `always`; `activated`,
 * once a skill that requires it is active or the agent's code activates it;
 * `hidden`, never (an inherited tool the policy hides).
 */
export type StudioToolReach = 'always' | 'activated' | 'hidden'

/** One tool an agent can reach, as the Tools page shows it. */
export type StudioTool = {
  name: string
  description: string
  /** The parameters' JSON Schema, as the model receives it. */
  parameters: { [key: string]: unknown }
  declared: StudioToolDeclaration
  reach: StudioToolReach
  /** The skills whose metadata requires the tool. */
  requiredBy: string[]
}

/** `GET agents/:id/tools`. */
export type StudioToolsAnswer = {
  tools: StudioTool[]
}

/** How an agent picks its skills (its skill router's settings). */
export type StudioSkillRouting = {
  mode: 'off' | 'full' | 'dynamic'
  /** The router's own model, when it does not use the agent's. */
  provider?: string
  model?: string
}

/** One skill of an agent, as the Skills list shows it. */
export type StudioSkillSummary = {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
  userInvocable: boolean
  /** The tools its lyteboat metadata requires. */
  requiredTools: string[]
  /** Its SKILL.md relative to the agent directory; absent for a skill registered in code or outside the directory. */
  path?: string
  /** When its SKILL.md last changed (epoch ms). */
  updatedAt?: number
  /** Why its lyteboat metadata cannot be read; the router would refuse it. */
  metadataProblem?: string
}

/** `GET agents/:id/skills`. */
export type StudioSkillsAnswer = {
  skills: StudioSkillSummary[]
  routing: StudioSkillRouting
}

/** `GET agents/:id/skills/:name`: a skill with its body and, when it has one, its file. */
export type StudioSkillDetail = StudioSkillSummary & {
  /** The body the model loads. */
  content: string
  /** The SKILL.md as stored, frontmatter included; what a hot-fix replaces. */
  file?: string
  /** The sha256 (hex) of `file`: a hot-fix sends it as `If-Match`. */
  sha256?: string
}

/** `PUT agents/:id/skills/:name` (admins): the SKILL.md's new text, frontmatter included. */
export type StudioSkillUpdateRequest = {
  file: string
}

/** The schema of {@link StudioSkillUpdateRequest}. */
export const studioSkillUpdateRequestSchema: z.ZodType<StudioSkillUpdateRequest> = z.strictObject({
  file: z.string().min(1).max(512 * 1024),
})

/** The answer to a hot-fix: the skill as stored now, and the agent (its digest, whether it deviates from its release). */
export type StudioSkillUpdateAnswer = {
  skill: StudioSkillDetail
  agent: StudioAgent
}

/** One deterministic check of a skill. */
export type StudioSkillFinding = {
  ruleId: string
  label: string
  passed: boolean
  /** How much a failure matters: `error` breaks the agent at runtime, `warn` does not. */
  level: 'error' | 'warn'
  message: string
  evidence?: string
  suggestion?: string
}

/** `POST agents/:id/skills/:name/diagnostics`. */
export type StudioSkillDiagnosticsAnswer = {
  skill: string
  generatedAt: number
  findings: StudioSkillFinding[]
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
