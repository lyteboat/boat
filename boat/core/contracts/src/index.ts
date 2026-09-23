/**
 * boat's contract extensions over the dsh seams. Types and constants only:
 * the tool and skill metadata boat plugins consume, the `boat/*` step events
 * (declared by boat's kernel agent loop, re-exported here), the log nodes boat
 * plugins append, and the projection keys they publish. Declared here, by declaration merging onto
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

import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Lossless JSON, the only shape session logs and projections may carry. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * The kernel's pre-assembly step events (`boat/intake`, `boat/pre-assemble`)
 * and their payloads are declared by boat's agent loop
 * (dsh/core/agent-loop/src/boat/step-hooks.ts, compatibility/contract/extensions.yml), which
 * cannot import this package; plugins read them from here.
 * `BOAT_ASSISTANT_PROVIDER` is the provider of every assistant message boat
 * writes without a model call (intake replies, imported history).
 */
export { BOAT_ASSISTANT_PROVIDER } from '@deepseek-ai/dsh-agent-loop'
export type {
  BoatIntakeDecision as IntakeDecision,
  BoatIntakeReply as IntakeReply,
  BoatStepPayload,
} from '@deepseek-ai/dsh-agent-loop'

/** One extension of the kernel contract that this boat build carries, as compatibility/contract/extensions.yml registers it. */
export interface BoatDistroExtension {
  /** The registry id (`agent-loop-intake`, …). */
  id: string
  /** The kernel package the extension lives in. */
  package: string
  /** `event`, `api`, `api-option`, `service`, or `config`. */
  kind: string
  /** The boat and dsh versions that introduced it. */
  since: string
}

/**
 * The `boatDistro` service (@boat/distro): present only on boat, so a plugin
 * that uses a kernel extension declares `inject: ['boatDistro']` and does not
 * load on the official release, where the extension does not exist.
 */
export interface BoatDistro {
  /** The dsh release the kernel was imported from. */
  readonly dsh: string
  /** Every kernel extension this build carries. */
  readonly extensions: readonly BoatDistroExtension[]
  /** Whether this build carries the extension registered under `id`. */
  has(id: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    boatDistro: BoatDistro
  }
}

/**
 * `source.kind` of the user messages imported history writes; consumers treat
 * them as conversation, not as context. dsh's V3→V4 session migration turns a
 * V3 `{ kind: 'plugin', plugin: 'boat-history-import' }` into this same kind.
 */
export const BOAT_HISTORY_IMPORT_SOURCE = 'plugin:boat-history-import'

/** `source.kind` of the skill router's own request message (a side model call, never logged). */
export const BOAT_SKILL_ROUTER_SOURCE = 'plugin:boat-skill-router'

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

/** One rendered A2UI card, as `tool/result.meta.boat.card` carries it. */
export interface BoatCard {
  /** The tool call that produced the card. */
  callId: string
  surfaceId: string
  payload: JsonValue
}

/** The `boatState` projection value: tool state accumulated by dot-path deep merge of `tool/result.meta.boat.stateDelta`. */
export type BoatStateValue = { [key: string]: JsonValue }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Imported history rounds, written by `@boat/history-import` into a session seed. */
    'plugin:boat-history-import': { kind: typeof BOAT_HISTORY_IMPORT_SOURCE }
    /** The skill router's request to its route model, owned by `@boat/skill-router`. */
    'plugin:boat-skill-router': { kind: typeof BOAT_SKILL_ROUTER_SOURCE }
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
