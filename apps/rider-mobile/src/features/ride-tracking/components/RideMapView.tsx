import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import { OCAR_MAP_PROPS, ROUTE } from '@/theme/mapStyle'
import CarMarker from '@/features/map/components/CarMarker'
import LocationPin from '@/features/map/components/LocationPin'

const USER_MOVE_HOLD_MS = 15_000
const DRIVER_REFIT_MIN_MS = 5_000

export type RideMapViewProps = {
  pickup: [number, number]
  drop: [number, number] | null
  driverPos: [number, number] | null
  driverHeading?: number
  driverHeadingKnown?: boolean
  routePoints: [number, number][]
  showDrop: boolean
  // Rendered as amber pins between pickup and drop -- previously add-stop had
  // no visual confirmation anywhere on the map, so a newly added stop just
  // vanished from view once the sheet closed.
  stops?: [number, number][]
  // Default suits a full-screen map; a small preview passes less so the pins are not squeezed together.
  edgePadding?: { top: number; right: number; bottom: number; left: number }
}

// Real map replacing the earlier placeholder progress-bar "track" (LiveMarker) --
// same pickup/drop/driver-pin + route-line shape as the web app's RideMapScene,
// scoped down to what react-native-maps needs (no traffic layer, no nearby-driver
// swarm -- those stay web-only per the UI-parity pass's agreed core scope). Pickup/
// drop/driver now use the same custom SVG markers as web (CarMarker/LocationPin)
// instead of react-native-maps' default OS pin -- see the input-consistency +
// premiumness pass this replaced.
function RideMapViewBase({ pickup, drop, driverPos, driverHeading, driverHeadingKnown, routePoints, showDrop, stops = [], edgePadding = { top: 80, right: 60, bottom: 80, left: 60 } }: RideMapViewProps) {
  const mapRef = useRef<MapView>(null)
  // Same react-native-maps gotcha as SelectRideMap: fitToCoordinates called
  // before the native view's onMapReady fires silently no-ops, leaving the
  // camera on initialRegion -- pickup/drop/driver pins get drawn but sit
  // outside that tiny visible area, reading as "the route isn't there".
  const [mapReady, setMapReady] = useState(false)
  const stopsKey = stops.map(([lat, lng]) => `${lat},${lng}`).join('|')
  // Bumped whenever the rider drags/zooms the map, so the camera stops fighting them.
  const userMovedAt = useRef(0)
  const lastDriverRefit = useRef(0)
  const holdActive = () => Date.now() - userMovedAt.current < USER_MOVE_HOLD_MS

  const fit = useCallback(() => {
    const points: [number, number][] = [pickup, ...stops]
    if (showDrop && drop) points.push(drop)
    if (driverPos) points.push(driverPos)
    if (points.length < 2) return
    mapRef.current?.fitToCoordinates(
      points.map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding, animated: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by fitKey below, not array identities
  }, [pickup, drop, driverPos, showDrop, stopsKey, edgePadding.top, edgePadding.bottom, edgePadding.left, edgePadding.right])

  // Re-fit when the SET of things on the map changes (status/leg, stops, driver first appearing),
  // not on every driver location tick -- that animated the camera every few seconds, snapped the
  // rider back whenever they panned, and kept the GPU at full frame rate for the whole trip.
  const fitKey = `${pickup[0]},${pickup[1]}|${drop ? `${drop[0]},${drop[1]}` : ''}|${stopsKey}|${showDrop}|${driverPos ? 1 : 0}`
  useEffect(() => {
    if (mapReady && !holdActive()) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures every input that should trigger a re-fit
  }, [mapReady, fitKey])

  // The driver drove out of frame: bring everything back, at most every 5s, never while the rider is exploring.
  useEffect(() => {
    if (!mapReady || !driverPos || holdActive() || Date.now() - lastDriverRefit.current < DRIVER_REFIT_MIN_MS) return
    let cancelled = false
    mapRef.current?.getMapBoundaries().then(({ northEast, southWest }) => {
      if (cancelled) return
      const inside =
        driverPos[0] <= northEast.latitude && driverPos[0] >= southWest.latitude &&
        driverPos[1] <= northEast.longitude && driverPos[1] >= southWest.longitude
      if (!inside && !holdActive()) {
        lastDriverRefit.current = Date.now()
        fit()
      }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per driver tick on purpose; fit is stable enough
  }, [mapReady, driverPos])

  // One coordinate array per route: a fresh array every render made react-native-maps re-send the
  // whole polyline (twice: casing + core) to the native map on every driver tick and clock second.
  const routeCoords = useMemo(
    () => routePoints.map(([latitude, longitude]) => ({ latitude, longitude })),
    [routePoints],
  )

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickup[0], longitude: pickup[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onMapReady={() => setMapReady(true)}
        onPanDrag={() => { userMovedAt.current = Date.now() }}
        loadingEnabled
        {...OCAR_MAP_PROPS}
      >
        <LocationPin position={pickup} variant="pickup" />
        {stops.map(([lat, lng], i) => (
          <LocationPin key={`stop-${i}-${lat}-${lng}`} position={[lat, lng]} variant="stop" />
        ))}
        {showDrop && drop ? <LocationPin position={drop} variant="drop" /> : null}
        {driverPos ? (
          <CarMarker position={driverPos} heading={driverHeading ?? 0} headingKnown={driverHeadingKnown ?? true} />
        ) : null}
        {routePoints.length >= 2 ? (
          <>
            <Polyline coordinates={routeCoords} strokeColor={ROUTE.casing} strokeWidth={ROUTE.casingWidth} lineCap="round" lineJoin="round" />
            <Polyline coordinates={routeCoords} strokeColor={ROUTE.core} strokeWidth={ROUTE.coreWidth} lineCap="round" lineJoin="round" />
          </>
        ) : null}
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  // Full-bleed background behind the whole screen, not a boxed header above a
  // scrolling stack of cards -- matches Uber/Rapido/Ola's actual tracking
  // screen shape (map is the dominant surface; a docked sheet floats over its
  // bottom edge). The caller positions this as the base layer.
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
})

export const RideMapView = memo(RideMapViewBase)
