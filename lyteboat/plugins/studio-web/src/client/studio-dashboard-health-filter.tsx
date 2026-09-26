/**
 * The performance view's filter, as the original Studio's: the agent (all by
 * default, the choices from the radar), the range (the last 12, 24, or 48
 * hours up to now, or whole local days picked by date), and an optional
 * comparison of whole local days, today against yesterday at first. A picked
 * range whose end comes before its start is invalid, and nothing is asked for
 * until it is fixed. The filter becomes the health query when it is read, so a
 * preset ends at the moment of each load.
 * @module @lyteboat/studio-web/client/studio-dashboard-health-filter
 */

import type { StudioAgent } from '@lyteboat/contracts/studio'
import type { StudioDashboardHealthQuery } from './studio-api-client.ts'
import { studioDashboardDateInput, studioDashboardDayEnd, studioDashboardDayStart } from './studio-dashboard-format.ts'
import { RefreshIcon } from './studio-icons.tsx'
import { studioAgentName } from './studio-shell.tsx'

const STUDIO_HEALTH_RANGE_PRESETS = ['12h', '24h', '48h', 'custom'] as const
const STUDIO_HOUR_MS = 3_600_000

type StudioHealthRangePreset = typeof STUDIO_HEALTH_RANGE_PRESETS[number]

/** The filter: the agent (empty for all), the range, and the comparison; dates are `YYYY-MM-DD`. */
interface StudioHealthFilter {
  agentId: string
  preset: StudioHealthRangePreset
  customStart: string
  customEnd: string
  comparing: boolean
  comparisonStart: string
  comparisonEnd: string
}

/** The filter a visit starts with: all agents, the last 24 hours, today against yesterday once comparing. */
export function studioHealthFilterInitial(): StudioHealthFilter {
  const today = studioDashboardDateInput(0)
  const yesterday = studioDashboardDateInput(1)
  return { agentId: '', preset: '24h', customStart: today, customEnd: today, comparing: false, comparisonStart: yesterday, comparisonEnd: yesterday }
}

function studioDateRangeInvalid(start: string, end: string): boolean {
  return start === '' || end === '' || start > end
}

/** A picked range, or the comparison, is missing a date or ends before it starts. */
export function studioHealthFilterInvalid(filter: StudioHealthFilter): boolean {
  return (filter.preset === 'custom' && studioDateRangeInvalid(filter.customStart, filter.customEnd))
    || (filter.comparing && studioDateRangeInvalid(filter.comparisonStart, filter.comparisonEnd))
}

/**
 * @param filter - a valid filter.
 * @param now - the moment a preset range ends.
 * @returns the health query: the window, the agent when one is picked, the comparison when on.
 */
export function studioHealthQuery(filter: StudioHealthFilter, now: number): StudioDashboardHealthQuery {
  const range = filter.preset === 'custom'
    ? { from: studioDashboardDayStart(filter.customStart), to: studioDashboardDayEnd(filter.customEnd) }
    : { from: now - Number.parseInt(filter.preset, 10) * STUDIO_HOUR_MS, to: now }
  return {
    ...range,
    ...filter.agentId === '' ? {} : { agent: filter.agentId },
    ...filter.comparing ? { compareFrom: studioDashboardDayStart(filter.comparisonStart), compareTo: studioDashboardDayEnd(filter.comparisonEnd) } : {},
  }
}

function StudioDateFields({ start, end, startLabel, endLabel, compare, onChange }: {
  start: string
  end: string
  startLabel: string
  endLabel: string
  compare: boolean
  onChange(start: string, end: string): void
}) {
  return (
    <div className={compare ? 'health-date-fields health-compare-dates' : 'health-date-fields'}>
      <input aria-label={startLabel} onChange={event => onChange(event.target.value, end)} type="date" value={start} />
      <span>—</span>
      <input aria-label={endLabel} onChange={event => onChange(start, event.target.value)} type="date" value={end} />
    </div>
  )
}

/** The filter bar, with the refresh button that reloads the radar and the health. */
export function StudioHealthFilterBar({ agents, filter, loading, onChange, onRefresh }: {
  agents: readonly StudioAgent[]
  filter: StudioHealthFilter
  loading: boolean
  onChange(filter: StudioHealthFilter): void
  onRefresh(): void
}) {
  return (
    <section className="workspace-surface health-filter-bar">
      <label>
        <span>智能体</span>
        <select onChange={event => onChange({ ...filter, agentId: event.target.value })} value={filter.agentId}>
          <option value="">全部智能体</option>
          {agents.map(agent => <option key={agent.id} value={agent.id}>{studioAgentName(agent)}</option>)}
        </select>
      </label>
      <div aria-label="时间范围" className="health-range-presets">
        {STUDIO_HEALTH_RANGE_PRESETS.map(preset => (
          <button className={filter.preset === preset ? 'active' : ''} key={preset} onClick={() => onChange({ ...filter, preset })} type="button">
            {preset === 'custom' ? '指定日期' : preset.toUpperCase()}
          </button>
        ))}
      </div>
      {filter.preset === 'custom' && (
        <StudioDateFields compare={false} end={filter.customEnd} endLabel="结束日期" onChange={(customStart, customEnd) => onChange({ ...filter, customStart, customEnd })} start={filter.customStart} startLabel="开始日期" />
      )}
      <label className="health-compare-toggle">
        <input checked={filter.comparing} onChange={event => onChange({ ...filter, comparing: event.target.checked })} type="checkbox" />
        <span>日期对比</span>
      </label>
      {filter.comparing && (
        <StudioDateFields compare end={filter.comparisonEnd} endLabel="对比结束日期" onChange={(comparisonStart, comparisonEnd) => onChange({ ...filter, comparisonStart, comparisonEnd })} start={filter.comparisonStart} startLabel="对比开始日期" />
      )}
      {studioHealthFilterInvalid(filter) && <b className="health-filter-error">请选择有效的日期范围</b>}
      <button className="btn btn-sm health-filter-refresh" disabled={loading} onClick={onRefresh} type="button">
        <RefreshIcon />{loading ? '刷新中…' : '刷新'}
      </button>
    </section>
  )
}
