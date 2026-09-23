/**
 * boat's extensions of the agent loop (compatibility/contract/extensions.yml:
 * `agent-loop-intake`, `agent-loop-pre-assemble`): the declarations of the two
 * waterfalls the loop dispatches after the inbox claim and before prompt
 * assembly, and of the decision an intake listener returns. The official
 * driver has neither event; a plugin that listens to them declares
 * `inject: ['boatDistro']`.
 * @module @deepseek-ai/dsh-agent-loop/boat/step-hooks
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Scoped } from '@deepseek-ai/dsh-scope'

/** `provider` of every assistant message boat writes without a model call, such as an intake reply. */
export const BOAT_ASSISTANT_PROVIDER = 'boat'

/**
 * An intake listener's answer to the claimed messages, without a model call.
 * The loop logs it as an ordinary assistant message whose `source` is
 * `{ provider: 'boat', model: plugin }`; no other node records it.
 */
export interface BoatIntakeReply {
  kind: 'reply'
  /** The deciding plugin; recorded as the assistant message's `model`. */
  plugin: string
  /** The reply's blocks. A tool call cannot be replied: nothing would execute it. */
  content: Exclude<ContentBlock, { type: 'tool-call' }>[]
}

/** An intake listener's verdict: let the step proceed, or answer it. */
export type BoatIntakeDecision = { kind: 'pass' } | BoatIntakeReply

/** Payload of the loop's pre-assembly events. */
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
     * Intake gate, dispatched after the inbox claim and before prompt
     * assembly, so before (and, on a reply, instead of) `agent/pre-step`. A
     * `reply` answers the claimed messages with a fixed assistant message
     * inside one step without a model request; the turn then ends unless
     * next-step input is already queued. The default `next()` passes.
     * Scope-filtered: agent-scoped listeners receive only their agent.
     * @mode waterfall
     */
    'boat/intake'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<BoatIntakeDecision>): Promise<BoatIntakeDecision>
    /**
     * Pre-assembly hook, dispatched after `boat/intake` passed and before the
     * system prompt is assembled: skill routing and tool activation done here
     * shape the request of this very step. Scope-filtered.
     * @mode waterfall
     */
    'boat/pre-assemble'(this: Scoped<Agent>, payload: BoatStepPayload, next: () => Promise<void>): Promise<void>
  }
}
