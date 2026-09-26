/**
 * One turn fed as it happens: streamed text between the session's events
 * shows what the finished log shows.
 */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LyteboatLiveTurn } from '../src/live-turn.ts'
import type { LyteboatTurnPart } from '../src/turn-parts.ts'

const event = (type: string, data: unknown, surfaceOp?: 'append'): SessionEvent => ({ type, seq: 0, time: 0, data, ...surfaceOp === undefined ? {} : { surfaceOp } }) as never
const stepStart = (step: number): SessionEvent => event('step/start', { turn: 1, step })
const answer = (text: string): SessionEvent => event('assistant/message', { turn: 1, step: 2, message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'mock', model: 'mock' } }) })
const toolResult: SessionEvent = event('tool/result', { message: { toolCallId: 'call-1' }, meta: { lyteboat: { cards: [{ surfaceId: 'overview-1', area: 'overview', emission: 'deferred', payload: {} }] } } }, 'append')
const turnEnd: SessionEvent = event('turn/end', { turn: 1, reason: { kind: 'completed' } })

const shape = (parts: readonly LyteboatTurnPart[]): string[] => parts.map(part => part.kind === 'text' ? part.text : `<${part.card.surfaceId}>`)

function replay(events: readonly SessionEvent[]): string[] {
  const turn = new LyteboatLiveTurn()
  for (const each of events) turn.event(each)
  return shape(turn.parts())
}

describe('LyteboatLiveTurn', () => {
  const log = [stepStart(1), toolResult, stepStart(2), answer('您的资产[[card:overview]]。以上。'), turnEnd]

  it('shows what the log shows when the answer streamed in pieces before its message settled', () => {
    const turn = new LyteboatLiveTurn()
    const shown: LyteboatTurnPart[] = []
    shown.push(...turn.event(stepStart(1)), ...turn.event(toolResult), ...turn.event(stepStart(2)))
    for (const piece of ['您的资产[[ca', 'rd:overview]]', '。以上。']) shown.push(...turn.delta(piece, 2))
    shown.push(...turn.event(answer('您的资产[[card:overview]]。以上。')), ...turn.event(turnEnd))

    expect(shape(turn.parts())).toEqual(replay(log))
    expect(shape(shown)).toEqual(['您的资产', '<overview-1>', '以上。'])
  })

  it('adds the part of a settled message its stream did not show, as an in-loop reply that never streams', () => {
    const turn = new LyteboatLiveTurn()
    turn.event(stepStart(1))
    turn.event(toolResult)
    turn.event(stepStart(2))
    turn.delta('您的资产', 2)
    turn.event(answer('您的资产[[card:overview]]。以上。'))
    turn.event(turnEnd)

    expect(shape(turn.parts())).toEqual(replay(log))
  })

  it('keeps text an abandoned attempt streamed when the settled message starts otherwise', () => {
    const turn = new LyteboatLiveTurn()
    turn.event(stepStart(2))
    turn.delta('第一次尝试', 2)
    turn.event(answer('第二次的回答'))

    expect(shape(turn.parts())).toEqual(['第一次尝试'])
  })
})
