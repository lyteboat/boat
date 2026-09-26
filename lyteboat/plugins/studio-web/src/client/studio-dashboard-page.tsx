/**
 * The Dashboard at `/`, as the original Studio's: the page head with the
 * switch between the performance view (run health over time, from serve's
 * run metrics) and the static view (totals, coverage, running messages, and
 * activity). The performance view opens first; a view switched away from
 * unmounts, so switching back loads it afresh.
 * @module @lyteboat/studio-web/client/studio-dashboard-page
 */

import { useState } from 'react'
import { StudioDashboardHealthView } from './studio-dashboard-health-view.tsx'
import { StudioDashboardStaticView } from './studio-dashboard-static-view.tsx'

type StudioDashboardView = 'performance' | 'static'

function StudioDashboardViewSwitch({ view, onChange }: { view: StudioDashboardView; onChange(view: StudioDashboardView): void }) {
  return (
    <div aria-label="Dashboard 视图" className="dashboard-view-switch">
      <button className={view === 'performance' ? 'active' : ''} onClick={() => onChange('performance')} type="button">性能视图</button>
      <button className={view === 'static' ? 'active' : ''} onClick={() => onChange('static')} type="button">静态指标</button>
    </div>
  )
}

/** The page at `/`. */
export function StudioDashboardPage() {
  const [view, setView] = useState<StudioDashboardView>('performance')
  return (
    <div className="workspace-page studio-dashboard-page">
      <div className="dashboard-page-head">
        <div>
          <h1>Workspace overview</h1>
          <p>智能体工作区的性能与静态指标总览</p>
        </div>
        <div className="dashboard-page-head-actions">
          <StudioDashboardViewSwitch onChange={setView} view={view} />
        </div>
      </div>
      {view === 'performance' ? <StudioDashboardHealthView /> : <StudioDashboardStaticView />}
    </div>
  )
}
