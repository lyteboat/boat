/**
 * One turn fed to a {@link LyteboatTurnComposer} as it happens: the session's
 * events (cards prepared by a human message or a tool result, the step each
 * text belongs to, each step's settled assistant message, the end of the
 * turn) and, between them, the assistant's streamed text. A step's settled
 * message adds only what its stream did not, so a turn read live and the same
 * turn replayed from the log show the same parts. A retried model attempt is
 * the exception: the text its abandoned attempt streamed was already shown and
 * stays.
 * @module @lyteboat/a2ui/live-turn
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { preparedCardsOf } from './cards-projection.ts'
import { LyteboatTurnComposer, type LyteboatTurnPart } from './turn-parts.ts'

/** A turn's parts, fed from its events and its streamed text. */
export class LyteboatLiveTurn {
  private readonly composer = new LyteboatTurnComposer()
  private step = 0
  /** The text each step's stream has shown. */
  private readonly streamed = new Map<number, string>()

  /**
   * Streamed assistant text of one step.
   * @param text - the next text delta.
   * @param step - the step the stream belongs to.
   */
  delta(text: string, step: number): LyteboatTurnPart[] {
    this.streamed.set(step, (this.streamed.get(step) ?? '') + text)
    return this.composer.write(text, step)
  }

  /** One event of the turn, in log order; an event that carries nothing for the parts adds nothing. */
  event(event: SessionEvent): LyteboatTurnPart[] {
    if ((event.type === 'user/message' || event.type === 'tool/result') && event.surfaceOp === 'append') {
      return this.composer.prepare(preparedCardsOf(event))
    }
    if (event.type === 'step/start') {
      this.step = event.data.step
      return []
    }
    if (event.type === 'assistant/message') {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      const shown = this.streamed.get(this.step) ?? ''
      this.streamed.set(this.step, text)
      return text.startsWith(shown) ? this.composer.write(text.slice(shown.length), this.step) : []
    }
    if (event.type === 'turn/end') return this.composer.end(event.data.reason.kind === 'completed')
    return []
  }

  /** Everything shown so far, adjacent text merged. */
  parts(): LyteboatTurnPart[] {
    return this.composer.parts()
  }
}
