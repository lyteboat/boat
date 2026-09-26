/**
 * The Evals pages' small widgets, as the original Studio's Evals primitives
 * draw them: a run's status pill and mode pill, the score bar, the progress
 * bar of a running run, the breadcrumbs of a detail page, the filter chip, the
 * pagination footer of a list, the empty state, and the error callout.
 * @module @lyteboat/studio-web/client/studio-evals-primitives
 */

import { useMemo, type ReactNode } from 'react'
import type { StudioEvalRun, StudioEvalRunStatus } from '@lyteboat/contracts/studio'
import type { StudioEvalsTone } from './studio-evals-format.ts'

const STUDIO_EVAL_STATUS_PILL: Record<StudioEvalRunStatus, string> = {
  running: 'evals-pill-info',
  passed: 'evals-pill-ok',
  failed: 'evals-pill-err',
  error: 'evals-pill-err',
  stopped: 'evals-pill-warn',
  interrupted: 'evals-pill-warn',
  incomplete: '',
}

const STUDIO_EVAL_PAGE_SIZES = [25, 50, 100] as const
const STUDIO_EVAL_PAGE_BUTTONS = 5

/** A run's status as a pill with its dot. */
export function StudioEvalsStatusPill({ status }: { status: StudioEvalRunStatus }) {
  return (
    <span className={`evals-pill ${STUDIO_EVAL_STATUS_PILL[status]}`}>
      <span className="evals-pill-dot" />
      {status}
    </span>
  )
}

/** A run's mode; a replay names the run it played back. */
export function StudioEvalsModePill({ run }: { run: StudioEvalRun }) {
  return (
    <span className="evals-mode-cell">
      <span className={`evals-pill ${run.mode === 'replay' ? 'evals-pill-accent' : ''}`}>{run.mode}</span>
      {run.from !== undefined && <span className="evals-mono-sm evals-muted evals-nowrap" title={`replay of ${run.from}`}>from {run.from}</span>}
    </span>
  )
}

/** A share (0 to 1) as a bar and a percentage. */
export function StudioEvalsScoreBar({ value, tone }: { value: number; tone: StudioEvalsTone }) {
  const safe = Math.max(0, Math.min(1, value))
  return (
    <div className="evals-score-row">
      <div className="evals-score-bar">
        <div className={`evals-score-bar-fill ${tone}`} style={{ width: `${String(safe * 100)}%` }} />
      </div>
      <span className="evals-score-num">{Math.round(safe * 100)}%</span>
    </div>
  )
}

/** A running run's finished cases over its total, as a moving bar. */
export function StudioEvalsProgressBar({ done, total }: { done: number; total: number | undefined }) {
  const pct = total === undefined || total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))
  return (
    <div className="evals-run-progress-inline">
      <div aria-valuemax={100} aria-valuemin={0} aria-valuenow={pct} className="evals-run-progress-bar" role="progressbar">
        <div className="evals-run-progress-fill running" style={{ width: `${String(pct)}%` }} />
      </div>
      <span className="evals-muted evals-mono-sm">running… {done}/{total ?? '?'}</span>
    </div>
  )
}

/** One step of a detail page's breadcrumbs; the last has no action. */
interface StudioEvalsCrumb {
  label: string
  onClick?: () => void
}

/** The breadcrumbs over a detail page's title. */
export function StudioEvalsCrumbs({ items }: { items: readonly StudioEvalsCrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="evals-crumbs">
      {items.map((item, index) => (
        <span className="evals-crumb" key={`${String(index)}-${item.label}`}>
          {index > 0 && <span className="evals-crumbs-sep">/</span>}
          {item.onClick === undefined
            ? <span className="evals-mono-sm">{item.label}</span>
            : <button onClick={item.onClick} type="button">{item.label}</button>}
        </span>
      ))}
    </nav>
  )
}

/** A filter chip; the active one is inked. */
export function StudioEvalsFilterChip({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return <button aria-pressed={active} className={`evals-filter-chip ${active ? 'active' : ''}`} onClick={onClick} type="button">{children}</button>
}

/** A list's footer: the rows shown, the page size, and the first five pages. */
export function StudioEvalsPagination({ total, page, perPage, onPage, onPerPage }: {
  total: number
  page: number
  perPage: number
  onPage(page: number): void
  onPerPage(perPage: number): void
}) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(Math.max(page, 1), pages)
  const start = total === 0 ? 0 : (current - 1) * perPage + 1
  const end = Math.min(current * perPage, total)
  const buttons = useMemo(() => Array.from({ length: Math.min(pages, STUDIO_EVAL_PAGE_BUTTONS) }, (_, index) => index + 1), [pages])
  return (
    <div className="evals-pagination">
      <span className="evals-pagination-left">Showing {start}–{end} of {total}</span>
      <div className="evals-pagination-right">
        <label className="evals-pagination-per">
          <span>per page</span>
          <select onChange={event => onPerPage(Number(event.target.value))} value={perPage}>
            {STUDIO_EVAL_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div className="evals-pagination-pages">
          <button aria-label="Previous page" className="evals-pagination-page" disabled={current <= 1} onClick={() => onPage(current - 1)} type="button">‹</button>
          {buttons.map(item => (
            <button aria-label={`Page ${String(item)}`} className={`evals-pagination-page ${item === current ? 'active' : ''}`} key={item} onClick={() => onPage(item)} type="button">{item}</button>
          ))}
          <button aria-label="Next page" className="evals-pagination-page" disabled={current >= pages} onClick={() => onPage(current + 1)} type="button">›</button>
        </div>
      </div>
    </div>
  )
}

/** An empty or loading state: a title, a hint, and an action. */
export function StudioEvalsEmpty({ title, hint, children }: { title?: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="evals-empty">
      {title !== undefined && <strong>{title}</strong>}
      {hint !== undefined && <span>{hint}</span>}
      {children}
    </div>
  )
}

/** A refusal or a failure, said where it happened. */
export function StudioEvalsErrorCallout({ label, message }: { label: string; message: string }) {
  return (
    <div className="evals-callout evals-callout-error" role="alert">
      <span className="evals-callout-icon">✕</span>
      <div className="evals-callout-body">
        <span className="evals-callout-label">{label}</span>
        <span>{message}</span>
      </div>
    </div>
  )
}
