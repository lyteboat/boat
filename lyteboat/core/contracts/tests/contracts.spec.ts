import { describe, expect, it } from 'vitest'
import { LYTEBOAT_ASSISTANT_PROVIDER, type LyteboatIntakeDecision } from '@lyteboat/contracts'

describe('@lyteboat/contracts', () => {
  it('exports the lyteboat assistant provider name', () => {
    expect(LYTEBOAT_ASSISTANT_PROVIDER).toBe('lyteboat')
  })

  it('types intake decisions', () => {
    const pass: LyteboatIntakeDecision = { kind: 'pass' }
    const reply: LyteboatIntakeDecision = { kind: 'reply', plugin: 'x', content: [{ type: 'text', text: 'no' }] }
    expect([pass.kind, reply.kind]).toEqual(['pass', 'reply'])
  })
})
