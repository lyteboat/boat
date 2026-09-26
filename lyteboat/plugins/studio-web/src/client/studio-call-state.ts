/**
 * A Studio call a section makes when it mounts, and again whenever the call
 * changes (another agent, another skill), held as its answer or the message of
 * the error that stopped it; both are null while it runs. An answer that
 * arrives after the call changed or the section unmounted is dropped, so a
 * quick switch never shows the previous agent's data.
 * @module @lyteboat/studio-web/client/studio-call-state
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { studioErrorMessage } from './studio-api-client.ts'

/** A call's answer or error, and a setter for a section that changes what it answered (a hot-fix). */
interface StudioCallState<T> {
  answer: T | null
  error: string | null
  setAnswer: Dispatch<SetStateAction<T | null>>
}

/**
 * @param call - the call, memoized (`useCallback`) on what it asks for; a new function runs it again.
 * @returns its state.
 */
export function useStudioCall<T>(call: () => Promise<T>): StudioCallState<T> {
  const [answer, setAnswer] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setAnswer(null)
    setError(null)
    const run = async (): Promise<void> => {
      try {
        const next = await call()
        if (!cancelled) setAnswer(next)
      } catch (nextError: unknown) {
        if (!cancelled) setError(studioErrorMessage(nextError))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [call])

  return { answer, error, setAnswer }
}
