import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker, type Region } from 'react-native-maps'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { OCAR_MAP_PROPS } from '@/theme/mapStyle'
import { PinGlyph } from '@/features/map/components/PinGlyph'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography, fonts, haversineMetres } from '@ocar/mobile-shared'
import { fetchReverseGeocode } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'
import { useLocationStore, useLocationTracking } from '@/store/useLocationStore'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'
import LocationPin from '@/features/map/components/LocationPin'

type Field = 'pickup' | 'drop'

// The rider's own marker elsewhere in the app (home map) is this brand pink: keep "you" the same colour here.
const YOU = '#DC3E93'
const YOU_RING = 'rgba(220,62,147,0.45)'
const YOU_FILL = 'rgba(220,62,147,0.10)'
const YOU_HALO = 'rgba(220,62,147,0.18)'
// A pickup is placed to the side of a road, so start close (~330 m across); a destination starts wider.
const PICKUP_DELTA = 0.003
const DROP_DELTA = 0.02
// Beyond this the pin is probably on the wrong street: say so instead of letting it through silently.
const FAR_FROM_YOU_M = 200
const PIN_W = 30
const PIN_H = 40

// "Select on map" (web's /confirm-pickup, reached via search's map pill and, for a pickup, before every trip is quoted) --
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
  const confirmPickup = useBookingDraftStore((s) => s.confirmPickup)
  const setDrop = useBookingDraftStore((s) => s.setDrop)
  const addRecent = useRecentSearchesStore((s) => s.addRecent)
  useLocationTracking(true, true) // placing a pickup: GPS-grade accuracy while this screen is on show
  const locLat = useLocationStore((s) => s.lat)
  const locLng = useLocationStore((s) => s.lng)
  const locAddress = useLocationStore((s) => s.address)
  const locAccuracy = useLocationStore((s) => s.accuracy)

  const existing = isPickup ? pickup : drop
  // The other end of the trip, already confirmed -- shown as a static marker
  // alongside the drag pin so the rider can see both source and destination
  // while positioning this one, instead of just the one point being edited.
  const otherPlace = isPickup ? drop : pickup
  const fallback = pickup ?? (locLat !== null ? { address: locAddress, lat: locLat, lng: locLng! } : null)
  const initial = existing ?? fallback
  const centerLat = initial?.lat ?? 20.2961
  const centerLng = initial?.lng ?? 85.8245
  // Start close for a pickup, but not when the fix is so rough (over ~200 m) that the real spot could be off the tight view.
  const tightZoom = isPickup && !(locAccuracy !== null && locAccuracy > 200)
  const delta = tightZoom ? PICKUP_DELTA : DROP_DELTA

  const [address, setAddress] = useState(initial?.address ?? '')
  const [resolving, setResolving] = useState(false)
  const [coords, setCoords] = useState({ lat: centerLat, lng: centerLng })
  const [cardH, setCardH] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A slow earlier lookup must not overwrite the address of a newer pin position.
  const geocodeSeq = useRef(0)
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])
  const mapRef = useRef<MapView>(null)

  // The pin lifts off the map while the rider drags it and settles back on release, so it is clear where it will land.
  const lift = useSharedValue(0)
  const lifted = useRef(false)
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -10 * lift.get() }] }))
  const groundStyle = useAnimatedStyle(() => ({ opacity: 0.2 - 0.1 * lift.get(), transform: [{ scale: 1 - 0.35 * lift.get() }] }))

  // Frame both ends of the trip on first render so the other marker is
  // actually visible rather than just present off-screen.
  useEffect(() => {
    if (!otherPlace) return
    mapRef.current?.fitToCoordinates(
      [{ latitude: centerLat, longitude: centerLng }, { latitude: otherPlace.lat, longitude: otherPlace.lng }],
      { edgePadding: { top: 100, right: 80, bottom: 220, left: 80 }, animated: false }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only frame once on mount
  }, [])

  const handlePanDrag = useCallback(() => {
    if (lifted.current) return
    lifted.current = true
    lift.set(withTiming(1, { duration: 120 }))
  }, [lift])

  const handleRegionChangeComplete = useCallback((region: Region) => {
    lifted.current = false
    lift.set(withSpring(0, { damping: 14, stiffness: 240 }))
    setCoords({ lat: region.latitude, lng: region.longitude })
    setResolving(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const seq = ++geocodeSeq.current
    debounceRef.current = setTimeout(() => {
      fetchReverseGeocode(region.latitude, region.longitude)
        .then((d) => { if (seq === geocodeSeq.current) setAddress(d.address) })
        .catch(() => { if (seq === geocodeSeq.current) setAddress('Unknown location') })
        .finally(() => { if (seq === geocodeSeq.current) setResolving(false) })
    }, 500)
  }, [lift])

  const youAt: [number, number] | null = locLat !== null && locLng !== null ? [locLat, locLng] : null
  const metresFromYou = youAt ? haversineMetres([coords.lat, coords.lng], youAt) : null

  function recenter() {
    if (!youAt) return
    mapRef.current?.animateToRegion({ latitude: youAt[0], longitude: youAt[1], latitudeDelta: PICKUP_DELTA, longitudeDelta: PICKUP_DELTA }, 350)
  }

  function confirm() {
    const place = { address: address || 'Selected location', lat: coords.lat, lng: coords.lng }
    if (isPickup) {
      confirmPickup(place)
    } else {
      setDrop(place)
      addRecent(place)
    }
    goBack(router)
  }

  const far = metresFromYou !== null && metresFromYou > FAR_FROM_YOU_M
  const chipText = metresFromYou === null ? null : metresFromYou < 30 ? 'At your location' : `${fmtMetres(metresFromYou)} from you`

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: centerLat, longitude: centerLng, latitudeDelta: delta, longitudeDelta: delta }}
        loadingEnabled
        {...OCAR_MAP_PROPS}
        onPanDrag={handlePanDrag}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {otherPlace ? (
          <LocationPin position={[otherPlace.lat, otherPlace.lng]} variant={isPickup ? 'drop' : 'pickup'} />
        ) : null}
        {/* How far off the GPS fix could be: the rider can see the real spot may sit anywhere inside the ring. */}
        {isPickup && youAt && locAccuracy !== null && locAccuracy > 15 ? (
          <Circle center={{ latitude: youAt[0], longitude: youAt[1] }} radius={Math.min(locAccuracy, 300)} strokeColor={YOU_RING} strokeWidth={1.5} fillColor={YOU_FILL} />
        ) : null}
        {/* "You are here": the same brand-pink dot as the home map, so the rider can tell where they stand against the pin. */}
        {youAt ? (
          <Marker coordinate={{ latitude: youAt[0], longitude: youAt[1] }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
            {/* Drawn as one SVG: a map marker is snapshotted to a bitmap, and nested flex centring inside it is not reliable. */}
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <SvgCircle cx={22} cy={22} r={22} fill={YOU_HALO} />
              <SvgCircle cx={22} cy={22} r={10} fill="#FFFFFF" />
              <SvgCircle cx={22} cy={22} r={7} fill={YOU} />
            </Svg>
          </Marker>
        ) : null}
      </MapView>

      {/* Screen-fixed pin -- the map moves underneath it, not the other way round. The tip sits on the map centre. */}
      <View style={styles.centerPin} pointerEvents="none">
        <Animated.View style={[styles.ground, groundStyle]} />
        <Animated.View style={[styles.pinBox, pinStyle]}>
          <PinGlyph variant={isPickup ? 'pickup' : 'drop'} width={PIN_W} height={PIN_H} />
        </Animated.View>
      </View>

      <Pressable
        onPress={() => goBack(router)}
        style={[styles.backButton, { top: insets.top + spacing.md }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Feather name="arrow-left" size={18} color={colors.ink900} />
      </Pressable>

      {isPickup ? (
        <View style={[styles.hint, { top: insets.top + spacing.md }]} pointerEvents="none">
          <Text style={styles.hintText}>Drag the map to where you'll stand</Text>
        </View>
      ) : null}

      {/* Floating readout and recenter, sitting just above the card whatever its height. */}
      {cardH > 0 && youAt ? (
        <View style={[styles.floatRow, { bottom: cardH + spacing.md }]} pointerEvents="box-none">
          {isPickup && chipText ? (
            <View style={[styles.chip, far ? styles.chipFar : null]} accessibilityLiveRegion="polite">
              <Feather name={far ? 'alert-circle' : 'navigation'} size={14} color={far ? colors.warning : colors.primary} />
              <Text style={styles.chipText}>{chipText}</Text>
            </View>
          ) : <View />}
          <Pressable onPress={recenter} style={styles.fab} hitSlop={8} accessibilityRole="button" accessibilityLabel="Centre on my location">
            <Feather name="crosshair" size={20} color={colors.primary} />
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.card, { paddingBottom: insets.bottom + spacing.md }]} onLayout={(e) => setCardH(e.nativeEvent.layout.height)}>
        <Text style={styles.cardLabel}>{isPickup ? 'Pickup point' : 'Destination'}</Text>
        <View style={styles.addressRow}>
          <View style={styles.addressIcon}>
            {resolving ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="map-pin" size={16} color={colors.primary} />}
          </View>
          <Text style={[styles.addressText, resolving && !address ? styles.addressMuted : null]} numberOfLines={2}>
            {resolving && !address ? 'Finding address…' : address || 'Move the map to set your location'}
          </Text>
        </View>
        {isPickup ? <Text style={styles.cardSub}>Pick the side of the road you'll be on.</Text> : null}
        <Button
          label={isPickup ? 'Confirm pickup' : 'Confirm location'}
          onPress={confirm}
          disabled={resolving || !address}
          accessibilityLabel={isPickup ? 'Confirm this pickup point' : 'Confirm this location'}
        />
      </View>
    </View>
  )
}

function fmtMetres(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m / 10) * 10} m`
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // Zero-size anchor at the screen centre: the pin's tip and its ground shadow both hang off this point.
  centerPin: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0 },
  pinBox: { position: 'absolute', left: -PIN_W / 2, top: -PIN_H, width: PIN_W, height: PIN_H },
  ground: { position: 'absolute', top: -3, left: -7, width: 14, height: 6, borderRadius: 7, backgroundColor: colors.ink900 },
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
  // Level with the back button, to its right, so it never covers the map centre where the pin is.
  hint: {
    position: 'absolute',
    left: spacing.lg + 40 + spacing.sm,
    right: spacing.lg,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    ...shadowFallback(),
  },
  hintText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.semibold },
  floatRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, height: 36, paddingHorizontal: spacing.sm + 4, borderRadius: radii.full, backgroundColor: colors.surface, ...shadowFallback() },
  chipFar: { backgroundColor: colors.warningLight },
  chipText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  fab: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadowFallback() },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  addressIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  addressText: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold, flex: 1 },
  addressMuted: { color: colors.ink400, fontFamily: fonts.regular },
  cardSub: { ...typography.caption, color: colors.ink600, marginTop: -spacing.xs },
})

// Cross-platform elevation without importing the shared `shadows` token set
// (this screen only needs a few plain floating controls, not the whole shadow scale).
function shadowFallback() {
  return {
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  }
}
