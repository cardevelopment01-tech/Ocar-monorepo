'use client'
import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker } from 'leaflet'
import { adminSessionsApi, type ActiveDriverSession } from '@/lib/admin-api'
import { getAdminSocket } from '@/lib/socket'

const CITIES = [
  { label: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, zoom: 13 },
  { label: 'Cuttack',     lat: 20.4625, lng: 85.8830, zoom: 13 },
  { label: 'Puri',        lat: 19.8135, lng: 85.8312, zoom: 13 },
]

const DEFAULT_CENTER: [number, number] = [20.3493, 85.8412]
const DEFAULT_ZOOM = 11
const RECONCILE_INTERVAL_MS = 30_000

type DriverMap = Map<string, ActiveDriverSession>

interface LocationUpdate {
  driverId: string
  lat: number
  lng: number
  heading: number
  speed: number
}

function statusColor(status: 'online' | 'on_trip') {
  return status === 'on_trip' ? '#4F46E5' : '#10B981'
}

function markerHtml(session: ActiveDriverSession) {
  const color = statusColor(session.session_status)
  return `<div style="
    width:16px;height:16px;border-radius:50%;
    background:${color};border:2.5px solid white;
    box-shadow:0 0 0 3px ${color}40,0 2px 6px rgba(79,70,229,0.15);
    cursor:pointer;
  "></div>`
}

export default function LiveMap() {
  const mapRef       = useRef<LeafletMap | null>(null)
  const mapDivRef    = useRef<HTMLDivElement>(null)
  const markersRef   = useRef<Map<string, Marker>>(new Map())
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconcileRef = useRef<(() => Promise<void>) | null>(null)

  const [drivers, setDrivers]         = useState<DriverMap>(new Map())
  const [selected, setSelected]       = useState<ActiveDriverSession | null>(null)
  const [loading, setLoading]         = useState(true)
  const [onlineCount, setOnlineCount] = useState(0)
  const [tripCount,   setTripCount]   = useState(0)

  useEffect(() => {
    let online = 0, onTrip = 0
    drivers.forEach(d => {
      if (d.session_status === 'online') online++
      else onTrip++
    })
    setOnlineCount(online)
    setTripCount(onTrip)
  }, [drivers])

  useEffect(() => {
    if (typeof window === 'undefined' || !mapDivRef.current) return
    if (mapRef.current) return

    void (async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')

      const map = L.map(mapDivRef.current!, {
        center: DEFAULT_CENTER,
        zoom:   DEFAULT_ZOOM,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map

      // Reconcile the full active-sessions list with the current marker set.
      // Handles new drivers going online, position updates, and drivers going offline.
      const reconcile = async () => {
        try {
          const sessions = await adminSessionsApi.getActive()
          const nextMap: DriverMap = new Map()

          for (const s of sessions) {
            nextMap.set(s.driver_id, s)
            if (s.lat != null && s.lng != null) {
              const existing = markersRef.current.get(s.driver_id)
              if (existing) {
                existing.setLatLng([s.lat, s.lng])
              } else {
                const icon = L.divIcon({
                  className: '',
                  html: markerHtml(s),
                  iconSize: [16, 16],
                  iconAnchor: [8, 8],
                })
                const marker = L.marker([s.lat, s.lng], { icon })
                  .addTo(map)
                  .on('click', () => setSelected(s))
                markersRef.current.set(s.driver_id, marker)
              }
            }
          }

          // Remove markers for drivers that are no longer active
          for (const [driverId, marker] of markersRef.current) {
            if (!nextMap.has(driverId)) {
              marker.remove()
              markersRef.current.delete(driverId)
            }
          }

          setDrivers(nextMap)
        } catch { /* silent — stale data is better than a crash */ }
      }

      reconcileRef.current = reconcile

      await reconcile()
      setLoading(false)

      // Periodic refresh — catches drivers going online/offline between socket events
      intervalRef.current = setInterval(() => { void reconcile() }, RECONCILE_INTERVAL_MS)

      // Real-time location updates: move known markers immediately; for unknown
      // drivers (went online after initial load) trigger an early reconcile.
      const socket = getAdminSocket()
      socket.on('driver:location_update', (update: LocationUpdate) => {
        const marker = markersRef.current.get(update.driverId)
        if (marker) {
          marker.setLatLng([update.lat, update.lng])
          setDrivers(prev => {
            const existing = prev.get(update.driverId)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(update.driverId, { ...existing, lat: update.lat, lng: update.lng, heading: update.heading })
            return next
          })
        } else {
          // Driver not in our map yet — pull a fresh session list
          void reconcile()
        }
      })
    })()

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      getAdminSocket().off('driver:location_update')
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  const flyTo = (lat: number, lng: number, zoom: number) => {
    mapRef.current?.flyTo([lat, lng], zoom, { duration: 1.2 })
  }

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
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80">
            <div className="text-sm text-text-muted font-medium">Loading map…</div>
          </div>
        )}
        <div ref={mapDivRef} className="w-full h-full" style={{ minHeight: 500 }} />
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
