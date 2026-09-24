import { describe, expect, it } from 'vitest'
import { createToolResultMessage, createUserMessage, ToolCallId, type Message } from '@deepseek-ai/dsh-llm'
import { buildRoutePrompt, renderHistory, resolveRouteDecision, SKILL_ROUTER_SYSTEM_PROMPT } from '@lyteboat/skill-router'

describe('resolveRouteDecision', () => {
  const candidates = ['asset-overview', 'market-news']

  it('switches to a valid candidate and keeps the model reason', () => {
    expect(resolveRouteDecision('{"skill_id": "market-news", "reason": "问行情"}', candidates, 'asset-overview'))
      .toEqual({ skill: 'market-news', reason: '问行情' })
  })

  it('tolerates a json fence', () => {
    expect(resolveRouteDecision('```json\n{"skill_id": "asset-overview", "reason": "r"}\n```', candidates, null))
      .toEqual({ skill: 'asset-overview', reason: 'r' })
  })

  it('keeps the current skill on null, unknown ids, wrong types, and malformed replies', () => {
    expect(resolveRouteDecision('{"skill_id": null, "reason": "闲聊"}', candidates, 'asset-overview')).toEqual({ skill: 'asset-overview', reason: '闲聊' })
    expect(resolveRouteDecision('{"skill_id": null, "reason": "闲聊"}', candidates, null)).toEqual({ skill: null, reason: '闲聊' })
    expect(resolveRouteDecision('{"skill_id": "nope"}', candidates, 'asset-overview')).toEqual({ skill: 'asset-overview', reason: 'invalid_id' })
    expect(resolveRouteDecision('{"skill_id": 3}', candidates, 'asset-overview')).toEqual({ skill: 'asset-overview', reason: 'invalid_id_type' })
    expect(resolveRouteDecision('not json', candidates, 'asset-overview')).toEqual({ skill: 'asset-overview', reason: 'parse_error' })
    expect(resolveRouteDecision('[1]', candidates, 'asset-overview')).toEqual({ skill: 'asset-overview', reason: 'not_an_object' })
  })

  it('caps the reason at 80 characters', () => {
    const decision = resolveRouteDecision(`{"skill_id": "market-news", "reason": "${'x'.repeat(100)}"}`, candidates, null)
    expect(decision.reason).toHaveLength(80)
  })
})

describe('buildRoutePrompt', () => {
  it('renders the reference sections in order', () => {
    const prompt = buildRoutePrompt({
      candidates: [{ name: 'asset-overview', description: '资产总览' }],
      history: ['user: 你好', 'assistant: 您好'],
      current: null,
      userInput: '看看资产',
    })
    expect(prompt).toContain('<available_skills>\n  - id: asset-overview\n    description: 资产总览\n</available_skills>')
    expect(prompt).toContain('<conversation_history>\nuser: 你好\nassistant: 您好\n</conversation_history>')
    expect(prompt).toContain('<current_active_skill>none</current_active_skill>')
    expect(prompt).toContain('<latest_user_input>看看资产</latest_user_input>')
    expect(prompt.indexOf('<task>')).toBeLessThan(prompt.indexOf('<available_skills>'))
    expect(prompt.indexOf('<rules>')).toBeLessThan(prompt.indexOf('<output_format>'))
    expect(SKILL_ROUTER_SYSTEM_PROMPT).toContain('skill 路由器')
  })

  it('renders an empty history as (empty)', () => {
    expect(buildRoutePrompt({ candidates: [], history: [], current: 'x', userInput: 'y' })).toContain('<conversation_history>\n(empty)\n</conversation_history>')
  })
})

describe('renderHistory', () => {
  const user = (text: string): Message => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const plugin = (text: string): Message => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'model-selection' } })
  const assistant = (content: Message['content']): Message => ({ role: 'assistant', content, source: { kind: 'model', provider: 'mock', model: 'mock' } } as unknown as Message)

  it('renders user text, assistant text or tool calls, and tool results; skips plugin messages', () => {
    const messages: Message[] = [
      plugin('snapshot'),
      user('你好'),
      assistant([{ type: 'tool-call', id: ToolCallId('c1'), name: 'lookup', arguments: '{}' }]),
      createToolResultMessage({ callId: ToolCallId('c1'), content: [{ type: 'text', text: 'total 5' }], isError: false }),
      assistant([{ type: 'text', text: '总资产 5' }]),
    ]
    expect(renderHistory(messages, 6)).toEqual(['user: 你好', 'assistant: [calling tools: lookup]', 'tool: total 5', 'assistant: 总资产 5'])
  })

  it('keeps only the last window lines and none for a zero window', () => {
    const messages = [user('1'), user('2'), user('3')]
    expect(renderHistory(messages, 2)).toEqual(['user: 2', 'user: 3'])
    expect(renderHistory(messages, 0)).toEqual([])
  })
})
