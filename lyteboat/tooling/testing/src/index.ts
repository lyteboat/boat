/**
 * lyteboat's unit-test harness: the unit host (a context with dsh's invariants,
 * the dsh services, the kernel's agent loop, and a scripted adapter), the
 * in-process MockAdapter, and the follow-up step every agent-loop test takes. Tests
 * mount the lyteboat services under test on the host themselves, so their load
 * order stays the test's decision.
 * @module @lyteboat/testing
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness, type AgentLoopTestDependenciesOptions } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createUserMessage, type LlmAdapter, type UserMessage } from '@deepseek-ai/dsh-llm'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import { onTestFinished } from 'vitest'

export { MockAdapter, maxTokensResponse, textResponse, toolCallResponse, type HangAfter } from './mock-adapter.ts'

/** Configuration forwarded to the mounted dsh services. */
export type DshTestServicesOptions = AgentLoopTestDependenciesOptions

/**
 * Mount the dsh services the agent loop injects: llm, sessions, projections, system
 * prompt, tools, and the agent registry, through the kernel testkit's own
 * mounting. The context owns every service; a failed plugin load rejects and
 * leaves earlier services for the context to unwind.
 * @param ctx - test context that owns the mounted services.
 * @param options - service configuration, forwarded unchanged.
 * @returns after every service has activated.
 */
export async function mountDshTestServices(ctx: Context, options: DshTestServicesOptions = {}): Promise<void> {
  await mountAgentLoopTestDependencies(ctx, options)
}

/**
 * Build a unit host for the running test: a fresh context with dsh's invariant
 * registry and the session, agent, and agent-loop companions, the dsh services,
 * the kernel's agent loop, and `adapter` serving the `mock` provider. The host
 * disposes itself when the test finishes, so call it from a test body.
 * @param adapter - the scripted model.
 * @param options - dsh service configuration, forwarded unchanged.
 * @returns the host context; the test mounts the lyteboat services under test on it.
 */
export async function createLyteboatUnitHost(adapter: LlmAdapter, options: DshTestServicesOptions = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await mountDshTestServices(ctx, options)
  await mountAgentLoopTestHarness(ctx)
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  return ctx
}

/**
 * Follow up on an agent and wait until it is idle again.
 * @param agent - the agent under test.
 * @param input - the message, or the text of a plain user message.
 * @returns once the agent has settled every step the message started.
 */
export async function followUpAndWait(agent: Agent, input: string | UserMessage): Promise<void> {
  agent.followup(typeof input === 'string' ? createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }) : input)
  await agent.whenIdle()
}
