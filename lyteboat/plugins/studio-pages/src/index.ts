/**
 * @lyteboat/studio-pages — lyteboat's pages in dsh web. The Host face answers the
 * browser on the `/lyteboat` channel of dsh's connection, behind the same
 * authentication as every dsh web request: the agents the catalog serves and
 * the ones that failed, a reload of the catalog, a session's lyteboat state
 * (active skill, request, cards, state), a message sent with its request
 * context, the eval runs and one run's report. A message goes through dsh's
 * session controller with its request on the source, the path a `/chat`
 * message takes, so its answer shows in dsh's own conversation. The client
 * face (`./client`) is the pages.
 * @module @lyteboat/studio-pages
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@lyteboat/agent-catalog'
import type {} from '@lyteboat/request-context'
import { z as zod } from 'zod'
import { listEvalRuns, readEvalReport } from './eval-runs.ts'

export type { StudioEvalRun } from './eval-runs.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    studioPages: StudioPagesService
  }
}

/** The connection channel the pages call. */
export const STUDIO_RPC_CHANNEL = '/lyteboat'

export interface Config {
  /** The request owner a message the pages send records. */
  owner?: string
  /** Where the eval runs are; default `$LYTEBOAT_HOME/evals`. */
  evalsDir?: string
}

export const Config: z<Config> = z.object({
  owner: z.string().default('studio'),
  evalsDir: z.string(),
})

/** A refusal the page shows. */
class StudioRpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const sessionPayload = zod.strictObject({ sessionId: zod.string().min(1) })
const sendPayload = zod.strictObject({
  sessionId: zod.string().min(1),
  text: zod.string().refine((text: string) => text.trim() !== '', 'text must not be blank'),
  context: zod.record(zod.string(), zod.json()).optional(),
})
const reportPayload = zod.strictObject({ run: zod.string().min(1) })

function parse<T>(schema: zod.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new StudioRpcError('invalid_request', issue === undefined ? 'invalid payload' : `${issue.path.join('.') || 'payload'}: ${issue.message}`)
}

/** Host service: the `/lyteboat` channel the Studio pages call. */
export class StudioPagesService extends Service {
  static inject = ['connection', 'sessionController', 'agentCatalog', 'requestContext']
  // The loader applies a class plugin's static Config, not the module's.
  static Config = Config

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'studioPages')
    ctx.effect(() => ctx.connection.rpc.handle(STUDIO_RPC_CHANNEL, (endpoint, payload, signal) => this.answer(endpoint, payload, signal)), 'studio-pages: /lyteboat')
  }

  private async answer(endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcHandlerResult> {
    try {
      return { ok: true, value: await this.endpoint(endpoint, payload, signal) }
    } catch (error: unknown) {
      const refusal = error instanceof StudioRpcError ? error : new StudioRpcError('internal', error instanceof Error ? error.message : String(error))
      if (refusal.code === 'internal') this.ctx.logger.warn(`studio pages: ${endpoint}: ${refusal.message}`)
      return { ok: false, error: { code: refusal.code, message: refusal.message, details: {} } }
    }
  }

  private async endpoint(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    switch (endpoint) {
      case 'agents': return this.agents()
      case 'agents/reload':
        // A failed agent is reported with the rest; the reload itself answers.
        await this.ctx.agentCatalog.reload().catch(() => {})
        return this.agents()
      case 'session': return this.session(parse(sessionPayload, payload).sessionId, signal)
      case 'session/send': return this.send(parse(sendPayload, payload), signal)
      case 'evals': return { runs: listEvalRuns(this.evalsDir()) }
      case 'evals/report': {
        const { run } = parse(reportPayload, payload)
        try {
          return { run, report: readEvalReport(this.evalsDir(), run) }
        } catch (error: unknown) {
          throw new StudioRpcError('not_found', error instanceof Error ? error.message : String(error))
        }
      }
      default: throw new StudioRpcError('not_found', `no endpoint ${JSON.stringify(endpoint)}`)
    }
  }

  private evalsDir(): string {
    return this.config.evalsDir ?? dshHomePath('evals')
  }

  private async agents(): Promise<unknown> {
    await this.ctx.agentCatalog.whenReady().catch(() => {})
    return {
      agents: this.ctx.agentCatalog.list().map(agent => ({ id: agent.id, name: agent.name ?? agent.id, ...agent.description === undefined ? {} : { description: agent.description } })),
      failures: this.ctx.agentCatalog.failures().map(failure => ({ id: failure.id, reason: failure.reason })),
    }
  }

  /** A session's lyteboat state, as its projections show it. */
  private async session(id: string, signal: AbortSignal): Promise<unknown> {
    const projections = await this.ctx.sessionController.projections({ sessionId: brandString<SessionId>(id) }, signal)
    if (projections === null) throw new StudioRpcError('session_not_found', `session ${JSON.stringify(id)} does not exist`)
    const values = projections.values
    return {
      agent: values['agentPreset'] ?? null,
      // The active-skill projection's wire view is the skill's name, or null.
      skill: typeof values['lyteboatActiveSkill'] === 'string' ? values['lyteboatActiveSkill'] : null,
      request: values['lyteboatRequest'] ?? null,
      cards: values['lyteboatCards'] ?? null,
      state: values['lyteboatState'] ?? null,
    }
  }

  /** Queue a message with its request context, the way `/chat` does. */
  private async send(message: zod.infer<typeof sendPayload>, signal: AbortSignal): Promise<unknown> {
    const requestId = randomUUID()
    await this.ctx.sessionController.prompt({
      requestId: brandString<SessionRequestId>(requestId),
      sessionId: brandString<SessionId>(message.sessionId),
      mode: 'queue',
      content: [{ type: 'text', text: message.text }],
      sourceFields: this.ctx.requestContext.sourceFields({ requestId, owner: this.config.owner ?? 'studio', ...message.context === undefined ? {} : { context: message.context } }),
    }, signal)
    return { requestId }
  }
}

export default StudioPagesService
