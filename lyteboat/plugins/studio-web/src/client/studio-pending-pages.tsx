/**
 * The pages whose data the Studio does not serve yet: the Dashboard (run
 * metrics that serve records) and an agent's workspace (its overview, skills,
 * tools, and sessions). Each keeps its route and its frame, so the radar and
 * the navigation already lead somewhere, and says what it will show.
 * @module @lyteboat/studio-web/client/studio-pending-pages
 */

import { studioAgentName, useStudioShell } from './studio-shell.tsx'

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

/** The page at `/agents/:agentId/:section`. */
export function StudioAgentPage() {
  const { selectedAgent, agentsLoading } = useStudioShell()
  if (agentsLoading) return <div className="workspace-page"><div className="empty-surface">正在加载 Agent...</div></div>
  if (selectedAgent === null) return <div className="workspace-page"><div className="empty-surface">没有这个 Agent，或它没有挂载成功（见左侧列表）。</div></div>
  return (
    <div className="workspace-page">
      <div className="dashboard-page-head">
        <div>
          <h1>{studioAgentName(selectedAgent)}</h1>
          <p>{selectedAgent.id}{selectedAgent.version === undefined ? '' : ` · v${selectedAgent.version}`} · {selectedAgent.digest.slice(0, 19)}</p>
        </div>
      </div>
      <div className="empty-surface">Agent 工作台尚未接入：概览、技能、工具与会话会显示在这里。</div>
    </div>
  )
}
