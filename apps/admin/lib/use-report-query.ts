'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'

export interface ReportQuery<T> {
  /** last good data; kept while a newer request loads (never blank on filter change) */
  data: T | null
  /** true only for the very first load, when there is nothing to show yet */
  loading: boolean
  /** true while a newer request is in flight and old data is still on screen */
  refreshing: boolean
  error: string | null
  reload: () => void
  updatedAt: number | null
}

/**
 * Latest-wins fetch for a report widget (CEO Section 4): a slow response for an earlier filter
 * can never overwrite a newer one, because the older request is aborted AND its result ignored.
 * Failures surface as `error` (rendered as an error card with Retry), never as empty data.
 */
export function useReportQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  opts: { pollMs?: number } = {}
): ReportQuery<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  const hasData = useRef(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const mine = ++seq.current
    const ctrl = new AbortController()
    if (hasData.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    fetcherRef.current(ctrl.signal)
      .then(res => {
        if (seq.current !== mine) return
        hasData.current = true
        setData(res)
        setUpdatedAt(Date.now())
      })
      .catch((err: unknown) => {
        if (seq.current !== mine || axios.isCancel(err) || ctrl.signal.aborted) return
        setError('Could not load this section.')
      })
      .finally(() => {
        if (seq.current !== mine) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  // Polling refreshes in place: no skeleton flash, previous rows stay until new ones arrive.
  useEffect(() => {
    if (!opts.pollMs) return
    const id = setInterval(() => setTick(t => t + 1), opts.pollMs)
    return () => clearInterval(id)
  }, [opts.pollMs])

  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, refreshing, error, reload, updatedAt }
}
