import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Image, ScrollView, StyleSheet, View, useWindowDimensions, type ImageSourcePropType, type LayoutChangeEvent } from 'react-native'
import { FONT_CAP, Text } from './Text'
import Animated, {
  type SharedValue,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { VehicleIcon } from '@ocar/mobile-shared'
import { ease, font, geo, h, shadow } from '@/theme/homeTokens'
import { ArrowUpRight, ChevronIcon, ClockIcon, OneWayIcon, PlaneIcon, RentalsIcon, RoundTripIcon, ShieldCheckIcon, StarIcon, TempleIcon, CloseIcon } from './icons'
import { Press } from './Press'
import type { FleetItem } from './fleet'

// ---------- .reveal: fade + rise once when 18% of the block enters the scroll viewport ----------
export type RevealCtx = { scrollY: SharedValue<number>; sheetTop: SharedValue<number>; viewH: SharedValue<number> }
export const RevealContext = createContext<RevealCtx | null>(null)

export function Reveal({ children, style }: { children: ReactNode; style?: object }) {
  const ctx = useContext(RevealContext)!
  const y = useSharedValue(0)
  const hgt = useSharedValue(0)
  const p = useSharedValue(0)
  const done = useSharedValue(false)
  useAnimatedReaction(
    () => {
      if (done.get() || hgt.get() === 0) return false
      const top = ctx.sheetTop.get() + y.get() - ctx.scrollY.get()
      return ctx.viewH.get() - top >= 0.18 * hgt.get() && top + hgt.get() > 0
    },
    (visible) => {
      if (visible && !done.get()) {
        done.set(true)
        p.set(withTiming(1, { duration: 550, easing: ease.rowIn }))
      }
    }
  )
  const anim = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: 14 * (1 - p.get()) }] }))
  const onLayout = (e: LayoutChangeEvent) => {
    y.set(e.nativeEvent.layout.y)
    hgt.set(e.nativeEvent.layout.height)
  }
  return (
    <Animated.View style={[style, anim]} onLayout={onLayout}>
      {children}
    </Animated.View>
  )
}

// ---------- recent destinations card (.card > .row) ----------
export type RecentItem = { key: string; title: string; sub: string; onPress: () => void }

function RowIn({ delay, children }: { delay: number; children: ReactNode }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.set(withDelay(delay, withTiming(1, { duration: 500, easing: ease.rowIn })))
  }, [p, delay])
  const anim = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: 8 * (1 - p.get()) }] }))
  return <Animated.View style={anim}>{children}</Animated.View>
}

function Row({ item, delay }: { item: RecentItem; delay: number }) {
  return (
    <RowIn delay={delay}>
      <Press onPress={item.onPress} label={item.title}>
        {(p) => <RowBody item={item} p={p} />}
      </Press>
    </RowIn>
  )
}

function RowBody({ item, p }: { item: RecentItem; p: SharedValue<number> }) {
  const ring = useSharedValue(1) // 1 = pulse finished (invisible)
  // .row:active .chip .ring -> ringPulse .55s (0% .9 @ .85 -> 100% 0 @ 1.35), fires once per press
  useAnimatedReaction(
    () => p.get() > 0.02,
    (down, was) => {
      if (down && !was) {
        ring.set(0)
        ring.set(withTiming(1, { duration: 550, easing: ease.ring }))
      }
    }
  )
  const tint = useAnimatedStyle(() => ({ opacity: p.get() }))
  const chip = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.06 * p.get() }] }))
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.9 * (1 - ring.get()), transform: [{ scale: 0.85 + 0.5 * ring.get() }] }))
  const text = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.01 * p.get() }] }))
  const chev = useAnimatedStyle(() => ({ opacity: 0.38 + (0.75 - 0.38) * p.get(), transform: [{ translateX: 3 * p.get() }] }))
  return (
    <View style={s.row}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: h.tealFaint }, tint]} />
      <Animated.View style={[s.chip, chip]}>
        <Animated.View style={[s.ring, ringStyle]} />
        <ClockIcon />
      </Animated.View>
      <View style={s.rowText}>
        <Animated.Text maxFontSizeMultiplier={FONT_CAP} style={[s.rowTitle, text]} numberOfLines={1}>
          {item.title}
        </Animated.Text>
        <Animated.Text maxFontSizeMultiplier={FONT_CAP} style={[s.rowSub, text]} numberOfLines={1}>
          {item.sub}
        </Animated.Text>
      </View>
      <Animated.View style={chev}>
        <ChevronIcon />
      </Animated.View>
    </View>
  )
}

export function RecentsCard({ items }: { items: RecentItem[] }) {
  return (
    <View style={s.card}>
      {items.map((it, i) => (
        <View key={it.key}>
          {i > 0 ? <View style={s.divider} /> : null}
          <Row item={it} delay={550 + 150 * i} />
        </View>
      ))}
    </View>
  )
}

// ---------- trip type (.tt-card) ----------
const TRIPS = [
  { type: 'one_way' as const, title: 'One-way', sub: 'Point A to B', Icon: OneWayIcon },
  { type: 'round_trip' as const, title: 'Round trip', sub: 'There, and back', Icon: RoundTripIcon },
  { type: 'rental' as const, title: 'Rentals', sub: 'By the hour', Icon: RentalsIcon },
]

export function TripTypeCard({ onPick, style }: { onPick: (t: 'one_way' | 'round_trip' | 'rental') => void; style?: object | undefined }) {
  return (
    <View style={[s.ttWrap, style]}>
      <Text style={s.ttLabel}>Choose your journey</Text>
      <View style={s.ttCard}>
        {TRIPS.map((t, i) => (
          <Press key={t.type} hit={{ flex: 1 }} style={[s.ttTile, i < 2 && s.ttTileDivider]} onPress={() => onPick(t.type)} label={t.title}>
            {(p) => <TripTile t={t} p={p} />}
          </Press>
        ))}
      </View>
    </View>
  )
}

function TripTile({ t, p }: { t: (typeof TRIPS)[number]; p: SharedValue<number> }) {
  const tint = useAnimatedStyle(() => ({ opacity: p.get() }))
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * p.get() }] }))
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,23,26,0.04)' }, tint]} />
      <Animated.View style={icon}>
        <t.Icon />
      </Animated.View>
      <Text style={s.ttTitle}>{t.title}</Text>
      <Text style={s.ttSub}>{t.sub}</Text>
    </>
  )
}

// ---------- fleet ----------
export function FleetImage({ item, box, w = box }: { item: FleetItem; box: number; w?: number }) {
  return item.image ? (
    <Image source={item.image} style={{ width: w, height: box }} resizeMode="contain" accessibilityIgnoresInvertColors />
  ) : (
    <VehicleIcon slug={item.slug} size={box} style={{ width: w }} />
  )
}

export function FleetPreview({ items, onViewAll, onPick }: { items: FleetItem[]; onViewAll: () => void; onPick: (i: FleetItem) => void }) {
  return (
    <View style={s.fleetWrap}>
      <View style={s.fleetHeader}>
        <Text style={s.ttLabelBare}>Our fleet</Text>
        <Press onPress={onViewAll} scaleTo={0.88} label="View all vehicles" style={s.viewAll}>
          <ChevronIcon size={12} />
        </Press>
      </View>
      <View style={s.fleetRow}>
        {items.slice(0, 4).map((it) => (
          <Press key={it.key} hit={{ flex: 1, minWidth: 0 }} onPress={() => onPick(it)} label={it.name} style={s.fleetTile}>
            {(p) => <FleetTile item={it} p={p} />}
          </Press>
        ))}
      </View>
    </View>
  )
}

function FleetTile({ item, p }: { item: FleetItem; p: SharedValue<number> }) {
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.06 * p.get() }] }))
  return (
    <>
      <Animated.View style={[s.badge, badge]}>
        <FleetImage item={item} box={50} />
      </Animated.View>
      <Text style={s.fleetName}>{item.name}</Text>
    </>
  )
}

// ---------- more ways to ride ----------
export type Way = { key: string; title: string; sub: string; image: ImageSourcePropType; bg: string; kind: 'air' | 'safety' | 'trip'; onPress: () => void }

function LiveDot() {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 2200, easing: ease.css }), -1))
  }, [t])
  // liveDot: 0% (0px, .5) -> 70% (7px, 0) -> 100% (0px, 0)
  const ring = useAnimatedStyle(() => {
    const k = Math.min(t.get() / 0.7, 1)
    return { opacity: 0.5 * (1 - k), transform: [{ scale: 1 + (14 / 9) * k }] }
  })
  return (
    <View style={s.liveWrap} pointerEvents="none">
      <Animated.View style={[s.liveRing, ring]} />
      <View style={s.liveDot} />
    </View>
  )
}

const MOTIF = { air: <PlaneIcon />, safety: <ShieldCheckIcon size={19} />, trip: <TempleIcon /> }

export function WaysRow({ ways }: { ways: Way[] }) {
  return (
    <View style={s.waysWrap}>
      <Text style={s.ttLabel}>More ways to ride</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={170}
        decelerationRate="fast"
        style={s.bleed}
        contentContainerStyle={s.bleedInner}
      >
        {ways.map((w) => (
          <Press key={w.key} onPress={w.onPress} scaleTo={0.96} label={w.title} style={[s.way, { backgroundColor: w.bg }]}>
            <Image source={w.image} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <LinearGradient
              colors={['rgba(6,8,10,0.28)', 'rgba(6,8,10,0.05)', 'rgba(6,8,10,0.5)', 'rgba(6,8,10,0.88)']}
              locations={[0, 0.32, 0.58, 1]}
              style={StyleSheet.absoluteFill}
            />
            {w.kind === 'safety' ? <LiveDot /> : null}
            <View style={s.motif}>{MOTIF[w.kind]}</View>
            <View style={s.wayTitleBox}>
              <Text style={s.wayTitle}>{w.title}</Text>
            </View>
            <Text style={s.waySub}>{w.sub}</Text>
            <View style={s.wayArrow}>
              <ArrowUpRight />
            </View>
          </Press>
        ))}
      </ScrollView>
    </View>
  )
}

// ---------- promo banners ----------
export type Promo = { key: string; eyebrow: string; title: string; sub: string; image: ImageSourcePropType; bg: string; onPress?: () => void }

export function PromoRow({ promos }: { promos: Promo[] }) {
  const { width } = useWindowDimensions()
  const cardW = 0.83 * (width - 36)
  return (
    <View style={s.promoWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + 12}
        decelerationRate="fast"
        style={s.bleed}
        contentContainerStyle={[s.bleedInner, { gap: 12 }]}
      >
        {promos.map((pr) => (
          <Press key={pr.key} onPress={pr.onPress} scaleTo={0.97} label={pr.title} style={[s.promo, { width: cardW, height: (cardW * 10) / 16, backgroundColor: pr.bg }]}>
            <Image source={pr.image} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <LinearGradient colors={['rgba(6,8,10,0)', 'rgba(6,8,10,0.35)', 'rgba(6,8,10,0.82)']} locations={[0.28, 0.54, 1]} style={StyleSheet.absoluteFill} />
            <View style={s.promoArrow}>
              <ArrowUpRight size={13} />
            </View>
            <View style={s.promoBody}>
              <Text style={s.promoEyebrow}>{pr.eyebrow}</Text>
              <Text style={s.promoTitle}>{pr.title}</Text>
              <Text style={s.promoSub}>{pr.sub}</Text>
            </View>
          </Press>
        ))}
      </ScrollView>
    </View>
  )
}

// ---------- Ocar Elite banner + toast ----------
export function EliteBanner({ onPress }: { onPress: () => void }) {
  const w = useSharedValue(0)
  const t = useSharedValue(0)
  useEffect(() => {
    // shimmer: rests at -60% for 55% of 3.6s, then sweeps to 140% (ease-in-out), loops
    t.set(
      withRepeat(
        withSequence(withTiming(0, { duration: 0 }), withTiming(0, { duration: 1980 }), withTiming(1, { duration: 1620, easing: ease.inOut })),
        -1
      )
    )
  }, [t])
  const shimmer = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(t.get(), [0, 1], [-0.6 * w.get(), 1.4 * w.get()]) }] }))
  return (
    <View style={s.eliteWrap}>
      <Press onPress={onPress} scaleTo={0.98} label="Introducing Ocar Elite" style={s.elite}>
        <LinearGradient
          colors={['#F3D9A6', '#E0B662', '#C9974A']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0.35 }}
          end={{ x: 1, y: 0.65 }}
          style={StyleSheet.absoluteFill}
          onLayout={(e) => w.set(e.nativeEvent.layout.width)}
        />
        <Animated.View style={[s.shimmer, shimmer]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.4 }}
            end={{ x: 1, y: 0.6 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={s.eliteIcon}>
          <StarIcon />
        </View>
        <View style={s.eliteText}>
          <Text style={s.eliteTitle}>Introducing Ocar Elite</Text>
          <Text style={s.eliteSub}>Priority pickups &amp; dedicated chauffeurs</Text>
        </View>
        <ChevronIcon w={1.6} />
      </Press>
    </View>
  )
}

export function Toast({ visible, bottom, onClose }: { visible: boolean; bottom: number; onClose: () => void }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.set(withTiming(visible ? 1 : 0, { duration: 300, easing: ease.ring }))
  }, [visible, p])
  const anim = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: 16 * (1 - p.get()) }] }))
  return (
    <Animated.View style={[s.toast, { bottom }, anim]} pointerEvents={visible ? 'auto' : 'none'}>
      <View style={s.toastIcon}>
        <StarIcon size={14} color={h.gold} />
      </View>
      <Text style={s.toastText}>Ocar Elite: priority chauffeurs, launching soon</Text>
      <Press onPress={onClose} label="Dismiss" style={s.toastClose}>
        <CloseIcon />
      </Press>
    </Animated.View>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 20, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: h.line08, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  chip: { width: 40, height: 40, borderRadius: 12, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 13, borderWidth: 1, borderColor: h.teal, opacity: 0 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory, marginBottom: 2 },
  rowSub: { fontFamily: font.r, fontSize: 12, color: h.ivoryDim },

  ttWrap: { marginTop: 22 },
  ttLabel: { fontFamily: font.b, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: h.teal, marginBottom: 10 },
  ttLabelBare: { fontFamily: font.b, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: h.teal },
  ttCard: { flexDirection: 'row', backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 20, overflow: 'hidden' },
  ttTile: { alignItems: 'center', gap: 6, paddingVertical: 19, paddingHorizontal: 8 },
  ttTileDivider: { borderRightWidth: 1, borderRightColor: h.line08 },
  ttTitle: { fontFamily: font.sb, fontSize: 13.5, color: h.ivory },
  ttSub: { fontFamily: font.r, fontSize: 10.5, color: 'rgba(20,23,26,0.36)' },

  fleetWrap: { marginTop: 22 },
  fleetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  viewAll: { width: 28, height: 28, borderRadius: 14, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  fleetRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  fleetTile: { alignItems: 'center', gap: 8 },
  badge: { width: 66, height: 66, borderRadius: 18, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line07, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fleetName: { fontFamily: font.m, fontSize: 12, lineHeight: 15, color: h.ivory, textAlign: 'center' },

  waysWrap: { marginTop: 22 },
  bleed: { marginHorizontal: -geo.gutter },
  bleedInner: { paddingHorizontal: geo.gutter, paddingTop: 2, paddingBottom: 4, gap: 10 },
  way: { width: 160, minHeight: 174, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: 16, paddingHorizontal: 15, justifyContent: 'flex-end', gap: 5, overflow: 'hidden' },
  motif: { position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  wayTitleBox: { minHeight: 36, justifyContent: 'flex-end', maxWidth: 98 },
  wayTitle: { fontFamily: font.b, fontSize: 14, lineHeight: 17.64, color: '#FFFFFF' },
  waySub: { fontFamily: font.r, fontSize: 10.5, color: 'rgba(255,255,255,0.68)', maxWidth: 98 },
  wayArrow: { position: 'absolute', bottom: 14, right: 13, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center' },
  liveWrap: { position: 'absolute', top: 8, right: 8, width: 9, height: 9, zIndex: 2 },
  liveDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: h.live, borderWidth: 2, borderColor: '#0A252B' },
  liveRing: { position: 'absolute', top: 0, left: 0, width: 9, height: 9, borderRadius: 4.5, backgroundColor: h.live },

  promoWrap: { marginTop: 22 },
  promo: { borderRadius: 22, overflow: 'hidden' },
  promoArrow: { position: 'absolute', top: 16, right: 16, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  promoBody: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 17 },
  promoEyebrow: { fontFamily: font.b, fontSize: 10, letterSpacing: 1.7, textTransform: 'uppercase', color: h.goldLight, marginBottom: 6 },
  promoTitle: { fontFamily: font.b, fontSize: 17, lineHeight: 21.25, letterSpacing: -0.1, color: '#FFFFFF', marginBottom: 4 },
  promoSub: { fontFamily: font.r, fontSize: 11.5, lineHeight: 16.1, color: 'rgba(255,255,255,0.75)' },

  eliteWrap: { marginTop: 14 },
  elite: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, overflow: 'hidden', boxShadow: '0 10px 24px rgba(201,151,74,0.28)' },
  shimmer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%' },
  eliteIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(20,23,26,0.13)', alignItems: 'center', justifyContent: 'center' },
  eliteText: { flex: 1, minWidth: 0 },
  eliteTitle: { fontFamily: font.b, fontSize: 13.5, color: h.ivory },
  eliteSub: { fontFamily: font.r, fontSize: 11, color: 'rgba(20,23,26,0.65)' },

  toast: { position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, boxShadow: shadow.lg, zIndex: 4 },
  toastIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(216,165,87,0.18)', alignItems: 'center', justifyContent: 'center' },
  toastText: { flex: 1, fontFamily: font.r, fontSize: 12, lineHeight: 16.8, color: h.ivory },
  toastClose: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: 0.5 },
})
