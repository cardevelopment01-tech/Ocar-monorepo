import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  FadeIn,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import MapView, { Marker, type Region } from 'react-native-maps'
import { PinGlyph, a11yLabelFor, cameraMode, haversineMetres, pillTextFor, type Freshness } from '@ocar/mobile-shared'
import { ease, font, geo, h } from '@/theme/homeTokens'
import { OCAR_MAP_PROPS } from '@/theme/mapStyle'
import { Text } from './Text'
import { UserDot } from './UserDot'
import { useLiveLocation, type LatLng } from './useLiveLocation'

const DEFAULT_CENTER: LatLng = { lat: 20.2961, lng: 85.8245 } // Bhubaneswar
const PER_PX = 0.0075 / 236 // degrees of latitude per dp: fixed map scale (zoom is locked)
const SAME_SPOT = 0.00008 // ~9m: a region change this small is our own animateToRegion landing, not a rider drag

// Distances from the hero's bottom edge (the sheet overlaps its bottom 22px).
const PILL_H = 42
/** The pickup point at rest (sheet peeking): the ring dot's centre / pin tip. Dragging the sheet open lifts it to stay centred. */
const POINT = 43
const PILL_UP = POINT + 20 // peeking: the pill hovers above the ring dot, its tail pointing down at it
const PILL_DOWN = geo.sheetOverlap + 10 // open: the pill is fixed just above the sheet edge
const CHANGE_PX = 100 // how far the sheet must open for the callout to finish becoming pin + bottom pill
const PILL_BG = '#FFFFFF'
const DIM_TEXT = '#64748B' // Ink 400: 4.5:1 on white (DESIGN.md). Opacity fading fell to about 3.4:1.
const DOT_STALE_OPACITY = 0.45 // ring dot when the location is not live
const CAMERA_GLIDE_MS = 250 // DESIGN.md motion budget: 150-250 ms

/** The map view spans `extra` px below the hero's bottom edge up to `expanded` above it, and is slid up by half the
 *  height the sheet has opened by. That keeps the pin (which lifts by the same amount) at the visible map's centre
 *  while the coordinate under it never changes. So the pin-to-map-centre distance is a constant, computed here. */
function pinBelowCentre(expanded: number, extra: number) {
  return (expanded - extra) / 2 - POINT
}

function regionFor(c: LatLng, width: number, expanded: number, extra: number) {
  const imgH = expanded + extra
  return {
    latitude: c.lat + pinBelowCentre(expanded, extra) * PER_PX,
    longitude: c.lng,
    latitudeDelta: imgH * PER_PX,
    longitudeDelta: PER_PX * width,
  }
}

// Soft breathing halo under the ring dot: scale .82 -> 1.3, opacity .5 -> 1, 4.2s ease-in-out.
// Mounted only while the fix is live, so unmounting is what stops the loop; under reduce-motion it holds still.
function Pulse() {
  const t = useSharedValue(0)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    if (reduceMotion) {
      t.set(0.5)
      return
    }
    t.set(withRepeat(withSequence(withTiming(1, { duration: 2100, easing: ease.inOut }), withTiming(0, { duration: 2100, easing: ease.inOut })), -1))
  }, [t, reduceMotion])
  const style = useAnimatedStyle(() => ({ opacity: 0.5 + 0.5 * t.get(), transform: [{ scale: 0.82 + 0.48 * t.get() }] }))
  return (
    <Animated.View style={[styles.pulse, style]} pointerEvents="none">
      <Svg width={28} height={28}>
        <Defs>
          <RadialGradient id="pulseGrad" cx={14} cy={14} r={19.8} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor={h.teal} stopOpacity={0.5} />
            <Stop offset={0.55} stopColor={h.teal} stopOpacity={0.16} />
            <Stop offset={1} stopColor={h.teal} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={14} cy={14} r={14} fill="url(#pulseGrad)" />
      </Svg>
    </Animated.View>
  )
}

// Curve of the pill's notch: a soft triangle with a rounded tip, 22 wide x 9 tall.
const NOTCH = 'M0.5 0 C4.2 0 7 4.6 8.9 7.4 Q11 10 13.1 7.4 C15 4.6 17.8 0 21.5 0'

// The address pill: brand dot, then the street in bold and the rest of the address softer. With `notch` it points
// down at the ring dot: the same white as the pill, stroked only along its two slanted sides so it grows out of the
// pill instead of sitting on it as a separate shape.
function AddressPill({
  text,
  muted,
  notch,
  tappable,
  onPress,
  label,
  hidden,
}: {
  text: string
  muted: boolean
  notch?: boolean
  tappable?: boolean
  onPress?: () => void
  label?: string
  /** The duplicate pill (peeking vs open sheet) is hidden from screen readers so each state is spoken once. */
  hidden?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const i = text.indexOf(',')
  const lead = i < 0 ? text : text.slice(0, i + 1)
  const rest = i < 0 ? '' : text.slice(i + 1)
  const body = (
    <View>
      {/* text crossfades 150 ms on any change (DESIGN.md motion budget); keyed so each new string fades in */}
      <View style={styles.pill}>
        <View style={styles.dot} />
        <Animated.View key={text} {...(reduceMotion ? {} : { entering: FadeIn.duration(150) })} style={styles.textWrap}>
          <Text style={[styles.text, muted ? styles.muted : null]} numberOfLines={1}>
            <Text style={[styles.lead, muted ? styles.muted : null]}>{lead}</Text>
            <Text style={[styles.rest, muted ? styles.muted : null]}>{rest}</Text>
          </Text>
        </Animated.View>
      </View>
      {notch ? (
        <Svg width={22} height={10} viewBox="0 0 22 10" style={styles.notch}>
          <Path d={`${NOTCH} Z`} fill={PILL_BG} />
          <Path d={NOTCH} fill="none" stroke={h.line10} strokeWidth={1} strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  )
  const hiddenProps = hidden ? ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as const) : null
  if (tappable && onPress) {
    // the pill is 42 dp tall: 1 dp of slop each side gives the 44 dp minimum touch target
    return (
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 1, bottom: 1, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={label ?? text}
        {...hiddenProps}
      >
        {body}
      </Pressable>
    )
  }
  return (
    <View accessible={!hidden} accessibilityRole="text" accessibilityLabel={label ?? text} {...hiddenProps}>
      {body}
    </View>
  )
}

// The rider's blue dot + heading beam. Owns the GPS/compass subscriptions so heading ticks re-render only this marker.
const UserMarker = memo(function UserMarker({ enabled }: { enabled: boolean }) {
  const live = useLiveLocation(enabled)
  const at = live.coords // live GPS only: a saved fix would draw a real-looking blue dot and beam at a stale spot
  const has = at !== null
  const [track, setTrack] = useState(true)
  // the marker bitmap only needs re-rendering when it first appears
  useEffect(() => {
    if (!has) return
    setTrack(true)
    const t = setTimeout(() => setTrack(false), 700)
    return () => clearTimeout(t)
  }, [has])
  if (!at) return null
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={live.heading}
      tracksViewChanges={track}
      zIndex={1}
      tappable={false}
    >
      <UserDot />
    </Marker>
  )
})

export function MapHero({
  height,
  expanded,
  address,
  resolving,
  pickup,
  user,
  freshness,
  locationEnabled,
  onPillPress,
  onPickupMove,
}: {
  height: SharedValue<number>
  /** Hero height (dp) when the sheet is dragged fully open. */
  expanded: number
  /** Street address to show: the chosen pickup's, else the saved/live location's ('' when unknown). */
  address: string
  /** True while a new pickup address is being looked up. */
  resolving: boolean
  /** The chosen pickup, or null to sit on the rider's own location. */
  pickup: LatLng | null
  /** The rider's saved/last fix: only seeds the map; the blue dot needs a live fix. */
  user: LatLng | null
  /** One state for pill text, ring dot and pulse (see freshnessOf); ignored while the rider has chosen a pickup. */
  freshness: Freshness
  locationEnabled: boolean
  /** The pill is tappable in the timeout/denied states: open the pickup picker. */
  onPillPress: () => void
  /** The rider moved the map: this is the new coordinate under the pin. */
  onPickupMove: (c: LatLng) => void
}) {
  const { width } = useWindowDimensions()
  const mapRef = useRef<MapView>(null)
  const extra = Math.round((expanded - geo.peek) / 2)
  const imgH = expanded + extra
  const mapBox = { height: imgH, bottom: -extra }
  const start = pickup ?? user ?? DEFAULT_CENTER
  const initialRegion = useRef(regionFor(start, width, expanded, extra)).current

  // The coordinate currently under the pin, so our own animateToRegion landings aren't mistaken for rider drags.
  const pinAt = useRef<LatLng>(start)
  const dragged = useRef(false)

  const goTo = useCallback(
    (c: LatLng, animated = true) => {
      pinAt.current = c
      const r = regionFor(c, width, expanded, extra)
      if (animated) mapRef.current?.animateToRegion(r, CAMERA_GLIDE_MS)
      else mapRef.current?.setCamera({ center: { latitude: r.latitude, longitude: r.longitude } })
    },
    [width, expanded, extra]
  )

  // Where the pin belongs: the chosen pickup, else the rider's own location until they touch the map. The map can
  // mount before the GPS fix arrives (it would then sit on the default centre while the pill already names the
  // rider's street), and a camera move sent before the native map is ready is dropped, so the target is remembered
  // and applied both when it changes and once the map reports ready.
  const mapReady = useRef(false)
  const wanted = useRef<LatLng | null>(null)
  const far = (c: LatLng) => Math.abs(c.lat - pinAt.current.lat) > SAME_SPOT || Math.abs(c.lng - pinAt.current.lng) > SAME_SPOT
  useEffect(() => {
    const target = pickup ?? (dragged.current ? null : user)
    if (!target) return
    wanted.current = target
    // A chosen pickup always glides; following the rider's fix glides under 1 km and snaps beyond (a long glide
    // across a city looks broken).
    const glide = pickup !== null || cameraMode(haversineMetres([pinAt.current.lat, pinAt.current.lng], [target.lat, target.lng])) === 'glide'
    if (mapReady.current && far(target)) goTo(target, glide)
  }, [pickup?.lat, pickup?.lng, user?.lat, user?.lng]) // eslint-disable-line react-hooks/exhaustive-deps -- goTo/far are stable per layout
  const onMapReady = useCallback(() => {
    mapReady.current = true
    if (wanted.current && far(wanted.current)) goTo(wanted.current, false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lift = useSharedValue(0)
  // Only a real finger pan counts as moving the pickup: the map also reports a "settled" region on mount and after our
  // own animateToRegion, and those must not silently rewrite the rider's pickup.
  const panning = useRef(false)
  const onPanDrag = useCallback(() => {
    panning.current = true
    if (lift.get() === 0) lift.set(withSpring(-9, { damping: 18, stiffness: 320 }))
  }, [lift])
  const onRegionChangeComplete = useCallback(
    (r: Region) => {
      lift.set(withSpring(0, { damping: 18, stiffness: 320 }))
      if (!panning.current) return
      panning.current = false
      const c = { lat: r.latitude - pinBelowCentre(expanded, extra) * (r.latitudeDelta / imgH), lng: r.longitude }
      if (Math.abs(c.lat - pinAt.current.lat) < SAME_SPOT && Math.abs(c.lng - pinAt.current.lng) < SAME_SPOT) return
      dragged.current = true
      pinAt.current = c
      onPickupMove(c)
    },
    [expanded, extra, imgH, lift, onPickupMove]
  )

  // Recenter: glide back to the rider's own fix and make it the pickup again (the pill re-resolves the address).
  const recenter = useCallback(() => {
    if (!user) return
    dragged.current = false
    goTo(user)
    onPickupMove(user)
  }, [user, goTo, onPickupMove])
  const box = useAnimatedStyle(() => ({ height: height.get() }))
  // slide the map up by half the height gained; the pin lifts by the same amount
  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, height.get() - geo.peek) / 2 }] }))
  // 0 = peeking (ring dot + pill above it), 1 = open (pin + pill fixed above the sheet); crossfaded as the sheet moves
  const m = useDerivedValue(() => Math.min(1, Math.max(0, (height.get() - geo.peek) / CHANGE_PX)))
  const callout = useAnimatedStyle(() => ({
    opacity: interpolate(m.get(), [0, 0.5], [1, 0], 'clamp'),
    transform: [{ translateY: -Math.max(0, height.get() - geo.peek) / 2 }],
  }))
  const pin = useAnimatedStyle(() => ({
    opacity: interpolate(m.get(), [0.25, 0.9], [0, 1], 'clamp'),
    transform: [{ translateY: -Math.max(0, height.get() - geo.peek) / 2 + lift.get() }, { scale: interpolate(m.get(), [0.25, 0.9], [0.7, 1], 'clamp') }],
  }))
  const fixedPill = useAnimatedStyle(() => ({ opacity: interpolate(m.get(), [0.4, 1], [0, 1], 'clamp') }))
  // Only offered once the sheet is dragged open and the map has room: fades in with the drag, above the fixed pill.
  const recenterStyle = useAnimatedStyle(() => ({ opacity: interpolate(m.get(), [0.6, 1], [0, 1], 'clamp') }))

  // Only the visible pill may take touches: the peeking callout and the open-sheet pill share screen space with the map.
  const [sheetOpen, setSheetOpen] = useState(false)
  useAnimatedReaction(
    () => m.get() > 0.5,
    (open, prev) => {
      if (open !== prev) runOnJS(setSheetOpen)(open)
    }
  )

  // What the pill says and how the ring dot looks. A pickup the rider chose (dragged the map or picked a place) is
  // their own point: shown as-is, never "searching".
  const pill = pickup ? { text: address, tappable: false, muted: resolving } : pillTextFor(freshness, address)
  const showLive = pickup !== null || freshness === 'live'
  const label = pickup ? `Pickup: ${address}` : a11yLabelFor(freshness, address)
  const dotOpacity = useSharedValue(showLive ? 1 : DOT_STALE_OPACITY)
  useEffect(() => {
    dotOpacity.set(withTiming(showLive ? 1 : DOT_STALE_OPACITY, { duration: 200, easing: ease.rowIn }))
  }, [showLive, dotOpacity])
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.get() }))

  // One announcement per change of what the pill says (not per 150 m tick, and not once per duplicate pill).
  const announced = useRef(label)
  useEffect(() => {
    if (announced.current === label) return
    announced.current = label
    AccessibilityInfo.announceForAccessibility(label)
  }, [label])

  return (
    <Animated.View style={[styles.hero, box]}>
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient colors={['#EAF6F6', '#E1F1F1', '#D8ECEC']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.map, mapBox, rise]}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            moveOnMarkerPress={false}
            {...OCAR_MAP_PROPS}
            onMapReady={onMapReady}
            onPanDrag={onPanDrag}
            onRegionChangeComplete={onRegionChangeComplete}
          >
            <UserMarker enabled={locationEnabled} />
          </MapView>
        </Animated.View>

        {/* peeking: ring dot on the pickup point, address pill hovering above it with a tail pointing down at the dot */}
        <Animated.View style={[StyleSheet.absoluteFill, callout]} pointerEvents={sheetOpen ? 'none' : 'box-none'}>
          {showLive ? <Pulse /> : null}
          <Animated.View style={[styles.ring, dotStyle]} pointerEvents="none">
            <View style={styles.ringCore} />
          </Animated.View>
          <View style={styles.anchor} pointerEvents="box-none">
            <AddressPill text={pill.text} muted={pill.muted} tappable={pill.tappable} onPress={onPillPress} label={label} notch />
          </View>
        </Animated.View>

        {/* recenter: right corner above the open-sheet pill; hidden while the sheet peeks */}
        {locationEnabled && user ? (
          <Animated.View style={[styles.recenter, recenterStyle]} pointerEvents={sheetOpen ? 'box-none' : 'none'}>
            <Pressable onPress={recenter} accessibilityRole="button" accessibilityLabel="Go to my current location" style={styles.recenterBtn} hitSlop={2}>
              <Svg width={22} height={22} viewBox="0 0 22 22">
                <Circle cx={11} cy={11} r={7.5} fill="none" stroke={h.teal} strokeWidth={1.8} />
                <Circle cx={11} cy={11} r={3.5} fill={h.teal} />
                <Path d="M11 0.5V3.5M11 18.5V21.5M0.5 11H3.5M18.5 11H21.5" stroke={h.teal} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* open: the dot has become a pin fixed to the screen while the map moves under it; the pill drops to the sheet's edge */}
        <Animated.View style={[styles.pin, pin]} pointerEvents="none">
          <View style={styles.tagWrap}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>Pickup</Text>
            </View>
          </View>
          <PinGlyph variant="pickup" width={26} height={35} />
        </Animated.View>
        <Animated.View style={[styles.fixedPill, fixedPill]} pointerEvents={sheetOpen ? 'box-none' : 'none'}>
          <AddressPill text={pill.text} muted={pill.muted} tappable={pill.tappable} onPress={onPillPress} label={label} hidden />
        </Animated.View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden' },
  map: { position: 'absolute', left: 0, right: 0 },
  // teardrop svg is 26x35 with its tip at the base; sits on the map centre line, tip POINT above the sheet edge
  pin: { position: 'absolute', left: '50%', marginLeft: -13, bottom: POINT - 1, width: 26, height: 35 },
  // small teal capsule floating above the pin head, centred on it
  tagWrap: { position: 'absolute', left: -40, width: 106, bottom: 35 + 6, alignItems: 'center' },
  tag: { height: 22, paddingHorizontal: 10, borderRadius: 11, backgroundColor: h.teal, justifyContent: 'center', boxShadow: '0 4px 10px rgba(10,60,66,0.28)' },
  tagText: { fontFamily: font.b, fontSize: 12, color: '#FFFFFF' }, // sentence case, 12 px: no all-caps tracked labels (DESIGN.md)
  fixedPill: { position: 'absolute', left: 16, right: 16, bottom: PILL_DOWN },
  recenter: { position: 'absolute', right: 16, bottom: PILL_DOWN + PILL_H + 12 },
  recenterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PILL_BG,
    borderWidth: 1,
    borderColor: h.line10,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 12px 28px rgba(20,23,26,0.14), 0 3px 8px rgba(20,23,26,0.07)', // same lift as the pill
  },
  anchor: { position: 'absolute', left: 16, right: 16, bottom: PILL_UP },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    borderWidth: 1,
    borderColor: h.line10,
    backgroundColor: PILL_BG,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingLeft: 16,
    paddingRight: 18,
    // deep, soft neutral lift (the app's shadow.lg family) instead of a coloured glow
    boxShadow: '0 12px 28px rgba(20,23,26,0.14), 0 3px 8px rgba(20,23,26,0.07)',
  },
  // sits over the pill's bottom border (1px overlap) so the notch and pill read as one shape
  notch: { position: 'absolute', left: '50%', marginLeft: -11, bottom: -9 },
  pulse: { position: 'absolute', left: '50%', marginLeft: -14, bottom: POINT - 14, width: 28, height: 28 },
  // the point itself: a teal ring with a white core
  ring: {
    position: 'absolute',
    left: '50%',
    marginLeft: -9,
    bottom: POINT - 9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: h.teal,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(10,60,66,0.28)',
  },
  ringCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.teal, boxShadow: `0 0 0 4px ${h.tealSoft}` },
  textWrap: { flex: 1 },
  text: { fontFamily: font.m, fontSize: 14, letterSpacing: -0.1 },
  lead: { fontFamily: font.b, color: h.ivory },
  rest: { color: h.ivoryDim },
  muted: { color: DIM_TEXT },
})
