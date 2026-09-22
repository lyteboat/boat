import { describe, expect, it } from 'vitest'
import { BOAT_ASSISTANT_PROVIDER, type IntakeDecision } from '@boat/contracts'

describe('@boat/contracts', () => {
  it('exports the boat assistant provider name', () => {
    expect(BOAT_ASSISTANT_PROVIDER).toBe('boat')
  })

  it('types intake decisions', () => {
    const pass: IntakeDecision = { kind: 'pass' }
    const reply: IntakeDecision = { kind: 'reply', plugin: 'x', content: [{ type: 'text', text: 'no' }] }
    expect([pass.kind, reply.kind]).toEqual(['pass', 'reply'])
  })
})
