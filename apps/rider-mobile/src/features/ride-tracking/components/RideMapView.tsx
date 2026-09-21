import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import { colors } from '@ocar/mobile-shared'
import CarMarker from '@/features/map/components/CarMarker'
import LocationPin from '@/features/map/components/LocationPin'

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
}

// Real map replacing the earlier placeholder progress-bar "track" (LiveMarker) --
// same pickup/drop/driver-pin + route-line shape as the web app's RideMapScene,
// scoped down to what react-native-maps needs (no traffic layer, no nearby-driver
// swarm -- those stay web-only per the UI-parity pass's agreed core scope). Pickup/
// drop/driver now use the same custom SVG markers as web (CarMarker/LocationPin)
// instead of react-native-maps' default OS pin -- see the input-consistency +
// premiumness pass this replaced.
export function RideMapView({ pickup, drop, driverPos, driverHeading, driverHeadingKnown, routePoints, showDrop, stops = [] }: RideMapViewProps) {
  const mapRef = useRef<MapView>(null)
  // Same react-native-maps gotcha as SelectRideMap: fitToCoordinates called
  // before the native view's onMapReady fires silently no-ops, leaving the
  // camera on initialRegion -- pickup/drop/driver pins get drawn but sit
  // outside that tiny visible area, reading as "the route isn't there".
  const [mapReady, setMapReady] = useState(false)
  const stopsKey = stops.map(([lat, lng]) => `${lat},${lng}`).join('|')

  useEffect(() => {
    if (!mapReady) return
    const points: [number, number][] = [pickup, ...stops]
    if (showDrop && drop) points.push(drop)
    if (driverPos) points.push(driverPos)
    if (points.length < 2) return
    mapRef.current?.fitToCoordinates(
      points.map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stops re-fit keyed by stopsKey, not the array reference
  }, [mapReady, pickup, drop, driverPos, showDrop, stopsKey])

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickup[0], longitude: pickup[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onMapReady={() => setMapReady(true)}
        loadingEnabled
        loadingIndicatorColor={colors.primary}
        loadingBackgroundColor={colors.surface}
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
          <Polyline
            coordinates={routePoints.map(([latitude, longitude]) => ({ latitude, longitude }))}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
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
