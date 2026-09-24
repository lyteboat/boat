/**
 * lyteboat extension `session-append-ignorable` (dsh-compat/contract/extensions.yml): the
 * write path for `SessionEvent.ignorable`.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/audit-record': { note: string }
  }
}

describe('Session.append with the ignorable marker', () => {
  it('marks a record of a type this build does not know, and the surface does not change', () => {
    const session = Session.create(SessionId('ignorable'))
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const nodes = session.surface.nodes

    const record = session.append('test/audit-record', { note: 'side call' }, { ignorable: true })

    expect(record).toMatchObject({ type: 'test/audit-record', data: { note: 'side call' }, ignorable: true })
    expect(session.eventAt(record.seq)).toBe(record)
    expect(session.surface.nodes).toEqual(nodes)
  })

  it('leaves an append without the marker exactly as upstream writes it', () => {
    const session = Session.create(SessionId('inert'))

    const record = session.append('test/audit-record', { note: 'plain' })
    const boundary = session.append('turn/start', { turn: 1 })

    expect(Object.keys(record).sort()).toEqual(['data', 'seq', 'time', 'type'])
    expect(Object.keys(boundary).sort()).toEqual(['data', 'seq', 'time', 'type'])
  })

  it('refuses the marker on a type this build knows: a reader must never skip a required event', () => {
    const session = Session.create(SessionId('known'))
    const knownType = 'turn/start' as 'test/audit-record'

    expect(() => session.append(knownType, { note: 'x' }, { ignorable: true })).toThrow('session event "turn/start" is known to this harness and cannot be marked ignorable')
    expect(session.seq).toBe(0)
  })

  it('reads a marked record back through the seed path, which a reopened log takes', () => {
    const source = Session.create(SessionId('source'))
    source.append('turn/start', { turn: 1 })
    source.append('test/audit-record', { note: 'kept' }, { ignorable: true })
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const reopened = Session.create(SessionId('reopened'), source.snapshotEvents())

    expect(reopened.snapshotEvents().map(event => [event.type, event.ignorable ?? false])).toEqual([
      ['turn/start', false], ['test/audit-record', true], ['turn/end', false], ['session/end-seed', false],
    ])
  })
})
