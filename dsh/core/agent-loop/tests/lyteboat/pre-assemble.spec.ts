/**
 * lyteboat extension `agent-loop-pre-assemble` (dsh-compat/contract/extensions.yml): the
 * hook between a passed intake and prompt assembly.
 */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from '../mock-adapter.ts'

it('lyteboat/pre-assemble runs before assembly, so a section registered there reaches this step\'s request', async () => {
  const adapter = new MockAdapter([textResponse('ok')])
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  let registered = false
  ctx.on('lyteboat/pre-assemble', async (payload, next) => {
    if (!registered) {
      registered = true
      payload.agent.ctx.systemPrompt.section({ name: 'lyteboat:test-mark', order: 5, text: 'PRE-ASSEMBLE-MARK' })
    }
    return next()
  })
  const agent = await ctx.agentLoop.create(SessionId('pre-assemble'), { provider: 'mock', model: 'mock' })

  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(1)
  const system = adapter.requests[0]?.messages[0]
  expect(system?.role).toBe('system')
  expect(JSON.stringify(system?.content)).toContain('PRE-ASSEMBLE-MARK')
})
