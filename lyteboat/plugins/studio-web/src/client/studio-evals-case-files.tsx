/**
 * An agent's Cases, read only: each case file under the agent's `evals/`
 * with its cases (id, turns, first message, the case's request context, how
 * many checks), laid out as the original Studio's dataset lists lay out cases.
 * A case expands into its turns, each a turn card with the message, the
 * context the turn brings, and its expectations (check → expected) in the
 * original's expectation-table look. A file that does not load shows why.
 * Editors and admins 试跑 a case: a real run of that case alone, opened as soon
 * as the Studio starts it; a refusal shows above the files. Cases are edited
 * in their files, so there is no editing, import, or export here.
 * @module @lyteboat/studio-web/client/studio-evals-case-files
 */

import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { StudioEvalCase, StudioEvalCaseFile } from '@lyteboat/contracts/studio'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'
import { useStudioEvalsAgent } from './studio-evals-agent-scope.tsx'
import { StudioEvalsEmpty, StudioEvalsErrorCallout } from './studio-evals-primitives.tsx'
import { StudioEvalsContextTags, StudioEvalsExpectTable, StudioEvalsTurnBadge, StudioEvalsTurnConnector, StudioEvalsTurnGutter, StudioEvalsTurnUserEcho, studioEvalExpectCount } from './studio-evals-turn-atoms.tsx'
import { PlayIcon } from './studio-icons.tsx'

const STUDIO_EVAL_CASE_COLUMNS = 7

/** What a case row needs from the page: whether 试跑 shows, which case is starting, and the start. */
interface StudioEvalsCaseTry {
  canRun: boolean
  starting: string | null
  start(caseId: string): void
}

function StudioEvalsCaseTurnCard({ turn, index }: { turn: StudioEvalCase['turns'][number]; index: number }) {
  const count = studioEvalExpectCount(turn.expect)
  return (
    <div className="evals-turn-card evals-turn-card-idle">
      <StudioEvalsTurnGutter state="idle" turn={index + 1} />
      <div className="evals-turn-body">
        <div className="evals-turn-section">
          <div className="evals-turn-section-head">
            <span className="evals-kicker">user</span>
            {turn.context !== undefined && <span className="evals-turn-context"><span className="evals-kicker">context</span><StudioEvalsContextTags context={turn.context} /></span>}
          </div>
          <StudioEvalsTurnUserEcho text={turn.message} />
        </div>
        <div className="evals-turn-section">
          <div className="evals-turn-section-head">
            <span className="evals-kicker">expect<span className="evals-kicker-meta"> · {count} check{count === 1 ? '' : 's'}</span></span>
          </div>
          <StudioEvalsExpectTable expect={turn.expect} />
        </div>
      </div>
    </div>
  )
}

function StudioEvalsCaseRow({ evalCase, open, onToggle, trial }: { evalCase: StudioEvalCase; open: boolean; onToggle(): void; trial: StudioEvalsCaseTry }) {
  const first = evalCase.turns[0]?.message ?? ''
  const checks = evalCase.turns.reduce((total, turn) => total + studioEvalExpectCount(turn.expect), 0)
  return (
    <>
      <tr aria-expanded={open} className={`clickable ${open ? 'evals-row-open' : ''}`} onClick={onToggle}>
        <td className="evals-col-arrow"><span aria-hidden="true" className="evals-expand-arrow">{open ? '▼' : '▶'}</span></td>
        <td className="evals-tbl-cell-trunc evals-col-case"><span className="evals-mono-sm" title={evalCase.id}>{evalCase.id}</span></td>
        <td><StudioEvalsTurnBadge count={evalCase.turns.length} /></td>
        <td><div className="evals-query-cell" title={first}>{first}</div></td>
        <td><StudioEvalsContextTags context={evalCase.context} /></td>
        <td className="evals-nowrap">{checks === 0 ? <span className="evals-pill evals-pill-warn">no checks</span> : <span className="evals-mono-sm">{checks} checks</span>}</td>
        <td onClick={event => event.stopPropagation()}>
          {trial.canRun && (
            <button className="btn btn-sm" disabled={trial.starting !== null} onClick={() => trial.start(evalCase.id)} title="只跑这一个 case 的 real run（调用模型）" type="button">
              <PlayIcon /> {trial.starting === evalCase.id ? '启动中…' : '试跑'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="evals-drawer-row">
          <td colSpan={STUDIO_EVAL_CASE_COLUMNS}>
            <div className="evals-case-drawer">
              {evalCase.turns.map((turn, index) => (
                <Fragment key={`${String(index)}-${turn.message}`}>
                  {index > 0 && <StudioEvalsTurnConnector />}
                  <StudioEvalsCaseTurnCard index={index} turn={turn} />
                </Fragment>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function StudioEvalsCaseFileSurface({ file, openCase, onToggle, trial }: { file: StudioEvalCaseFile; openCase: string | null; onToggle(caseId: string): void; trial: StudioEvalsCaseTry }) {
  return (
    <section aria-label={file.file} className="evals-surface evals-case-file">
      <header className="evals-surface-head">
        <span className="evals-surface-head-title evals-mono-sm">{file.file}</span>
        {file.error === undefined
          ? <span className="evals-surface-head-meta">{file.cases.length} case{file.cases.length === 1 ? '' : 's'}</span>
          : <span className="evals-pill evals-pill-err">load error</span>}
      </header>
      {file.error !== undefined && <div className="evals-case-file-error"><StudioEvalsErrorCallout label="Case file error" message={file.error} /></div>}
      {file.cases.length > 0 && (
        <table className="evals-tbl">
          <thead>
            <tr>
              <th aria-label="Expand" className="evals-col-arrow" />
              <th className="evals-col-case">Case ID</th>
              <th>Turns</th>
              <th>First message</th>
              <th>Context</th>
              <th>Checks</th>
              <th aria-label="Try" />
            </tr>
          </thead>
          <tbody>
            {file.cases.map(evalCase => <StudioEvalsCaseRow evalCase={evalCase} key={evalCase.id} onToggle={() => onToggle(evalCase.id)} open={openCase === evalCase.id} trial={trial} />)}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** The Cases tab's files. */
export function StudioEvalsCaseFiles({ canRun }: { canRun: boolean }) {
  const { agentId, caseFiles, reloadRuns } = useStudioEvalsAgent()
  const navigate = useNavigate()
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  if (caseFiles === null) return <div className="evals-list-page"><StudioEvalsEmpty hint="Loading cases…" /></div>
  if (caseFiles.length === 0) return <div className="evals-list-page"><StudioEvalsEmpty hint="Add YAML case files under the agent's evals/ directory." title="No eval cases" /></div>

  const start = async (caseId: string): Promise<void> => {
    setStarting(caseId)
    setRefusal(null)
    try {
      const run = await studioApi.startEvalRun({ agentId, mode: 'real', caseIds: [caseId] })
      void reloadRuns()
      void navigate(`/evals/${agentId}/runs/${encodeURIComponent(run.runId)}`)
    } catch (error: unknown) {
      setRefusal(`${caseId}: ${studioErrorMessage(error)}`)
      setStarting(null)
    }
  }
  const trial: StudioEvalsCaseTry = { canRun, starting, start: caseId => void start(caseId) }

  return (
    <div className="evals-list-page">
      {refusal !== null && <StudioEvalsErrorCallout label="试跑 refused" message={refusal} />}
      <div className="evals-case-files">
        {caseFiles.map(file => (
          <StudioEvalsCaseFileSurface file={file} key={file.file} onToggle={caseId => setOpenCase(current => current === caseId ? null : caseId)} openCase={openCase} trial={trial} />
        ))}
      </div>
    </div>
  )
}
