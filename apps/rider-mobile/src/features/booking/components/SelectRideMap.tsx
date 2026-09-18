import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import CarMarker from '@/features/map/components/CarMarker'
import LocationPin from '@/features/map/components/LocationPin'
import { fetchNearbyDrivers } from '@/features/booking/api'

const POLL_MS = 8000

export type SelectRideMapProps = {
  pickup: [number, number]
  drop: [number, number]
  routePoints: [number, number][]
  /** Fill the parent container instead of the default fixed 180px card --
   *  used by the redesigned select-ride screen, which sizes the map section
   *  itself (a fraction of the window height) rather than letting this
   *  component dictate a fixed height. */
  fill?: boolean
}

// Matches web's SelectRideMapScene: pickup/drop pins + route line, plus a
// scattering of nearby driver car icons around pickup -- the "cars are close,
// you'll be matched fast" reassurance beat. Polls the same nearby-drivers
// endpoint the web select-ride page polls, at the same 8s cadence.
export function SelectRideMap({ pickup, drop, routePoints, fill }: SelectRideMapProps) {
  const mapRef = useRef<MapView>(null)
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ driverId: string; lat: number; lng: number }>>([])
  // Distinct from "0 drivers" -- a fresh poll in flight shouldn't flash a false
  // "no drivers nearby" banner before the first response has even landed.
  const [hasPolled, setHasPolled] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const drivers = await fetchNearbyDrivers(pickup[0], pickup[1])
        if (!cancelled) {
          setNearbyDrivers(drivers)
          setHasPolled(true)
        }
      } catch {
        // Nearby-drivers is a reassurance layer, not core booking data -- a
        // failed poll just leaves the map without car icons until the next tick.
      }
    }
    void poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [pickup])

  useEffect(() => {
    mapRef.current?.fitToCoordinates(
      [pickup, drop].map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true }
    )
  }, [pickup, drop])

  return (
    <View style={fill ? styles.fillContainer : styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickup[0], longitude: pickup[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        {routePoints.length >= 2 ? (
          <Polyline
            coordinates={routePoints.map(([latitude, longitude]) => ({ latitude, longitude }))}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
        ) : null}
        <LocationPin position={pickup} variant="pickup" />
        <LocationPin position={drop} variant="drop" />
        {nearbyDrivers.map((d) => (
          <CarMarker key={d.driverId} position={[d.lat, d.lng]} />
        ))}
      </MapView>

      {hasPolled && nearbyDrivers.length === 0 ? (
        <View style={styles.noDriversBanner} pointerEvents="none">
          <Feather name="alert-triangle" size={13} color={colors.warning} />
          <Text style={styles.noDriversText}>No drivers nearby. Try again in a few minutes.</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { height: 180, borderRadius: radii.lg, overflow: 'hidden' },
  fillContainer: { flex: 1 },
  noDriversBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
  },
  noDriversText: { ...typography.caption, color: colors.warning, fontWeight: '600', flex: 1 },
})
