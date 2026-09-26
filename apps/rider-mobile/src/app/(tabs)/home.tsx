import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedProps, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRideHistory } from '@/features/ride-history/hooks/useRideHistory'
import { useBookingDraftStore } from '@/features/booking/store'
import { useLocationStore } from '@/store/useLocationStore'
import type { RideType } from '@/features/booking/api'
import { drag, ease, geo, h } from '@/theme/homeTokens'
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

// Sheet layout above the search bar: padding-top 14 + handle 4 + handle margin 14.
const SEARCH_OFFSET = 14 + 4 + 14
const SHEET_TIMING = { duration: 360, easing: ease.sheet }
const MAP_FADE = { duration: 300, easing: ease.css }
const PEEK = 0
const EXPANDED = 1
const COLLAPSED = 2

// "Kalinga Stadium, Sector 19, CDA, Cuttack" -> title / sub
function splitAddress(a: string): { title: string; sub: string } {
  const i = a.indexOf(',')
  return i < 0 ? { title: a, sub: a } : { title: a.slice(0, i).trim(), sub: a.slice(i + 1).trim() }
}

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const navBottom = useNavBottom()
  const { rides, loading } = useRideHistory()
  const fleet = useFleet()
  const address = useLocationStore((s) => s.address)
  const lat = useLocationStore((s) => s.lat)
  const lng = useLocationStore((s) => s.lng)
  const setRideType = useBookingDraftStore((s) => s.setRideType)

  function toBooking(rideType: RideType, declared = true) {
    setRideType(rideType, declared)
    router.push('/booking')
  }
  // Search bar / recents / vehicle taps declare no ride type; /booking classifies the route itself.
  const toBookingAuto = () => toBooking('one_way', false)

  // ---------- map sheet: peek 120 <-> expanded 236, collapsed 0 while scrolled ----------
  const mapH = useSharedValue<number>(geo.peek)
  const overlap = useSharedValue<number>(-geo.sheetOverlap) // .collapsible margin-top
  const mapFade = useSharedValue(1)
  const mapState = useSharedValue<number>(PEEK)
  const openTarget = useSharedValue<number>(PEEK) // last user-chosen state, restored after scroll-collapse
  const scrollY = useSharedValue(0)
  const viewH = useSharedValue(0)

  const applyState = (next: number) => {
    'worklet'
    mapState.set(next)
    mapH.set(withTiming(next === PEEK ? geo.peek : next === EXPANDED ? geo.expanded : 0, SHEET_TIMING))
    overlap.set(withTiming(next === COLLAPSED ? 0 : -geo.sheetOverlap, SHEET_TIMING))
    mapFade.set(withTiming(next === COLLAPSED ? 0 : 1, MAP_FADE))
  }

  // Scroll collapse: once the list moves the map tucks away; back at the top it restores.
  const onScroll = useAnimatedScrollHandler((e) => {
    const y = e.contentOffset.y
    scrollY.set(y)
    if (y > drag.collapseAt && mapState.get() !== COLLAPSED) applyState(COLLAPSED)
    else if (y <= drag.restoreAt && mapState.get() === COLLAPSED) applyState(openTarget.get())
  })

  // Handle drag (1:1 with the finger, clamped) / tap (< 250ms and < 6px) toggle.
  const dragging = useSharedValue(false)
  const startH = useSharedValue(0)
  const t0 = useSharedValue(0)
  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .onBegin(() => {
      if (scrollY.get() > drag.scrollGate || mapState.get() === COLLAPSED) {
        dragging.set(false)
        return
      }
      dragging.set(true)
      startH.set(mapH.get())
      t0.set(Date.now())
      mapH.set(mapH.get()) // stop any in-flight settle
    })
    .onUpdate((e) => {
      if (!dragging.get()) return
      mapH.set(Math.min(geo.expanded, Math.max(geo.minDrag, startH.get() + e.translationY)))
    })
    .onFinalize((e) => {
      if (!dragging.get()) return
      dragging.set(false)
      if (Date.now() - t0.get() < drag.tapMs && Math.abs(e.translationY) < drag.tapPx) {
        openTarget.set(mapState.get() === EXPANDED ? PEEK : EXPANDED)
      } else {
        openTarget.set(mapH.get() > (geo.peek + geo.expanded) / 2 ? EXPANDED : PEEK)
      }
      applyState(openTarget.get())
    })

  // ---------- sticky search bar (no position:sticky in RN, driven off scroll offset) ----------
  const sheetTop = useDerivedValue(() => insets.top + mapH.get() + overlap.get())
  const stuck = useDerivedValue(() => (sheetTop.get() + SEARCH_OFFSET - scrollY.get() <= insets.top ? 1 : 0))
  const flowBar = useAnimatedStyle(() => ({ opacity: stuck.get() ? 0 : 1 }))
  const pinnedBar = useAnimatedStyle(() => ({ opacity: stuck.get() }))
  const pinnedProps = useAnimatedProps(() => ({ pointerEvents: stuck.get() ? ('auto' as const) : ('none' as const) }))
  const topFade = useAnimatedStyle(() => ({ opacity: withTiming(stuck.get(), { duration: 150, easing: ease.css }) }))
  const sheetMargin = useAnimatedStyle(() => ({ marginTop: overlap.get() }))

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
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => viewH.set(e.nativeEvent.layout.height)}
        >
          <View style={{ height: insets.top }} />
          <MapHero height={mapH} fade={mapFade} address={address || 'Current location'} coords={lat !== null && lng !== null ? { lat, lng } : null} onLocate={() => useLocationStore.getState().init()} />

          <Animated.View style={[styles.sheet, { paddingBottom: geo.scrollClearance + (navBottom - geo.navBottom) }, sheetMargin]}>
            <LinearGradient colors={['rgba(20,23,26,0)', 'rgba(20,23,26,0.05)']} style={styles.edge} pointerEvents="none" />
            <GestureDetector gesture={pan}>
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
          </Animated.View>
        </Animated.ScrollView>

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
  sheet: {
    backgroundColor: h.canvas,
    paddingTop: 14,
    paddingHorizontal: geo.gutter,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  // '0 -10px 22px rgba(20,23,26,.07)' on a ~2000dp-tall sheet re-rasterised the blur on every layout frame
  // of the collapse animation; a thin gradient above the edge gives the same lift at a fraction of the cost.
  edge: { position: 'absolute', top: -24, left: 0, right: 0, height: 24 },
  // The reference's 56x28 touch target centred on the 36x4 bar; negative margins keep the
  // layout at 4px bar + 14px gap (Android drops touches outside a parent's bounds, so the
  // target has to be the layout box itself, not an overflowing child).
  handleHit: { width: 56, height: 28, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: -12, marginBottom: 2 },
  handle: { width: 36, height: 4, borderRadius: 999, backgroundColor: 'rgba(20,23,26,0.16)' },
  searchSlot: { marginBottom: 18 },
  noTop: { marginTop: 0 },
  topFade: { position: 'absolute', left: 0, right: 0, height: 66, zIndex: 2 },
  pinned: { position: 'absolute', left: geo.gutter, right: geo.gutter, zIndex: 4 },
  statusCover: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: h.canvas, zIndex: 5 },
})
