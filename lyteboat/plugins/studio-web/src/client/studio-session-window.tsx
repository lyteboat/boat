/**
 * The time window of an agent's Sessions list, as the original Studio keeps
 * it: the last two hours by default, a start and an end typed as
 * `YYYY/MM/DD HH:mm` (local time) and applied together, or 全量 for every
 * session. The window filters a session's `updatedAt`; the list and the search
 * both read it. {@link useStudioSessionWindow} holds the window, and
 * {@link StudioSessionWindowPanel} is its panel under the list's search box.
 * @module @lyteboat/studio-web/client/studio-session-window
 */

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronRightIcon } from './studio-icons.tsx'
import { StudioSwitch } from './studio-switch.tsx'

const STUDIO_SESSION_DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000
const STUDIO_SESSION_MINUTE_MS = 60_000
const STUDIO_SESSION_DATE_TIME = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/u

/** The window's two ends as typed. */
interface StudioSessionDateRange {
  since: string
  until: string
}

/** What a listing or a search asks for: `updatedAt` bounds in epoch ms, or neither for 全量. */
type StudioSessionWindow = { since?: number; until?: number }

/** The window, and what its panel edits. */
export interface StudioSessionWindowState {
  /** The applied window; the same object until it changes. */
  window: StudioSessionWindow
  draft: StudioSessionDateRange
  setDraft: Dispatch<SetStateAction<StudioSessionDateRange>>
  applied: StudioSessionDateRange
  apply(): void
  /** Apply the last two hours, ending now. */
  showRecent(): void
  fullScope: boolean
  setFullScope(full: boolean): void
  expanded: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
}

function formatStudioSessionDateTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear())}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The moment a typed end names, or NaN when it is not a real `YYYY/MM/DD HH:mm`. */
function parseStudioSessionDateTime(value: string): number {
  const match = STUDIO_SESSION_DATE_TIME.exec(value.trim())
  if (match === null) return Number.NaN
  const [, year, month, day, hour, minute] = match.map(Number)
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) return Number.NaN
  const epochMs = new Date(year, month - 1, day, hour, minute).getTime()
  // Date rolls 2024/02/31 over into March; only a date that formats back to itself is real.
  return formatStudioSessionDateTime(epochMs) === value.trim() ? epochMs : Number.NaN
}

function recentStudioSessionDateRange(now = Date.now()): StudioSessionDateRange {
  return { since: formatStudioSessionDateTime(now - STUDIO_SESSION_DEFAULT_WINDOW_MS), until: formatStudioSessionDateTime(now) }
}

function studioSessionWindowOf(range: StudioSessionDateRange): Required<StudioSessionWindow> | null {
  const since = parseStudioSessionDateTime(range.since)
  const until = parseStudioSessionDateTime(range.until)
  if (Number.isNaN(since) || Number.isNaN(until) || since > until) return null
  // The end is typed to the minute; it takes in that whole minute, or the default window would
  // leave out the sessions updated in the minute the page opened.
  return { since, until: until + STUDIO_SESSION_MINUTE_MS - 1 }
}

function studioSessionDateRangeError(draft: StudioSessionDateRange): string | null {
  if (draft.since === '' || draft.until === '') return '请输入完整的开始和结束时间'
  return studioSessionWindowOf(draft) === null ? '请使用 YYYY/MM/DD HH:mm 格式，并检查时间顺序' : null
}

/** The window of a Sessions section, starting at the last two hours. */
export function useStudioSessionWindow(): StudioSessionWindowState {
  const [initial] = useState(recentStudioSessionDateRange)
  const [draft, setDraft] = useState(initial)
  const [applied, setApplied] = useState(initial)
  const [fullScope, setFullScopeState] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const sessionWindow = useMemo((): StudioSessionWindow => fullScope ? {} : studioSessionWindowOf(applied) ?? {}, [applied, fullScope])
  const apply = useCallback(() => {
    if (studioSessionDateRangeError(draft) === null) setApplied({ ...draft })
  }, [draft])
  const showRecent = useCallback(() => {
    const recent = recentStudioSessionDateRange()
    setDraft(recent)
    setApplied(recent)
  }, [])
  const setFullScope = useCallback((full: boolean) => {
    setFullScopeState(full)
    if (full) setExpanded(false)
  }, [])

  return { window: sessionWindow, draft, setDraft, applied, apply, showRecent, fullScope, setFullScope, expanded, setExpanded }
}

function StudioSessionDateField({ label, ariaLabel, value, disabled, onChange }: {
  label: string
  ariaLabel: string
  value: string
  disabled: boolean
  onChange(value: string): void
}) {
  return (
    <label className="session-date-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        inputMode="numeric"
        onChange={event => onChange(event.target.value)}
        placeholder="YYYY/MM/DD HH:mm"
        type="text"
        value={value}
      />
    </label>
  )
}

function StudioSessionDateForm({ state }: { state: StudioSessionWindowState }) {
  const { draft, setDraft, applied, fullScope } = state
  const error = studioSessionDateRangeError(draft)
  const changed = draft.since !== applied.since || draft.until !== applied.until
  return (
    <form
      className="session-date-filter"
      onSubmit={event => {
        event.preventDefault()
        if (!fullScope && changed) state.apply()
      }}
    >
      <div className="session-date-range">
        <StudioSessionDateField ariaLabel="Session start time" disabled={fullScope} label="开始" onChange={since => setDraft(current => ({ ...current, since }))} value={draft.since} />
        <StudioSessionDateField ariaLabel="Session end time" disabled={fullScope} label="结束" onChange={until => setDraft(current => ({ ...current, until }))} value={draft.until} />
      </div>
      <div className="session-date-actions">
        <span className={error === null ? 'session-date-hint' : 'session-date-error'}>
          {fullScope ? '已开启全量，不按时间筛选' : error ?? '按会话最后更新时间筛选'}
        </span>
        <button className="action-button action-button-primary session-date-apply" disabled={fullScope || error !== null || !changed} type="submit">
          应用
        </button>
      </div>
    </form>
  )
}

/** The window's panel: 时间区间 (expands to the form), 最近 2 小时, and 全量. */
export function StudioSessionWindowPanel({ state }: { state: StudioSessionWindowState }) {
  const { expanded, fullScope } = state
  return (
    <div className="session-filter-panel">
      <div className="session-filter-heading">
        <div className="session-filter-heading-leading">
          <button aria-expanded={expanded} className="session-filter-expand" disabled={fullScope} onClick={() => state.setExpanded(current => !current)} type="button">
            <ChevronRightIcon className={expanded ? 'expanded' : ''} />
            <span>时间区间</span>
          </button>
          {!fullScope && <button className="session-filter-reset" onClick={state.showRecent} type="button">最近 2 小时</button>}
        </div>
        <span className="session-heading-toggle session-filter-scope-toggle">
          <span>全量</span>
          <StudioSwitch checked={fullScope} label="全量" onChange={state.setFullScope} />
        </span>
      </div>
      {expanded && <StudioSessionDateForm state={state} />}
    </div>
  )
}
