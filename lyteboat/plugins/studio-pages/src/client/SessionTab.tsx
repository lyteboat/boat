/**
 * The lyteboat tab of a session's right sidebar. Its upper half sends the next
 * message with a request context, the way `/chat` does: dsh's own composer has
 * no place for one. Its lower half is the session's lyteboat state as its
 * projections show it (active skill, request, cards, state), live as the turn
 * goes on.
 * @module @lyteboat/studio-pages/client/SessionTab
 */

import { useState, type ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { JsonValue, LyteboatRequestState } from '@lyteboat/contracts'
import type { StudioPagesInjected } from './AgentsPage.tsx'
import { errorText } from './studio-pages-client.ts'
import { errorStyle, fieldStyle, mutedStyle, preStyle, sectionTitleStyle } from './studio-styles.ts'

type SessionTabProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<StudioPagesInjected>

/**
 * The tab's body.
 * @param props - the session's share (its id and projections) and the pages' client.
 * @returns the tab.
 */
export function SessionTab({ sessionId, useProjection, studio }: SessionTabProps): ReactNode {
  const skill = useProjection('lyteboatActiveSkill')
  const request = useProjection('lyteboatRequest')
  const cards = useProjection('lyteboatCards')
  const state = useProjection('lyteboatState')
  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>
      <SendWithContext sessionId={sessionId} studio={studio} initialContext={request?.context ?? {}} />
      <section data-testid="lyteboat-session-state">
        <h3 style={sectionTitleStyle}>Session</h3>
        <p style={mutedStyle}>Active skill: <Tag tone="neutral"><span data-testid="lyteboat-active-skill">{skill ?? 'none'}</span></Tag></p>
        <RequestSummary request={request} />
        <h4 style={sectionTitleStyle}>Request context</h4>
        <pre style={preStyle} data-testid="lyteboat-request-context">{JSON.stringify(request?.context ?? {}, null, 2)}</pre>
        <h4 style={sectionTitleStyle}>Cards ({cards?.length ?? 0})</h4>
        <pre style={preStyle} data-testid="lyteboat-cards">{JSON.stringify(cards ?? [], null, 2)}</pre>
        <h4 style={sectionTitleStyle}>State</h4>
        <pre style={preStyle} data-testid="lyteboat-state">{JSON.stringify(state ?? {}, null, 2)}</pre>
      </section>
    </div>
  )
}

function RequestSummary({ request }: { request: LyteboatRequestState | undefined }): ReactNode {
  const intake = request?.intake ?? null
  return (
    <p style={mutedStyle} data-testid="lyteboat-request-summary">
      Requests: {request?.requests ?? 0} · owner: {request?.owner ?? 'none'} · admission:{' '}
      {intake === null ? 'none' : `${intake.decision}${intake.verdict === undefined ? '' : ` (${intake.verdict})`} by ${intake.by}`}
    </p>
  )
}

interface SendWithContextProps extends StudioPagesInjected {
  sessionId: string
  initialContext: { [key: string]: JsonValue }
}

function SendWithContext({ sessionId, studio, initialContext }: SendWithContextProps): ReactNode {
  const [context, setContext] = useState(() => JSON.stringify(initialContext, null, 2))
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = (): void => {
    const parsed = parseContext(context)
    if (typeof parsed === 'string') {
      setError(parsed)
      return
    }
    setSending(true)
    studio.send({ sessionId, text, context: parsed })
      .then(() => { setText(''); setError(null) }, (failure: unknown) => { setError(errorText(failure)) })
      .finally(() => { setSending(false) })
  }

  return (
    <section>
      <h3 style={{ ...sectionTitleStyle, marginTop: 0 }}>Send with a request context</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={mutedStyle}>Context (a JSON object)</span>
        <textarea style={{ ...fieldStyle, fontFamily: 'monospace' }} rows={4} value={context}
          onChange={event => { setContext(event.target.value) }} data-testid="lyteboat-context" />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={mutedStyle}>Message</span>
        <textarea style={fieldStyle} rows={3} value={text} onChange={event => { setText(event.target.value) }} data-testid="lyteboat-message" />
      </label>
      <Button variant="primary" size="sm" onClick={send} disabled={sending || text.trim() === ''} data-testid="lyteboat-send">
        {sending ? 'Sending…' : 'Send'}
      </Button>
      {error === null ? null : <p role="alert" style={errorStyle}>{error}</p>}
    </section>
  )
}

/** The context field as a JSON object, or why it is not one. */
function parseContext(text: string): { [key: string]: JsonValue } | string {
  let value: unknown
  try {
    value = JSON.parse(text === '' ? '{}' : text)
  } catch {
    return 'The context is not JSON.'
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'The context must be a JSON object.'
  // JSON.parse yields JSON values only; the Host face validates it again.
  return value as { [key: string]: JsonValue }
}
