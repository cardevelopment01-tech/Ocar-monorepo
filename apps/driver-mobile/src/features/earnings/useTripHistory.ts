import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { fetchEarningsSummary, fetchTrips } from './api'
import type { EarningsPeriod, EarningsSummary, Trip } from './types'

// Same focus-throttle pattern as rider-mobile's useRideHistory.ts (Days 6-8 Eng
// review finding, reused rather than re-derived).
const FOCUS_REFETCH_THROTTLE_MS = 30_000
const LOAD_ERROR_MESSAGE = "Couldn't load your trips. Check your connection and try again."

export function useTripHistory() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [summary, setSummary] = useState<EarningsSummary | null>(null)
  // Recent Trips (below) is always the latest 10 regardless of period, same as
  // web's Earnings.tsx -- only the summary card/chart/breakdown respond to it.
  const [period, setPeriod] = useState<EarningsPeriod>('today')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasLoadedOnceRef = useRef(false)
  const lastFetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const periodRef = useRef(period)
  periodRef.current = period

  const fetchAll = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (hasLoadedOnceRef.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [tripsRes, summaryRes] = await Promise.all([fetchTrips(1), fetchEarningsSummary(periodRef.current)])
      setTrips(tripsRes.trips)
      setHasMore(tripsRes.hasMore)
      setPage(1)
      setSummary(summaryRes)
      lastFetchedAtRef.current = Date.now()
    } catch {
      setError(LOAD_ERROR_MESSAGE)
    } finally {
      hasLoadedOnceRef.current = true
      setLoading(false)
      setRefreshing(false)
      inFlightRef.current = false
    }
  }, [])

  // Period changes only re-fetch the summary -- the trip list underneath stays put.
  useEffect(() => {
    if (!hasLoadedOnceRef.current) return
    let cancelled = false
    setSummaryLoading(true)
    fetchEarningsSummary(period)
      .then((res) => { if (!cancelled) setSummary(res) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSummaryLoading(false) })
    return () => { cancelled = true }
  }, [period])

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || loadingMore || !hasMore) return
    inFlightRef.current = true
    setLoadingMore(true)
    const nextPage = page + 1
    try {
      const res = await fetchTrips(nextPage)
      setTrips((prev) => [...prev, ...res.trips])
      setPage(nextPage)
      setHasMore(res.hasMore)
    } catch {
      // Leave hasMore as-is so the next onEndReached retries the same page.
    } finally {
      setLoadingMore(false)
      inFlightRef.current = false
    }
  }, [page, hasMore, loadingMore])

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastFetchedAtRef.current >= FOCUS_REFETCH_THROTTLE_MS) void fetchAll()
    }, [fetchAll])
  )

  const refresh = useCallback(() => {
    void fetchAll()
  }, [fetchAll])

  return { trips, summary, period, setPeriod, loading, refreshing, loadingMore, summaryLoading, hasMore, error, refresh, loadMore }
}
