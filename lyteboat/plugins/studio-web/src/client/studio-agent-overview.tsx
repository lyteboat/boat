/**
 * An agent's Overview, laid out as the original Studio's: four metric tiles
 * (skills, tools, sessions, release), the run snapshot beside the health rows,
 * and three cards (recent skills, tools, the release lock) whose entries
 * deep-link into their sections. Skills and tools load together; sessions and
 * the in-flight reading are not served to the Studio yet, and their tiles and
 * rows say so instead of showing a number.
 * @module @lyteboat/studio-web/client/studio-agent-overview
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { StudioAgent, StudioSkillRouting, StudioSkillSummary, StudioTool } from '@lyteboat/contracts/studio'
import { studioApi } from './studio-api-client.ts'
import { studioToolReachLabel } from './studio-agent-tools.tsx'
import { useStudioCall } from './studio-call-state.ts'
import { formatStudioRelativeTime } from './studio-relative-time.ts'

/** What the Overview reads, in one answer. */
interface StudioOverviewSnapshot {
  skills: StudioSkillSummary[]
  routing: StudioSkillRouting
  tools: StudioTool[]
}

type StudioReleaseState = 'released' | 'deviates' | 'unreleased'
type StudioHealthTone = 'ok' | 'warn' | 'idle'

/** One row of the Health card. */
interface StudioHealthRow {
  label: string
  detail: string
  tone: StudioHealthTone
  badge: string
}

const STUDIO_RELEASE_LABEL: Record<StudioReleaseState, string> = { released: '已发布', deviates: '偏离发布', unreleased: '未发布' }
const STUDIO_RELEASE_NOTE: Record<StudioReleaseState, string> = {
  released: '已发布：目录内容与发布锁一致。',
  deviates: '偏离发布：目录内容与发布锁不同。',
  unreleased: '未发布：目录旁没有发布锁。',
}
const STUDIO_RELEASE_BADGE: Record<StudioReleaseState, string> = { released: 'badge ok', deviates: 'badge warn', unreleased: 'badge' }
const STUDIO_HEALTH_BADGE: Record<StudioHealthTone, string> = { ok: 'badge ok', warn: 'badge warn', idle: 'badge' }
const STUDIO_ROUTING_MODE_TEXT: Record<StudioSkillRouting['mode'], string> = { dynamic: '模型按描述路由', full: '全部载入', off: '不加载' }
const STUDIO_DIGEST_SHOWN = 19

function studioReleaseState(agent: StudioAgent): StudioReleaseState {
  if (agent.deviates) return 'deviates'
  return agent.release === undefined ? 'unreleased' : 'released'
}

function studioRoutingText(routing: StudioSkillRouting): string {
  const mode = STUDIO_ROUTING_MODE_TEXT[routing.mode]
  const router = routing.provider === undefined ? routing.model : routing.model === undefined ? routing.provider : `${routing.provider}/${routing.model}`
  return router === undefined ? mode : `${mode} · ${router}`
}

function studioCountHealthRow(label: string, valid: number, total: number, detail: string): StudioHealthRow {
  if (total === 0) return { label, detail, tone: 'warn', badge: 'EMPTY' }
  return valid < total ? { label, detail, tone: 'warn', badge: 'WARN' } : { label, detail, tone: 'ok', badge: 'OK' }
}

function studioReleaseHealthRow(agent: StudioAgent): StudioHealthRow {
  const label = '发布一致性'
  if (agent.release === undefined) {
    return agent.releaseProblem === undefined
      ? { label, detail: '没有发布锁', tone: 'idle', badge: 'NONE' }
      : { label, detail: `发布锁读不出：${agent.releaseProblem}`, tone: 'warn', badge: 'NONE' }
  }
  return agent.deviates
    ? { label, detail: `目录内容与发布锁 v${agent.release.version} 不同`, tone: 'warn', badge: 'WARN' }
    : { label, detail: `与发布锁 v${agent.release.version} 一致`, tone: 'ok', badge: 'OK' }
}

function studioHealthRows(agent: StudioAgent, snapshot: StudioOverviewSnapshot): StudioHealthRow[] {
  const validSkills = snapshot.skills.filter(skill => skill.metadataProblem === undefined).length
  // The original counted a tool without parameters as unparsed; here every schema is the registry's, so an object schema is a parsed one.
  const toolsWithSchema = snapshot.tools.filter(tool => tool.parameters['type'] === 'object').length
  return [
    studioCountHealthRow('Skills 元数据', validSkills, snapshot.skills.length, `${String(validSkills)}/${String(snapshot.skills.length)} 元数据有效`),
    studioCountHealthRow('Tools schema', toolsWithSchema, snapshot.tools.length, `${String(toolsWithSchema)}/${String(snapshot.tools.length)} 已解析 schema`),
    studioReleaseHealthRow(agent),
    { label: 'Session 活跃度', detail: '尚未接入', tone: 'idle', badge: '—' },
  ]
}

function StudioOverviewMetric({ label, note, value }: { label: string; note: string; value: string | number }) {
  return (
    <div className="metric-surface metric-surface-compact">
      <div className="metric-surface-compact-copy">
        <span>{label}</span>
        <p>{note}</p>
      </div>
      <strong>{value}</strong>
    </div>
  )
}

function StudioOverviewSignals({ agent, snapshot }: { agent: StudioAgent; snapshot: StudioOverviewSnapshot }) {
  return (
    <section className="workspace-grid-two">
      <article className="workspace-surface">
        <div className="surface-heading">
          <span>运行快照</span>
        </div>
        <div className="signal-list">
          <div className="signal-card">
            <strong>正在执行的消息</strong>
            <p>读数暂不可用。</p>
          </div>
          <div className="signal-card">
            <strong>最近会话活动</strong>
            <p>会话数据尚未接入。</p>
          </div>
          <div className="signal-card">
            <strong>技能加载方式</strong>
            <p>{studioRoutingText(snapshot.routing)}</p>
          </div>
        </div>
      </article>

      <article className="workspace-surface">
        <div className="surface-heading">
          <span>Health</span>
        </div>
        <div>
          {studioHealthRows(agent, snapshot).map(row => (
            <div className="health-row" key={row.label}>
              <span className={`status-dot ${row.tone}`} />
              <div>
                <div className="row-name">{row.label}</div>
                <div className="row-meta">{row.detail}</div>
              </div>
              <span className={STUDIO_HEALTH_BADGE[row.tone]}>{row.badge}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

function StudioOverviewRecentSkills({ agentId, skills }: { agentId: string; skills: StudioSkillSummary[] }) {
  const navigate = useNavigate()
  const recent = [...skills].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)).slice(0, 3)
  return (
    <article className="workspace-surface">
      <div className="surface-heading">
        <span>最近技能</span>
        <button className="btn btn-ghost btn-sm" onClick={() => void navigate(`/agents/${agentId}/skills`)} type="button">View all →</button>
      </div>
      <div className="document-list">
        {recent.map(skill => (
          <button aria-label={`Open skill ${skill.name}`} className="document-card document-button" key={skill.name} onClick={() => void navigate(`/agents/${agentId}/skills?skill=${encodeURIComponent(skill.name)}`)} type="button">
            <strong>{skill.name}</strong>
            <p>{skill.description || skill.path}</p>
            {skill.updatedAt !== undefined && <span>{formatStudioRelativeTime(skill.updatedAt)}</span>}
          </button>
        ))}
        {skills.length === 0 && <div className="empty-surface">No skills found.</div>}
      </div>
    </article>
  )
}

function StudioOverviewTools({ agentId, tools }: { agentId: string; tools: StudioTool[] }) {
  const navigate = useNavigate()
  const shown = [...tools].sort((left, right) => Number(right.reach === 'always') - Number(left.reach === 'always')).slice(0, 3)
  return (
    <article className="workspace-surface">
      <div className="surface-heading">
        <span>工具</span>
        <button className="btn btn-ghost btn-sm" onClick={() => void navigate(`/agents/${agentId}/tools`)} type="button">View all →</button>
      </div>
      <div className="document-list">
        {shown.map(tool => (
          <button aria-label={`Open tool ${tool.name}`} className="document-card document-button" key={tool.name} onClick={() => void navigate(`/agents/${agentId}/tools?tool=${encodeURIComponent(tool.name)}`)} type="button">
            <strong>{tool.name}</strong>
            <p>{tool.description}</p>
            <span>{studioToolReachLabel(tool.reach)}</span>
          </button>
        ))}
        {tools.length === 0 && <div className="empty-surface">No tools found.</div>}
      </div>
    </article>
  )
}

function StudioOverviewRelease({ agent }: { agent: StudioAgent }) {
  const state = studioReleaseState(agent)
  return (
    <article className="workspace-surface">
      <div className="surface-heading">
        <span>发布锁</span>
        <span className={STUDIO_RELEASE_BADGE[state]}>{STUDIO_RELEASE_LABEL[state]}</span>
      </div>
      <div className="signal-list">
        <div className="signal-card">
          <strong>发布版本</strong>
          <p>{agent.release === undefined ? agent.releaseProblem ?? '没有发布锁。' : `v${agent.release.version}`}</p>
        </div>
        {agent.release !== undefined && (
          <div className="signal-card">
            <strong>锁定摘要</strong>
            <p>{agent.release.digest.slice(0, STUDIO_DIGEST_SHOWN)}</p>
          </div>
        )}
        <div className="signal-card">
          <strong>当前摘要</strong>
          <p>{agent.digest.slice(0, STUDIO_DIGEST_SHOWN)}</p>
        </div>
      </div>
    </article>
  )
}

/** The Overview section of an agent's workspace. */
export function StudioAgentOverview({ agent }: { agent: StudioAgent }) {
  const { answer, error } = useStudioCall(useCallback(async (): Promise<StudioOverviewSnapshot> => {
    const [skills, tools] = await Promise.all([studioApi.skills(agent.id), studioApi.tools(agent.id)])
    return { skills: skills.skills, routing: skills.routing, tools: tools.tools }
  }, [agent.id]))

  if (error !== null) return <div className="empty-surface">{error}</div>
  if (answer === null) return <div className="empty-surface">Loading overview...</div>
  const state = studioReleaseState(agent)

  return (
    <div className="workspace-overview-scroll">
      <section className="workspace-grid-four overview-metric-grid">
        <StudioOverviewMetric label="Skills" note="当前 Agent 已注册的技能条目。" value={answer.skills.length} />
        <StudioOverviewMetric label="Tools" note="可被编排或调用的工具数量。" value={answer.tools.length} />
        <StudioOverviewMetric label="Sessions" note="最近保留下来的会话记录总数。" value="—" />
        <StudioOverviewMetric label="Release" note={STUDIO_RELEASE_NOTE[state]} value={agent.release === undefined ? '—' : `v${agent.release.version}`} />
      </section>

      <StudioOverviewSignals agent={agent} snapshot={answer} />

      <section className="workspace-grid-three">
        <StudioOverviewRecentSkills agentId={agent.id} skills={answer.skills} />
        <StudioOverviewTools agentId={agent.id} tools={answer.tools} />
        <StudioOverviewRelease agent={agent} />
      </section>
    </div>
  )
}
