import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { camelizeKeys, type RideDetail, type RideHistoryItem } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { fetchRide, fetchActiveRideId, cancelRide } from '@/features/ride-tracking/api'
import type { HistoryTab, UpcomingRide } from '../types'

// Mirrors web's My Rides page (apps/user/app/(main)/history/page.tsx) exactly:
// page-based history (Prev/Next, not infinite scroll) with client-side tab
// filtering of the current page, a separate upcoming (scheduled) list with
// its own cancel action, and a live active-ride card surfaced on the
// Upcoming tab. Same three parallel fetches, same 30s focus-refetch throttle.
const LIMIT = 20
const FOCUS_REFETCH_THROTTLE_MS = 30_000
const LOAD_ERROR_MESSAGE = "Couldn't load your rides. Check your connection and try again."

type HistoryResponse = { rides: unknown[]; pagination: { total: number; page: number; pages: number } }
type UpcomingResponse = { rides: unknown[] }

export function useRideHistory() {
  const [tab, setTab] = useState<HistoryTab>('upcoming')

  const [rides, setRides] = useState<RideHistoryItem[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [upcoming, setUpcoming] = useState<UpcomingRide[]>([])
  const [upcomingLoading, setUpcomingLoading] = useState(true)
  const [upcomingError, setUpcomingError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const [activeRide, setActiveRide] = useState<RideDetail | null>(null)

  const lastFetchedAtRef = useRef(0)

  const fetchActive = useCallback(async () => {
    try {
      const activeId = await fetchActiveRideId()
      setActiveRide(activeId ? await fetchRide(activeId) : null)
    } catch {
      setActiveRide(null)
    }
  }, [])

  const fetchHistory = useCallback(async (p: number) => {
    setLoading(true); setError(null)
    try {
      const res = await api.get<HistoryResponse>('/api/v1/rides/me/history', { params: { page: p, limit: LIMIT } })
      setRides(camelizeKeys<RideHistoryItem[]>(res.data.rides))
      setPage(res.data.pagination.page)
      setPages(res.data.pagination.pages)
      setTotal(res.data.pagination.total)
    } catch {
      setError(LOAD_ERROR_MESSAGE)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUpcoming = useCallback(async () => {
    setUpcomingLoading(true); setUpcomingError(null)
    try {
      const res = await api.get<UpcomingResponse>('/api/v1/rides/me/upcoming')
      setUpcoming(camelizeKeys<UpcomingRide[]>(res.data.rides))
    } catch {
      setUpcomingError(LOAD_ERROR_MESSAGE)
    } finally {
      setUpcomingLoading(false)
    }
  }, [])

  const refreshAll = useCallback(() => {
    lastFetchedAtRef.current = Date.now()
    void fetchHistory(1)
    void fetchUpcoming()
    void fetchActive()
  }, [fetchHistory, fetchUpcoming, fetchActive])

  useEffect(() => { refreshAll() }, [refreshAll])

  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastFetchedAtRef.current >= FOCUS_REFETCH_THROTTLE_MS) refreshAll()
    }, [refreshAll])
  )

  const cancelUpcoming = useCallback(async (rideId: string) => {
    setCancellingId(rideId)
    try {
      await cancelRide(rideId, 'rider_cancelled_scheduled')
      setUpcoming((prev) => prev.filter((r) => r.id !== rideId))
    } catch {
      setUpcomingError(LOAD_ERROR_MESSAGE)
    } finally {
      setCancellingId(null)
    }
  }, [])

  return {
    tab, setTab,
    rides, page, pages, total, loading, error, fetchHistory,
    upcoming, upcomingLoading, upcomingError, fetchUpcoming, cancellingId, cancelUpcoming,
    activeRide,
    refresh: refreshAll,
  }
}
