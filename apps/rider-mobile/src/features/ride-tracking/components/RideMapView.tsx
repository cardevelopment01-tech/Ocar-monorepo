import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, Polyline } from 'react-native-maps'
import { colors, radii } from '@ocar/mobile-shared'

export type RideMapViewProps = {
  pickup: [number, number]
  drop: [number, number] | null
  driverPos: [number, number] | null
  routePoints: [number, number][]
  showDrop: boolean
}

// Real map replacing the earlier placeholder progress-bar "track" (LiveMarker) --
// same pickup/drop/driver-pin + route-line shape as the web app's RideMapScene,
// scoped down to what react-native-maps needs (no traffic layer, no nearby-driver
// swarm -- those stay web-only per the UI-parity pass's agreed core scope).
export function RideMapView({ pickup, drop, driverPos, routePoints, showDrop }: RideMapViewProps) {
  const mapRef = useRef<MapView>(null)

  useEffect(() => {
    const points: [number, number][] = [pickup]
    if (showDrop && drop) points.push(drop)
    if (driverPos) points.push(driverPos)
    if (points.length < 2) return
    mapRef.current?.fitToCoordinates(
      points.map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true }
    )
  }, [pickup, drop, driverPos, showDrop])

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickup[0], longitude: pickup[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        <Marker coordinate={{ latitude: pickup[0], longitude: pickup[1] }} pinColor={colors.primary} title="Pickup" />
        {showDrop && drop ? (
          <Marker coordinate={{ latitude: drop[0], longitude: drop[1] }} pinColor={colors.ink900} title="Drop" />
        ) : null}
        {driverPos ? (
          <Marker
            coordinate={{ latitude: driverPos[0], longitude: driverPos[1] }}
            pinColor={colors.accentOrange}
            title="Driver"
            zIndex={10}
          />
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
  container: { height: 260, borderRadius: radii.lg, overflow: 'hidden' },
})
