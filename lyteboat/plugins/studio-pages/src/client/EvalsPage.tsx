/**
 * The Evals page: the eval runs under `$LYTEBOAT_HOME/evals`, newest first,
 * and the report of the run picked.
 * @module @lyteboat/studio-pages/client/EvalsPage
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconChecklistOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { StudioEvalReportAnswer, StudioEvalsAnswer } from '../studio-endpoints.ts'
import type { StudioPagesInjected } from './AgentsPage.tsx'
import { errorText } from './studio-pages-client.ts'
import { errorStyle, headerStyle, listStyle, mutedStyle, pageStyle, preStyle, rowStyle, sectionTitleStyle, titleStyle } from './studio-styles.ts'

/**
 * The Evals page.
 * @param props - the main panel's share and the pages' client.
 * @returns the page.
 */
export function EvalsPage({ studio }: PropsRuntime<'main'> & InjectFace<StudioPagesInjected>): ReactNode {
  const [runs, setRuns] = useState<StudioEvalsAnswer | null>(null)
  const [report, setReport] = useState<StudioEvalReportAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let live = true
    studio.evals().then(next => { if (live) setRuns(next) }, (failure: unknown) => { if (live) setError(errorText(failure)) })
    return () => { live = false }
  }, [studio, generation])

  const open = (run: string): void => {
    studio.evalReport(run).then(next => { setReport(next); setError(null) }, (failure: unknown) => { setError(errorText(failure)) })
  }

  return (
    <div style={pageStyle} data-testid="lyteboat-evals-page">
      <header style={headerStyle}>
        <h1 style={titleStyle}>Evals</h1>
        <Button variant="outline" size="sm" onClick={() => { setGeneration(value => value + 1) }} data-testid="lyteboat-evals-refresh">Refresh</Button>
      </header>
      <p style={mutedStyle}>The runs of <code>lyteboat eval</code> under $LYTEBOAT_HOME/evals.</p>
      {error === null ? null : <p role="alert" style={errorStyle}>{error}</p>}
      {runs === null ? <p style={mutedStyle}>Loading…</p> : runs.runs.length === 0 ? <p style={mutedStyle}>No run yet.</p> : (
        <ul style={listStyle}>
          {runs.runs.map(run => (
            <li key={run.id} style={{ ...rowStyle, cursor: 'pointer' }} data-testid="lyteboat-eval-run" data-run-id={run.id}
              onClick={() => { open(run.id) }}>
              <strong>{run.agent}</strong> <Tag tone={run.passedCases === run.cases ? 'success' : 'danger'}>{`${String(run.passedCases)}/${String(run.cases)} cases`}</Tag>{' '}
              <Tag tone="neutral">{run.mode}</Tag>
              <p style={mutedStyle}>{run.id} · {run.startedAt}</p>
            </li>
          ))}
        </ul>
      )}
      {report === null ? null : (
        <section>
          <h2 style={sectionTitleStyle}>Report {report.run}</h2>
          <pre style={preStyle} data-testid="lyteboat-eval-report">{report.report}</pre>
        </section>
      )}
    </div>
  )
}

/**
 * The Evals entry's glyph in the sidebar's panel list.
 * @param props - the sidebar's icon share.
 * @returns the icon.
 */
export function EvalsIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconChecklistOutlineRegular size={size} />
}
