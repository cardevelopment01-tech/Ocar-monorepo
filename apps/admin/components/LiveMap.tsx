'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Map as GoogleMap, AdvancedMarker, Polyline, useMap } from '@vis.gl/react-google-maps'
import { adminSessionsApi, type ActiveDriverSession } from '@/lib/admin-api'
import { getAdminSocket } from '@/lib/socket'
import api from '@/lib/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }
const DEFAULT_CENTER = { lat: 20.3493, lng: 85.8412 }
const DEFAULT_ZOOM = 11
const RECONCILE_MS = 30_000

const CITIES = [
  { label: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, zoom: 13 },
  { label: 'Cuttack',     lat: 20.4625, lng: 85.8830, zoom: 13 },
  { label: 'Puri',        lat: 19.8135, lng: 85.8312, zoom: 13 },
]

function decodePolyline(encoded: string): [number, number][] {
  const pts: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < encoded.length) {
    let b, shift = 0, result = 0
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

type SessionMap = Map<string, ActiveDriverSession>

interface LocationUpdate {
  driverId: string
  lat: number
  lng: number
  heading: number
  speed: number
}

// ─── Driver dot marker ────────────────────────────────────────────────────────

function DriverDot({ session, onClick }: { session: ActiveDriverSession; onClick: () => void }) {
  const isOnTrip = session.session_status === 'on_trip'
  const color = isOnTrip ? '#4F46E5' : '#10B981'

  return (
    <AdvancedMarker
      position={{ lat: session.lat!, lng: session.lng! }}
      onClick={onClick}
    >
      <div style={{ position: 'relative', width: 28, height: 28, cursor: 'pointer' }}>
        {/* Halo */}
        <div style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          background: color, opacity: 0.18,
        }} />
        {/* Solid dot */}
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: color, border: '2.5px solid #ffffff',
          boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
          position: 'relative',
        }} />
      </div>
    </AdvancedMarker>
  )
}

// ─── FlyTo helper — must be inside Map tree ───────────────────────────────────

function MapController({ target }: { target: { lat: number; lng: number; zoom: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !target) return
    map.panTo({ lat: target.lat, lng: target.lng })
    map.setZoom(target.zoom)
  }, [map, target])
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveMap() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const driversRef  = useRef<SessionMap>(new Map())

  const [drivers,     setDrivers]     = useState<ActiveDriverSession[]>([])
  const [selected,    setSelected]    = useState<ActiveDriverSession | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
  const [tripCount,   setTripCount]   = useState(0)
  const [tripRoute,   setTripRoute]   = useState<[number, number][] | null>(null)
  const [flyTarget,   setFlyTarget]   = useState<{ lat: number; lng: number; zoom: number } | null>(null)

  // Fetch trip route when selected on_trip driver changes
  useEffect(() => {
    setTripRoute(null)
    if (
      !selected ||
      selected.session_status !== 'on_trip' ||
      selected.origin_lat == null || selected.origin_lng == null ||
      selected.dest_lat   == null || selected.dest_lng   == null
    ) return

    api.get<{ polyline: string }>('/api/v1/geo/route', {
      params: {
        originLat: selected.origin_lat,
        originLng: selected.origin_lng,
        destLat:   selected.dest_lat,
        destLng:   selected.dest_lng,
      },
    })
      .then(r => { if (r.data.polyline) setTripRoute(decodePolyline(r.data.polyline)) })
      .catch(() => {})
  }, [selected])

  const syncDrivers = useCallback((next: SessionMap) => {
    driversRef.current = next
    let online = 0, onTrip = 0
    next.forEach(d => { if (d.session_status === 'online') online++; else onTrip++ })
    setOnlineCount(online)
    setTripCount(onTrip)
    setDrivers(Array.from(next.values()).filter(d => d.lat != null && d.lng != null))
  }, [])

  const reconcile = useCallback(async () => {
    try {
      const sessions = await adminSessionsApi.getActive()
      syncDrivers(new Map(sessions.map(s => [s.driver_id, s])))
    } catch { /* stale data is better than a crash */ }
  }, [syncDrivers])

  useEffect(() => {
    void reconcile().then(() => setLoading(false))
    intervalRef.current = setInterval(() => void reconcile(), RECONCILE_MS)

    const socket = getAdminSocket()
    socket.on('driver:location_update', (update: LocationUpdate) => {
      const existing = driversRef.current.get(update.driverId)
      if (!existing) { void reconcile(); return }
      const next = new Map(driversRef.current)
      next.set(update.driverId, { ...existing, lat: update.lat, lng: update.lng, heading: update.heading })
      syncDrivers(next)
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      socket.off('driver:location_update')
    }
  }, [reconcile, syncDrivers])

  const tripRoutePath = useMemo(
    () => tripRoute ? tripRoute.map(([lat, lng]) => ({ lat, lng })) : null,
    [tripRoute]
  )

  return (
    <div className="relative w-full h-full flex flex-col">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-semibold text-text-secondary">{onlineCount} online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-text-secondary">{tripCount} on trip</span>
        </div>
        <div className="flex-1" />
        {CITIES.map(c => (
          <button
            key={c.label}
            onClick={() => setFlyTarget({ lat: c.lat, lng: c.lng, zoom: c.zoom })}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-surface-2 text-primary"
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="relative flex-1" style={{ minHeight: 500 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80">
            <div className="text-sm text-text-muted font-medium">Loading map…</div>
          </div>
        )}

        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy"
          disableDefaultUI
          restriction={{ latLngBounds: ODISHA_BOUNDS, strictBounds: false }}
          style={{ width: '100%', height: '100%' }}
        >
          <MapController target={flyTarget} />

          {/* Trip route for selected on_trip driver */}
          {tripRoutePath && tripRoutePath.length >= 2 && (
            <>
              <Polyline
                path={tripRoutePath}
                strokeColor="#ffffff"
                strokeWeight={7}
                strokeOpacity={0.75}
                zIndex={1}
              />
              <Polyline
                path={tripRoutePath}
                strokeColor="#4F46E5"
                strokeWeight={4}
                strokeOpacity={0.9}
                zIndex={2}
              />
            </>
          )}

          {/* One AdvancedMarker per driver */}
          {drivers.map(session => (
            <DriverDot
              key={session.driver_id}
              session={session}
              onClick={() => setSelected(session)}
            />
          ))}
        </GoogleMap>
      </div>

      {/* Driver detail panel */}
      {selected && (
        <div className="absolute bottom-4 left-4 z-[1000] w-72 bg-surface rounded-2xl border border-border p-4 shadow-card">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-bold text-text-primary text-sm">{selected.driver_name ?? 'Driver'}</p>
              <p className="text-text-muted text-xs">{selected.driver_code} · {selected.driver_phone}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-text-muted hover:text-text-primary text-lg leading-none"
            >×</button>
          </div>
          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${
            selected.session_status === 'on_trip' ? 'pill-info' : 'pill-success'
          }`}>
            {selected.session_status === 'on_trip' ? 'On Trip' : 'Online'}
          </span>
          {selected.ride_id && (
            <div className="mt-1 text-xs text-text-secondary space-y-0.5">
              <p className="truncate"><span className="font-medium">From:</span> {selected.origin_address ?? '—'}</p>
              <p className="truncate"><span className="font-medium">To:</span> {selected.destination_address ?? '—'}</p>
            </div>
          )}
          {selected.lat != null && (
            <p className="text-xs text-text-muted mt-1.5">
              {selected.lat.toFixed(5)}, {selected.lng?.toFixed(5)}
              {selected.speed_kmph != null ? ` · ${selected.speed_kmph} km/h` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
