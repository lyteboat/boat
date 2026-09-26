/**
 * @lyteboat/studio-api — the Studio's HTTP API, `/api/studio/*` on the host
 * web server, JSON in and out. Every request passes the Host allowlist (the
 * loopback names and `trustedHosts`; any other Host is answered 421, which
 * keeps DNS rebinding out), and every answer carries `nosniff`, a
 * `default-src 'none'` CSP, and `no-store`. A route names the least role that
 * may call it; the caller comes from `studioAuth` (a bearer token, or the
 * gateway's headers). Request bodies are JSON, at most `maxBodyBytes`, and
 * checked against the schemas of `@lyteboat/contracts/studio`, an unknown key
 * included. Changes made through the API are appended to the Studio's audit
 * log. The API reads the agents from `agentCatalog` and `agentInspector`, and
 * their sessions from `sessionIndex`, and runs nothing of theirs: Studio never
 * creates, continues, or changes a session. The one write to an agent is an
 * admin's hot-fix of an existing skill's SKILL.md.
 * @module @lyteboat/studio-api
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import type {} from '@lyteboat/agent-catalog'
import type {} from '@lyteboat/agent-inspector'
import type {} from '@lyteboat/contracts'
import type {} from '@lyteboat/session-index'
import type {} from '@lyteboat/studio-auth'
import { studioAgentRoutes } from './studio-agent-routes.ts'
import { StudioApiRouter } from './studio-api-router.ts'
import { StudioAudit } from './studio-audit.ts'
import { studioAuthRoutes } from './studio-auth-routes.ts'
import { studioSessionRoutes } from './studio-session-routes.ts'
import { studioSystemRoutes } from './studio-system-routes.ts'
import { studioWorkspaceRoutes } from './studio-workspace-routes.ts'

/** Stable Cordis plugin name. */
export const name = 'lyteboat-studio-api'

/** The services the API answers from. */
export const inject = ['webServer', 'studioAuth', 'agentCatalog', 'agentInspector', 'sessionIndex', 'lyteboatDistro']

/** Where the API sits on the web server. */
export const STUDIO_API_PREFIX = '/api/studio'

export interface Config {
  /** Where the audit log lives; default `$LYTEBOAT_HOME/studio`, beside the accounts. */
  dir?: string
  /** Host header values accepted beside the loopback names: `name` (any port) or `name:port`. */
  trustedHosts?: string[]
  /** The agent roots, as the System page shows them. */
  agentRoots?: string[]
  /** The launcher's version, as the System page shows it. */
  lyteboatVersion?: string
  /** The tracing UI's URL for one trace, with `{trace_id}` where the id goes. */
  traceLinkTemplate?: string
  /** Environment variables the System page masks whatever their names. */
  maskedEnv?: string[]
  maxBodyBytes?: number
}

export const Config: z<Config> = z.object({
  dir: z.string(),
  trustedHosts: z.array(z.string()).default([]),
  agentRoots: z.array(z.string()).default([]),
  lyteboatVersion: z.string(),
  traceLinkTemplate: z.string(),
  maskedEnv: z.array(z.string()).default([]),
  maxBodyBytes: z.natural().default(1024 * 1024),
})

const STUDIO_API_CONFIG_KEYS = new Set(['dir', 'trustedHosts', 'agentRoots', 'lyteboatVersion', 'traceLinkTemplate', 'maskedEnv', 'maxBodyBytes'])

/**
 * Register `/api/studio` on the web server.
 * @param ctx - plugin context carrying the web server, studioAuth, the agent catalog, inspector, and session index, and the distro marker.
 * @param config - the validated config.
 * @throws when a config key is unknown or the trace link template has no `{trace_id}`.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery passes unknown keys through; a misspelt one must not be ignored.
  const unknown = Object.keys(config).filter(key => !STUDIO_API_CONFIG_KEYS.has(key))
  if (unknown.length > 0) throw new Error(`studio-api: unknown config key ${unknown.map(key => JSON.stringify(key)).join(', ')}; allowed: ${[...STUDIO_API_CONFIG_KEYS].join(', ')}`)
  if (config.traceLinkTemplate !== undefined && !config.traceLinkTemplate.includes('{trace_id}')) {
    throw new Error('studio-api: traceLinkTemplate must hold {trace_id}, where a session\'s trace id goes')
  }
  const audit = new StudioAudit(config.dir ?? dshHomePath('studio'), message => ctx.logger.warn(message))
  const router = new StudioApiRouter({
    prefix: STUDIO_API_PREFIX,
    trustedHosts: config.trustedHosts ?? [],
    maxBodyBytes: config.maxBodyBytes ?? 1024 * 1024,
    principal: headers => ctx.studioAuth.principal(headers),
    internalError: error => ctx.logger.error(`lyteboat studio api: ${error instanceof Error ? error.stack ?? error.message : String(error)}`),
  }, [
    ...studioAuthRoutes(ctx.studioAuth, audit),
    ...studioSystemRoutes(() => ({
      distro: ctx.lyteboatDistro,
      lyteboatVersion: config.lyteboatVersion,
      agentRoots: config.agentRoots ?? [],
      maskedEnv: config.maskedEnv ?? [],
      env: process.env,
    }), config.traceLinkTemplate),
    ...studioAgentRoutes(ctx.agentCatalog, audit),
    ...studioWorkspaceRoutes({ catalog: ctx.agentCatalog, inspector: ctx.agentInspector, audit }),
    ...studioSessionRoutes(ctx.sessionIndex),
  ])
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: STUDIO_API_PREFIX, handler: (request, response) => router.handle(request, response) }), 'studio-api: /api/studio')
}
