/**
 * The Agents page: the agents the catalog serves, the ones it cannot and why,
 * and a reload that declares them again from what the agent directories hold.
 * @module @lyteboat/studio-pages/client/AgentsPage
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconAgentPresetOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { StudioAgentsAnswer } from '../studio-endpoints.ts'
import { errorText, type StudioPagesClient } from './studio-pages-client.ts'
import { errorStyle, headerStyle, listStyle, mutedStyle, pageStyle, rowStyle, sectionTitleStyle, titleStyle } from './studio-styles.ts'

/** What the pages are handed at registration. */
export interface StudioPagesInjected {
  readonly studio: StudioPagesClient
}

/**
 * The Agents page.
 * @param props - the main panel's share and the pages' client.
 * @returns the page.
 */
export function AgentsPage({ studio }: PropsRuntime<'main'> & InjectFace<StudioPagesInjected>): ReactNode {
  const [answer, setAnswer] = useState<StudioAgentsAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    let live = true
    studio.agents().then(next => { if (live) setAnswer(next) }, (failure: unknown) => { if (live) setError(errorText(failure)) })
    return () => { live = false }
  }, [studio])

  const reload = (): void => {
    setReloading(true)
    studio.reloadAgents()
      .then(next => { setAnswer(next); setError(null) }, (failure: unknown) => { setError(errorText(failure)) })
      .finally(() => { setReloading(false) })
  }

  return (
    <div style={pageStyle} data-testid="lyteboat-agents-page">
      <header style={headerStyle}>
        <h1 style={titleStyle}>Agents</h1>
        <Button variant="outline" size="sm" onClick={reload} disabled={reloading} data-testid="lyteboat-agents-reload">
          {reloading ? 'Reloading…' : 'Reload'}
        </Button>
      </header>
      <p style={mutedStyle}>The agents of the agent directories. A new session runs the one you pick for it; a change to a directory reloads them.</p>
      {error === null ? null : <p role="alert" style={errorStyle}>{error}</p>}
      {answer === null ? <p style={mutedStyle}>Loading…</p> : <AgentList answer={answer} />}
    </div>
  )
}

function AgentList({ answer }: { answer: StudioAgentsAnswer }): ReactNode {
  return (
    <>
      <h2 style={sectionTitleStyle}>Serving ({answer.agents.length})</h2>
      {answer.agents.length === 0 ? <p style={mutedStyle}>No agent.</p> : (
        <ul style={listStyle}>
          {answer.agents.map(agent => (
            <li key={agent.id} style={rowStyle} data-testid="lyteboat-agent" data-agent-id={agent.id}>
              <strong>{agent.name}</strong> <Tag tone="neutral">{agent.id}</Tag>
              {agent.description === undefined ? null : <p style={mutedStyle}>{agent.description}</p>}
            </li>
          ))}
        </ul>
      )}
      {answer.failures.length === 0 ? null : (
        <>
          <h2 style={sectionTitleStyle}>Failed ({answer.failures.length})</h2>
          <ul style={listStyle}>
            {answer.failures.map(failure => (
              <li key={failure.id} style={rowStyle} data-testid="lyteboat-agent-failure" data-agent-id={failure.id}>
                <strong>{failure.id}</strong> <Tag tone="danger">failed</Tag>
                <p style={mutedStyle}>{failure.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/**
 * The Agents entry's glyph in the sidebar's panel list.
 * @param props - the sidebar's icon share.
 * @returns the icon.
 */
export function AgentsIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconAgentPresetOutlineRegular size={size} />
}
