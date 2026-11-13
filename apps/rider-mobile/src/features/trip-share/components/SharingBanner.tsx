import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, FadeInDown, FadeOutUp, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { Press, font, h } from '@ocar/mobile-shared'
import { bannerText } from '../model'

/**
 * A slim line while the trip is being shared: tap it to see who can follow, or Stop to end every link (after a confirmation).
 * It slides in when sharing starts and out when it ends, and the rest of the sheet moves smoothly to make room.
 */
export function SharingBanner({ count, onManage, onStop }: { count: number; onManage: () => void; onStop: () => void }) {
  // The live dot breathes while the trip is being shared (steady for reduced motion).
  const reduced = useReducedMotion()
  const pulse = useSharedValue(0)
  useEffect(() => {
    if (count <= 0 || reduced) { pulse.set(0); return }
    pulse.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.out(Easing.quad) }), -1, false))
  }, [count, reduced, pulse])
  const halo = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.get()), transform: [{ scale: 1 + 1.7 * pulse.get() }] }))
  if (count <= 0) return null
  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOutUp.duration(180)} layout={LinearTransition.duration(240)} style={styles.bar}>
      <Press onPress={onManage} accessibilityRole="button" accessibilityLabel={`${bannerText(count)}. Manage`} scaleTo={0.985} hit={styles.mainHit} style={styles.main}>
        <View style={styles.dotWrap}>
          <Animated.View style={[styles.halo, halo]} />
          <View style={styles.dot} />
        </View>
        <Text style={styles.text} numberOfLines={1}>{bannerText(count)}</Text>
        <Text style={styles.manage}>Manage</Text>
      </Press>
      <Press onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop sharing" hitSlop={6} scaleTo={0.92} style={styles.stop}>
        <Text style={styles.stopText}>Stop</Text>
      </Press>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: 26, backgroundColor: '#F3FAFB', borderWidth: 1, borderColor: 'rgba(14,143,163,0.22)', paddingLeft: 16, paddingRight: 6 },
  mainHit: { flex: 1 },
  main: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: h.live },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: h.live },
  text: { fontFamily: font.b, fontSize: 13.5, color: h.tealText, flexShrink: 1 },
  manage: { fontFamily: font.sb, fontSize: 12.5, color: h.muted, marginLeft: 'auto', paddingRight: 8 },
  stop: { height: 40, borderRadius: 20, backgroundColor: h.dangerWash, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  stopText: { fontFamily: font.b, fontSize: 13.5, color: h.danger },
})
