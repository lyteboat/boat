/**
 * One finished turn laid out from its answer and the cards its results
 * prepared: marker placement, emission modes, and the punctuation a placed card
 * takes with it.
 */
import { describe, expect, it } from 'vitest'
import type { LyteboatCard, LyteboatCardEmission } from '@lyteboat/contracts'
import { composeTurnParts, type LyteboatTurnPart } from '../src/turn-parts.ts'

function card(area: string, emission: LyteboatCardEmission, n = 1): LyteboatCard {
  return { callId: `call-${area}`, surfaceId: `${area}-${String(n)}`, area, emission, payload: {} }
}

/** Parts as `text` strings and `<surfaceId>` markers, for compact expectations. */
const shape = (parts: readonly LyteboatTurnPart[]): string[] => parts.map(part => part.kind === 'text' ? part.text : `<${part.card.surfaceId}>`)

describe('composeTurnParts', () => {
  it('places deferred cards at their markers and drops the markers', () => {
    const parts = composeTurnParts('总览如下：\n[[card:overview]]\n配置如下：\n[[card:plan]]\n以上。', [card('overview', 'deferred'), card('plan', 'deferred')], true)

    expect(shape(parts)).toEqual(['总览如下：\n', '<overview-1>', '配置如下：\n', '<plan-1>', '以上。'])
  })

  it('shows immediate cards first, as their results arrived, and drops a marker that names one', () => {
    const parts = composeTurnParts('看这里 [[card:overview]] 就好', [card('overview', 'immediate')], true)

    expect(shape(parts)).toEqual(['<overview-1>', '看这里  就好'])
  })

  it('places every unplaced card of an area at its marker, and a second marker for the area finds none', () => {
    const parts = composeTurnParts('[[card:detail]]\n再看一次 [[card:detail]]', [card('detail', 'deferred', 1), card('detail', 'deferred', 2)], true)

    expect(shape(parts)).toEqual(['<detail-1>', '<detail-2>', '再看一次 '])
  })

  it('drops a marker no prepared card answers', () => {
    expect(shape(composeTurnParts('前 [[card:missing]] 后', [], true))).toEqual(['前  后'])
  })

  it('lets a completed turn append an unplaced deferred card and drop an unplaced deferred_discard one', () => {
    const parts = composeTurnParts('没有写标记。', [card('plan', 'deferred_discard'), card('next', 'deferred')], true)

    expect(shape(parts)).toEqual(['没有写标记。', '<next-1>'])
  })

  it('shows no unplaced card when the turn did not complete', () => {
    const parts = composeTurnParts('写到一半 [[card:overview]]', [card('overview', 'deferred'), card('next', 'deferred')], false)

    expect(shape(parts)).toEqual(['写到一半 ', '<overview-1>'])
  })

  it('takes the whitespace and closing punctuation stranded after a placed card with it', () => {
    const parts = composeTurnParts('您的资产[[card:overview]]。\n接下来', [card('overview', 'deferred')], true)

    expect(shape(parts)).toEqual(['您的资产', '<overview-1>', '接下来'])
  })

  it('leaves text after a dropped marker as written', () => {
    expect(shape(composeTurnParts('A[[card:none]]。B', [], true))).toEqual(['A。B'])
  })
})
