/**
 * One turn's run metrics, folded from the session events the turn appends,
 * from its `turn/start` to its `turn/end`: steps, model requests (answers and
 * failed attempts that streamed), side calls, tool calls paired with their
 * results (dsh's `skill` tool, a skill load, left out), the skills active
 * during the turn, the first content (the first answer text streamed, or an
 * immediate card, or an answer without a stream), and the outcome from the
 * turn's reason (a completed turn the admission answered is `rejected`).
 * @module @lyteboat/run-metrics/run-metric-turn
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LYTEBOAT_ASSISTANT_PROVIDER, LYTEBOAT_TURN_OUTCOME_OF_REASON, lyteboatRequestSchema, lyteboatResultMetaSchema, type JsonValue, type LyteboatRequestOwner, type LyteboatRunMetric } from '@lyteboat/contracts'

/** dsh's tool that loads a skill: it is part of routing, not work the dashboard counts. */
const SKILL_LOAD_TOOL = 'skill'

type RunMetricTool = LyteboatRunMetric['tools'][number]

function ownerOf(source: { kind: string }): LyteboatRequestOwner | undefined {
  // The stored request rides the human message's source only when the caller recorded one.
  const parsed = lyteboatRequestSchema.safeParse((source as { lyteboatRequest?: unknown }).lyteboatRequest)
  return parsed.success ? parsed.data.owner : undefined
}

function hasImmediateCard(meta: JsonValue | undefined): boolean {
  const carried = typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? meta['lyteboat'] : undefined
  const parsed = lyteboatResultMetaSchema.safeParse(carried ?? {})
  return parsed.success && (parsed.data.cards ?? []).some(card => card.emission === 'immediate')
}

/** When an answer's first visible text arrived: its first non-blank streamed text, else the answer itself when it has text. */
function firstTextTime(event: SessionEvent<'assistant/message'>): number | undefined {
  for (const record of event.data.stream) {
    if (record.type === 'text-chunks' && record.texts.some(text => text.trim() !== '')) return record.time0
  }
  const hasText = event.data.message.content.some(block => block.type === 'text' && block.text.trim() !== '')
  return hasText ? event.time : undefined
}

/** The fold of one turn. */
export class RunMetricTurn {
  private steps = 0
  private modelRequests = 0
  private auxCalls = 0
  private firstContentAt: number | undefined
  private owner: LyteboatRequestOwner | undefined
  private answeredByAdmission = false
  private readonly tools: RunMetricTool[] = []
  private readonly calls = new Map<string, { tool: RunMetricTool; time: number }>()
  private readonly activatedSkills: string[] = []
  private activeSkill: string | undefined

  constructor(readonly agentId: string, readonly sessionId: string, readonly turn: number, readonly startedAt: number) {}

  /** Take one event the turn appended. */
  add(event: SessionEvent): void {
    switch (event.type) {
      case 'step/start':
        this.steps++
        return
      case 'user/message':
        if (event.data.source.kind === 'user') this.owner ??= ownerOf(event.data.source)
        return
      case 'assistant/attempt':
        if (event.data.stream.length > 0) this.modelRequests++
        return
      case 'assistant/message': return this.answer(event)
      case 'tool/call': return this.toolCall(event)
      case 'tool/result': return this.toolResult(event)
      case 'lyteboat/aux-llm-call':
        this.auxCalls++
        return
      default:
        return
    }
  }

  /** The skill active after the latest event, as the session's projection folds it. */
  noteActiveSkill(skill: string | null | undefined): void {
    if (skill === null || skill === undefined) return
    this.activeSkill = skill
    if (!this.activatedSkills.includes(skill)) this.activatedSkills.push(skill)
  }

  /** The turn's metric, from its `turn/end`. */
  ended(event: SessionEvent<'turn/end'>): LyteboatRunMetric {
    const { reason } = event.data
    const outcome = LYTEBOAT_TURN_OUTCOME_OF_REASON[reason.kind] ?? 'errored'
    const durationMs = Math.max(0, event.time - this.startedAt)
    return {
      agentId: this.agentId,
      sessionId: this.sessionId,
      turn: this.turn,
      ...this.owner === undefined ? {} : { owner: this.owner },
      startedAt: this.startedAt,
      durationMs,
      firstContentMs: this.firstContentAt === undefined ? durationMs : Math.max(0, this.firstContentAt - this.startedAt),
      steps: this.steps,
      modelRequests: this.modelRequests,
      auxCalls: this.auxCalls,
      tools: this.tools,
      activatedSkills: this.activatedSkills,
      ...this.activeSkill === undefined ? {} : { activeSkill: this.activeSkill },
      outcome: outcome === 'completed' && this.answeredByAdmission ? 'rejected' : outcome,
      ...reason.kind === 'error' ? { errorCode: reason.error.code } : {},
    }
  }

  private answer(event: SessionEvent<'assistant/message'>): void {
    if (event.surfaceOp !== 'append') return
    if (event.data.stream.length > 0) this.modelRequests++
    if (event.data.message.source.provider === LYTEBOAT_ASSISTANT_PROVIDER) this.answeredByAdmission = true
    this.firstContentAt ??= firstTextTime(event)
  }

  private toolCall(event: SessionEvent<'tool/call'>): void {
    if (event.data.name === SKILL_LOAD_TOOL) return
    const tool: RunMetricTool = { name: event.data.name, isError: false }
    this.tools.push(tool)
    this.calls.set(event.data.callId, { tool, time: event.time })
  }

  private toolResult(event: SessionEvent<'tool/result'>): void {
    if (event.surfaceOp !== 'append') return
    if (hasImmediateCard(event.data.meta)) this.firstContentAt ??= event.time
    const call = this.calls.get(event.data.message.toolCallId)
    if (call === undefined) return
    call.tool.durationMs = Math.max(0, event.time - call.time)
    call.tool.isError = event.data.message.isError === true
    if (event.data.error !== undefined) call.tool.errorCode = event.data.error.code
  }
}
