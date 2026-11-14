import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Text, font, h } from '@ocar/mobile-shared'

const GAP = 10
const PAD = 16

/** `hours` is the big line. Rental tiles add `km` and `price` lines; Round trip tiles (tone "teal") add `unit` ("hrs") and one `km` sub line, gold when `warn`. */
export type PackageTileData = { id: number; hours: string; km: string; price?: string; unit?: string; warn?: boolean }
export type SliderTone = 'rose' | 'teal'
const tileWidth = (tone: SliderTone) => (tone === 'teal' ? 92 : 96)

// Rental package tiles (design: Rental.dc.html). Rose is the product's call for this one control (brief section 7 item 7).
function Tile({ t, selected, best, onPress, tone }: { t: PackageTileData; selected: boolean; best: boolean; onPress: () => void; tone: SliderTone }) {
  if (tone === 'teal') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${t.hours} ${t.unit ?? ''}, ${t.km}${best ? ', best fit' : ''}`}
        style={({ pressed }) => [s.tile, s.tileTeal, selected ? s.tileTealOn : null, pressed ? s.tilePressed : null]}
      >
        {best ? (
          <LinearGradient colors={['#F6DC9A', '#D6A552']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.badge, s.badgeGold]}>
            <Text style={[s.badgeText, { color: '#3E2A05' }]} numberOfLines={1}>Best fit</Text>
          </LinearGradient>
        ) : null}
        <Text style={[s.bigTeal, selected ? { color: '#0A5666' } : null]} numberOfLines={1}>
          {t.hours}<Text style={s.unitTeal}> {t.unit}</Text>
        </Text>
        <Text style={[s.subTeal, t.warn ? { color: '#9A6A12' } : selected ? { color: h.tealText } : null]} numberOfLines={1}>{t.km}</Text>
      </Pressable>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${t.hours}, ${t.km}, ${t.price}${best ? ', best fit' : ''}`}
      style={({ pressed }) => [s.tile, selected ? s.tileOn : null, pressed ? s.tilePressed : null]}
    >
      {best ? (
        <LinearGradient colors={['#E5588A', '#C93566']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badge}>
          <Text style={s.badgeText} numberOfLines={1}>Best fit</Text>
        </LinearGradient>
      ) : null}
      <Text style={[s.hours, selected ? { color: h.roseInk } : null]} numberOfLines={1}>{t.hours}</Text>
      <Text style={[s.km, selected ? { color: '#A33B5E' } : null]} numberOfLines={1}>{t.km}</Text>
      <Text style={[s.price, selected ? { color: h.roseInk } : null]} numberOfLines={1}>{t.price}</Text>
    </Pressable>
  )
}

/**
 * Horizontal, snapping row of package tiles. The next tile peeks about 18px so it reads as scrollable, and a white edge
 * arrow with a fade shows on each side while more tiles exist that way (right at the start, left once scrolled). The
 * selected tile is brought in as the second visible one when the row opens and whenever the selection changes.
 */
export function PackageSlider({
  tiles, selectedId, bestId, onSelect, tone = 'rose', arrowLabel = 'packages',
}: {
  tiles: PackageTileData[]
  selectedId: number | null
  bestId: number | null
  onSelect: (id: number) => void
  tone?: SliderTone
  /** Used in the arrows' accessibility labels ("Show more {arrowLabel}"). */
  arrowLabel?: string
}) {
  const STEP = tileWidth(tone) + GAP
  const ref = useRef<ScrollView>(null)
  const offset = useRef(0)
  const content = useRef(0)
  const layout = useRef(0)
  const placed = useRef(false)
  const wanted = useRef<number | null>(null)
  const opL = useSharedValue(0)
  const opR = useSharedValue(0)
  const [canL, setCanL] = useState(false)
  const [canR, setCanR] = useState(false)
  // Hidden until the first placement, so a freshly opened row never shows its tiles from the start and then jumps.
  const [ready, setReady] = useState(false)

  const evaluate = useCallback(() => {
    const l = offset.current > 4
    const r = content.current - offset.current - layout.current > 4
    setCanL((p) => (p === l ? p : l))
    setCanR((p) => (p === r ? p : r))
    opL.value = withTiming(l ? 1 : 0, { duration: 200 })
    opR.value = withTiming(r ? 1 : 0, { duration: 200 })
  }, [opL, opR])

  // Needs the row and its content measured, which arrive in any order: every measurement asks to settle again.
  const settle = useCallback(() => {
    const idx = wanted.current
    if (idx === null || content.current === 0 || layout.current === 0) return
    wanted.current = null
    const max = Math.max(0, content.current - layout.current)
    const x = Math.min(max, Math.max(0, (idx - 1) * STEP))
    offset.current = x
    ref.current?.scrollTo({ x, animated: placed.current })
    placed.current = true
    setReady(true)
    evaluate()
  }, [evaluate, STEP])

  const selIndex = tiles.findIndex((t) => t.id === selectedId)
  useEffect(() => {
    if (selIndex < 0) { setReady(true); return }
    wanted.current = selIndex
    settle()
  }, [selIndex, settle])

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.x; evaluate() }
  const styleL = useAnimatedStyle(() => ({ opacity: opL.value }))
  const styleR = useAnimatedStyle(() => ({ opacity: opR.value }))
  const by = (dir: 1 | -1) => ref.current?.scrollTo({ x: Math.max(0, offset.current + dir * STEP * 2), animated: true })

  return (
    <View style={ready ? null : s.hidden}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={STEP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={s.row}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={(e) => { layout.current = e.nativeEvent.layout.width; evaluate(); settle() }}
        onContentSizeChange={(w) => { content.current = w; evaluate(); settle() }}
      >
        {tiles.map((t) => (
          <Tile key={t.id} t={t} tone={tone} selected={t.id === selectedId} best={t.id === bestId} onPress={() => onSelect(t.id)} />
        ))}
      </ScrollView>

      <Animated.View pointerEvents="none" style={[s.fadeR, styleR]}>
        <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} locations={[0, 0.78]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents={canR ? 'auto' : 'none'} style={[s.arrow, { right: 10 }, styleR]}>
        <Pressable onPress={() => by(1)} accessibilityRole="button" accessibilityLabel={`Show more ${arrowLabel}`} style={s.arrowBtn}>
          <Feather name="chevron-right" size={16} color={h.tealText} />
        </Pressable>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[s.fadeL, styleL]}>
        <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} locations={[0.22, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents={canL ? 'auto' : 'none'} style={[s.arrow, { left: 10 }, styleL]}>
        <Pressable onPress={() => by(-1)} accessibilityRole="button" accessibilityLabel={`Show earlier ${arrowLabel}`} style={s.arrowBtn}>
          <Feather name="chevron-left" size={16} color={h.tealText} />
        </Pressable>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  hidden: { opacity: 0 },
  row: { gap: GAP, paddingHorizontal: PAD, paddingTop: 22, paddingBottom: 8 },
  tile: { width: 96, minHeight: 92, paddingVertical: 8, borderRadius: 16, backgroundColor: h.roseWash, borderWidth: 1, borderColor: h.roseLine, alignItems: 'center', justifyContent: 'center' },
  tileOn: { backgroundColor: h.roseSelected, borderWidth: 1.5, borderColor: h.rose, boxShadow: '0 0 0 4px rgba(210,63,109,0.12)' },
  tileTeal: { width: 92, height: 88, minHeight: 88, paddingVertical: 0, borderRadius: 18, backgroundColor: '#F7F6F1', borderWidth: 1, borderColor: 'rgba(20,23,26,0.06)' },
  tileTealOn: { backgroundColor: '#EAF6F8', borderWidth: 1.5, borderColor: '#0B8296', boxShadow: '0 0 0 4px rgba(14,143,163,0.12)' },
  bigTeal: { fontFamily: font.xb, fontSize: 22, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },
  unitTeal: { fontFamily: font.b, fontSize: 13, letterSpacing: 0 },
  subTeal: { fontFamily: font.sb, fontSize: 12, color: '#6B7176', marginTop: 4, fontVariant: ['tabular-nums'] },
  badgeGold: { boxShadow: '0 0 0 2.5px #FFFFFF, 0 4px 10px rgba(214,165,82,0.35)' },
  tilePressed: { transform: [{ scale: 0.98 }] },
  badge: { position: 'absolute', top: -11, alignSelf: 'center', height: 22, paddingHorizontal: 10, borderRadius: 11, justifyContent: 'center', boxShadow: '0 0 0 2.5px #FFFFFF, 0 4px 10px rgba(201,53,102,0.30)' },
  badgeText: { fontFamily: font.xb, fontSize: 12, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  hours: { fontFamily: font.xb, fontSize: 17, letterSpacing: -0.2, color: h.ivory, fontVariant: ['tabular-nums'] },
  km: { fontFamily: font.m, fontSize: 12.5, color: '#7B5663', marginTop: 2, fontVariant: ['tabular-nums'] },
  price: { fontFamily: font.b, fontSize: 14, color: h.ivory, marginTop: 6, fontVariant: ['tabular-nums'] },
  fadeR: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 64 },
  fadeL: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 48 },
  arrow: { position: 'absolute', top: 52, width: 32, height: 32 },
  arrowBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: h.line08, alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(20,23,26,0.14)' },
})
