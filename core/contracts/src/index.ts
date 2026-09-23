/**
 * boat's contract extensions over the dsh seams. Types and constants only:
 * the tool and skill metadata boat plugins consume, the `boat/*` events the
 * boat driver dispatches, the log nodes boat plugins append, and the
 * projection keys they publish. Declared here, by declaration merging onto
 * the dsh maps, so that providers and consumers depend on this package and
 * never on each other — the same rule dsh applies to its own seams.
 *
 * Session log vocabulary: dsh's persistence layer refuses to reopen a log
 * that carries an event type outside its compiled catalog unless the event is
 * marked `ignorable`, and `Session.append` cannot set that mark. Every boat
 * fact therefore rides an envelope dsh already knows — `tool/result.meta`
 * for cards and state deltas, the assistant message `source` for a reply's
 * author — except the skill router's two nodes, which have no existing
 * envelope and keep a routed session from reopening until dsh offers a
 * write path for the mark.
 * @module @boat/contracts
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Lossless JSON, the only shape session logs and projections may carry. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** `provider` of every assistant message boat writes without a model call (intake replies, imported history). */
export const BOAT_ASSISTANT_PROVIDER = 'boat'

/** `plugin` of the user messages imported history writes; consumers treat them as conversation, not as context. */
export const BOAT_HISTORY_IMPORT_PLUGIN = 'boat-history-import'

/** When a tool's schema reaches the model: always, or only after a skill (or a plugin) activated it. */
export type BoatToolVisibility = 'always' | 'auto'

/** boat-side metadata registered beside a dsh ToolDefinition (the reference AgentTool fields). */
export interface BoatToolMeta {
  /** Defaults to `always`. */
  visibility?: BoatToolVisibility
  /** Registry grouping only; never affects visibility. */
  group?: string
  /** Route the call through the approval seam before execution. */
  requiresConfirmation?: boolean
  /**
   * Derive a state delta (dot-path keys, deep-merged into the session state
   * projection) from the tool's validated return value. Runs where dsh
   * computes presentation meta, before post-execute listeners.
   */
  stateDelta?: (args: unknown, value: unknown) => JsonValue | undefined
}

/** boat-side skill metadata: the `metadata.boat` object of a SKILL.md frontmatter. */
export interface BoatSkillMeta {
  group?: string
  /** Tools the skill needs; activated (made visible) when the skill is routed. */
  requiredTools?: string[]
  version?: string
  tags?: string[]
}

/** One rendered A2UI card, as `tool/result.meta.boat.card` carries it. */
export interface BoatCard {
  /** The tool call that produced the card. */
  callId: string
  surfaceId: string
  payload: JsonValue
}

/**
 * An intake listener's verdict: let the step proceed, or answer without a
 * model call. The reply is logged as an ordinary assistant message whose
 * `source` is `{ provider: 'boat', model: plugin }`; no other node records it.
 */
export interface IntakeReply {
  kind: 'reply'
  /** The deciding plugin; recorded as the assistant message's `model`. */
  plugin: string
  /** The reply's blocks. A tool call cannot be replied: nothing would execute it. */
  content: Exclude<ContentBlock, { type: 'tool-call' }>[]
}

export type IntakeDecision = { kind: 'pass' } | IntakeReply

/** The `boatState` projection value: tool state accumulated by dot-path deep merge of `tool/result.meta.boat.stateDelta`. */
export type BoatStateValue = { [key: string]: JsonValue }

/** Payload of the boat driver's pre-assembly events. */
export interface BoatStepPayload {
  agent: Agent
  /** The messages claimed for this step, before admission. */
  messages: UserMessage[]
  turn: number
  step: number
  signal: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Intake gate, dispatched by the boat driver after the inbox claim and
     * before prompt assembly, so before (and, on a reply, instead of)
     * `agent/pre-step`. A `reply` answers the claimed messages with a fixed
     * assistant message inside one step without a model request; the turn
     * then ends unless next-step input is already queued. The default
     * `next()` passes. Scope-filtered: agent-scoped listeners receive only
     * their agent. Never dispatched by the official driver.
     * @mode waterfall
     */
    'boat/intake'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<IntakeDecision>): Promise<IntakeDecision>
    /**
     * Pre-assembly hook, dispatched after `boat/intake` passed and before the
     * system prompt is assembled: skill routing and tool activation done here
     * shape the request of this very step. Scope-filtered. Never dispatched by
     * the official driver.
     * @mode waterfall
     */
    'boat/pre-assemble'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<void>): Promise<void>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The skill router's decision for a turn, or a model-initiated activation.
     * Written before the step's `system/message`; the `boatActiveSkill`
     * projection and the `boat:skill` runtime context derive from it.
     */
    'boat/skill-routed': { turn: number; skill: string | null; reason: string; source: 'router' | 'model' }
    /** Audit record of one router model call, written before the `boat/skill-routed` it may lead to. */
    'boat/route-request': {
      turn: number
      route: { provider: string; model: string }
      candidates: string[]
      decision: string | null
      reason: string
      durationMs: number
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Session tool state (host fold of `tool/result.meta.boat.stateDelta`), owned by `@boat/tool-policy`. */
    boatState: BoatStateValue
    /** The skill active for the session (the last `boat/skill-routed`), owned by `@boat/skill-router`; null before routing. */
    boatActiveSkill: string | null
    /** Cards from `tool/result.meta.boat.card`, in log order; a `surfaceUpdate` replaces its surface. Owned by `@boat/a2ui`. */
    boatCards: BoatCard[]
  }
  interface SessionProjectionMap {
    /** Session tool state as the client sees it: the fold state itself. */
    boatState: BoatStateValue
    /** The active skill as the client sees it. */
    boatActiveSkill: string | null
    /** Every card rendered in the session, as the client sees it. */
    boatCards: BoatCard[]
  }
}
