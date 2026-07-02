'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import MapGL, { Source, Layer } from 'react-map-gl/maplibre'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import type { FeatureCollection, Point } from 'geojson'
import type { StyleSpecification } from 'maplibre-gl'
import { adminSessionsApi, type ActiveDriverSession } from '@/lib/admin-api'
import { getAdminSocket } from '@/lib/socket'
import api from '@/lib/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const ODISHA_BOUNDS: [[number, number], [number, number]] = [[82.0, 17.5], [88.5, 23.0]]
const DEFAULT_CENTER: [number, number] = [20.3493, 85.8412]
const DEFAULT_ZOOM = 11
const RECONCILE_MS = 30_000

const CITIES = [
  { label: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, zoom: 13 },
  { label: 'Cuttack',     lat: 20.4625, lng: 85.8830, zoom: 13 },
  { label: 'Puri',        lat: 19.8135, lng: 85.8312, zoom: 13 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

let styleCache: StyleSpecification | null = null
let styleFetch: Promise<StyleSpecification> | null = null
function getStyle(): Promise<StyleSpecification> {
  if (styleCache) return Promise.resolve(styleCache)
  if (!styleFetch) {
    styleFetch = fetch(STYLE_URL)
      .then(r => r.json() as Promise<StyleSpecification>)
      .then(s => { styleCache = s; return s })
  }
  return styleFetch
}

// Google encoded polyline decoder — same algorithm as user/driver apps
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

type DriverMap = Map<string, ActiveDriverSession>

interface LocationUpdate {
  driverId: string
  lat: number
  lng: number
  heading: number
  speed: number
}

function buildGeoJSON(drivers: DriverMap): FeatureCollection<Point> {
  const features: FeatureCollection<Point>['features'] = []
  for (const s of drivers.values()) {
    if (s.lat == null || s.lng == null) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        driver_id:      s.driver_id,
        driver_name:    s.driver_name ?? s.driver_code,
        session_status: s.session_status,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveMap() {
  const mapRef      = useRef<MapRef>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hoverRef    = useRef(false)

  const [mapStyle,    setMapStyle]    = useState<StyleSpecification | string>(styleCache ?? STYLE_URL)
  const [geojson,     setGeojson]     = useState<FeatureCollection<Point>>({ type: 'FeatureCollection', features: [] })
  const driversRef    = useRef<DriverMap>(new Map())
  const [selected,    setSelected]    = useState<ActiveDriverSession | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
  const [tripCount,   setTripCount]   = useState(0)
  const [tripRoute,   setTripRoute]   = useState<[number, number][] | null>(null)
  const [cursor,      setCursor]      = useState('grab')

  useEffect(() => {
    if (styleCache) return
    getStyle().then(setMapStyle).catch(() => {})
  }, [])

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

  const reconcile = useCallback(async () => {
    try {
      const sessions = await adminSessionsApi.getActive()
      const next: DriverMap = new Map(sessions.map(s => [s.driver_id, s]))
      driversRef.current = next

      let online = 0, onTrip = 0
      next.forEach(d => { if (d.session_status === 'online') online++; else onTrip++ })
      setOnlineCount(online)
      setTripCount(onTrip)
      setGeojson(buildGeoJSON(next))
    } catch { /* stale data is better than a crash */ }
  }, [])

  useEffect(() => {
    void reconcile().then(() => setLoading(false))
    intervalRef.current = setInterval(() => void reconcile(), RECONCILE_MS)

    const socket = getAdminSocket()
    socket.on('driver:location_update', (update: LocationUpdate) => {
      const drivers = driversRef.current
      const existing = drivers.get(update.driverId)
      if (!existing) {
        void reconcile()
        return
      }
      const next = new Map(drivers)
      next.set(update.driverId, { ...existing, lat: update.lat, lng: update.lng, heading: update.heading })
      driversRef.current = next
      setGeojson(buildGeoJSON(next))
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      socket.off('driver:location_update')
    }
  }, [reconcile])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const feat = e.features?.[0]
    if (!feat?.properties) { setSelected(null); return }
    const driverId = feat.properties['driver_id'] as string
    const session  = driversRef.current.get(driverId)
    setSelected(session ?? null)
  }, [])

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const over = (e.features?.length ?? 0) > 0
    if (over !== hoverRef.current) {
      hoverRef.current = over
      setCursor(over ? 'pointer' : 'grab')
    }
  }, [])

  const flyTo = (lat: number, lng: number, zoom: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200 })
  }

  const tripRouteGeojson = useMemo(() => {
    if (!tripRoute || tripRoute.length < 2) return null
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: tripRoute.map(([lat, lng]) => [lng, lat]),
      },
      properties: {},
    }
  }, [tripRoute])

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
            onClick={() => flyTo(c.lat, c.lng, c.zoom)}
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

        <MapGL
          ref={mapRef}
          initialViewState={{ latitude: DEFAULT_CENTER[0], longitude: DEFAULT_CENTER[1], zoom: DEFAULT_ZOOM }}
          mapStyle={mapStyle}
          style={{ width: '100%', height: '100%' }}
          minZoom={6}
          maxZoom={19}
          maxBounds={ODISHA_BOUNDS}
          reuseMaps
          cursor={cursor}
          interactiveLayerIds={['drivers-circle']}
          onClick={handleMapClick}
          onMouseMove={handleMouseMove}
          pixelRatio={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1}
        >
          {/* Trip route for selected on_trip driver */}
          {tripRouteGeojson && (
            <Source id="trip-route" type="geojson" data={tripRouteGeojson}>
              <Layer
                id="trip-route-casing"
                type="line"
                paint={{ 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.75 }}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              />
              <Layer
                id="trip-route-line"
                type="line"
                paint={{ 'line-color': '#4F46E5', 'line-width': 4, 'line-opacity': 0.9 }}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              />
            </Source>
          )}

          {/* Driver dots — single GeoJSON source, two layers (halo + fill) */}
          <Source id="drivers" type="geojson" data={geojson}>
            {/* Soft halo */}
            <Layer
              id="drivers-halo"
              type="circle"
              paint={{
                'circle-radius': 14,
                'circle-color': ['match', ['get', 'session_status'], 'on_trip', '#4F46E5', '#10B981'],
                'circle-opacity': 0.18,
              }}
            />
            {/* Solid dot */}
            <Layer
              id="drivers-circle"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['match', ['get', 'session_status'], 'on_trip', '#4F46E5', '#10B981'],
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': 0.92,
              }}
            />
          </Source>
        </MapGL>
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
