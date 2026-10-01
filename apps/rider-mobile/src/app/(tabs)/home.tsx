import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  scrollTo,
  useAnimatedProps,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRideHistory } from '@/features/ride-history/hooks/useRideHistory'
import { fetchReverseGeocode } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'
import { useFreshness, useLocationStore } from '@/store/useLocationStore'
import type { RideType } from '@/features/booking/api'
import { ease, geo, h } from '@/theme/homeTokens'
import { MapHero } from '@/features/home/MapHero'
import { SearchBar } from '@/features/home/SearchBar'
import { useNavBottom } from '@/features/home/FloatingTabBar'
import { useFleet } from '@/features/home/fleet'
import {
  EliteBanner,
  FleetPreview,
  PromoRow,
  RecentsCard,
  Reveal,
  RevealContext,
  Toast,
  TripTypeCard,
  WaysRow,
  type Promo,
  type RecentItem,
  type Way,
} from '@/features/home/sections'
import airportImg from '../../../assets/home/way-airport.jpg'
import safetyImg from '../../../assets/home/way-safety.jpg'
import tripImg from '../../../assets/home/way-trip.jpg'
import firstRideImg from '../../../assets/home/promo-first-ride.jpg'
import businessImg from '../../../assets/home/promo-business.jpg'

// Sheet layout above the search bar: padding-top 14 + handle hit area (28 - 12 + 2).
const SEARCH_OFFSET = 14 + (28 - 12 + 2)
// Settle spring: carries the finger's release velocity, no overshoot (the map image ends at the expanded height).
const settle = (velocity: number) => {
  'worklet'
  return { damping: 30, stiffness: 320, mass: 1, overshootClamping: true, velocity }
}
const FLICK = 600 // px/s: a flick this fast picks the state in its direction regardless of position
const FAST_SCROLL = 1.2 // list release velocity toward the top above which a fling counts as "hard" and opens the map (a soft flick reads ~0.3, a hard one ~2)
// RN reports scroll-release velocity with opposite signs: on Android a finger moving down (list heading to the top) is positive
const VELOCITY_TO_TOP = Platform.OS === 'android' ? 1 : -1
const SNAP_PULL = 36 // px past the search-bar stop toward the map that counts as asking for the map strip
const EXPANDED_SHARE = 0.42 // map share of the screen when dragged open (peek stays geo.peek); Rapido settles at ~44%

// Google sometimes leads a reverse-geocoded address with an Open Location Code ("6RQM+P33, Lingaraj Nagar, ...")
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3},?\s*/i

// "Kalinga Stadium, Sector 19, CDA, Cuttack" -> title / sub
function splitAddress(a: string): { title: string; sub: string } {
  const i = a.indexOf(',')
  return i < 0 ? { title: a, sub: a } : { title: a.slice(0, i).trim(), sub: a.slice(i + 1).trim() }
}

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: winH } = useWindowDimensions()
  const expanded = Math.round(winH * EXPANDED_SHARE)
  const navBottom = useNavBottom()
  const { rides, loading } = useRideHistory()
  const fleet = useFleet()
  const address = useLocationStore((s) => s.address)
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const locationEnabled = useLocationStore((s) => s.permission === 'granted')
  const freshness = useFreshness()
  const setRideType = useBookingDraftStore((s) => s.setRideType)
  const pickup = useBookingDraftStore((s) => s.pickup)
  const setPickup = useBookingDraftStore((s) => s.setPickup)

  // Pickup is whatever the rider parks the pin on: resolve its address (debounced, latest drag wins) into the draft,
  // which the booking screen already reads.
  const [resolving, setResolving] = useState(false)
  const geoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const geoSeq = useRef(0)
  useEffect(() => () => clearTimeout(geoTimer.current), [])
  const onPickupMove = useCallback(
    (c: { lat: number; lng: number }) => {
      const seq = ++geoSeq.current
      setResolving(true)
      clearTimeout(geoTimer.current)
      geoTimer.current = setTimeout(() => {
        fetchReverseGeocode(c.lat, c.lng)
          .then((d) => d.address.replace(PLUS_CODE, '') || d.address)
          .catch(() => 'Selected location')
          .then((addr) => {
            if (seq !== geoSeq.current) return
            setPickup({ address: addr, lat: c.lat, lng: c.lng })
            setResolving(false)
          })
      }, 350)
    },
    [setPickup]
  )

  function toBooking(rideType: RideType, declared = true) {
    setRideType(rideType, declared)
    router.push('/booking')
  }
  // Search bar / recents / vehicle taps declare no ride type; /booking classifies the route itself.
  const toBookingAuto = () => toBooking('one_way', false)

  // ---------- map sheet: peek -> half -> full, dragged from anywhere on the sheet ----------
  // The map is the first thing in the scroll content, so scrolling up carries it away 1:1 (closing it) and the sticky
  // search bar takes over. At the top of the list, pulling down opens the map in steps (peek, half, full); a hard pull
  // goes straight to full. Pushing up shrinks it back to the peek strip *before* the list scrolls, so the whole sheet
  // feels like one surface. While the map is open the list is locked, so the two never fight over the same swipe.
  const mapH = useSharedValue<number>(geo.peek)
  const scrollY = useSharedValue(0)
  const viewH = useSharedValue(0)
  const half = Math.round((geo.peek + expanded) / 2)

  const settleTo = (target: number, velocity: number) => {
    'worklet'
    mapH.set(withSpring(target, settle(velocity)))
  }

  // Scrolling back toward the top comes to rest in stages instead of coasting straight to the map:
  //   soft  -> stops with the search bar pinned under the status bar and the whole list below it (offset `parkAt`)
  //   a bit more -> the map strip above it (offset 0)
  //   hard fling -> keeps going to the top and opens the half map when it lands
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const parkAt = geo.peek - geo.sheetOverlap + SEARCH_OFFSET + 2 // the offset at which the sticky search bar takes over
  const soft = useSharedValue(false) // released while moving toward the top: park at the search bar
  const hard = useSharedValue(false) // released with a hard fling toward the top: open the map on landing
  const parked = useSharedValue(false)

  const snapNear = (y: number) => {
    'worklet'
    // resting between the map strip and the search-bar stop: go to whichever the finger asked for
    if (y > 0 && y < parkAt) scrollTo(scrollRef, 0, y < parkAt - SNAP_PULL ? 0 : parkAt, true)
  }

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y
      scrollY.set(y)
      // momentum reached the search-bar stop: replace it with a short animation that ends exactly there
      if (soft.get() && !parked.get() && y <= parkAt) {
        parked.set(true)
        scrollTo(scrollRef, 0, parkAt, true)
      }
      if (hard.get() && y <= 1) {
        hard.set(false)
        settleTo(half, 0)
      }
    },
    onBeginDrag: () => {
      soft.set(false)
      hard.set(false)
      parked.set(false)
    },
    onEndDrag: (e) => {
      const toTop = VELOCITY_TO_TOP * (e.velocity?.y ?? 0) // > 0: still moving toward the top
      if (toTop > FAST_SCROLL) {
        // already at the top when the finger lifted: open now; otherwise open when the momentum lands there
        if (scrollY.get() <= 1) settleTo(half, 0)
        else hard.set(true)
      }
      else if (toTop > 0.05) soft.set(scrollY.get() > parkAt)
      else snapNear(scrollY.get())
    },
    onMomentumEnd: () => {
      soft.set(false)
      snapNear(scrollY.get())
    },
  })
  const listProps = useAnimatedProps(() => ({ scrollEnabled: mapH.get() <= geo.peek + 1 }))

  const listGesture = Gesture.Native()
  const lastY = useSharedValue(0)
  const moved = useSharedValue(false)
  const pan = Gesture.Pan()
    .simultaneousWithExternalGesture(listGesture)
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      moved.set(false)
      lastY.set(0)
      mapH.set(mapH.get()) // stop any in-flight settle
    })
    .onUpdate((e) => {
      const d = e.translationY - lastY.get()
      lastY.set(e.translationY)
      const cur = mapH.get()
      if (d > 0 && scrollY.get() <= 1 && cur < expanded) {
        mapH.set(Math.min(expanded, cur + d))
        moved.set(true)
      } else if (d < 0 && cur > geo.peek) {
        mapH.set(Math.max(geo.peek, cur + d))
        moved.set(true)
      }
    })
    .onFinalize((e) => {
      if (!moved.get()) return
      const cur = mapH.get()
      let target: number = geo.peek
      if (e.velocityY > FLICK) target = expanded
      else if (e.velocityY < -FLICK) target = geo.peek
      else {
        // nearest of the three stops
        let best = Math.abs(cur - geo.peek)
        if (Math.abs(cur - half) < best) {
          best = Math.abs(cur - half)
          target = half
        }
        if (Math.abs(cur - expanded) < best) target = expanded
      }
      settleTo(target, e.velocityY)
    })
  // a tap on the handle toggles closed <-> full
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      settleTo(mapH.get() > geo.peek + 10 ? geo.peek : expanded, 0)
    })

  // ---------- sticky search bar (no position:sticky in RN, driven off scroll offset) ----------
  const sheetTop = useDerivedValue(() => insets.top + mapH.get() - geo.sheetOverlap)
  const stuck = useDerivedValue(() => (sheetTop.get() + SEARCH_OFFSET - scrollY.get() <= insets.top ? 1 : 0))
  const flowBar = useAnimatedStyle(() => ({ opacity: stuck.get() ? 0 : 1 }))
  const pinnedBar = useAnimatedStyle(() => ({ opacity: stuck.get() }))
  const pinnedProps = useAnimatedProps(() => ({ pointerEvents: stuck.get() ? ('auto' as const) : ('none' as const) }))
  const topFade = useAnimatedStyle(() => ({ opacity: withTiming(stuck.get(), { duration: 150, easing: ease.css }) }))

  const recents: RecentItem[] = useMemo(() => {
    if (loading) return []
    const seen = new Set<string>()
    const out: RecentItem[] = []
    for (const r of rides) {
      const a = r.status === 'completed' ? r.destinationAddress : null
      if (!a || seen.has(a)) continue
      seen.add(a)
      const { title, sub } = splitAddress(a)
      out.push({ key: r.id, title, sub, onPress: toBookingAuto })
      if (out.length === 2) break
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toBookingAuto only closes over stable store/router refs
  }, [rides, loading])

  const ways: Way[] = [
    { key: 'air', kind: 'air', title: 'Airport Transfers', sub: 'Flight tracked, meet & greet', image: airportImg, bg: '#17130F', onPress: toBookingAuto },
    { key: 'safety', kind: 'safety', title: 'Trip Safety, Always On', sub: 'Live-tracked, every ride', image: safetyImg, bg: '#0A252B', onPress: () => router.push('/info/safety') },
    { key: 'trip', kind: 'trip', title: 'Puri – Konark Day Trip', sub: 'The Golden Triangle, one chauffeur', image: tripImg, bg: '#22130C', onPress: () => router.push('/info/golden-triangle') },
  ]
  const promos: Promo[] = [
    { key: 'first', eyebrow: 'Limited-time', title: '20% off your first ride', sub: 'On Sedan, SUV & Luxury bookings', image: firstRideImg, bg: '#10161C', onPress: toBookingAuto },
    { key: 'biz', eyebrow: 'Ocar for Business', title: 'Corporate travel, elevated', sub: 'Dedicated billing & priority chauffeurs', image: businessImg, bg: '#1C1510' },
  ]

  // Elite banner -> toast, auto-dismiss after 3.2s
  const [toast, setToast] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const showToast = () => {
    setToast(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(false), 3200)
  }
  const hideToast = () => {
    clearTimeout(toastTimer.current)
    setToast(false)
  }

  return (
    <View style={styles.screen}>
      <RevealContext.Provider value={{ scrollY, sheetTop, viewH }}>
        <GestureDetector gesture={pan}>
          <View style={styles.scrollHost}>
            <GestureDetector gesture={listGesture}>
        <Animated.ScrollView
          ref={scrollRef}
          animatedProps={listProps}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          onLayout={(e) => viewH.set(e.nativeEvent.layout.height)}
        >
          <View style={{ height: insets.top }} />
          <MapHero
            height={mapH}
            expanded={expanded}
            address={pickup?.address || address}
            resolving={resolving}
            pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
            user={lat !== null && lng !== null ? { lat, lng } : null}
            freshness={freshness}
            locationEnabled={locationEnabled}
            onPillPress={() => router.push({ pathname: '/booking/map-picker', params: { field: 'pickup' } })}
            onPickupMove={onPickupMove}
          />

          <View style={[styles.sheet, { paddingBottom: geo.scrollClearance + (navBottom - geo.navBottom) }]}>
            <LinearGradient colors={['rgba(20,23,26,0)', 'rgba(20,23,26,0.05)']} style={styles.edge} pointerEvents="none" />
            <GestureDetector gesture={tap}>
              <View style={styles.handleHit}>
                <View style={styles.handle} />
              </View>
            </GestureDetector>

            <Animated.View style={[styles.searchSlot, flowBar]}>
              <SearchBar onPress={toBookingAuto} onLater={toBookingAuto} />
            </Animated.View>

            {recents.length > 0 ? <RecentsCard items={recents} /> : null}
            <TripTypeCard onPick={toBooking} style={recents.length > 0 ? undefined : styles.noTop} />
            <FleetPreview items={fleet} onViewAll={() => router.navigate('/fleet')} onPick={toBookingAuto} />
            <Reveal>
              <WaysRow ways={ways} />
            </Reveal>
            <Reveal>
              <PromoRow promos={promos} />
            </Reveal>
            <Reveal>
              <EliteBanner onPress={showToast} />
            </Reveal>
          </View>
        </Animated.ScrollView>
            </GestureDetector>
          </View>
        </GestureDetector>

        {/* .top-fade, pinned search copy (.sb-sticky), status cover (.status-bar) */}
        <Animated.View style={[styles.topFade, { top: insets.top }, topFade]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(246,251,251,1)', 'rgba(246,251,251,1)', 'rgba(246,251,251,0.55)', 'rgba(246,251,251,0.15)', 'rgba(246,251,251,0)']}
            locations={[0, 58 / 66, 62 / 66, 65 / 66, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View style={[styles.pinned, { top: insets.top }, pinnedBar]} animatedProps={pinnedProps}>
          <SearchBar stuck onPress={toBookingAuto} onLater={toBookingAuto} />
        </Animated.View>
        <View style={[styles.statusCover, { height: insets.top }]} pointerEvents="none" />
        <Toast visible={toast} bottom={navBottom + 72} onClose={hideToast} />
      </RevealContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  scrollHost: { flex: 1 },
  // overlaps the map's bottom edge by sheetOverlap so the rounded corners sit over it
  sheet: {
    backgroundColor: h.canvas,
    marginTop: -geo.sheetOverlap,
    paddingTop: 14,
    paddingHorizontal: geo.gutter,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  // '0 -10px 22px rgba(20,23,26,.07)' on a tall sheet re-rasterises the blur on every frame it moves; a thin
  // gradient above the edge gives the same lift at a fraction of the cost.
  edge: { position: 'absolute', top: -24, left: 0, right: 0, height: 24 },
  // 56x28 touch target centred on the 36x4 bar. Deliberately small: a full-width strip here grabbed ordinary
  // downward scroll swipes and expanded the map. Negative margins keep the layout at 4px bar + 14px gap (Android
  // drops touches outside a parent's bounds, so the target has to be the layout box itself, not an overflowing child).
  handleHit: { width: 56, height: 28, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: -12, marginBottom: 2 },
  handle: { width: 36, height: 4, borderRadius: 999, backgroundColor: 'rgba(20,23,26,0.16)' },
  searchSlot: { marginBottom: 18 },
  noTop: { marginTop: 0 },
  topFade: { position: 'absolute', left: 0, right: 0, height: 66, zIndex: 2 },
  pinned: { position: 'absolute', left: geo.gutter, right: geo.gutter, zIndex: 4 },
  statusCover: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: h.canvas, zIndex: 5 },
})
