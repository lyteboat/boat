/**
 * Age the finance digests of earlier turns. When a turn starts, every finance
 * tool result still on the surface from an earlier turn is replaced, through
 * dsh's own surface replacement (the move its tool-result pruner makes), by its
 * past form: the facts stay quotable, the old answer guidance and follow-ups
 * leave the model's view. The original result stays in the log. dsh lets a
 * replacement change only the content, so it carries the original's meta too:
 * a projection folding results must skip replacement nodes (the agent's own
 * state projection does).
 * @module @lyteboat/agent-finance/digest/digest-aging
 */

import { freezeMessage, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { pastFinanceDigest } from './finance-digest.ts'

function textOf(message: ToolResultMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/**
 * Replace the surface nodes of earlier turns' finance results with their past form.
 * @param session - the agent's session.
 * @param turn - the turn about to be assembled; results of this turn stay as they are.
 * @returns how many results were aged.
 */
export function ageFinanceDigests(session: Session, turn: number): number {
  let aged = 0
  for (const seq of [...session.surface.nodes]) {
    const result = session.eventAt(seq)
    if (result?.type !== 'tool/result') continue
    if (result.data.turn >= turn || result.data.message.isError === true) continue
    const original = session.deriveEventMessage(result)
    if (original?.role !== 'tool') continue
    const past = pastFinanceDigest(textOf(original))
    if (past === undefined) continue
    session.append('tool/result', {
      ...result.data,
      message: freezeMessage<ToolResultMessage>({ ...original, content: [{ type: 'text', text: past }] }),
    }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })
    aged += 1
  }
  return aged
}
