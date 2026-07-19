'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Map as GoogleMap, AdvancedMarker, Polyline } from '@vis.gl/react-google-maps'
import { Play, Pause } from 'lucide-react'
import { safetyApi, type TripReplay } from '@/lib/safety-api'
import { decodePolyline } from '@/lib/polyline'

const DEFAULT_ZOOM = 14
const STEP_MS = 400 // playback speed: ms of real time per GPS ping advanced
const FALLBACK_CENTER = { lat: 20.2961, lng: 85.8245 } // Bhubaneswar

export default function TripReplayMap({ disputeId }: { disputeId: string }) {
  const [replay, setReplay] = useState<TripReplay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setReplay(null)
    setIndex(0)
    setPlaying(false)
    safetyApi.getTripReplay(disputeId)
      .then((data) => { if (!cancelled) setReplay(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [disputeId, retryKey])

  const trail = replay?.actualTrail ?? []

  useEffect(() => {
    if (!playing || trail.length === 0) return
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        if (i >= trail.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, STEP_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing, trail.length])

  const actualPath = useMemo(
    () => trail.map((p) => ({ lat: p.lat, lng: p.lng })),
    [trail]
  )

  const plannedPath = useMemo(
    () => replay?.plannedRoute
      ? decodePolyline(replay.plannedRoute.polyline).map(([lat, lng]) => ({ lat, lng }))
      : null,
    [replay]
  )

  const current = trail[index]
  const markerPosition = current ? { lat: current.lat, lng: current.lng } : (actualPath[0] ?? FALLBACK_CENTER)
  const initialCenter = actualPath[0] ?? FALLBACK_CENTER

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-text-muted bg-surface-2 rounded-xl border border-border-light">
        Loading trail…
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-32 flex flex-col items-center justify-center gap-2 text-sm text-text-muted bg-surface-2 rounded-xl border border-border-light">
        <span>Failed to load trip trail.</span>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (trail.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-text-muted bg-surface-2 rounded-xl border border-border-light">
        No GPS trail available for this ride
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-64 rounded-xl overflow-hidden border border-border-light">
        <GoogleMap
          defaultCenter={initialCenter}
          defaultZoom={DEFAULT_ZOOM}
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy"
          disableDefaultUI
          style={{ width: '100%', height: '100%' }}
        >
          {plannedPath && plannedPath.length >= 2 && (
            <Polyline path={plannedPath} strokeColor="#9CA3AF" strokeWeight={4} strokeOpacity={0.8} zIndex={1} />
          )}
          {actualPath.length >= 2 && (
            <Polyline path={actualPath} strokeColor="#4F46E5" strokeWeight={4} strokeOpacity={0.95} zIndex={2} />
          )}
          <AdvancedMarker position={markerPosition}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: '#4F46E5', border: '2.5px solid #ffffff',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }} />
          </AdvancedMarker>
        </GoogleMap>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { if (index >= trail.length - 1) setIndex(0); setPlaying((p) => !p) }}
          aria-label={playing ? 'Pause' : 'Play'}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-dark transition-colors flex-shrink-0"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={trail.length - 1}
          value={index}
          onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)) }}
          aria-label="Trip position"
          className="flex-1"
        />
        <span className="text-xs text-text-muted flex-shrink-0 w-16 text-right">
          {current ? new Date(current.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
        </span>
      </div>

      <p className="text-[11px] text-text-muted flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#4F46E5' }} /> Actual path
        {plannedPath && (
          <>
            <span className="inline-block w-2 h-2 rounded-full ml-3" style={{ background: '#9CA3AF' }} /> Planned route
          </>
        )}
      </p>
    </div>
  )
}
