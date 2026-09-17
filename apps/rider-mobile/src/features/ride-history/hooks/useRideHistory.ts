import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { camelizeKeys, type RideHistoryItem } from '@ocar/mobile-shared'
import { api } from '@/services/api'

const PAGE_SIZE = 20
const FOCUS_REFETCH_THROTTLE_MS = 30_000
const LOAD_ERROR_MESSAGE = "Couldn't load your trips. Check your connection and try again."

type HistoryResponse = { rides: unknown[]; pagination: { page: number; pages: number } }
type UpcomingResponse = { rides: unknown[] }

export function useRideHistory() {
  const [items, setItems] = useState<RideHistoryItem[]>([])
  const [upcoming, setUpcoming] = useState<RideHistoryItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasLoadedOnceRef = useRef(false)
  const lastFetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)

  const fetchAll = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (hasLoadedOnceRef.current) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [historyRes, upcomingRes] = await Promise.all([
        api.get<HistoryResponse>('/api/v1/rides/me/history', { params: { page: 1, limit: PAGE_SIZE } }),
        api.get<UpcomingResponse>('/api/v1/rides/me/upcoming'),
      ])
      setItems(camelizeKeys<RideHistoryItem[]>(historyRes.data.rides))
      setUpcoming(camelizeKeys<RideHistoryItem[]>(upcomingRes.data.rides))
      setPage(1)
      setHasMore(historyRes.data.pagination.page < historyRes.data.pagination.pages)
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

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || loadingMore || !hasMore) return
    inFlightRef.current = true
    setLoadingMore(true)
    const nextPage = page + 1
    try {
      const res = await api.get<HistoryResponse>('/api/v1/rides/me/history', {
        params: { page: nextPage, limit: PAGE_SIZE },
      })
      setItems((prev) => [...prev, ...camelizeKeys<RideHistoryItem[]>(res.data.rides)])
      setPage(nextPage)
      setHasMore(res.data.pagination.page < res.data.pagination.pages)
    } catch {
      // Leave hasMore as-is so the next onEndReached retries the same page.
    } finally {
      setLoadingMore(false)
      inFlightRef.current = false
    }
  }, [page, hasMore, loadingMore])

  // Covers both the initial mount (lastFetchedAtRef starts at 0, always stale)
  // and the Eng-phase focus-throttle finding: skip refetch on tab refocus if
  // fetched within the last 30s. Pull-to-refresh bypasses this via refresh().
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastFetchedAtRef.current >= FOCUS_REFETCH_THROTTLE_MS) void fetchAll()
    }, [fetchAll])
  )

  const refresh = useCallback(() => {
    void fetchAll()
  }, [fetchAll])

  return { items, upcoming, loading, refreshing, loadingMore, hasMore, error, refresh, loadMore }
}
