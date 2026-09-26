import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { type Region } from 'react-native-maps'
import { OCAR_MAP_PROPS } from '@/theme/mapStyle'
import { PinGlyph } from '@/features/map/components/PinGlyph'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import { fetchReverseGeocode } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'
import { useLocationStore } from '@/store/useLocationStore'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'
import LocationPin from '@/features/map/components/LocationPin'

type Field = 'pickup' | 'drop'

// "Select on map" (web's /confirm-pickup, reached via search's map pill) --
// adapted to the native drag-to-position pattern instead of web's tap-to-place:
// the pin stays fixed at screen center, the map moves underneath it, and the
// center coordinate reverse-geocodes on drag-end. This is the platform-correct
// version of the same feature, not a literal port of web's own interaction.
export default function MapPickerScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { field } = useLocalSearchParams<{ field: Field }>()
  const isPickup = field === 'pickup'

  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const setPickup = useBookingDraftStore((s) => s.setPickup)
  const setDrop = useBookingDraftStore((s) => s.setDrop)
  const addRecent = useRecentSearchesStore((s) => s.addRecent)
  const location = useLocationStore()

  const existing = isPickup ? pickup : drop
  // The other end of the trip, already confirmed -- shown as a static marker
  // alongside the drag pin so the rider can see both source and destination
  // while positioning this one, instead of just the one point being edited.
  const otherPlace = isPickup ? drop : pickup
  const fallback = pickup ?? (location.lat !== null ? { address: location.address, lat: location.lat, lng: location.lng! } : null)
  const initial = existing ?? fallback
  const centerLat = initial?.lat ?? 20.2961
  const centerLng = initial?.lng ?? 85.8245

  const [address, setAddress] = useState(initial?.address ?? '')
  const [resolving, setResolving] = useState(false)
  const [coords, setCoords] = useState({ lat: centerLat, lng: centerLng })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapRef = useRef<MapView>(null)

  // Frame both points on first open so the other, already-set location is
  // actually visible rather than just present off-screen.
  useEffect(() => {
    if (!otherPlace) return
    mapRef.current?.fitToCoordinates(
      [{ latitude: centerLat, longitude: centerLng }, { latitude: otherPlace.lat, longitude: otherPlace.lng }],
      { edgePadding: { top: 100, right: 80, bottom: 220, left: 80 }, animated: false }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only frame once on mount
  }, [])

  const handleRegionChangeComplete = useCallback((region: Region) => {
    setCoords({ lat: region.latitude, lng: region.longitude })
    setResolving(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchReverseGeocode(region.latitude, region.longitude)
        .then((d) => setAddress(d.address))
        .catch(() => setAddress('Unknown location'))
        .finally(() => setResolving(false))
    }, 500)
  }, [])

  function confirm() {
    const place = { address: address || 'Selected location', lat: coords.lat, lng: coords.lng }
    if (isPickup) {
      setPickup(place)
    } else {
      setDrop(place)
      addRecent(place)
    }
    router.back()
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: centerLat, longitude: centerLng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        loadingEnabled
        {...OCAR_MAP_PROPS}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {otherPlace ? (
          <LocationPin position={[otherPlace.lat, otherPlace.lng]} variant={isPickup ? 'drop' : 'pickup'} />
        ) : null}
      </MapView>

      {/* Screen-fixed pin -- the map moves underneath it, not the other way round. */}
      <View style={styles.centerPin} pointerEvents="none">
        <PinGlyph variant={isPickup ? 'pickup' : 'drop'} width={30} height={40} />
      </View>

      <Pressable
        onPress={() => router.back()}
        style={[styles.backButton, { top: insets.top + spacing.md }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Feather name="arrow-left" size={18} color={colors.ink900} />
      </Pressable>

      <View style={[styles.card, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.cardLabel}>{isPickup ? 'PICKUP LOCATION' : 'DESTINATION'}</Text>
        <View style={styles.addressRow}>
          {resolving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="map-pin" size={16} color={colors.ink600} />
          )}
          <Text style={styles.addressText} numberOfLines={2}>
            {resolving ? 'Locating…' : address || 'Move the map to set your location'}
          </Text>
        </View>
        <Button
          label="Confirm location"
          onPress={confirm}
          disabled={resolving || !address}
          accessibilityLabel="Confirm this location"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerPin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -15, marginTop: -40 },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowFallback(),
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, letterSpacing: 0.5 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addressText: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold, flex: 1 },
})

// Cross-platform elevation without importing the shared `shadows` token set
// (this screen only needs one plain floating button, not the whole shadow scale).
function shadowFallback() {
  return {
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  }
}
