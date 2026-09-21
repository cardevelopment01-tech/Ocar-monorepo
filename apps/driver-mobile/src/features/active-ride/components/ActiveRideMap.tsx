import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import * as Location from 'expo-location'
import { colors, simplifyPolyline, spacing, typography } from '@ocar/mobile-shared'
import CarMarker from '@/features/map/components/CarMarker'
import LocationPin from '@/features/map/components/LocationPin'
import { useDriverLivePosition } from '../useDriverLivePosition'
import { fetchRouteLeg } from '../api'

export type ActiveRideLeg = 'to-pickup' | 'to-destination'

export type ActiveRideMapProps = {
  pickup: [number, number]
  destination: [number, number] | null
  leg: ActiveRideLeg
  // Pending stops, routed through only on the to-destination leg (stops sit
  // between pickup and drop, never before pickup) -- previously not accepted
  // by this component at all, so an added stop was invisible on the driver's
  // own map and the drawn line never reflected it.
  stops?: [number, number][]
}

const DEFAULT_REGION = { latitude: 20.2961, longitude: 85.8245, latitudeDelta: 0.05, longitudeDelta: 0.05 }
const ROUTE_STALE_MS = 20_000
const ROUTE_DEVIATION_METRES = 200

function distanceMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

// Brief "here's the whole picture" beat whenever the leg changes (pickup ->
// destination), then settles into following the driver -- same beat/duration
// as web's RideMapScene.tsx (OVERVIEW_BEAT_MS), ported to react-native-maps'
// camera API instead of the web map library's FitBounds/RecenterMap components.
const OVERVIEW_BEAT_MS = 1200
const NAVIGATION_ZOOM = 17

// Matches DriverMapView.tsx's (driver web) two-camera-mode convention: OVERVIEW
// (fit-bounds, north-up) for a leg-change preview, NAVIGATION (heading = driver
// bearing, flat pitch, follow) once settled. One map style everywhere in this
// app -- no per-screen camera invention.
export function ActiveRideMap({ pickup, destination, leg, stops = [] }: ActiveRideMapProps) {
  const mapRef = useRef<MapView>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const live = useDriverLivePosition(!permissionDenied)
  const [overview, setOverview] = useState(true)
  const prevLeg = useRef(leg)
  const [routePoints, setRoutePoints] = useState<[number, number][]>([])
  const routeFetchSeq = useRef(0)
  const lastRouteFetch = useRef<{ leg: ActiveRideLeg; stopsKey: string; origin: [number, number]; at: number } | null>(null)
  const stopsKey = stops.map(([lat, lng]) => `${lat},${lng}`).join('|')

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') setPermissionDenied(true)
    })
  }, [])

  const legTarget = leg === 'to-pickup' ? pickup : destination

  useEffect(() => {
    if (prevLeg.current === leg) return
    prevLeg.current = leg
    setOverview(true)
    const t = setTimeout(() => setOverview(false), OVERVIEW_BEAT_MS)
    return () => clearTimeout(t)
  }, [leg])

  useEffect(() => {
    if (!live || !legTarget || !mapRef.current) return
    if (overview) {
      mapRef.current.fitToCoordinates(
        [
          { latitude: live.position[0], longitude: live.position[1] },
          { latitude: legTarget[0], longitude: legTarget[1] },
        ],
        { edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true }
      )
    } else {
      mapRef.current.animateCamera(
        { center: { latitude: live.position[0], longitude: live.position[1] }, heading: live.heading, pitch: 0, zoom: NAVIGATION_ZOOM },
        { duration: 500 }
      )
    }
  }, [live, legTarget, overview])

  // Real road-following route (was a bare two-point straight line between the
  // driver and the leg target -- never actually called the routing API).
  // Throttled like rider-mobile's tracking screen: refetch on leg change, on a
  // pending-stop change, once the driver has moved meaningfully off the last
  // fetched route, or after 20s -- not on every ~3s GPS tick.
  useEffect(() => {
    if (!live || !legTarget) return
    const prev = lastRouteFetch.current
    const legChanged = !prev || prev.leg !== leg || prev.stopsKey !== stopsKey
    const deviated = prev ? distanceMetres(live.position, prev.origin) > ROUTE_DEVIATION_METRES : false
    const stale = prev ? Date.now() - prev.at > ROUTE_STALE_MS : true
    if (!legChanged && !deviated && !stale) return

    const seq = ++routeFetchSeq.current
    lastRouteFetch.current = { leg, stopsKey, origin: live.position, at: Date.now() }

    const waypoints = leg === 'to-destination' ? stops : []
    const pts: [number, number][] = [live.position, ...waypoints, legTarget]
    Promise.all(pts.slice(0, -1).map((p, i) => fetchRouteLeg(p[0], p[1], pts[i + 1]![0], pts[i + 1]![1], false)))
      .then((legs) => {
        if (routeFetchSeq.current !== seq) return
        const points = simplifyPolyline(legs.flatMap((l) => l.polyline))
        setRoutePoints(points.length >= 2 ? points : [live.position, legTarget])
      })
      .catch(() => {
        if (routeFetchSeq.current === seq) setRoutePoints([live.position, legTarget])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stops re-fetch keyed by stopsKey, not the array reference
  }, [live, legTarget, leg, stopsKey])

  if (permissionDenied) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback]}>
        <Text style={styles.fallbackText}>Enable location to see the live map</Text>
      </View>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          live
            ? { latitude: live.position[0], longitude: live.position[1], latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : DEFAULT_REGION
        }
        loadingEnabled
        loadingIndicatorColor={colors.primary}
        loadingBackgroundColor={colors.surface}
      >
        <LocationPin position={pickup} variant="pickup" />
        {leg === 'to-destination' ? stops.map(([lat, lng], i) => (
          <LocationPin key={`stop-${i}-${lat}-${lng}`} position={[lat, lng]} variant="stop" />
        )) : null}
        {destination ? <LocationPin position={destination} variant="drop" /> : null}
        {live ? <CarMarker position={live.position} heading={live.heading} headingKnown={live.headingKnown} /> : null}
        {routePoints.length >= 2 ? (
          <>
            {/* White halo under the color line, matching web's RoutePolyline.tsx layering. */}
            <Polyline
              coordinates={routePoints.map(([latitude, longitude]) => ({ latitude, longitude }))}
              strokeColor="#ffffff"
              strokeWidth={leg === 'to-pickup' ? 6 : 11}
            />
            <Polyline
              coordinates={routePoints.map(([latitude, longitude]) => ({ latitude, longitude }))}
              strokeColor={leg === 'to-pickup' ? colors.ink600 : colors.primary}
              strokeWidth={leg === 'to-pickup' ? 3 : 7}
              {...(leg === 'to-pickup' ? { lineDashPattern: [8, 8] } : {})}
            />
          </>
        ) : null}
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  fallbackText: { ...typography.label, color: colors.ink600, textAlign: 'center' },
})
