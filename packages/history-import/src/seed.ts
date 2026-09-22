/**
 * Turn history rounds into a session seed: one closed turn per round, the
 * same node shapes the boat driver writes for a reply step (an empty system
 * head on node 0, `user/message` and `assistant/message` with `surfaceOp:
 * 'append'`, provider `boat`, model `history-import`, empty stream), and a
 * trailing `boat/history-imported` audit node. Seq is contiguous from
 * `startSeq`, so the result satisfies `CreateAgentOptions.seed`.
 * @module @boat/history-import/seed
 */

import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { BOAT_ASSISTANT_PROVIDER, BOAT_HISTORY_IMPORT_PLUGIN } from '@boat/contracts'
import type { HistoryRound } from './sa-history.ts'

/** The model recorded on imported assistant messages. */
export const HISTORY_IMPORT_MODEL = 'history-import'

/** The plugin the empty system head is attributed to: the one the driver replaces on the first real prompt. */
const SYSTEM_PROMPT_SOURCE = '@deepseek-ai/dsh-system-prompt'

export interface SeedOptions {
  /** Where the history came from (a file name, `sa_history`), recorded on the audit node. */
  source: string
  /** Trace ids already in the session; their rounds are skipped. */
  knownTraceIds?: ReadonlySet<string>
  /** The first turn number to use; defaults to 1 (an empty log). */
  startTurn?: number
  /** The first seq to use; defaults to 0 (an empty log). */
  startSeq?: number
  /** Whether the log already holds a system node; when it does, no empty head is written. */
  hasSystemNode?: boolean
  /** Event time; defaults to now. */
  time?: number
}

export interface SeedResult {
  events: SessionEvent[]
  /** The rounds the seed carries, in order. */
  imported: HistoryRound[]
  skipped: number
}

type Envelope<T extends SessionEventType> = { type: T; seq: number; time: number; data: SessionEventMap[T]; surfaceOp?: 'append' }

/**
 * Build the seed.
 * @param rounds - complete rounds, already ordered.
 * @param options - source, dedup set and log position.
 */
export function seedFromRounds(rounds: readonly HistoryRound[], options: SeedOptions): SeedResult {
  const known = options.knownTraceIds ?? new Set<string>()
  const imported = rounds.filter(round => !known.has(round.traceId))
  const time = options.time ?? Date.now()
  let seq = options.startSeq ?? 0
  let turn = (options.startTurn ?? 1) - 1
  let hasSystemNode = options.hasSystemNode ?? false
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
      push('system/message', { turn, step, message: createSystemMessage('', SYSTEM_PROMPT_SOURCE) }, 'append')
      hasSystemNode = true
    }
    push('user/message', createUserMessage({
      content: [{ type: 'text', text: round.user.text }],
      source: { kind: 'plugin', plugin: BOAT_HISTORY_IMPORT_PLUGIN },
    }), 'append')
    push('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'text', text: round.assistant.text }],
        source: { provider: BOAT_ASSISTANT_PROVIDER, model: HISTORY_IMPORT_MODEL },
      }),
      stream: [],
    }, 'append')
    push('step/end', { turn, step })
    push('turn/end', { turn, reason: { kind: 'completed' } })
  }
  if (imported.length > 0) {
    push('boat/history-imported', { source: options.source, traceIds: imported.map(round => round.traceId), rounds: imported.length })
  }
  return { events, imported, skipped: rounds.length - imported.length }
}
