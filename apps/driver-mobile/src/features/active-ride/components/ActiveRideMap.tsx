import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import * as Location from 'expo-location'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import CarMarker from '@/features/map/components/CarMarker'
import LocationPin from '@/features/map/components/LocationPin'
import { useDriverLivePosition } from '../useDriverLivePosition'

export type ActiveRideLeg = 'to-pickup' | 'to-destination'

export type ActiveRideMapProps = {
  pickup: [number, number]
  destination: [number, number] | null
  leg: ActiveRideLeg
}

const DEFAULT_REGION = { latitude: 20.2961, longitude: 85.8245, latitudeDelta: 0.05, longitudeDelta: 0.05 }

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
export function ActiveRideMap({ pickup, destination, leg }: ActiveRideMapProps) {
  const mapRef = useRef<MapView>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const live = useDriverLivePosition(!permissionDenied)
  const [overview, setOverview] = useState(true)
  const prevLeg = useRef(leg)

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

  if (permissionDenied) {
    return (
      <View style={[styles.container, styles.fallback]}>
        <Text style={styles.fallbackText}>Enable location to see the live map</Text>
      </View>
    )
  }

  const routePoints: [number, number][] = live && legTarget ? [live.position, legTarget] : []

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={
          live
            ? { latitude: live.position[0], longitude: live.position[1], latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : DEFAULT_REGION
        }
      >
        <LocationPin position={pickup} variant="pickup" />
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
  container: { height: 220, borderRadius: radii.lg, overflow: 'hidden' },
  fallback: { backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  fallbackText: { ...typography.label, color: colors.ink600, textAlign: 'center' },
})
