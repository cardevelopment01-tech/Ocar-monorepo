import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import { OCAR_MAP_PROPS, ROUTE } from '@/theme/mapStyle'
import CarMarker from '@/features/map/components/CarMarker'
import NearbyCarMarker from '@/features/map/components/NearbyCarMarker'
import LocationPin from '@/features/map/components/LocationPin'
import { framePoints, framingPadding, isInVisibleBand, sheetHeightBucket } from '../mapFraming'
import { carsToFrame, type NearbyCar } from '../nearbyCars'
import { fleetOpacity, hasRetired, pruneFleet, reconcileFleet, retireAll, type FleetEntry } from '../nearbyFleet'

const USER_MOVE_HOLD_MS = 15_000
const DRIVER_REFIT_MIN_MS = 5_000
const NO_CARS: readonly NearbyCar[] = []

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
  // Height (px) of a sheet docked over the bottom of the map. The camera frames the trip in the part that is NOT under
  // it, and "is the car in view" is judged the same way. 0 = nothing covers the map.
  coveredBottom?: number
  // Available cars around the pickup, shown while a ride is being matched (before any driver is assigned). Ignored once
  // `driverPos` is set: from then on the assigned car is the only car.
  nearbyDrivers?: readonly NearbyCar[]
  // True once `driverPos` is a real driver fix (not the pickup stand-in): only then does the assigned car glide.
  driverLocated?: boolean
  // False while a driver is on the way to the pickup: frame the pickup and the car, not the far-away drop.
  frameDrop?: boolean
}

// Real map replacing the earlier placeholder progress-bar "track" (LiveMarker) --
// same pickup/drop/driver-pin + route-line shape as the web app's RideMapScene,
// scoped down to what react-native-maps needs (no traffic layer, no nearby-driver
// swarm -- those stay web-only per the UI-parity pass's agreed core scope). Pickup/
// drop/driver now use the same custom SVG markers as web (CarMarker/LocationPin)
// instead of react-native-maps' default OS pin -- see the input-consistency +
// premiumness pass this replaced.
function RideMapViewBase({ pickup, drop, driverPos, driverHeading, driverHeadingKnown, routePoints, showDrop, stops = [], edgePadding = { top: 80, right: 60, bottom: 80, left: 60 }, coveredBottom = 0, nearbyDrivers = NO_CARS, driverLocated = true, frameDrop = true }: RideMapViewProps) {
  const mapRef = useRef<MapView>(null)
  // Same react-native-maps gotcha as SelectRideMap: fitToCoordinates called
  // before the native view's onMapReady fires silently no-ops, leaving the
  // camera on initialRegion -- pickup/drop/driver pins get drawn but sit
  // outside that tiny visible area, reading as "the route isn't there".
  const [mapReady, setMapReady] = useState(false)
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 })
  // The nearby cars on the map. A car is never removed while it may be gliding (that can leave a stray copy on Android): one
  // that leaves the feed, or every car once a driver is assigned, is retired -- faded to invisible, kept mounted until no glide
  // can still be running, then removed (see nearbyFleet.ts). `tick` re-renders while any car is retiring so the fade shows.
  const assigned = driverPos !== null
  const [fleet, setFleet] = useState<FleetEntry[]>([])
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const now = Date.now()
    setFleet((prev) => (assigned ? pruneFleet(retireAll(prev, now), now) : reconcileFleet(prev, nearbyDrivers, now)))
  }, [assigned, nearbyDrivers])
  const anyRetired = hasRetired(fleet)
  useEffect(() => {
    if (!anyRetired) return
    const id = setInterval(() => {
      setFleet((prev) => pruneFleet(prev, Date.now()))
      tick()
    }, 100)
    return () => clearInterval(id)
  }, [anyRetired])
  const stopsKey = stops.map(([lat, lng]) => `${lat},${lng}`).join('|')
  // Bumped whenever the rider drags/zooms the map, so the camera stops fighting them.
  const userMovedAt = useRef(0)
  const lastDriverRefit = useRef(0)
  const holdActive = () => Date.now() - userMovedAt.current < USER_MOVE_HOLD_MS
  // The sheet floats over the lower part of this map: pad the camera by its real height so the car is framed above it.
  const padding = useMemo(
    () => framingPadding(edgePadding, coveredBottom, mapSize.height),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the padding's numbers, not the object identity
    [edgePadding.top, edgePadding.right, edgePadding.bottom, edgePadding.left, coveredBottom, mapSize.height],
  )

  const fit = useCallback(() => {
    const cars = driverPos ? [] : carsToFrame(pickup, nearbyDrivers)
    const points = framePoints({ pickup, stops, drop, showDrop, driverPos, cars, frameDrop })
    if (points.length < 2) return
    mapRef.current?.fitToCoordinates(
      points.map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding: padding, animated: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by fitKey below, not array identities
  }, [pickup, drop, driverPos, showDrop, stopsKey, padding, nearbyDrivers, frameDrop])

  // Re-fit when the SET of things on the map changes (status/leg, stops, driver first appearing),
  // not on every driver location tick -- that animated the camera every few seconds, snapped the
  // rider back whenever they panned, and kept the GPU at full frame rate for the whole trip.
  // Re-frame when cars first appear near the pickup (or all leave), not on every poll: cars drifting about must not move the camera.
  const framesCars = !driverPos && carsToFrame(pickup, nearbyDrivers).length > 0 ? 1 : 0
  const fitKey = `${pickup[0]},${pickup[1]}|${drop ? `${drop[0]},${drop[1]}` : ''}|${stopsKey}|${showDrop}|${driverPos ? 1 : 0}|${sheetHeightBucket(coveredBottom)}|${framesCars}|${frameDrop ? 1 : 0}`
  useEffect(() => {
    if (mapReady && !holdActive()) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey captures every input that should trigger a re-fit
  }, [mapReady, fitKey])

  // The driver drove out of frame: bring everything back, at most every 5s, never while the rider is exploring.
  useEffect(() => {
    if (!mapReady || !driverPos || holdActive() || Date.now() - lastDriverRefit.current < DRIVER_REFIT_MIN_MS) return
    let cancelled = false
    const refit = (inside: boolean) => {
      if (cancelled || inside || holdActive()) return
      lastDriverRefit.current = Date.now()
      fit()
    }
    // In view = on the map AND not under the sheet. The whole-map bounds count the strip behind the sheet as visible,
    // which is how a car driving there was never brought back. Falls back to the bounds if the projection is missing.
    const byBounds = () =>
      mapRef.current?.getMapBoundaries().then(({ northEast, southWest }) => {
        refit(
          driverPos[0] <= northEast.latitude && driverPos[0] >= southWest.latitude &&
          driverPos[1] <= northEast.longitude && driverPos[1] >= southWest.longitude,
        )
      }).catch(() => {})
    if (mapSize.height > 0 && mapRef.current?.pointForCoordinate) {
      mapRef.current
        .pointForCoordinate({ latitude: driverPos[0], longitude: driverPos[1] })
        .then((pt) => refit(isInVisibleBand(pt, mapSize, coveredBottom)))
        .catch(() => { void byBounds() })
    } else {
      void byBounds()
    }
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
    <View
      style={styles.container}
      onLayout={(e) => setMapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
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
        {fleet.map((e) => <NearbyCarMarker key={e.car.driverId} position={[e.car.lat, e.car.lng]} {...(e.car.heading !== undefined ? { heading: e.car.heading } : {})} opacity={fleetOpacity(e, Date.now())} />)}
        {driverPos ? (
          <CarMarker position={driverPos} heading={driverHeading ?? 0} headingKnown={driverHeadingKnown ?? true} animate={driverLocated} />
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
