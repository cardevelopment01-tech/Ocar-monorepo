'use client'

import { Component, memo, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AdvancedMarker, AdvancedMarkerAnchorPoint, APILoadingStatus, Map, useAdvancedMarkerRef, useApiLoadingStatus, useMap, useMapsLibrary,
} from '@vis.gl/react-google-maps'
import { MapPinOff } from 'lucide-react'

import RoutePolyline from '@/components/map/RoutePolyline'
import StopPin from '@/components/map/StopPin'
import { bearingDeg, haversineMetres } from '@/lib/geo'
import { lerpPosition, planGlide } from '@/lib/trip-share/glide'
import { t, type Lang } from '@/lib/trip-share/i18n'
import type { PublicTrip } from '@/lib/trip-share/types'

// The map half of the page. It frames the car and the places it is going inside the area ABOVE the sheet (bottom padding = the
// measured sheet height), and if the map cannot load at all it says so in words while the rest of the page keeps working.
//
// Performance notes (this page is opened on modest Android phones):
// - The car is moved by writing the marker's position straight to the Maps API from a requestAnimationFrame loop. It never goes
//   through React state, so a glide does not re-render the map and its children 60 times a second.
// - The map is drawn plainly. The rest of the app puts a CSS `filter` over the whole map to mute it; a filter forces the browser to
//   re-composite every tile on every frame of a pan or glide, which is exactly the cost a cheap GPU cannot pay.

const GLIDE_FRAME_MS = 33 // ~30 fps is plenty for a car that moves a few metres a second

function MapUnavailable({ lang }: { lang: Lang }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#EAF2FF] to-surface-2 px-10 pb-[48dvh] pt-24 text-center">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-text-muted shadow-float"><MapPinOff size={24} /></span>
      <p className="max-w-[260px] text-[14px] font-medium leading-relaxed text-text-secondary">{t(lang, 'map.unavailable')}</p>
    </div>
  )
}

/** Anything the Google Maps script throws while drawing must never take the page down: the status, plate and route text matter more. */
class MapBoundary extends Component<{ lang: Lang; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override render() { return this.state.failed ? <MapUnavailable lang={this.props.lang} /> : this.props.children }
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The car. Its marker is created once at the first reported position and never re-positioned by React; every later position is
 * glided (or snapped) imperatively. Heading turns the car through a CSS transition on the inner element.
 */
function LiveCar({ lat, lng, heading, stale }: { lat: number; lng: number; heading: number | null; stale: boolean }) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // A stable prop: if it followed the latest report, React would snap the marker at the start of every glide.
  const [initial] = useState({ lat, lng })
  const motion = useRef<{ pos: [number, number]; at: number; raf: number; lastFrame: number; heading: number }>({
    pos: [lat, lng], at: 0, raf: 0, lastFrame: 0, heading: heading ?? 0,
  })

  useEffect(() => {
    if (!marker) return
    const m = motion.current
    const to: [number, number] = [lat, lng]
    const now = Date.now()
    cancelAnimationFrame(m.raf)

    // Heading: the reported one, else the direction of travel (when it moved far enough to mean something).
    if (heading !== null) m.heading = heading
    else if (haversineMetres(m.pos, to) > 4) m.heading = bearingDeg(m.pos, to)
    if (bodyRef.current) bodyRef.current.style.transform = `rotate(${m.heading % 360}deg)`

    const plan = planGlide({ from: m.at === 0 ? null : m.pos, to, sinceLastMs: m.at === 0 ? 0 : now - m.at, hidden: document.hidden, reducedMotion: prefersReducedMotion() })
    m.at = now
    if (plan.snap) {
      m.pos = to
      marker.position = { lat: to[0], lng: to[1] }
      return
    }
    const from = m.pos
    const t0 = performance.now()
    const step = (ts: number) => {
      if (ts - m.lastFrame >= GLIDE_FRAME_MS) {
        m.lastFrame = ts
        const k = (ts - t0) / plan.durationMs
        m.pos = lerpPosition(from, to, k)
        marker.position = { lat: m.pos[0], lng: m.pos[1] }
        if (k >= 1) return
      }
      m.raf = requestAnimationFrame(step)
    }
    m.raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(m.raf)
  }, [marker, lat, lng, heading])

  return (
    <AdvancedMarker ref={markerRef} position={initial} anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
      <div
        ref={bodyRef}
        className="motion-safe:transition-[opacity,filter] motion-safe:duration-300"
        style={{
          width: 22,
          height: 36,
          opacity: stale ? 0.55 : 1,
          filter: stale ? 'grayscale(1)' : 'drop-shadow(0 3px 6px rgba(14,143,163,0.35))',
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

  // Follow the trip in. A car 40 km/h along a 12 km frame moves about a pixel a second and looks frozen, so each time the
  // distance still to go halves the camera re-fits (about six times over a 12 km trip, each a handful of new tiles) and the car's
  // movement becomes visible as it nears. Never after the viewer has moved the map themselves.
  const left = points.length > 1 ? haversineMetres(points[0]!, points[points.length - 1]!) : 0
  const closeness = left > 0 ? Math.floor(Math.log2(Math.max(left, 150) / 150)) : 0

  useEffect(() => {
    const pts = pointsRef.current
    if (!map || !core || pts.length < 1 || moved.current) return
    const key = `${phaseKey}:${Math.round(bottomPad / 40)}:${closeness}`
    if (fitted.current === key) return
    fitted.current = key
    try {
      if (pts.length === 1) { map.setCenter({ lat: pts[0]![0], lng: pts[0]![1] }); map.setZoom(16); return }
      const bounds = new core.LatLngBounds()
      pts.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
      map.fitBounds(bounds, { top: 96, right: 40, left: 40, bottom: bottomPad + 24 })
    } catch { /* a map that cannot frame itself is shown as-is */ }
  }, [map, core, phaseKey, bottomPad, closeness])

  return null
}

function TripMap({ trip, lang, bottomPad, label }: { trip: PublicTrip; lang: Lang; bottomPad: number; label: string }) {
  const status = useApiLoadingStatus()
  const [authFailed, setAuthFailed] = useState(false)
  useEffect(() => {
    const w = window as unknown as { gm_authFailure?: () => void }
    w.gm_authFailure = () => setAuthFailed(true)
    return () => { delete w.gm_authFailure }
  }, [])

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE || authFailed) return <MapUnavailable lang={lang} />

  const live = trip.phase === 'driver_on_way' || trip.phase === 'in_trip'
  const target = trip.phase === 'driver_on_way' ? trip.pickup : trip.drop ?? trip.pickup
  const framed: [number, number][] = live
    ? [...(trip.driver ? ([[trip.driver.lat, trip.driver.lng]] as [number, number][]) : []), [target.lat, target.lng]]
    : [[trip.pickup.lat, trip.pickup.lng], ...(trip.drop ? ([[trip.drop.lat, trip.drop.lng]] as [number, number][]) : [])]

  return (
    <MapBoundary lang={lang}>
      <div role="img" aria-label={label} className="h-full w-full">
        <Map
          defaultCenter={{ lat: trip.pickup.lat, lng: trip.pickup.lng }}
          defaultZoom={14}
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          style={{ height: '100%', width: '100%' }}
        >
          <Camera points={framed} phaseKey={`${trip.phase}:${trip.driver ? 'car' : 'nocar'}`} bottomPad={bottomPad} />
          {live && trip.route && <RoutePolyline encoded={trip.route} />}
          <Dot position={[trip.pickup.lat, trip.pickup.lng]} color="#16A34A" label={trip.pickup.label ?? ''} />
          {trip.stops.map((s, i) => (s.status === 'pending' ? <StopPin key={i} position={[s.lat, s.lng]} index={i + 1} /> : null))}
          {trip.drop && <Dot position={[trip.drop.lat, trip.drop.lng]} color="#DC2626" label={trip.drop.label ?? ''} />}
          {live && trip.driver && <LiveCar lat={trip.driver.lat} lng={trip.driver.lng} heading={trip.driver.heading} stale={trip.driver.stale} />}
        </Map>
      </div>
    </MapBoundary>
  )
}

// Re-renders only when a new response arrives (a new `trip` object), never for the page's own clock.
export default memo(TripMap)
