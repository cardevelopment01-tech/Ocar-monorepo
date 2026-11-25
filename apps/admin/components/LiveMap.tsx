'use client'

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Map as GoogleMap, Polyline, useMap } from '@vis.gl/react-google-maps'
import { adminLiveMapApi, adminSessionsApi, type ActiveDriverSession, type AssignCandidate, type LiveMapAttention } from '@/lib/admin-api'
import { getAdminSocket } from '@/lib/socket'
import api from '@/lib/api'
import { decodePolyline } from '@/lib/polyline'
import { COLORS } from '@/lib/colors'
import { isStale } from '@/lib/driver-staleness'
import { ago } from '@/lib/ride-situation'
import { STAGE_META, stageCounts, stageOf, visibleDrivers, type StageFilter } from '@/lib/live-map-model'
import { clusterPoints, inView, type Bounds, type ClusterPoint } from '@/lib/live-map-cluster'
import { DriverList } from '@/components/live-map/DriverList'
import { AttentionMarker } from '@/components/live-map/AttentionMarker'
import { DriverDot } from '@/components/live-map/DriverDot'
import { ClusterMarker } from '@/components/live-map/ClusterMarker'
import { ViewportTracker, type Viewport } from '@/components/live-map/ViewportTracker'
import { AttentionPanel } from '@/components/live-map/AttentionPanel'
import { CandidateBadge } from '@/components/live-map/CandidateBadge'
import DispatchPanel from '@/components/dispatch/DispatchPanel'
import SuccessToast from '@/components/ui/SuccessToast'
import { useAdminAuth } from '@/lib/auth-context'
import { boundsAround, markedDrivers } from '@/lib/live-map-dispatch'
import { ATTENTION_LAYERS, attentionCounts, toAttentionItems, type AttentionKind } from '@/lib/live-map-attention'
import Link from 'next/link'

// ─── Constants ────────────────────────────────────────────────────────────────

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }
const DEFAULT_CENTER = { lat: 20.3493, lng: 85.8412 }
const DEFAULT_ZOOM = 11
const RECONCILE_MS = 30_000
const RECONCILE_SOON_MS = 1_500
// Location pings are applied to the list at most this often (hundreds of drivers ping every few seconds; one render per ping would be too much).
const FLUSH_MS = 1_000
// SOS, flagged rides and unmet requests are refetched this often, and a moment after a live SOS or flag event.
const ATTENTION_MS = 15_000
const MAX_FIT_ZOOM = 17

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

// ─── FlyTo helper (must be inside Map tree) ───────────────────────────────────

// `follow`: keep the map centred on this point as it moves (the "follow driver" switch). Only pans, never changes the zoom.
export interface FitTarget { bounds: Bounds; /** Pixels kept clear around the box; the side that an open panel covers needs more. */ padding?: number | { top: number; right: number; bottom: number; left: number } }

function MapController({ target, follow, fit }: { target: { lat: number; lng: number; zoom: number } | null; follow: { lat: number; lng: number } | null; fit: FitTarget | null }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !target) return
    map.panTo({ lat: target.lat, lng: target.lng })
    map.setZoom(target.zoom)
  }, [map, target])
  useEffect(() => {
    if (map && follow) map.panTo(follow)
  }, [map, follow])
  // A click on a cluster: zoom to show its drivers, but never past street level (a cluster of drivers at one spot would otherwise zoom to the maximum).
  useEffect(() => {
    if (!map || !fit) return
    map.fitBounds(fit.bounds, fit.padding ?? 80)
    const z = map.getZoom()
    if (z != null && z > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM)
  }, [map, fit])
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
  // What part of the map is on screen and how far it is zoomed: drivers are merged into clusters when zoomed out, and only those in view are drawn.
  const [view, setView] = useState<Viewport | null>(null)
  const [fitTarget, setFitTarget] = useState<FitTarget | null>(null)
  // Dispatching from the map: the ride being assigned, the drivers the panel lists for it, and the nearest of those the map marks.
  const { admin } = useAdminAuth()
  const canAssign = admin?.role === 'super_admin' || admin?.role === 'ops_admin'
  const [dispatchRideId, setDispatchRideId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<AssignCandidate[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])
  const marked = useMemo(() => markedDrivers(candidates), [candidates])
  const markedIds = useMemo(() => new Set(marked.map(m => m.driverId)), [marked])
  const fittedFor = useRef<string | null>(null)
  const onViewport = useCallback((v: Viewport) => setView(prev => (prev && prev.zoom === v.zoom && prev.bounds.north === v.bounds.north && prev.bounds.south === v.bounds.south && prev.bounds.east === v.bounds.east && prev.bounds.west === v.bounds.west ? prev : v)), [])
  const [attention, setAttention] = useState<LiveMapAttention | null>(null)
  const [layers, setLayers] = useState<Record<AttentionKind, boolean>>({ sos: true, flagged: true, request: true })
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const items = useMemo(() => toAttentionItems(attention), [attention])
  const shownItems = useMemo(() => items.filter(i => layers[i.kind]), [items, layers])
  const selectedItem = useMemo(() => items.find(i => i.key === selectedItemKey) ?? null, [items, selectedItemKey])
  const attentionTotals = useMemo(() => attentionCounts(attention), [attention])
  const rows   = useMemo(() => visibleDrivers(drivers, query, filter, nowMs), [drivers, query, filter, nowMs])
  const counts = useMemo(() => stageCounts(drivers, nowMs), [drivers, nowMs])

  const selected = useMemo(() => drivers.find(d => d.driver_id === selectedId) ?? null, [drivers, selectedId])

  // Which markers to draw. Cluster first, then keep only what is on screen (a cluster is decided on all drivers, so it does not change as the
  // map is panned). The selected driver and an on-trip driver with no location are never merged into a cluster.
  const zoom = view?.zoom ?? null
  const viewBounds = view?.bounds ?? null
  const rowById = useMemo(() => new Map(rows.map(r => [r.d.driver_id, r])), [rows])
  const driverById = useMemo(() => new Map(drivers.map(d => [d.driver_id, d])), [drivers])
  const points = useMemo<ClusterPoint[]>(() => rows.flatMap(({ d, stage }) => (
    d.lat != null && d.lng != null
      ? [{ id: d.driver_id, lat: d.lat, lng: d.lng, stage, pinned: d.driver_id === selectedId || markedIds.has(d.driver_id) || (stage === 'no_location' && d.session_status === 'on_trip') }]
      : []
  )), [rows, selectedId, markedIds])
  const layout = useMemo(() => (zoom == null ? { singles: points.map(p => p.id), clusters: [] } : clusterPoints(points, zoom)), [points, zoom])
  const shownSingles = useMemo(() => layout.singles.flatMap(id => {
    const r = rowById.get(id)
    return r && inView(r.d.lat!, r.d.lng!, viewBounds) ? [r] : []
  }), [layout, rowById, viewBounds])
  const shownClusters = useMemo(() => layout.clusters.filter(c => inView(c.lat, c.lng, viewBounds)), [layout, viewBounds])
  const selectDriver = useCallback((driverId: string | null) => { setSelectedId(driverId); setFollowing(false); if (driverId) setSelectedItemKey(null) }, [])
  // One thing is selected at a time: a driver or an item, never both panels.
  const selectItem = useCallback((key: string | null) => { setSelectedItemKey(key); setFollowing(false); if (key) setSelectedId(null) }, [])
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

  const loadAttention = useCallback(async () => {
    try { setAttention(await adminLiveMapApi.getAttention()) } catch { /* keep what is on screen */ }
  }, [])

  const dispatchItem = useMemo(() => (dispatchRideId ? items.find(i => i.kind === 'request' && i.rideId === dispatchRideId) ?? null : null), [items, dispatchRideId])
  const openDispatch = useCallback((rideId: string) => {
    // A search or filter would hide the very drivers about to be marked, so the list is reset first.
    setQuery(''); setFilter('all'); setSelectedId(null); setFollowing(false)
    fittedFor.current = null
    setDispatchRideId(rideId)
    const it = items.find(i => i.kind === 'request' && i.rideId === rideId)
    if (it) setFlyTarget({ lat: it.lat, lng: it.lng, zoom: 14 })
  }, [items])
  const closeDispatch = useCallback(() => { setDispatchRideId(null); setCandidates([]); fittedFor.current = null }, [])
  // Assigned, rescheduled or cancelled from the panel: say so, close, and refresh both what the map shows.
  const afterDispatch = useCallback((message: string) => { setToast(message); closeDispatch(); selectItem(null); void loadAttention(); void reconcile() }, [closeDispatch, selectItem, loadAttention, reconcile])
  // Once the nearest drivers are known, frame them and the pickup together, keeping the open panel's width clear on the right.
  useEffect(() => {
    if (!dispatchItem || marked.length === 0 || fittedFor.current === dispatchItem.rideId) return
    const pts = marked.flatMap(m => { const d = driversRef.current.get(m.driverId); return d?.lat != null && d.lng != null ? [{ lat: d.lat, lng: d.lng }] : [] })
    if (pts.length === 0) return
    fittedFor.current = dispatchItem.rideId
    setFitTarget({ bounds: boundsAround({ lat: dispatchItem.lat, lng: dispatchItem.lng }, pts), padding: { top: 110, right: 520, bottom: 90, left: 80 } })
  }, [dispatchItem, marked, drivers])
  useEffect(() => {
    void loadAttention()
    const poll = setInterval(() => void loadAttention(), ATTENTION_MS)
    // A live SOS or a ride flagged by the sweep shows within a second, not at the next poll.
    let soon: ReturnType<typeof setTimeout> | null = null
    const refresh = () => { if (!soon) soon = setTimeout(() => { soon = null; void loadAttention() }, 1_000) }
    const socket = getAdminSocket()
    socket.on('sos:alert', refresh)
    socket.on('ride:stuck_flagged', refresh)
    return () => {
      clearInterval(poll)
      if (soon) clearTimeout(soon)
      socket.off('sos:alert', refresh)
      socket.off('ride:stuck_flagged', refresh)
    }
  }, [loadAttention])

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
        <div className="flex items-center gap-1.5" role="group" aria-label="Map layers">
          {ATTENTION_LAYERS.map(l => (
            <button
              key={l.kind}
              type="button"
              aria-pressed={layers[l.kind]}
              onClick={() => setLayers(prev => ({ ...prev, [l.kind]: !prev[l.kind] }))}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${layers[l.kind] ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text-secondary hover:bg-surface-2'} ${l.kind === 'sos' && attentionTotals.sos > 0 && !layers.sos ? 'ring-2 ring-danger' : ''}`}
            >
              {l.label} {attentionTotals[l.count]}
            </button>
          ))}
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
          <ViewportTracker onChange={onViewport} />
          <MapController target={flyTarget} follow={follow} fit={fitTarget} />

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
          {shownClusters.map(c => (
            <ClusterMarker key={c.key} cluster={c} onClick={() => setFitTarget({ bounds: { ...c.bounds } })} />
          ))}
          {shownSingles.map(({ d: session, stage }) => (
            <DriverDot
              key={session.driver_id}
              session={session}
              stage={stage}
              selected={session.driver_id === selectedId}
              onClick={() => selectDriver(session.driver_id)}
            />
          ))}
          {dispatchItem && marked.map(m => {
            const d = driverById.get(m.driverId)
            if (d?.lat == null || d.lng == null) return null
            return (
              <Fragment key={`cand-${m.driverId}`}>
                <Polyline path={[{ lat: dispatchItem.lat, lng: dispatchItem.lng }, { lat: d.lat, lng: d.lng }]} strokeColor={COLORS.purple} strokeOpacity={0.55} strokeWeight={2} zIndex={3} />
                <CandidateBadge marked={m} lat={d.lat} lng={d.lng} />
              </Fragment>
            )
          })}
          {shownItems.map(item => (
            <AttentionMarker key={item.key} item={item} selected={item.key === selectedItemKey} onClick={() => selectItem(item.key)} />
          ))}
          {selected && selected.lat != null && selected.lng != null && !rows.some(r => r.d.driver_id === selected.driver_id) && (
            <DriverDot key={selected.driver_id} session={selected} stage={stageOf(selected, nowMs)} selected onClick={() => selectDriver(selected.driver_id)} />
          )}
        </GoogleMap>
      </div>
      </div>

      {selectedItem && layers[selectedItem.kind] && !dispatchRideId && <AttentionPanel item={selectedItem} nowMs={nowMs} onClose={() => selectItem(null)} onAssign={canAssign ? openDispatch : undefined} />}

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

      {canAssign && <DispatchPanel rideId={dispatchRideId} canAssign={canAssign} overMap onClose={closeDispatch} onAssigned={afterDispatch} onChanged={afterDispatch} onCandidates={setCandidates} />}
      <SuccessToast message={toast} onDismiss={dismissToast} />
    </div>
  )
}
