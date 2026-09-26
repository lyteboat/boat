/**
 * An agent's Evals home at `/evals/:agentId/cases` and `/evals/:agentId/runs`,
 * as the original Studio's Evals home: the subtab bar (Cases with the number of
 * cases across the agent's case files, Runs with the number of runs; the URL
 * is the tab), its actions (Refresh; New Run for editors and admins on Runs),
 * and the tab's list under it. lyteboat keeps an agent's cases in its case
 * files and has no profiles, so the original's Datasets and Profiles tabs
 * become the read-only Cases tab.
 * @module @lyteboat/studio-web/client/studio-evals-home
 */

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { StudioEvalRun } from '@lyteboat/contracts/studio'
import { canRunStudioEvals, useStudioAuth } from './studio-auth-context.tsx'
import { useStudioEvalsAgent } from './studio-evals-agent-scope.tsx'
import { StudioEvalsCaseFiles } from './studio-evals-case-files.tsx'
import { StudioEvalsNewRunDialog } from './studio-evals-new-run-dialog.tsx'
import { StudioEvalsErrorCallout } from './studio-evals-primitives.tsx'
import { StudioEvalsRunList } from './studio-evals-run-list.tsx'
import { PlusIcon, RefreshIcon } from './studio-icons.tsx'

type StudioEvalsHomeTab = 'cases' | 'runs'

/** The home of one agent's Evals, on the tab its route names. */
export function StudioEvalsHome({ tab }: { tab: StudioEvalsHomeTab }) {
  const scope = useStudioEvalsAgent()
  const navigate = useNavigate()
  const { user } = useStudioAuth()
  const canRun = canRunStudioEvals(user?.role)
  const [newRunOpen, setNewRunOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const caseCount = scope.caseFiles?.reduce((total, file) => total + file.cases.length, 0)
  const tabs: readonly { id: StudioEvalsHomeTab; label: string; count: number | undefined }[] = [
    { id: 'cases', label: 'Cases', count: caseCount },
    { id: 'runs', label: 'Runs', count: scope.runs?.length },
  ]
  const error = tab === 'cases' ? scope.casesError : scope.runsError

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    await Promise.all([scope.reloadCases(), scope.reloadRuns()])
    setRefreshing(false)
  }
  const started = (run: StudioEvalRun): void => {
    setNewRunOpen(false)
    void scope.reloadRuns()
    void navigate(`/evals/${scope.agentId}/runs/${encodeURIComponent(run.runId)}`)
  }

  return (
    <div className="evals-page" data-evals-tab={tab}>
      <div className="evals-subtab-bar">
        <nav aria-label="Evals sections">
          {tabs.map(item => (
            <NavLink aria-label={item.label} className={({ isActive }) => `evals-subtab-pill ${isActive ? 'active' : ''}`} key={item.id} to={`/evals/${scope.agentId}/${item.id}`}>
              <span>{item.label}</span>
              <span className="evals-subtab-pill-count">{item.count ?? '…'}</span>
            </NavLink>
          ))}
        </nav>
        <div className="evals-subtab-spacer" />
        <div className="evals-subtab-actions">
          <button aria-label="Refresh" className="btn btn-sm" disabled={refreshing} onClick={() => void refresh()} title="Refresh" type="button"><RefreshIcon /></button>
          {canRun && tab === 'runs' && (
            <button className="btn btn-sm btn-accent" onClick={() => setNewRunOpen(true)} title="Launch a new evaluation run" type="button"><PlusIcon /> New Run</button>
          )}
        </div>
      </div>
      {error !== null && <div className="evals-page-banner"><StudioEvalsErrorCallout label="Could not load eval data" message={error} /></div>}
      {tab === 'cases' ? <StudioEvalsCaseFiles canRun={canRun} /> : <StudioEvalsRunList canRun={canRun} />}
      {newRunOpen && <StudioEvalsNewRunDialog agentId={scope.agentId} onClose={() => setNewRunOpen(false)} onStarted={started} runs={scope.runs ?? []} />}
    </div>
  )
}
