/**
 * lyteboat's contract extensions over the dsh seams. Types, constants,
 * declaration merging, and the zod schemas of the JSON types declared here; no
 * other runtime behavior: the tool and skill metadata lyteboat plugins consume, the
 * `lyteboat/*` step events (declared by lyteboat's kernel agent loop, re-exported
 * here), the log nodes lyteboat plugins append, the envelopes their facts ride,
 * and the projection keys they publish. Declared here, by declaration merging onto
 * the dsh maps, so that providers and consumers depend on this package and
 * never on each other — the same rule dsh applies to its own seams. A reader
 * that finds a lyteboat envelope failing its schema throws: lyteboat wrote it.
 *
 * Session log vocabulary: dsh's persistence layer refuses to reopen a log
 * that carries an event type outside its compiled catalog unless the event is
 * marked `ignorable`, and a reader skips a marked event. Every lyteboat fact a
 * reader needs therefore rides an envelope dsh already knows — `tool/result.meta`
 * for cards and state deltas, the assistant message `source` for a reply's
 * author, dsh's own skill-invocation message for a routed skill — so every
 * lyteboat session reopens. The one record type of lyteboat's own,
 * `lyteboat/aux-llm-call`, is informational and appended ignorable (the kernel
 * extension `session-append-ignorable`), so a reader that does not know it
 * skips it.
 * @module @lyteboat/contracts
 */

import { z } from 'zod'
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Lossless JSON, the only shape session logs and projections may carry. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** The schema of {@link JsonValue}. */
export const lyteboatJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(lyteboatJsonValueSchema), z.record(z.string(), lyteboatJsonValueSchema),
]))

const lyteboatJsonObjectSchema = z.record(z.string(), lyteboatJsonValueSchema)

/**
 * The kernel's pre-assembly step events (`lyteboat/intake`, `lyteboat/pre-assemble`)
 * and their payloads are declared by lyteboat's agent loop
 * (dsh/core/agent-loop/src/lyteboat/step-hooks.ts, dsh-compat/contract/extensions.yml), which
 * cannot import this package; plugins read them from here.
 * `LYTEBOAT_ASSISTANT_PROVIDER` is the provider of every assistant message lyteboat
 * writes without a model call (intake replies, imported history).
 */
export { LYTEBOAT_ASSISTANT_PROVIDER } from '@deepseek-ai/dsh-agent-loop'
export type { LyteboatIntakeDecision, LyteboatIntakeReply, LyteboatStepPayload } from '@deepseek-ai/dsh-agent-loop'

/** One extension of the kernel contract that this lyteboat build carries, as dsh-compat/contract/extensions.yml registers it. */
export interface LyteboatDistroExtension {
  /** The registry id (`agent-loop-intake`, …). */
  id: string
  /** The kernel package the extension lives in. */
  package: string
  /** `event`, `api`, `api-option`, `service`, or `config`. */
  kind: string
}

/**
 * The `lyteboatDistro` service (@lyteboat/distro): present only on lyteboat, so a plugin
 * that uses a kernel extension declares `inject: ['lyteboatDistro']` and does not
 * load on the official release, where the extension does not exist.
 */
export interface LyteboatDistro {
  /** The dsh release the kernel was imported from. */
  readonly dsh: string
  /** Every kernel extension this build carries. */
  readonly extensions: readonly LyteboatDistroExtension[]
  /** Whether this build carries the extension registered under `id`. */
  has(id: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lyteboatDistro: LyteboatDistro
  }
}

/**
 * `source.kind` of the user messages imported history writes; consumers treat
 * them as conversation, not as context. It is dsh's producer kind for the
 * plugin `lyteboat-history-import` (`plugin:<name>`), the kind dsh's session
 * format also reads a stored `{ kind: 'plugin', plugin: 'lyteboat-history-import' }` source as.
 */
export const LYTEBOAT_HISTORY_IMPORT_SOURCE = 'plugin:lyteboat-history-import'

/** `source.kind` of the one user message a side model call sends (`@lyteboat/aux-llm`; the call is recorded, the message is not). */
export const LYTEBOAT_AUX_LLM_SOURCE = 'plugin:lyteboat-aux-llm'

/** Where the `lyteboat:state` runtime context (`@lyteboat/tool-policy`) sits among dsh's (sandbox 110, approval 115, delegation 120). */
export const LYTEBOAT_STATE_CONTEXT_ORDER = 130

/** Where the `lyteboat:skills` system prompt section (`@lyteboat/skill-router`, full mode) sits among the sections (before PLAN_POLICY at 500). */
export const LYTEBOAT_SKILLS_SECTION_ORDER = 450

/** When a tool's schema reaches the model: always, or only after a skill (or a plugin) activated it. */
export type LyteboatToolVisibility = 'always' | 'auto'

/** lyteboat-side metadata registered beside a dsh ToolDefinition (the reference AgentTool fields). */
export interface LyteboatToolMeta {
  /** Defaults to `always`. */
  visibility?: LyteboatToolVisibility
  /** Route the call through the approval seam before execution. */
  requiresConfirmation?: boolean
  /**
   * Derive a state delta (dot-path keys, deep-merged into the session state
   * projection) from the tool's validated return value. Runs where dsh
   * computes presentation meta, before post-execute listeners.
   */
  stateDelta?: (args: unknown, value: unknown) => JsonValue | undefined
}

/** lyteboat-side skill metadata: the `metadata.lyteboat` object of a SKILL.md frontmatter. */
export interface LyteboatSkillMeta {
  /** Tools the skill needs; activated (made visible) when the skill is routed. */
  requiredTools?: string[]
}

/** The schema of {@link LyteboatSkillMeta}; strict, since a misspelt key in a hand-written frontmatter must not silently mean nothing. */
export const lyteboatSkillMetaSchema: z.ZodType<LyteboatSkillMeta> = z.strictObject({
  requiredTools: z.array(z.string()).exactOptional(),
})

/**
 * When a card is shown: `immediate` as soon as its result arrives; `deferred`
 * where the answer writes its area's marker, or after the answer when it never
 * does; `deferred_discard` where the marker is, and nowhere otherwise.
 */
export type LyteboatCardEmission = 'immediate' | 'deferred' | 'deferred_discard'

/** One rendered A2UI card, as a tool result's `meta.lyteboat.cards` carries it (a type, so it is JSON). */
export type LyteboatResultCard = {
  surfaceId: string
  /** The name an answer places the card with: `[[card:<area>]]`. */
  area: string
  emission: LyteboatCardEmission
  payload: JsonValue
}

const lyteboatResultCardShape = {
  surfaceId: z.string(),
  area: z.string(),
  emission: z.enum(['immediate', 'deferred', 'deferred_discard']),
  payload: lyteboatJsonValueSchema,
}

/** The schema of {@link LyteboatResultCard}. */
export const lyteboatResultCardSchema: z.ZodType<LyteboatResultCard> = z.object(lyteboatResultCardShape)

/** A card the session prepared, with what prepared it: the tool call, or the admission reply's message. */
export type LyteboatCard = LyteboatResultCard & {
  callId: string
}

/** The schema of {@link LyteboatCard}. */
export const lyteboatCardSchema: z.ZodType<LyteboatCard> = z.object({ ...lyteboatResultCardShape, callId: z.string() })

/** A state delta: a JSON object whose top-level keys are dot paths into the `lyteboatState` projection (`assets.total`). */
export type LyteboatStateDelta = { [path: string]: JsonValue }

/** The schema of {@link LyteboatStateDelta}. */
export const lyteboatStateDeltaSchema: z.ZodType<LyteboatStateDelta> = lyteboatJsonObjectSchema

/**
 * What a tool result's presentation meta carries under `lyteboat`
 * (`tool/result.meta.lyteboat`): the cards the call rendered, and the state
 * delta it derived.
 */
export type LyteboatResultMeta = {
  cards?: LyteboatResultCard[]
  stateDelta?: LyteboatStateDelta
}

/** The schema of {@link LyteboatResultMeta}. */
export const lyteboatResultMetaSchema: z.ZodType<LyteboatResultMeta> = z.object({
  cards: z.array(lyteboatResultCardSchema).exactOptional(),
  stateDelta: lyteboatStateDeltaSchema.exactOptional(),
})

/** The `lyteboatState` projection value: tool state accumulated by dot-path deep merge of `tool/result.meta.lyteboat.stateDelta`. */
export type LyteboatStateValue = { [key: string]: JsonValue }

/** The schema of {@link LyteboatStateValue}. */
export const lyteboatStateValueSchema: z.ZodType<LyteboatStateValue> = lyteboatJsonObjectSchema

/** One side model call, as its `lyteboat/aux-llm-call` record keeps it. */
export interface LyteboatAuxLlmCallRecord {
  /** What the call was for: `skill-router`, `intake`, … */
  purpose: string
  route: { provider: string; model: string }
  system: string
  /** The one user message the call sent. */
  prompt: string
  maxTokens: number
  temperature: number
  /** The reasoning effort the call requested; absent: the route's default. */
  reasoningEffort?: string
  /** The model's text; absent when the call failed. */
  output?: string
  /** Why the call has no answer: `timeout`, `max-tokens`, or the error's name, with its message. */
  failure?: { reason: string; message: string }
  durationMs: number
}

/**
 * An admission function's decision on one request, made before the request
 * enters the loop and recorded on the request's human message.
 */
export type LyteboatIntakeVerdict = {
  /** The admission function that decided. */
  by: string
  /** `pass`: the model answers. `reply`: `text` answers without a model request, with `cards` if any. */
  decision: 'pass' | 'reply'
  /** The agent's label for the decision (`out_of_scope`, `unauthorized`, …). */
  verdict?: string
  text?: string
  cards?: LyteboatResultCard[]
}

/** The schema of {@link LyteboatIntakeVerdict}. */
export const lyteboatIntakeVerdictSchema: z.ZodType<LyteboatIntakeVerdict> = z.object({
  by: z.string(),
  decision: z.enum(['pass', 'reply']),
  verdict: z.string().exactOptional(),
  text: z.string().exactOptional(),
  cards: z.array(lyteboatResultCardSchema).exactOptional(),
})

/**
 * The request a human message answers to, carried on its `source` beside
 * `kind: 'user'`, so every dsh consumer still reads the message as human
 * input. `@lyteboat/request-context` reads it back.
 */
export type LyteboatRequest = {
  /** The caller's id for the request, when it gave one. */
  requestId?: string
  /** The request context as the caller passed it; absent keeps the session's earlier context. */
  context?: { [key: string]: JsonValue }
  intake?: LyteboatIntakeVerdict
}

/** The schema of {@link LyteboatRequest}, the envelope on a human message's `source.lyteboatRequest`. */
export const lyteboatRequestSchema: z.ZodType<LyteboatRequest> = z.object({
  requestId: z.string().exactOptional(),
  context: lyteboatJsonObjectSchema.exactOptional(),
  intake: lyteboatIntakeVerdictSchema.exactOptional(),
})

/** The `lyteboatRequest` fold state: the session's request context and the latest request's verdict. */
export type LyteboatRequestState = {
  /** Human messages that carried a request. */
  requests: number
  /** The latest context a request carried; empty before any. */
  context: { [key: string]: JsonValue }
  /** The latest request's verdict, when an admission function ran on it. */
  intake: LyteboatIntakeVerdict | null
}

/** The schema of {@link LyteboatRequestState}. */
export const lyteboatRequestStateSchema: z.ZodType<LyteboatRequestState> = z.object({
  requests: z.number(),
  context: lyteboatJsonObjectSchema,
  intake: lyteboatIntakeVerdictSchema.nullable(),
})

/** The `lyteboatActiveSkill` fold state. */
export interface LyteboatActiveSkillState {
  /** The skill in force; null before any skill is active. */
  active: string | null
  /** `skill` tool calls still awaiting their result: the skill each loads, by call id. */
  loading: { [callId: string]: string }
}

/** The schema of {@link LyteboatActiveSkillState}. */
export const lyteboatActiveSkillStateSchema: z.ZodType<LyteboatActiveSkillState> = z.object({
  active: z.string().nullable(),
  loading: z.record(z.string(), z.string()),
})

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Imported history rounds, written by `@lyteboat/history-import` into a session seed. */
    'plugin:lyteboat-history-import': { kind: typeof LYTEBOAT_HISTORY_IMPORT_SOURCE }
    /** A side model call's prompt, owned by `@lyteboat/aux-llm`. */
    'plugin:lyteboat-aux-llm': { kind: typeof LYTEBOAT_AUX_LLM_SOURCE }
    /** A human message that carries its request (context, verdict), written by the caller through `@lyteboat/request-context`. */
    'lyteboat-request': { kind: 'user'; lyteboatRequest: LyteboatRequest }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One side model call a plugin made for the agent, appended ignorable by
     * `@lyteboat/aux-llm`: no reader needs it to rebuild the session.
     */
    'lyteboat/aux-llm-call': LyteboatAuxLlmCallRecord
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Session tool state (host fold of `tool/result.meta.lyteboat.stateDelta`), owned by `@lyteboat/tool-policy`. */
    lyteboatState: LyteboatStateValue
    /** The skill active for the session, folded from skill-invocation messages and `skill` tool calls; owned by `@lyteboat/skill-router`. */
    lyteboatActiveSkill: LyteboatActiveSkillState
    /** Cards from `tool/result.meta.lyteboat.cards` and admission replies, in log order; a `surfaceUpdate` replaces its surface. Owned by `@lyteboat/a2ui`. */
    lyteboatCards: LyteboatCard[]
    /** The request context and the latest verdict, folded from human messages that carry a request. Owned by `@lyteboat/request-context`. */
    lyteboatRequest: LyteboatRequestState
  }
  interface SessionProjectionMap {
    /** Session tool state as the client sees it: the fold state itself. */
    lyteboatState: LyteboatStateValue
    /** The active skill as the client sees it; null before any skill is active. */
    lyteboatActiveSkill: string | null
    /** Every card the session prepared, as the client sees it; what a turn shows is `ctx.a2ui.turnParts`. */
    lyteboatCards: LyteboatCard[]
    /** The request state as the client sees it. */
    lyteboatRequest: LyteboatRequestState
  }
}
