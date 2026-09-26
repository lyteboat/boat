/**
 * The Studio's frame, as the original Studio lays it out: the top bar (brand,
 * role and user, theme, sign-out), the resizable agent radar on the left (the
 * agents the catalog serves, searchable; one that deviates from its release
 * marked; the ones that failed listed with why), the page navigation under it,
 * and the page in the workspace. Pages read the radar's state through
 * {@link useStudioShell}.
 * @module @lyteboat/studio-web/client/studio-shell
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { StudioAgent, StudioAgentFailure } from '@lyteboat/contracts/studio'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'
import { canManageStudioUsers, useStudioAuth } from './studio-auth-context.tsx'
import { LogoutIcon, OverviewIcon, PlusIcon, RefreshIcon, SearchIcon, ServerIcon, SparkIcon, UsersIcon } from './studio-icons.tsx'
import { StudioThemeToggle } from './studio-theme-toggle.tsx'

/** What the shell gives its pages. */
interface StudioShellContext {
  agents: StudioAgent[]
  failures: StudioAgentFailure[]
  agentsLoading: boolean
  agentsError: string | null
  refreshAgents(): Promise<void>
  selectedAgent: StudioAgent | null
  activeSection: string
}

/** The shell's state, for a page inside it. */
export function useStudioShell(): StudioShellContext {
  return useOutletContext<StudioShellContext>()
}

type StudioMainStyle = CSSProperties & { '--agent-radar-width': string }

const DEFAULT_SECTION = 'overview'
const RADAR_MIN_WIDTH = 200
const RADAR_MAX_WIDTH = 420
const RADAR_DEFAULT_WIDTH = 260

/** The name the radar shows for an agent. */
export function studioAgentName(agent: StudioAgent): string {
  return agent.name ?? agent.id
}

function useStudioAgents(): Pick<StudioShellContext, 'agents' | 'failures' | 'agentsLoading' | 'agentsError' | 'refreshAgents'> {
  const [agents, setAgents] = useState<StudioAgent[]>([])
  const [failures, setFailures] = useState<StudioAgentFailure[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const refreshAgents = useCallback(async () => {
    setAgentsLoading(true)
    setAgentsError(null)
    try {
      const answer = await studioApi.agents()
      setAgents([...answer.agents].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)))
      setFailures(answer.failures)
    } catch (error: unknown) {
      setAgentsError(studioErrorMessage(error))
    } finally {
      setAgentsLoading(false)
    }
  }, [])
  useEffect(() => { void refreshAgents() }, [refreshAgents])
  return { agents, failures, agentsLoading, agentsError, refreshAgents }
}

/** The radar's width and the drag that changes it. */
function useStudioRadarResize(): { width: number; resizing: boolean; startResize(event: ReactPointerEvent<HTMLButtonElement>): void } {
  const [width, setWidth] = useState(RADAR_DEFAULT_WIDTH)
  const [resizing, setResizing] = useState(false)
  const start = useRef<{ width: number; x: number } | null>(null)

  useEffect(() => {
    if (!resizing) return undefined
    const move = (event: PointerEvent): void => {
      if (start.current === null) return
      setWidth(Math.min(RADAR_MAX_WIDTH, Math.max(RADAR_MIN_WIDTH, start.current.width + event.clientX - start.current.x)))
    }
    const stop = (): void => {
      start.current = null
      setResizing(false)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
  }, [resizing])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    start.current = { width, x: event.clientX }
    setResizing(true)
  }
  return { width, resizing, startResize }
}

function StudioTopBar() {
  const navigate = useNavigate()
  const { user, loginRequired, signOut } = useStudioAuth()
  return (
    <header className="studio-topbar">
      <button className="studio-brand" onClick={() => void navigate('/')} type="button">
        <div className="studio-brand-mark"><SparkIcon /></div>
        <div className="studio-brand-copy">
          <strong>轻舟 Studio</strong>
          <span>Agent 协同与运行管控平台</span>
        </div>
      </button>
      <div aria-hidden="true" className="cmd">
        <SearchIcon />
        <span>Search agents, sessions, tools…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="studio-topbar-meta">
        {user !== null && <button className="hbtn" type="button">Role · {user.role}</button>}
        {user !== null && <button className="hbtn" type="button">User · {user.displayName}</button>}
        <StudioThemeToggle />
        {loginRequired && (
          <button className="topbar-logout" onClick={signOut} type="button">
            <LogoutIcon />
            Sign Out
          </button>
        )}
      </div>
    </header>
  )
}

function StudioRadarCard({ agent, active, section }: { agent: StudioAgent; active: boolean; section: string }) {
  return (
    <NavLink aria-label={`打开 Agent ${studioAgentName(agent)}`} className={`agent-radar-card ${active ? 'active' : ''}`} to={`/agents/${agent.id}/${section}`}>
      <div className="agent-radar-card-top">
        <strong>{studioAgentName(agent)}</strong>
        <span className="pill">{agent.id.toUpperCase()}</span>
      </div>
      <p>{agent.description ?? '暂无描述。'}</p>
      {(agent.version !== undefined || agent.deviates) && (
        <div className="agent-radar-card-meta">
          {agent.version !== undefined && <span>v{agent.version}</span>}
          {agent.deviates && <span className="badge warn" title="目录内容与发布锁不同：按锁上线的 serve 会拒绝它">偏离发布</span>}
        </div>
      )}
    </NavLink>
  )
}

function StudioRadarList({ shell, query }: { shell: StudioShellContext; query: string }) {
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (text === '') return shell.agents
    return shell.agents.filter(agent => [studioAgentName(agent), agent.id, agent.description ?? ''].some(field => field.toLowerCase().includes(text)))
  }, [shell.agents, query])
  return (
    <>
      {shell.agentsLoading && <div className="empty-surface">正在加载 Agent...</div>}
      {shell.agentsError !== null && !shell.agentsLoading && <div className="empty-surface">{shell.agentsError}</div>}
      {!shell.agentsLoading && shell.agentsError === null && visible.length === 0 && <div className="empty-surface">没有匹配的 Agent。</div>}
      <div aria-label="可用 Agent" className="agent-radar-list">
        {visible.map(agent => <StudioRadarCard active={shell.selectedAgent?.id === agent.id} agent={agent} key={agent.id} section={shell.activeSection} />)}
        {shell.failures.map(failure => (
          <div className="agent-radar-card" key={`failed:${failure.id}`} title={failure.reason}>
            <div className="agent-radar-card-top">
              <strong>{failure.id}</strong>
              <span className="badge err">挂载失败</span>
            </div>
            <p>{failure.reason}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function StudioNavFooter() {
  const { user } = useStudioAuth()
  const navClass = ({ isActive }: { isActive: boolean }): string => `nav-item ${isActive ? 'active' : ''}`
  return (
    <nav aria-label="Studio navigation" className="studio-nav-footer">
      <NavLink aria-label="Dashboard" className={navClass} end to="/">
        <OverviewIcon />
        <span>Dashboard</span>
      </NavLink>
      {canManageStudioUsers(user?.role) && (
        <NavLink aria-label="Users" className={navClass} to="/users">
          <UsersIcon />
          <span>Users</span>
        </NavLink>
      )}
      <NavLink aria-label="System Properties" className={navClass} to="/system">
        <ServerIcon />
        <span>System</span>
      </NavLink>
    </nav>
  )
}

/** The frame every signed-in page renders in. */
export function StudioShell() {
  const { agentId, section } = useParams<{ agentId?: string; section?: string }>()
  const agents = useStudioAgents()
  const radar = useStudioRadarResize()
  const [query, setQuery] = useState('')
  const shell: StudioShellContext = {
    ...agents,
    selectedAgent: agents.agents.find(agent => agent.id === agentId) ?? null,
    activeSection: section ?? DEFAULT_SECTION,
  }
  const mainStyle: StudioMainStyle = { '--agent-radar-width': `${String(radar.width)}px` }

  return (
    <div className="studio-shell">
      <StudioTopBar />
      <div className="studio-main studio-main-dock-collapsed" style={mainStyle}>
        <aside aria-label="Agent radar" className={`agent-radar ${radar.resizing ? 'agent-radar-resizing' : ''}`}>
          <button aria-label="Resize agent radar" className="agent-radar-resize-handle" onPointerDown={radar.startResize} type="button" />
          <div className="side-section">
            <div className="side-label">
              <span>Agents · {agents.agents.length}</span>
              <div className="side-label-actions">
                <button aria-label="Refresh agents" className="icon-action-button" onClick={() => void agents.refreshAgents()} title="Refresh" type="button"><RefreshIcon /></button>
                <button aria-label="Create new agent" className="icon-action-button" disabled title="即将推出" type="button"><PlusIcon /></button>
              </div>
            </div>
          </div>
          <label className="radar-search">
            <SearchIcon />
            <input aria-label="Search agents" onChange={event => setQuery(event.target.value)} placeholder="Search agents" value={query} />
          </label>
          <StudioRadarList query={query} shell={shell} />
          <StudioNavFooter />
        </aside>
        <div className="studio-workspace">
          <Outlet context={shell} />
        </div>
      </div>
    </div>
  )
}
