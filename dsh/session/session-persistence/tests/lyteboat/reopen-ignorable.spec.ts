/**
 * lyteboat extension `session-append-ignorable` (dsh-compat/contract/extensions.yml): a
 * record appended with the marker passes the persistence read path, which refuses
 * the same record without it.
 */
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'test/audit-record': { note: string }
  }
}

function storedLog(marked: boolean): Session {
  const session = Session.create(SessionId(marked ? 'marked' : 'unmarked'))
  session.append('turn/start', { turn: 1 })
  if (marked) session.append('test/audit-record', { note: 'side call' }, { ignorable: true })
  else session.append('test/audit-record', { note: 'side call' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

it('reopens a log whose unknown record carries the marker, and refuses it without the marker', () => {
  const read = (session: Session): unknown => validateStoredEvents(
    { id: session.id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false },
    structuredClone([...session.snapshotEvents()]),
  )

  expect(read(storedLog(true))).toHaveLength(3)
  expect(() => read(storedLog(false))).toThrow(SessionFormatUnsupportedError)
})
