/**
 * The routing prompt and decision rules, ported from the reference LLMSkillRouter
 * (core/skills/router.py) with the runner's sticky rule folded in: the result
 * is the skill that is active AFTER the decision, so a null, an unknown id,
 * a malformed reply, a timeout, or a failure all keep the current skill.
 * @module @boat/skill-router/router
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { BOAT_HISTORY_IMPORT_SOURCE } from '@boat/contracts'

/** The reference router system prompt, verbatim (the scripted test model classifies router requests by it). */
export const SKILL_ROUTER_SYSTEM_PROMPT = '你是一个 skill 路由器。根据用户对话上下文，从可用 skill 列表中选择最匹配的一个。\n仅输出严格 JSON：{"skill_id": "<id 或 null>", "reason": "<≤30字>"}，不要包含其它文本。'

export interface RouteCandidate {
  readonly name: string
  readonly description: string
}

export interface RoutePromptInput {
  readonly candidates: readonly RouteCandidate[]
  readonly history: readonly string[]
  readonly current: string | null
  readonly userInput: string
}

/** The active skill after a routing decision, with the reason recorded for audit. */
export interface RouteDecision {
  readonly skill: string | null
  readonly reason: string
}

/** The reference `_build_user_prompt`. */
export function buildRoutePrompt(input: RoutePromptInput): string {
  const skills = input.candidates.map(candidate => `  - id: ${candidate.name}\n    description: ${candidate.description}`).join('\n')
  const history = input.history.length === 0 ? '(empty)' : input.history.join('\n')
  return [
    '<task>从可用 skill 列表中为用户当前输入选择最匹配的一个，或返回 null。</task>',
    '',
    `<available_skills>\n${skills}\n</available_skills>`,
    '',
    `<conversation_history>\n${history}\n</conversation_history>`,
    '',
    `<current_active_skill>${input.current ?? 'none'}</current_active_skill>`,
    '',
    `<latest_user_input>${input.userInput}</latest_user_input>`,
    '',
    '<rules>',
    '1. 用户输入若是省略主语的追问 / 延续同主题，保持 current_active_skill。',
    '2. 用户明显切换主题，选最匹配的新 skill。',
    '3. 输入若是寒暄 / 闲聊 / 与所有 skill 无关，返回 null。',
    '4. 当前已激活的 skill 优先尊重，除非有明确切换信号。',
    '</rules>',
    '',
    '<output_format>严格 JSON: {"skill_id": "<id 或 null>", "reason": "<≤30字>"}</output_format>',
  ].join('\n')
}

/** Strip a ```json fence, as the reference implementation tolerates. */
function unfence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.split('\n').filter(line => !line.trim().startsWith('```')).join('\n').trim()
}

/**
 * The reference `_parse_decision` plus the runner's sticky rule.
 * @param raw - the model's text.
 * @param candidates - the candidate names offered.
 * @param current - the skill active before the decision.
 */
export function resolveRouteDecision(raw: string, candidates: readonly string[], current: string | null): RouteDecision {
  let data: unknown
  try {
    data = JSON.parse(unfence(raw))
  } catch {
    return { skill: current, reason: 'parse_error' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { skill: current, reason: 'not_an_object' }
  const record = data as { skill_id?: unknown; reason?: unknown }
  const reason = String(record.reason ?? '').slice(0, 80)
  const id = record.skill_id
  if (id === null || id === undefined) return { skill: current, reason }
  if (typeof id !== 'string') return { skill: current, reason: 'invalid_id_type' }
  if (!candidates.includes(id)) return { skill: current, reason: 'invalid_id' }
  return { skill: id, reason }
}

const HISTORY_CAP = 200

function cap(text: string): string {
  return text.length <= HISTORY_CAP ? text : `${text.slice(0, HISTORY_CAP)}…`
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * The reference `render_history_line` over the session's derived messages: the last
 * `window` user turns, assistant replies and tool results; prompt snapshots,
 * catalogs and other plugin-sourced messages are not conversation.
 * @param messages - the derived model-facing history.
 * @param window - how many rendered lines to keep from the end; 0 keeps none.
 */
export function renderHistory(messages: readonly Message[], window: number): string[] {
  if (window <= 0) return []
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      if (text !== '') {
        lines.push(`assistant: ${cap(text)}`)
        continue
      }
      const calls = message.content.filter(block => block.type === 'tool-call').map(block => block.name)
      if (calls.length > 0) lines.push(`assistant: [calling tools: ${calls.join(', ')}]`)
      continue
    }
    if (message.role === 'tool') {
      lines.push(`tool: ${cap(textOf(message.content))}`)
      continue
    }
    if (message.role !== 'user') continue
    // Imported history rounds are conversation; every other producer's user message is context.
    if (message.source.kind !== 'user' && message.source.kind !== BOAT_HISTORY_IMPORT_SOURCE) continue
    const text = textOf(message.content)
    if (text !== '') lines.push(`user: ${cap(text)}`)
  }
  return lines.slice(-window)
}
