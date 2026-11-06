'use client'

import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { AdvancedMarker, AdvancedMarkerAnchorPoint, APILoadingStatus, useApiLoadingStatus, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

import MapView from '@/components/ui/MapView'
import RoutePolyline from '@/components/map/RoutePolyline'
import StopPin from '@/components/map/StopPin'
import { useGlidedCar } from '@/lib/trip-share/hooks'
import { t, type Lang } from '@/lib/trip-share/i18n'
import type { PublicTrip } from '@/lib/trip-share/types'

// The map half of the page. It frames the car and the places it is going inside the area ABOVE the sheet (bottom padding =
// the measured sheet height), glides the car between positions, and if the map cannot load at all it says so in words while the
// rest of the page keeps working (the viewer must never be left with an unexplained grey box).

function LiveCar({ position, heading, stale }: { position: [number, number]; heading: number | null; stale: boolean }) {
  return (
    <AdvancedMarker position={{ lat: position[0], lng: position[1] }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
      <div
        style={{
          width: 22,
          height: 36,
          transform: `rotate(${(heading ?? 0) % 360}deg)`,
          opacity: stale ? 0.55 : heading === null ? 0.85 : 1,
          filter: stale ? 'grayscale(1) drop-shadow(0 3px 6px rgba(14,143,163,0.25))' : 'drop-shadow(0 3px 6px rgba(14,143,163,0.35))',
        }}
      >
        <svg viewBox="0 0 32 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
          <path d="M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z" fill="#1E293B" />
          <path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />
          <rect x="9" y="36" width="14" height="8" rx="2" fill="rgba(255,255,255,0.30)" />
          <circle cx="9" cy="7" r="2" fill="#FCD34D" />
          <circle cx="23" cy="7" r="2" fill="#FCD34D" />
        </svg>
      </div>
    </AdvancedMarker>
  )
}

function Dot({ position, color, label }: { position: [number, number]; color: string; label: string }) {
  return (
    <AdvancedMarker position={{ lat: position[0], lng: position[1] }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} title={label}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: color, border: '3px solid white', boxShadow: '0 1px 4px rgba(14,143,163,0.45)' }} />
    </AdvancedMarker>
  )
}

/** Fits the places that matter into the visible part of the map, once per phase, and stops fighting the viewer once they move the map. */
function Camera({ points, phaseKey, bottomPad }: { points: [number, number][]; phaseKey: string; bottomPad: number }) {
  const map = useMap()
  const core = useMapsLibrary('core')
  const moved = useRef(false)
  const fitted = useRef('')
  const pointsRef = useRef(points)
  pointsRef.current = points

  useEffect(() => {
    if (!map) return
    const l = map.addListener('dragstart', () => { moved.current = true })
    return () => l.remove()
  }, [map])

  useEffect(() => {
    const pts = pointsRef.current
    if (!map || !core || pts.length < 1 || moved.current) return
    const key = `${phaseKey}:${Math.round(bottomPad / 40)}`
    if (fitted.current === key) return
    fitted.current = key
    try {
      if (pts.length === 1) { map.setCenter({ lat: pts[0]![0], lng: pts[0]![1] }); map.setZoom(16); return }
      const bounds = new core.LatLngBounds()
      pts.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
      map.fitBounds(bounds, { top: 96, right: 40, left: 40, bottom: bottomPad + 24 })
    } catch { /* a map that cannot frame itself is shown as-is */ }
  }, [map, core, phaseKey, bottomPad])

  return null
}

function MapUnavailable({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-2 px-6 pb-[45dvh] pt-24 text-center">
      <p className="max-w-xs text-[15px] font-medium leading-relaxed text-text-secondary">{t(lang, 'map.unavailable')}</p>
    </div>
  )
}

/** Anything the Google Maps script throws while drawing must never take the page down: the status, plate and route text matter more. */
class MapBoundary extends Component<{ lang: Lang; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() { return this.state.failed ? <MapUnavailable lang={this.props.lang} /> : this.props.children }
}

export default function TripMap({ trip, lang, bottomPad, label }: { trip: PublicTrip; lang: Lang; bottomPad: number; label: string }) {
  const status = useApiLoadingStatus()
  const [authFailed, setAuthFailed] = useState(false)
  useEffect(() => {
    const w = window as unknown as { gm_authFailure?: () => void }
    w.gm_authFailure = () => setAuthFailed(true)
    return () => { delete w.gm_authFailure }
  }, [])

  const live = trip.phase === 'driver_on_way' || trip.phase === 'in_trip'
  const car = useGlidedCar(live ? trip.driver : null)

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE || authFailed) return <MapUnavailable lang={lang} />

  const target = trip.phase === 'driver_on_way' ? trip.pickup : trip.drop ?? trip.pickup
  const framed: [number, number][] =
    trip.phase === 'completed' || trip.phase === 'cancelled'
      ? [[trip.pickup.lat, trip.pickup.lng], ...(trip.drop ? ([[trip.drop.lat, trip.drop.lng]] as [number, number][]) : [])]
      : [...(trip.driver ? ([[trip.driver.lat, trip.driver.lng]] as [number, number][]) : []), [target.lat, target.lng]]

  return (
    <MapBoundary lang={lang}>
    <div role="img" aria-label={label} className="h-full w-full">
    <MapView center={[trip.pickup.lat, trip.pickup.lng]} zoom={14} className="h-full w-full">
      <Camera points={framed} phaseKey={`${trip.phase}:${trip.driver ? 'car' : 'nocar'}`} bottomPad={bottomPad} />
      {live && trip.route && <RoutePolyline encoded={trip.route} />}
      <Dot position={[trip.pickup.lat, trip.pickup.lng]} color="#16A34A" label={trip.pickup.label ?? ''} />
      {trip.stops.map((s, i) => (s.status === 'pending' ? <StopPin key={i} position={[s.lat, s.lng]} index={i + 1} /> : null))}
      {trip.drop && <Dot position={[trip.drop.lat, trip.drop.lng]} color="#DC2626" label={trip.drop.label ?? ''} />}
      {car && trip.driver && <LiveCar position={car.position} heading={car.heading} stale={trip.driver.stale} />}
    </MapView>
    </div>
    </MapBoundary>
  )
}
