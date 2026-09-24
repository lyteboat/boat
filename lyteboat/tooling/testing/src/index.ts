/**
 * lyteboat's unit-test harness: mount the dsh services a driver needs, and script
 * the model in process. Tests mount the driver and the lyteboat services under test
 * themselves, so load order stays the test's decision.
 * @module @lyteboat/testing
 */

import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config as ToolRuntimeConfig } from '@deepseek-ai/dsh-tools'

export { MockAdapter, maxTokensResponse, textResponse, toolCallResponse, type HangAfter } from './mock-adapter.ts'

/** Configuration forwarded to the mounted dsh services. */
export interface DshTestServicesOptions {
  /** Configuration for the system-prompt registry. */
  readonly systemPrompt?: SystemPromptConfig
  /** Configuration for the tool registry. */
  readonly tools?: ToolRuntimeConfig
}

/**
 * Mount the dsh services a driver injects: llm, sessions, projections, system
 * prompt, tools, and the agent registry. The context owns every service; a
 * failed plugin load rejects and leaves earlier services for the context to unwind.
 * @param ctx - test context that owns the mounted services.
 * @param options - service configuration, forwarded unchanged.
 * @returns after every service has activated.
 */
export async function mountDshTestServices(ctx: Context, options: DshTestServicesOptions = {}): Promise<void> {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, options.systemPrompt ?? {})
  await ctx.plugin(ToolRuntime, options.tools ?? {})
  await ctx.plugin(AgentRegistry)
}
