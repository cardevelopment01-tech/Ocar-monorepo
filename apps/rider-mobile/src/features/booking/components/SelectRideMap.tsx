import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Polyline } from 'react-native-maps'
import { colors } from '@ocar/mobile-shared'
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
  /** Reports poll state up so the parent can render the "no drivers nearby"
   *  banner itself (in the sheet, like web does) instead of this component
   *  drawing it as a map overlay -- the map's bottom edge sits right where
   *  the sheet's rounded top corner overlaps it (fare.tsx's negative
   *  marginTop), which clipped the banner right where it needed to be readable. */
  onNearbyDriversChange?: (hasPolled: boolean, count: number) => void
}

// Matches web's SelectRideMapScene: pickup/drop pins + route line, plus a
// scattering of nearby driver car icons around pickup -- the "cars are close,
// you'll be matched fast" reassurance beat. Polls the same nearby-drivers
// endpoint the web select-ride page polls, at the same 8s cadence.
export function SelectRideMap({ pickup, drop, routePoints, fill, onNearbyDriversChange }: SelectRideMapProps) {
  const mapRef = useRef<MapView>(null)
  const [nearbyDrivers, setNearbyDrivers] = useState<Array<{ driverId: string; lat: number; lng: number }>>([])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const drivers = await fetchNearbyDrivers(pickup[0], pickup[1])
        if (!cancelled) {
          setNearbyDrivers(drivers)
          onNearbyDriversChange?.(true, drivers.length)
        }
      } catch {
        // Nearby-drivers is a reassurance layer, not core booking data -- a
        // failed poll just leaves the map without car icons until the next tick.
      }
    }
    void poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // pickup is a fresh [lat, lng] array literal every render of the parent
    // screen -- depending on the array reference itself would tear down and
    // restart this interval (and the "have we polled yet" banner state) on
    // every unrelated re-render instead of running a stable 8s cadence,
    // which is what made new drivers coming online look like they required
    // leaving and re-entering the screen to show up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup[0], pickup[1]])

  useEffect(() => {
    mapRef.current?.fitToCoordinates(
      [pickup, drop].map(([latitude, longitude]) => ({ latitude, longitude })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup[0], pickup[1], drop[0], drop[1]])

  return (
    <View style={fill ? styles.fillContainer : styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: pickup[0], longitude: pickup[1], latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        loadingEnabled
        loadingIndicatorColor={colors.primary}
        loadingBackgroundColor={colors.surface}
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
    </View>
  )
}

const styles = StyleSheet.create({
  container: { height: 180, borderRadius: 16, overflow: 'hidden' },
  fillContainer: { flex: 1 },
})
