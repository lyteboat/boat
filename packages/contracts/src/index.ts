/**
 * boat's contract extensions over the dsh seams. Types and constants only:
 * the tool and skill metadata boat plugins consume, the `boat/*` events the
 * boat driver dispatches, the log nodes boat plugins append, and the
 * projection keys they publish. Declared here, by declaration merging onto
 * the dsh maps, so that providers and consumers depend on this package and
 * never on each other — the same rule dsh applies to its own seams.
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

/** boat-side metadata registered beside a dsh ToolDefinition (ark's AgentTool fields). */
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

/** One rendered A2UI card. */
export interface BoatCard {
  /** The tool call that produced the card; absent for cards an intake reply attached. */
  callId?: string
  surfaceId: string
  payload: JsonValue
}

/** An intake listener's verdict: let the step proceed, or answer without a model call. */
export interface IntakeReply {
  kind: 'reply'
  /** The deciding plugin; recorded as the assistant message's `model` and in `boat/intake-decided`. */
  plugin: string
  content: ContentBlock[]
  reason?: string
  cards?: BoatCard[]
}

export type IntakeDecision = { kind: 'pass' } | IntakeReply

/** The `boatState` projection value: tool state accumulated by dot-path deep merge of `boat/state` deltas. */
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
     * before prompt assembly. A `reply` answers the claimed messages with a
     * fixed assistant message and closes the turn without a model request.
     * The default `next()` passes. Scope-filtered: agent-scoped listeners
     * receive only their agent. Never dispatched by the official driver.
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
    /** An intake listener answered the step without a model call. */
    'boat/intake-decided': { turn: number; step: number; plugin: string; reason?: string }
    /** A rendered card outside a tool result (intake replies); tool cards ride `tool/result.meta`. */
    'boat/card': { turn: number; step: number; callId?: string; surfaceId: string; payload: JsonValue }
    /** The skill router's decision for a turn, or a model-initiated activation. */
    'boat/skill-routed': { turn: number; skill: string | null; reason: string; source: 'router' | 'model' }
    /** Audit record of one router model call. */
    'boat/route-request': {
      turn: number
      route: { provider: string; model: string }
      candidates: string[]
      decision: string | null
      reason: string
      durationMs: number
    }
    /** A tool result's state delta, folded into the `boatState` projection. */
    'boat/state': { callId: string; delta: JsonValue }
    /** External history rounds imported as this session's seed. */
    'boat/history-imported': { source: string; traceIds: string[]; rounds: number }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Session tool state (host fold), owned by `@boat/tool-policy`. */
    boatState: BoatStateValue
    /** The skill active for the session (the last `boat/skill-routed`), owned by `@boat/skill-router`; null before routing. */
    boatActiveSkill: string | null
    /** Cards from `tool/result.meta.boat.card` and `boat/card` nodes, in log order; a `surfaceUpdate` replaces its surface. Owned by `@boat/a2ui`. */
    boatCards: BoatCard[]
    /** Trace ids of every round `boat/history-imported` recorded, in log order. Owned by `@boat/history-import`. */
    boatImportedTraces: string[]
  }
  interface SessionProjectionMap {
    /** Session tool state as the client sees it: the fold state itself. */
    boatState: BoatStateValue
    /** The active skill as the client sees it. */
    boatActiveSkill: string | null
    /** Every card rendered in the session, as the client sees it. */
    boatCards: BoatCard[]
    /** The trace ids of every imported history round, as the client sees it. */
    boatImportedTraces: string[]
  }
}
