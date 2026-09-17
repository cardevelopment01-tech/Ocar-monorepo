import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import MapView, { Marker, type Region } from 'react-native-maps'
import { Input, colors, getCurrentOrLastKnownPosition, radii, shadows, spacing, typography } from '@ocar/mobile-shared'

type LocationStatus = 'requesting' | 'denied' | 'ready' | 'error'

const DEFAULT_DELTA = { latitudeDelta: 0.01, longitudeDelta: 0.01 }

export default function HomeScreen() {
  const router = useRouter()
  const mapRef = useRef<MapView>(null)
  const [status, setStatus] = useState<LocationStatus>('requesting')
  const [region, setRegion] = useState<Region | null>(null)

  const locate = useCallback(async () => {
    setStatus('requesting')
    const { status: permStatus } = await Location.requestForegroundPermissionsAsync()
    if (permStatus !== 'granted') {
      setStatus('denied')
      return
    }
    try {
      const position = await getCurrentOrLastKnownPosition()
      const nextRegion = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        ...DEFAULT_DELTA,
      }
      setRegion(nextRegion)
      setStatus('ready')
      mapRef.current?.animateToRegion(nextRegion, 300)
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    locate()
  }, [locate])

  if (status === 'denied') {
    return (
      <View style={styles.container}>
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Location access needed</Text>
          <Text style={styles.bannerBody}>
            Ocar needs your location to show nearby drivers and set your pickup point.
          </Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={12}>
            <Text style={styles.bannerLink}>Open settings</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {status === 'ready' && region ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation={false}
        >
          <Marker coordinate={region} pinColor={colors.primary} />
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.skeleton]}>
          {status === 'error' ? (
            <>
              <Text style={styles.bannerBody} accessibilityLiveRegion="polite">
                Couldn't get your location.
              </Text>
              <Pressable
                onPress={locate}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Retry getting your location"
              >
                <Text style={styles.bannerLink}>Try again</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}

      {/* Search bar overlay: pinned to the top only, leaving the rest of the map
          free for pan/zoom. The future pickup/drop bottom-sheet (built alongside
          app/booking/) mounts below this overlay, not here -- it should collapse
          to leave the map's gesture area clear per the plan's gesture-conflict note. */}
      <View style={styles.searchOverlay}>
        <Pressable onPress={() => router.push('/booking')} accessibilityRole="search">
          <Input
            placeholder="Where to?"
            editable={false}
            pointerEvents="none"
            accessibilityLabel="Search destination"
          />
        </Pressable>
      </View>

      {status === 'ready' ? (
        <Pressable
          style={styles.recenterButton}
          onPress={locate}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on my location"
        >
          <Text style={styles.recenterIcon}>◎</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skeleton: {
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  searchOverlay: { position: 'absolute', top: spacing.xl, left: spacing.lg, right: spacing.lg },
  recenterButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  recenterIcon: { fontSize: 20, color: colors.primary },
  banner: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  bannerTitle: { ...typography.title, color: colors.ink900 },
  bannerBody: { ...typography.body, color: colors.ink600 },
  bannerLink: { ...typography.body, color: colors.primary, fontWeight: '600' },
})
