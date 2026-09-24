/**
 * lyteboat's contract extensions over the dsh seams. Types and constants only:
 * the tool and skill metadata lyteboat plugins consume, the `lyteboat/*` step events
 * (declared by lyteboat's kernel agent loop, re-exported here), the log nodes lyteboat
 * plugins append, and the projection keys they publish. Declared here, by declaration merging onto
 * the dsh maps, so that providers and consumers depend on this package and
 * never on each other — the same rule dsh applies to its own seams.
 *
 * Session log vocabulary: dsh's persistence layer refuses to reopen a log
 * that carries an event type outside its compiled catalog unless the event is
 * marked `ignorable`, and `Session.append` cannot set that mark. Every lyteboat
 * fact therefore rides an envelope dsh already knows — `tool/result.meta`
 * for cards and state deltas, the assistant message `source` for a reply's
 * author — except the skill router's two nodes, which have no existing
 * envelope and keep a routed session from reopening until dsh offers a
 * write path for the mark.
 * @module @lyteboat/contracts
 */

import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Lossless JSON, the only shape session logs and projections may carry. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * The kernel's pre-assembly step events (`lyteboat/intake`, `lyteboat/pre-assemble`)
 * and their payloads are declared by lyteboat's agent loop
 * (dsh/core/agent-loop/src/lyteboat/step-hooks.ts, dsh-compat/contract/extensions.yml), which
 * cannot import this package; plugins read them from here.
 * `LYTEBOAT_ASSISTANT_PROVIDER` is the provider of every assistant message lyteboat
 * writes without a model call (intake replies, imported history).
 */
export { LYTEBOAT_ASSISTANT_PROVIDER } from '@deepseek-ai/dsh-agent-loop'
export type {
  LyteboatIntakeDecision as IntakeDecision,
  LyteboatIntakeReply as IntakeReply,
  LyteboatStepPayload,
} from '@deepseek-ai/dsh-agent-loop'

/** One extension of the kernel contract that this lyteboat build carries, as dsh-compat/contract/extensions.yml registers it. */
export interface LyteboatDistroExtension {
  /** The registry id (`agent-loop-intake`, …). */
  id: string
  /** The kernel package the extension lives in. */
  package: string
  /** `event`, `api`, `api-option`, `service`, or `config`. */
  kind: string
  /** The lyteboat and dsh versions that introduced it. */
  since: string
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
 * them as conversation, not as context. dsh's V3→V4 session migration turns a
 * V3 `{ kind: 'plugin', plugin: 'lyteboat-history-import' }` into this same kind.
 */
export const LYTEBOAT_HISTORY_IMPORT_SOURCE = 'plugin:lyteboat-history-import'

/** `source.kind` of the skill router's own request message (a side model call, never logged). */
export const LYTEBOAT_SKILL_ROUTER_SOURCE = 'plugin:lyteboat-skill-router'

/** When a tool's schema reaches the model: always, or only after a skill (or a plugin) activated it. */
export type LyteboatToolVisibility = 'always' | 'auto'

/** lyteboat-side metadata registered beside a dsh ToolDefinition (the reference AgentTool fields). */
export interface LyteboatToolMeta {
  /** Defaults to `always`. */
  visibility?: LyteboatToolVisibility
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

/** lyteboat-side skill metadata: the `metadata.lyteboat` object of a SKILL.md frontmatter. */
export interface LyteboatSkillMeta {
  group?: string
  /** Tools the skill needs; activated (made visible) when the skill is routed. */
  requiredTools?: string[]
  version?: string
  tags?: string[]
}

/** One rendered A2UI card, as `tool/result.meta.lyteboat.card` carries it. */
export interface LyteboatCard {
  /** The tool call that produced the card. */
  callId: string
  surfaceId: string
  payload: JsonValue
}

/** The `lyteboatState` projection value: tool state accumulated by dot-path deep merge of `tool/result.meta.lyteboat.stateDelta`. */
export type LyteboatStateValue = { [key: string]: JsonValue }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Imported history rounds, written by `@lyteboat/history-import` into a session seed. */
    'plugin:lyteboat-history-import': { kind: typeof LYTEBOAT_HISTORY_IMPORT_SOURCE }
    /** The skill router's request to its route model, owned by `@lyteboat/skill-router`. */
    'plugin:lyteboat-skill-router': { kind: typeof LYTEBOAT_SKILL_ROUTER_SOURCE }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The skill router's decision for a turn, or a model-initiated activation.
     * Written before the step's `system/message`; the `lyteboatActiveSkill`
     * projection and the `lyteboat:skill` runtime context derive from it.
     */
    'lyteboat/skill-routed': { turn: number; skill: string | null; reason: string; source: 'router' | 'model' }
    /** Audit record of one router model call, written before the `lyteboat/skill-routed` it may lead to. */
    'lyteboat/route-request': {
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
    /** Session tool state (host fold of `tool/result.meta.lyteboat.stateDelta`), owned by `@lyteboat/tool-policy`. */
    lyteboatState: LyteboatStateValue
    /** The skill active for the session (the last `lyteboat/skill-routed`), owned by `@lyteboat/skill-router`; null before routing. */
    lyteboatActiveSkill: string | null
    /** Cards from `tool/result.meta.lyteboat.card`, in log order; a `surfaceUpdate` replaces its surface. Owned by `@lyteboat/a2ui`. */
    lyteboatCards: LyteboatCard[]
  }
  interface SessionProjectionMap {
    /** Session tool state as the client sees it: the fold state itself. */
    lyteboatState: LyteboatStateValue
    /** The active skill as the client sees it. */
    lyteboatActiveSkill: string | null
    /** Every card rendered in the session, as the client sees it. */
    lyteboatCards: LyteboatCard[]
  }
}
