/**
 * What one finished turn shows, in order, from its answer text and the cards
 * its tool results prepared (the reference implementation's output composer,
 * applied to a whole turn): immediate cards first, as their results arrived;
 * then the answer, each `[[card:<area>]]` marker replaced by that area's
 * deferred cards not yet shown, in the order they were prepared, and a marker
 * with none left dropped. When the turn completed, a deferred card the answer
 * never placed follows the text and a `deferred_discard` one is dropped; a turn
 * that did not complete shows no card it did not place.
 * @module @lyteboat/a2ui/turn-parts
 */

import type { LyteboatCard } from '@lyteboat/contracts'

/** One piece of a turn as a client shows it. */
export type LyteboatTurnPart = { kind: 'text'; text: string } | { kind: 'card'; card: LyteboatCard }

/** `[[card:<area>]]`: an area of ASCII letters, digits, `_`, `-`, or CJK, at most 64 characters. */
const CARD_MARKER = /\[\[card:([A-Za-z0-9_\-\u4e00-\u9fff]{1,64})\]\]/gu

/**
 * Whitespace and closing punctuation a card leaves stranded when the answer put
 * its marker before the end of a sentence; the card is a block, so they would
 * start the next line. No markdown line starters and no straight quotes, which
 * open the next sentence as often as they close one.
 */
const ORPHANED_AFTER_CARD = /^[\s\u00a0\u3000\uff0c\u3002\u3001\uff1b\uff1a\uff01\uff1f\u2026\uff5e\u301c\uff0e\uff61\u22ef,.;:!?~\u300d\u300f\u3011\u300b\u3009\uff09\u201d\u2019)\]\u3015\u3017\uff5d]+/u

/**
 * Compose one turn.
 * @param text - the turn's answer: its last assistant text.
 * @param cards - the cards the turn's tool results prepared, in log order.
 * @param completed - whether the turn ended `completed`.
 */
export function composeTurnParts(text: string, cards: readonly LyteboatCard[], completed: boolean): LyteboatTurnPart[] {
  const parts: LyteboatTurnPart[] = cards.filter(card => card.emission === 'immediate').map(card => ({ kind: 'card', card }))
  const deferred = cards.filter(card => card.emission !== 'immediate')
  const shown = new Set<LyteboatCard>()
  let afterCard = false
  const addText = (segment: string): void => {
    const trimmed = afterCard ? segment.replace(ORPHANED_AFTER_CARD, '') : segment
    if (trimmed === '') return
    afterCard = false
    const last = parts.at(-1)
    if (last?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: last.text + trimmed }
    else parts.push({ kind: 'text', text: trimmed })
  }
  let cursor = 0
  for (const marker of text.matchAll(CARD_MARKER)) {
    addText(text.slice(cursor, marker.index))
    cursor = marker.index + marker[0].length
    const placed = deferred.filter(card => card.area === marker[1] && !shown.has(card))
    for (const card of placed) {
      shown.add(card)
      parts.push({ kind: 'card', card })
    }
    if (placed.length > 0) afterCard = true
  }
  addText(text.slice(cursor))
  if (completed) {
    for (const card of deferred) if (!shown.has(card) && card.emission === 'deferred') parts.push({ kind: 'card', card })
  }
  return parts
}
