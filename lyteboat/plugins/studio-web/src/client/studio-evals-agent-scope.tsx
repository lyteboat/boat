/**
 * What the pages under `/evals/:agentId` share, as the original Studio's
 * Evals agent scope: the agent's case files and its runs (newest first), read
 * when the agent is opened, each reloadable on its own, with the error of its
 * last reading. The pages stay mounted while a reading runs, so a dialog or a
 * navigation is never cut off by a refresh; a reading that answers after a
 * newer one is dropped. Each agent mounts its own scope.
 * @module @lyteboat/studio-web/client/studio-evals-agent-scope
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useOutletContext, useParams } from 'react-router-dom'
import type { StudioEvalCaseFile, StudioEvalRun } from '@lyteboat/contracts/studio'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'

/** The agent's eval data; `null` until its first reading answers. */
interface StudioEvalsAgentContext {
  agentId: string
  caseFiles: StudioEvalCaseFile[] | null
  casesError: string | null
  runs: StudioEvalRun[] | null
  runsError: string | null
  reloadCases(): Promise<void>
  reloadRuns(): Promise<void>
}

/** The scope's data, for a page under `/evals/:agentId`. */
export function useStudioEvalsAgent(): StudioEvalsAgentContext {
  return useOutletContext<StudioEvalsAgentContext>()
}

/** One reading kept as its answer and error, dropping an answer older than the last one asked for. */
function useStudioEvalsReading<T>(read: () => Promise<T>): { answer: T | null; error: string | null; reload(): Promise<void> } {
  const [answer, setAnswer] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const next = await read()
      if (mounted.current && ticket === latest.current) {
        setAnswer(next)
        setError(null)
      }
    } catch (nextError: unknown) {
      if (mounted.current && ticket === latest.current) setError(studioErrorMessage(nextError))
    }
  }, [read])

  return { answer, error, reload }
}

function StudioEvalsAgentData({ agentId }: { agentId: string }) {
  const cases = useStudioEvalsReading(useCallback(async () => (await studioApi.evalCases(agentId)).files, [agentId]))
  const runs = useStudioEvalsReading(useCallback(async () => (await studioApi.evalRuns(agentId)).runs, [agentId]))
  const { reload: reloadCases } = cases
  const { reload: reloadRuns } = runs

  useEffect(() => {
    void reloadCases()
    void reloadRuns()
  }, [reloadCases, reloadRuns])

  const context = useMemo((): StudioEvalsAgentContext => ({
    agentId,
    caseFiles: cases.answer,
    casesError: cases.error,
    runs: runs.answer,
    runsError: runs.error,
    reloadCases,
    reloadRuns,
  }), [agentId, cases.answer, cases.error, runs.answer, runs.error, reloadCases, reloadRuns])
  return <Outlet context={context} />
}

/** The element of `/evals/:agentId`; a new agent mounts a new scope, so no page shows the previous agent's data. */
export function StudioEvalsAgentScope() {
  const { agentId } = useParams<{ agentId: string }>()
  if (agentId === undefined) return <Navigate replace to="/evals" />
  return <StudioEvalsAgentData agentId={agentId} key={agentId} />
}
