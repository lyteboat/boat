/**
 * The admission's pure parts: the classifier's answer read tolerantly, and
 * the customer read from the request context.
 */
import { describe, expect, it } from 'vitest'
import { customerOfContext, intentOf } from '@lyteboat/agent-finance/intake'

describe('intentOf', () => {
  it('reads the intent from a bare line, from a fenced block, and from JSON with prose around it', () => {
    expect(intentOf('{"intent": "asset", "reason": "看资产"}')).toBe('asset')
    expect(intentOf('```json\n{"intent": "education", "reason": "概念"}\n```')).toBe('education')
    expect(intentOf('分类结果：{"intent":"other","reason":"写诗"}。')).toBe('other')
    expect(intentOf('{"intent": "chat", "reason": "打招呼"}')).toBe('chat')
  })

  it('reads nothing from an unknown intent, a missing one, or text that is not JSON', () => {
    expect(intentOf('{"intent": "stocks"}')).toBeUndefined()
    expect(intentOf('{"reason": "none"}')).toBeUndefined()
    expect(intentOf('我不确定')).toBeUndefined()
    expect(intentOf('{broken')).toBeUndefined()
  })
})

describe('customerOfContext', () => {
  it('names the customer only when the context holds a non-empty string', () => {
    expect(customerOfContext({ customer: 'young-idle-cash' })).toBe('young-idle-cash')
    expect(customerOfContext({ customer: '' })).toBeUndefined()
    expect(customerOfContext({ customer: 42 })).toBeUndefined()
    expect(customerOfContext({})).toBeUndefined()
  })
})
