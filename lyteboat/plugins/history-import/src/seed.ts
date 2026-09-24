/**
 * Turn history rounds into a session seed: one closed turn per round, the
 * same node shapes lyteboat's agent loop writes for an intake reply (an empty system
 * head on node 0, `user/message` and `assistant/message` with `surfaceOp:
 * 'append'`, provider `lyteboat`, model `history-import`, empty stream). Seq is
 * contiguous from 0, so the result satisfies `CreateAgentOptions.seed`. The
 * trace ids the seed carries are returned, not logged: dsh's persistence
 * refuses a log with a lyteboat-specific node.
 * @module @lyteboat/history-import/seed
 */

import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { LYTEBOAT_ASSISTANT_PROVIDER, LYTEBOAT_HISTORY_IMPORT_SOURCE } from '@lyteboat/contracts'
import type { HistoryRound } from './round-history.ts'

/** The model recorded on imported assistant messages. */
export const HISTORY_IMPORT_MODEL = 'history-import'

export interface SeedOptions {
  /** Event time; defaults to now. */
  time?: number
}

export interface SeedResult {
  events: SessionEvent[]
  /** The rounds the seed carries, in order. */
  imported: HistoryRound[]
}

type Envelope<T extends SessionEventType> = { type: T; seq: number; time: number; data: SessionEventMap[T]; surfaceOp?: 'append' }

/**
 * Build the seed.
 * @param rounds - complete rounds, already ordered.
 * @param options - the event time.
 */
export function seedFromRounds(rounds: readonly HistoryRound[], options: SeedOptions = {}): SeedResult {
  const imported = [...rounds]
  const time = options.time ?? Date.now()
  let seq = 0
  let turn = 0
  let hasSystemNode = false
  const events: SessionEvent[] = []
  const push = <T extends SessionEventType>(type: T, data: SessionEventMap[T], surface?: 'append'): void => {
    const envelope: Envelope<T> = { type, seq: SessionSeq(seq), time, data, ...surface === undefined ? {} : { surfaceOp: surface } }
    events.push(envelope as unknown as SessionEvent)
    seq += 1
  }
  for (const round of imported) {
    turn += 1
    const step = 1
    push('turn/start', { turn })
    push('step/start', { turn, step })
    if (!hasSystemNode) {
      push('system/message', { turn, step, message: createSystemMessage('') }, 'append')
      hasSystemNode = true
    }
    push('user/message', createUserMessage({
      content: [{ type: 'text', text: round.user.text }],
      source: { kind: LYTEBOAT_HISTORY_IMPORT_SOURCE },
    }), 'append')
    push('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'text', text: round.assistant.text }],
        source: { provider: LYTEBOAT_ASSISTANT_PROVIDER, model: HISTORY_IMPORT_MODEL },
      }),
      stream: [],
    }, 'append')
    push('step/end', { turn, step })
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return { events, imported }
}
