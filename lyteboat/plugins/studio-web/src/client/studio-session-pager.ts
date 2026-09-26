/**
 * An infinite list of sessions read a page at a time, as the Sessions list and
 * its search both scroll: the first page loads whenever the page reader
 * changes (another agent, window, or search text), and `loadMore` appends the
 * next one at the offset read so far. A page that arrives after the reader
 * changed or the list unmounted is dropped, and a session a later page repeats
 * (it moved while the list scrolled) is kept once.
 * @module @lyteboat/studio-web/client/studio-session-pager
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { studioErrorMessage } from './studio-api-client.ts'

/** One page of a listing. */
interface StudioSessionPage<T> {
  sessions: T[]
  hasMore: boolean
}

/** What a list shows of its pages so far. */
export interface StudioSessionPager<T> {
  sessions: T[]
  hasMore: boolean
  /** The first page is on its way. */
  loading: boolean
  /** A further page is on its way. */
  loadingMore: boolean
  /** Why the last page did not load; no further page is asked for after one fails. */
  error: string | null
  loadMore(): void
}

interface StudioSessionPagerState<T> {
  sessions: T[]
  offset: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error: string | null
}

function studioSessionPagerIdle<T>(loading: boolean): StudioSessionPagerState<T> {
  return { sessions: [], offset: 0, hasMore: false, loading, loadingMore: false, error: null }
}

/**
 * @param readPage - reads the page at an offset, memoized on what it asks for; null reads nothing (no search text).
 * @returns the pages so far.
 */
export function useStudioSessionPager<T extends { sessionId: string }>(readPage: ((offset: number) => Promise<StudioSessionPage<T>>) | null): StudioSessionPager<T> {
  const [state, setState] = useState<StudioSessionPagerState<T>>(() => studioSessionPagerIdle(readPage !== null))
  const generation = useRef(0)
  const reading = useRef(false)

  useEffect(() => {
    generation.current += 1
    const current = generation.current
    reading.current = false
    setState(studioSessionPagerIdle(readPage !== null))
    if (readPage === null) return
    const run = async (): Promise<void> => {
      try {
        const page = await readPage(0)
        if (generation.current === current) setState({ sessions: page.sessions, offset: page.sessions.length, hasMore: page.hasMore, loading: false, loadingMore: false, error: null })
      } catch (error: unknown) {
        if (generation.current === current) setState({ ...studioSessionPagerIdle<T>(false), error: studioErrorMessage(error) })
      }
    }
    void run()
    return () => { generation.current += 1 }
  }, [readPage])

  const { offset, hasMore, loading, error } = state
  const loadMore = useCallback(() => {
    if (readPage === null || reading.current || loading || !hasMore || error !== null) return
    reading.current = true
    const current = generation.current
    setState(previous => ({ ...previous, loadingMore: true }))
    const run = async (): Promise<void> => {
      try {
        const page = await readPage(offset)
        if (generation.current !== current) return
        setState(previous => {
          const known = new Set(previous.sessions.map(session => session.sessionId))
          const fresh = page.sessions.filter(session => !known.has(session.sessionId))
          return { ...previous, sessions: [...previous.sessions, ...fresh], offset: previous.offset + page.sessions.length, hasMore: page.hasMore, loadingMore: false }
        })
      } catch (nextError: unknown) {
        if (generation.current === current) setState(previous => ({ ...previous, loadingMore: false, error: studioErrorMessage(nextError) }))
      } finally {
        if (generation.current === current) reading.current = false
      }
    }
    void run()
  }, [readPage, offset, hasMore, loading, error])

  return { sessions: state.sessions, hasMore, loading, loadingMore: state.loadingMore, error, loadMore }
}
