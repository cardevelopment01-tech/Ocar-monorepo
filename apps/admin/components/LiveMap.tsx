'use client'

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Map as GoogleMap, AdvancedMarker, Polyline, useMap } from '@vis.gl/react-google-maps'
import { adminSessionsApi, type ActiveDriverSession } from '@/lib/admin-api'
import { getAdminSocket } from '@/lib/socket'
import api from '@/lib/api'
import { decodePolyline } from '@/lib/polyline'
import { COLORS } from '@/lib/colors'
import { isStale } from '@/lib/driver-staleness'
import { ago } from '@/lib/ride-situation'
import { STAGE_META, stageCounts, stageOf, visibleDrivers, type Stage, type StageFilter } from '@/lib/live-map-model'
import { DriverList } from '@/components/live-map/DriverList'
import Link from 'next/link'

// ─── Constants ────────────────────────────────────────────────────────────────

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }
const DEFAULT_CENTER = { lat: 20.3493, lng: 85.8412 }
const DEFAULT_ZOOM = 11
const RECONCILE_MS = 30_000
const RECONCILE_SOON_MS = 1_500
// Location pings are applied to the list at most this often (hundreds of drivers ping every few seconds; one render per ping would be too much).
const FLUSH_MS = 1_000

const CITIES = [
  { label: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, zoom: 13 },
  { label: 'Cuttack',     lat: 20.4625, lng: 85.8830, zoom: 13 },
  { label: 'Puri',        lat: 19.8135, lng: 85.8312, zoom: 13 },
]

type SessionMap = Map<string, ActiveDriverSession>

interface LocationUpdate {
  driverId: string
  lat: number
  lng: number
  heading: number
  speed: number
}

// ─── Smoothed position (glides between socket fixes instead of snapping) ──────

const GLIDE_MS = 2_500

function useSmoothedLatLng(lat: number, lng: number): { lat: number; lng: number } {
  const [display, setDisplay] = useState({ lat, lng })
  const liveRef = useRef({ lat, lng })
  const rafRef  = useRef<number | null>(null)

  useEffect(() => {
    const from = liveRef.current
    if (from.lat === lat && from.lng === lng) return

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / GLIDE_MS, 1)
      const next = { lat: from.lat + (lat - from.lat) * t, lng: from.lng + (lng - from.lng) * t }
      liveRef.current = next
      setDisplay(next)
      rafRef.current = t < 1 ? requestAnimationFrame(tick) : null
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [lat, lng])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return display
}

// ─── Driver dot marker ────────────────────────────────────────────────────────

// Memoized on `session` identity only (ignores `onClick`, which is a fresh
// closure every parent render but always resolves to the same session data) —
// otherwise every driver marker re-renders on every OTHER driver's location
// update, since `onClick`'s identity would defeat the default shallow compare.
const DriverDot = memo(function DriverDot({ session, stage, selected, onClick }: { session: ActiveDriverSession; stage: Stage; selected: boolean; onClick: () => void }) {
  // The colour says where the driver is (same colours as the list chips). A driver who stopped sending location is grey and dimmed
  // so a frozen dot is never mistaken for a live one.
  const stale = stage === 'no_location'
  // On a trip with no location is the case ops must not miss: a red ring, not a dimmed dot. A silent idle driver just fades.
  const alarm = stale && session.session_status === 'on_trip'
  const color = STAGE_META[stage].color
  const pos = useSmoothedLatLng(session.lat!, session.lng!)

  return (
    <AdvancedMarker
      position={pos}
      onClick={onClick}
      zIndex={selected ? 1000 : alarm ? 500 : stale ? 0 : 1}
    >
      <div style={{ position: 'relative', width: 28, height: 28, cursor: 'pointer', opacity: stale && !alarm ? 0.65 : 1, outline: selected ? `3px solid ${COLORS.primary}` : alarm ? `3px solid ${COLORS.danger}` : undefined, outlineOffset: 3, borderRadius: '50%' }}>
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
}, (prev, next) => prev.session === next.session && prev.stage === next.stage && prev.selected === next.selected)

// ─── FlyTo helper (must be inside Map tree) ───────────────────────────────────

// `follow`: keep the map centred on this point as it moves (the "follow driver" switch). Only pans, never changes the zoom.
function MapController({ target, follow }: { target: { lat: number; lng: number; zoom: number } | null; follow: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !target) return
    map.panTo({ lat: target.lat, lng: target.lng })
    map.setZoom(target.zoom)
  }, [map, target])
  useEffect(() => {
    if (map && follow) map.panTo(follow)
  }, [map, follow])
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveMap() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const driversRef  = useRef<SessionMap>(new Map())

  const [drivers,     setDrivers]     = useState<ActiveDriverSession[]>([])
  // Only the id is kept: the panel reads the driver's current record from `drivers`, so its position and "last seen" follow live updates
  // instead of showing the copy taken at click time.
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
  const [tripCount,   setTripCount]   = useState(0)
  const [tripRoute,   setTripRoute]   = useState<[number, number][] | null>(null)
  const [flyTarget,   setFlyTarget]   = useState<{ lat: number; lng: number; zoom: number } | null>(null)
  const [socketLive,  setSocketLive]  = useState(true)
  // Re-evaluated every 15 s so a dot turns grey on its own when its driver goes quiet, without waiting for a refetch.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 15_000); return () => clearInterval(t) }, [])
  const silentCount = drivers.filter(d => d.session_status === 'on_trip' && isStale(d.location_updated_at, nowMs)).length

  const [query,     setQuery]     = useState('')
  const [filter,    setFilter]    = useState<StageFilter>('all')
  const [following, setFollowing] = useState(false)
  const rows   = useMemo(() => visibleDrivers(drivers, query, filter, nowMs), [drivers, query, filter, nowMs])
  const counts = useMemo(() => stageCounts(drivers, nowMs), [drivers, nowMs])

  const selected = useMemo(() => drivers.find(d => d.driver_id === selectedId) ?? null, [drivers, selectedId])
  const selectDriver = useCallback((driverId: string | null) => { setSelectedId(driverId); setFollowing(false) }, [])
  // Picking a driver from the list flies the map to them. A new selection always starts with Follow off.
  const flyToDriver = useCallback((driverId: string) => {
    const d = driversRef.current.get(driverId)
    selectDriver(driverId)
    if (d?.lat != null && d.lng != null) setFlyTarget({ lat: d.lat, lng: d.lng, zoom: 15 })
  }, [selectDriver])
  // Only changes when the followed driver actually moves, so the map is re-centred on movement and not on every unrelated render.
  const fLat = following ? (selected?.lat ?? null) : null
  const fLng = following ? (selected?.lng ?? null) : null
  const follow = useMemo(() => (fLat != null && fLng != null ? { lat: fLat, lng: fLng } : null), [fLat, fLng])

  // Fetch trip route when the selected driver's trip changes. Plain values in the dependencies (not the driver object, which is replaced
  // on every location update) so the route is fetched once per trip, not once per ping.
  const onTrip = selected?.session_status === 'on_trip'
  const oLat = selected?.origin_lat ?? null, oLng = selected?.origin_lng ?? null
  const dLat = selected?.dest_lat ?? null,   dLng = selected?.dest_lng ?? null
  useEffect(() => {
    setTripRoute(null)
    if (!onTrip || oLat == null || oLng == null || dLat == null || dLng == null) return

    api.get<{ polyline: string }>('/api/v1/geo/route', {
      params: { originLat: oLat, originLng: oLng, destLat: dLat, destLng: dLng },
    })
      .then(r => { if (r.data.polyline) setTripRoute(decodePolyline(r.data.polyline)) })
      .catch(() => {})
  }, [onTrip, oLat, oLng, dLat, dLng])

  const syncDrivers = useCallback((next: SessionMap) => {
    driversRef.current = next
    let online = 0, onTrip = 0
    next.forEach(d => { if (d.session_status === 'online') online++; else onTrip++ })
    setOnlineCount(online)
    setTripCount(onTrip)
    // Drivers with no position at all stay in the list (as "No location"); only the map skips them.
    setDrivers(Array.from(next.values()))
  }, [])

  const reconcile = useCallback(async () => {
    try {
      const sessions = await adminSessionsApi.getActive()
      syncDrivers(new Map(sessions.map(s => [s.driver_id, s])))
    } catch { /* stale data is better than a crash */ }
  }, [syncDrivers])

  // A ping from a driver we do not know yet means the list is out of date. One refetch is enough however many unknown drivers ping at
  // once (after a reconnect, many do), so the refetch waits a moment and later pings join the pending one.
  const dirtyRef = useRef(false)
  const soonRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconcileSoon = useCallback(() => {
    if (soonRef.current) return
    soonRef.current = setTimeout(() => { soonRef.current = null; void reconcile() }, RECONCILE_SOON_MS)
  }, [reconcile])

  useEffect(() => {
    void reconcile().then(() => setLoading(false))
    intervalRef.current = setInterval(() => void reconcile(), RECONCILE_MS)

    const socket = getAdminSocket()
    socket.on('driver:location_update', (update: LocationUpdate) => {
      const existing = driversRef.current.get(update.driverId)
      if (!existing) { reconcileSoon(); return }
      // Written straight into the map; the screen picks it up on the next flush (below), so a burst of pings is one render, not one each.
      driversRef.current.set(update.driverId, { ...existing, lat: update.lat, lng: update.lng, heading: update.heading, location_updated_at: new Date().toISOString() })
      dirtyRef.current = true
    })
    const flush = setInterval(() => { if (dirtyRef.current) { dirtyRef.current = false; syncDrivers(driversRef.current) } }, FLUSH_MS)
    const onDisconnect = () => setSocketLive(false)
    const onConnect    = () => { setSocketLive(true); void reconcile() }
    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)
    if (!socket.connected) setSocketLive(false)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      clearInterval(flush)
      if (soonRef.current) { clearTimeout(soonRef.current); soonRef.current = null }
      socket.off('driver:location_update')
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
    }
  }, [reconcile, reconcileSoon, syncDrivers])

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
        {silentCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-danger" />
            <span className="text-xs font-semibold text-danger">{silentCount} on trip with no location</span>
          </div>
        )}
        {!socketLive && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-danger" />
            <span className="text-xs font-semibold text-danger">Reconnecting… positions may be stale</span>
          </div>
        )}
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

      <div className="flex flex-1 min-h-0">
      <DriverList
        rows={rows}
        total={drivers.length}
        counts={counts}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        selectedId={selectedId}
        onSelect={flyToDriver}
        nowMs={nowMs}
      />

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
          onDragstart={() => setFollowing(false)}
        >
          <MapController target={flyTarget} follow={follow} />

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
                strokeColor={COLORS.primary}
                strokeWeight={4}
                strokeOpacity={0.9}
                zIndex={2}
              />
            </>
          )}

          {/* One AdvancedMarker per driver that passes the search and filter (the selected driver always stays) */}
          {rows.filter(({ d }) => d.lat != null && d.lng != null).map(({ d: session, stage }) => (
            <DriverDot
              key={session.driver_id}
              session={session}
              stage={stage}
              selected={session.driver_id === selectedId}
              onClick={() => selectDriver(session.driver_id)}
            />
          ))}
          {selected && selected.lat != null && selected.lng != null && !rows.some(r => r.d.driver_id === selected.driver_id) && (
            <DriverDot key={selected.driver_id} session={selected} stage={stageOf(selected, nowMs)} selected onClick={() => selectDriver(selected.driver_id)} />
          )}
        </GoogleMap>
      </div>
      </div>

      {/* Driver detail panel */}
      {selected && (
        <div className="absolute bottom-4 left-4 md:left-[21rem] z-[1000] w-72 bg-surface rounded-2xl border border-border p-4 shadow-card">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-bold text-text-primary text-sm">{selected.driver_name ?? 'Driver'}</p>
              <p className="text-text-muted text-xs">{selected.driver_code} · {selected.driver_phone}</p>
            </div>
            <button
              onClick={() => selectDriver(null)}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary text-lg leading-none"
            >×</button>
          </div>
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full mb-2 bg-surface-2 text-text-secondary"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: STAGE_META[stageOf(selected, nowMs)].color }} aria-hidden />
            {STAGE_META[stageOf(selected, nowMs)].label}
          </span>
          <p className="text-xs text-text-secondary">
            {selected.vehicle_category ?? selected.vehicle_name
              ? `${selected.vehicle_category ?? ''}${selected.vehicle_category && selected.vehicle_name ? ' · ' : ''}${selected.vehicle_name ?? ''}`
              : 'No vehicle on file'}
            {selected.number_plate ? ` · ${selected.number_plate}` : ''}
          </p>
          {selected.ride_id && (
            <div className="mt-1 text-xs text-text-secondary space-y-0.5">
              {selected.rider_name && <p className="truncate"><span className="font-medium">Rider:</span> {selected.rider_name}</p>}
              <p className="truncate"><span className="font-medium">From:</span> {selected.origin_address ?? '—'}</p>
              <p className="truncate"><span className="font-medium">To:</span> {selected.destination_address ?? '—'}</p>
            </div>
          )}
          {selected.lat != null && (
            <p className={`text-xs mt-1.5 ${isStale(selected.location_updated_at, nowMs) ? 'text-danger font-semibold' : 'text-text-muted'}`}>
              {isStale(selected.location_updated_at, nowMs)
                ? `Last seen ${ago(selected.location_updated_at, nowMs) || 'a long time ago'}, not live · `
                : 'Live · '}
              {selected.lat.toFixed(5)}, {selected.lng?.toFixed(5)}
              {selected.speed_kmph != null ? ` · ${selected.speed_kmph} km/h` : ''}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`tel:${selected.driver_phone}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-2">Call driver</a>
            {selected.ride_id && (
              <Link href={`/rides/${selected.ride_id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-2">Open ride</Link>
            )}
            {selected.lat != null && <button
              type="button"
              onClick={() => setFollowing(f => !f)}
              aria-pressed={following}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${following ? 'border-primary bg-primary text-white' : 'border-border text-primary hover:bg-surface-2'}`}
            >
              {following ? 'Following' : 'Follow'}
            </button>}
          </div>
        </div>
      )}
    </div>
  )
}
