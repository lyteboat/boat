/**
 * The pages whose data the Studio does not serve yet: the Dashboard (run
 * metrics that serve records). It keeps its route and its frame, so the
 * navigation already leads somewhere, and says what it will show.
 * @module @lyteboat/studio-web/client/studio-pending-pages
 */

import { useStudioShell } from './studio-shell.tsx'

/** The page at `/`. */
export function StudioDashboardPage() {
  const { agents } = useStudioShell()
  return (
    <div className="workspace-page">
      <div className="dashboard-page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{agents.length} 个 Agent · 运行指标由 serve 记录</p>
        </div>
      </div>
      <div className="empty-surface">看板尚未接入：serve 记录运行指标之后，请求量、耗时、工具与技能排行会显示在这里。</div>
    </div>
  )
}
