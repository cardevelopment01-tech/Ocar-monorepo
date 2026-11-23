import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import MapView, { Circle, Marker, Polyline, type Region } from 'react-native-maps'
import Svg, { Circle as SvgCircle } from 'react-native-svg'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { OCAR_MAP_PROPS } from '@/theme/mapStyle'
import { PinGlyph } from '@/features/map/components/PinGlyph'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography, fonts, haversineMetres, track } from '@ocar/mobile-shared'
import { fetchReverseGeocode, resolveBookingError } from '@/features/booking/api'
import { updatePickup } from '@/features/ride-tracking/api'
import { clampToRadius } from '@/features/ride-tracking/clampToRadius'
import { useBookingDraftStore } from '@/features/booking/store'
import { useLocationStore, useLocationTracking } from '@/store/useLocationStore'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'
import LocationPin from '@/features/map/components/LocationPin'

type Field = 'pickup' | 'drop'

// "You are here" is the blue dot every maps app uses, so it can never be mistaken for the pin (teal, the brand's pickup colour).
const YOU = '#2563EB'
const YOU_RING = 'rgba(37,99,235,0.30)'
const YOU_FILL = 'rgba(37,99,235,0.07)'
const YOU_HALO = 'rgba(37,99,235,0.16)'
// Floating controls (back, hint, distance chip, recenter) share one height so their edges line up.
const CONTROL = 44
// A pickup starts at block level (~210 m across): close enough to tell which side of the road, wide enough to see the
// junctions around it. It widens only as far as needed to keep the GPS accuracy ring in view. A destination starts wider.
const PICKUP_DELTA_MIN = 0.0019
const PICKUP_DELTA_MAX = 0.004
const DROP_DELTA = 0.02
const pickupDelta = (accuracyM: number | null) =>
  Math.min(PICKUP_DELTA_MAX, Math.max(PICKUP_DELTA_MIN, accuracyM === null ? 0 : (accuracyM * 3.2) / 111_320))
// The address service can fall back to raw coordinates; never show those as if they were a place.
const looksLikeCoords = (a: string) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(a.trim())
// Under this the pin is on top of the dot: a dotted line would be a stub.
const MIN_LINE_M = 12
// Beyond this the pin is probably on the wrong street: say so instead of letting it through silently.
const FAR_FROM_YOU_M = 200
// Edit pickup (after booking): mirrors api/src/constants/limits.ts PICKUP_EDIT_RADIUS_METRES. UX only -- the server re-checks it.
const PICKUP_EDIT_RADIUS_METRES = 150
const EDIT_DELTA = 0.0045 // ~500 m across: the whole circle fits with room to spare
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
  const { field, editRide, lat: editLat, lng: editLng, address: editAddress, driver } = useLocalSearchParams<{
    field: Field; editRide?: string; lat?: string; lng?: string; address?: string; driver?: string
  }>()
  // Edit pickup on a booked ride reuses this screen: same map, pin, dot and card, limited to a circle around the booked pickup.
  const isEdit = !!editRide
  const isPickup = isEdit || field === 'pickup'
  const editOrigin: [number, number] | null =
    isEdit && editLat && editLng && Number.isFinite(Number(editLat)) && Number.isFinite(Number(editLng)) ? [Number(editLat), Number(editLng)] : null

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

  const existing = editOrigin ? { address: editAddress ?? '', lat: editOrigin[0], lng: editOrigin[1] } : isPickup ? pickup : drop
  // The other end of the trip, already confirmed -- shown as a static marker
  // alongside the drag pin so the rider can see both source and destination
  // while positioning this one, instead of just the one point being edited.
  const otherPlace = isEdit ? null : isPickup ? drop : pickup
  const fallback = pickup ?? (locLat !== null ? { address: locAddress, lat: locLat, lng: locLng! } : null)
  const initial = existing ?? fallback
  const centerLat = initial?.lat ?? 20.2961
  const centerLng = initial?.lng ?? 85.8245
  // Start close for a pickup, but not when the fix is so rough (over ~200 m) that the real spot could be off the tight view.
  const tightZoom = isPickup && !(locAccuracy !== null && locAccuracy > 200)
  const delta = editOrigin ? EDIT_DELTA : tightZoom ? pickupDelta(locAccuracy) : DROP_DELTA

  const [address, setAddress] = useState(initial?.address ?? '')
  const [resolving, setResolving] = useState(false)
  const [coords, setCoords] = useState({ lat: centerLat, lng: centerLng })
  // Follows the map while it is being dragged, so the dotted line stays attached to the pin.
  const [liveCenter, setLiveCenter] = useState({ lat: centerLat, lng: centerLng })
  const [cardH, setCardH] = useState(0)
  // The hint has done its job once the rider starts moving the map.
  const [touched, setTouched] = useState(false)
  const [atBoundary, setAtBoundary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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

  // A touch that never moves the map fires onPanDrag but no onRegionChangeComplete, so the pin would stay lifted:
  // put it down once the drags stop arriving.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])
  const putPinDown = useCallback(() => {
    lifted.current = false
    lift.set(withSpring(0, { damping: 14, stiffness: 240 }))
  }, [lift])

  const handlePanDrag = useCallback(() => {
    setTouched(true)
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(putPinDown, 400)
    if (lifted.current) return
    lifted.current = true
    lift.set(withTiming(1, { duration: 120 }))
  }, [lift, putPinDown])

  const handleRegionChangeComplete = useCallback((region: Region) => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    putPinDown()
    let lat = region.latitude
    let lng = region.longitude
    if (editOrigin && haversineMetres(editOrigin, [lat, lng]) > PICKUP_EDIT_RADIUS_METRES) {
      // Past the edge: slide the map back so the pin sits just inside the circle the server accepts.
      const c = clampToRadius(editOrigin, [lat, lng], PICKUP_EDIT_RADIUS_METRES - 2)
      lat = c[0]
      lng = c[1]
      mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta }, 200)
      setAtBoundary(true)
      setTimeout(() => setAtBoundary(false), 2000)
    }
    setCoords({ lat, lng })
    setLiveCenter({ lat, lng })
    setResolving(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const seq = ++geocodeSeq.current
    debounceRef.current = setTimeout(() => {
      fetchReverseGeocode(lat, lng)
        .then((d) => { if (seq === geocodeSeq.current) setAddress(d.address) })
        .catch(() => { if (seq === geocodeSeq.current) setAddress('Unknown location') })
        .finally(() => { if (seq === geocodeSeq.current) setResolving(false) })
    }, 500)
  }, [putPinDown, editOrigin?.[0], editOrigin?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps -- editOrigin is rebuilt each render; its two numbers are the real inputs

  const youAt: [number, number] | null = locLat !== null && locLng !== null ? [locLat, locLng] : null
  const metresFromYou = youAt ? haversineMetres([liveCenter.lat, liveCenter.lng], youAt) : null

  function recenter() {
    if (!youAt) return
    mapRef.current?.animateToRegion({ latitude: youAt[0], longitude: youAt[1], latitudeDelta: pickupDelta(locAccuracy), longitudeDelta: pickupDelta(locAccuracy) }, 350)
  }

  async function confirm() {
    const place = { address: address || 'Selected location', lat: coords.lat, lng: coords.lng }
    if (isEdit && editRide) {
      setSaving(true)
      setSaveError(null)
      try {
        await updatePickup(editRide, { lat: place.lat, lng: place.lng, address: place.address })
        router.navigate(`/ride/${editRide}?pickupUpdated=1`)
      } catch (err) {
        setSaveError(resolveBookingError(err))
        setSaving(false)
      }
      return
    }
    if (isPickup) {
      confirmPickup(place)
      track('pickup_confirmed', { moved_from_you_m: metresFromYou === null ? null : Math.round(metresFromYou), accuracy_m: locAccuracy === null ? null : Math.round(locAccuracy) })
    } else {
      setDrop(place)
      addRecent(place)
    }
    goBack(router)
  }

  const coordsOnly = looksLikeCoords(address)
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
        onRegionChange={(r) => setLiveCenter({ lat: r.latitude, lng: r.longitude })}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {otherPlace ? (
          <LocationPin position={[otherPlace.lat, otherPlace.lng]} variant={isPickup ? 'drop' : 'pickup'} />
        ) : null}
        {/* How far off the GPS fix could be: the rider can see the real spot may sit anywhere inside the ring. */}
        {editOrigin ? (
          <Circle center={{ latitude: editOrigin[0], longitude: editOrigin[1] }} radius={PICKUP_EDIT_RADIUS_METRES} strokeColor={YOU} strokeWidth={2} fillColor={YOU_FILL} />
        ) : null}
        {isPickup && youAt && locAccuracy !== null && locAccuracy > 15 ? (
          <Circle center={{ latitude: youAt[0], longitude: youAt[1] }} radius={Math.min(locAccuracy, 300)} strokeColor={YOU_RING} strokeWidth={1} fillColor={YOU_FILL} />
        ) : null}
        {/* The way from where you are to where the pin is: dotted, like a walk, and it follows the pin as it moves. */}
        {isPickup && youAt && haversineMetres([liveCenter.lat, liveCenter.lng], youAt) > MIN_LINE_M ? (
          <Polyline
            coordinates={[{ latitude: youAt[0], longitude: youAt[1] }, { latitude: liveCenter.lat, longitude: liveCenter.lng }]}
            strokeColor={YOU}
            strokeWidth={4}
            lineCap="round"
            lineDashPattern={[1, 7]}
          />
        ) : null}
        {/* "You are here": the same brand-pink dot as the home map, so the rider can tell where they stand against the pin. */}
        {youAt ? (
          <Marker coordinate={{ latitude: youAt[0], longitude: youAt[1] }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
            {/* Drawn as one SVG: a map marker is snapshotted to a bitmap, and nested flex centring inside it is not reliable. */}
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <SvgCircle cx={22} cy={22} r={20} fill={YOU_HALO} />
              <SvgCircle cx={22} cy={22} r={9} fill="#FFFFFF" />
              <SvgCircle cx={22} cy={22} r={6} fill={YOU} />
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
        <Feather name="arrow-left" size={20} color={colors.ink900} />
      </Pressable>

      {isPickup && !touched ? (
        <View style={[styles.hint, { top: insets.top + spacing.md }]} pointerEvents="none">
          <Text style={styles.hintText} numberOfLines={1}>{isEdit ? 'Move the map within the circle' : "Move the map to where you'll wait"}</Text>
        </View>
      ) : null}

      {atBoundary ? (
        <View style={[styles.hint, { top: insets.top + spacing.md + CONTROL + spacing.sm }]} pointerEvents="none">
          <Text style={styles.hintText} numberOfLines={1}>Pickup can only move within the circle</Text>
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
        <View style={styles.group}>
          <Text style={styles.cardLabel}>{isPickup ? 'Pickup point' : 'Destination'}</Text>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              {resolving ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="map-pin" size={18} color={colors.primary} />}
            </View>
            <View style={styles.addressCol}>
              <Text style={[styles.addressText, resolving && !address ? styles.addressMuted : null]} numberOfLines={2}>
                {resolving && !address ? 'Finding address…' : !address ? 'Move the map to set your location' : coordsOnly ? 'Pinned location' : address}
              </Text>
              {coordsOnly ? <Text style={styles.cardSub}>{address}</Text> : null}
            </View>
          </View>
          {isPickup ? <Text style={styles.cardSub}>Stand on the side of the road you want the driver to stop.</Text> : null}
          {isEdit && driver === '1' ? <Text style={styles.cardSub}>Your driver will be notified of the update.</Text> : null}
          {saveError ? <Text style={[styles.cardSub, { color: colors.error }]}>{saveError}</Text> : null}
        </View>
        <Button
          label={isPickup ? 'Confirm pickup' : 'Confirm location'}
          onPress={confirm}
          loading={saving}
          disabled={resolving || !address || saving}
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
  ground: { position: 'absolute', top: -3, left: -8, width: 16, height: 6, borderRadius: 8, backgroundColor: colors.ink900 },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: CONTROL,
    height: CONTROL,
    borderRadius: CONTROL / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowFallback(),
  },
  // Level with the back button, to its right, so it never covers the map centre where the pin is.
  hint: {
    position: 'absolute',
    left: spacing.lg + CONTROL + spacing.sm,
    right: spacing.lg,
    height: CONTROL,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: CONTROL / 2,
    backgroundColor: colors.surface,
    ...shadowFallback(),
  },
  hintText: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold, textAlign: 'center' },
  floatRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, height: CONTROL, paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.surface, ...shadowFallback() },
  chipFar: { backgroundColor: colors.warningLight },
  chipText: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  fab: { width: CONTROL, height: CONTROL, borderRadius: CONTROL / 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadowFallback() },
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
  group: { gap: spacing.sm },
  cardLabel: { ...typography.label, color: colors.ink600 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  addressIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  addressCol: { flex: 1, gap: 2 },
  addressText: { ...typography.title, color: colors.ink900 },
  addressMuted: { color: colors.ink400, fontFamily: fonts.regular },
  cardSub: { ...typography.caption, color: colors.ink600 },
})

// Cross-platform elevation without importing the shared `shadows` token set
// (this screen only needs a few plain floating controls, not the whole shadow scale).
function shadowFallback() {
  return {
    elevation: 3,
    shadowColor: colors.ink900,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  }
}
