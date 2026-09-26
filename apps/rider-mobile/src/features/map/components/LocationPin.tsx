import { memo, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Marker } from 'react-native-maps'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { PinGlyph, type PinVariant } from './PinGlyph'

export type { PinVariant }

export type LocationPinProps = {
  position: [number, number]
  variant: PinVariant
}

// Matches web's LocationPin.tsx (apps/user/components/map/LocationPin.tsx): a
// teardrop map pin (not the default OS pin) with a white ring dot, plus a soft
// pulsing halo on pickup only (draws the eye to "you are here" on first render).
function PulsingHalo() {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const opacity = useSharedValue(0.35)

  useEffect(() => {
    if (reduced) return
    scale.set(withRepeat(withTiming(2.2, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false))
    opacity.set(withRepeat(withTiming(0, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false))
  }, [reduced, scale, opacity])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }], opacity: opacity.get() }))

  if (reduced) return null
  return <Animated.View style={[styles.halo, style]} />
}

function LocationPin({ position, variant }: LocationPinProps) {
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 1 }}
      // The pickup pin's PulsingHalo starts its reanimated loop from a
      // useEffect, which fires after the first paint -- with
      // tracksViewChanges=false (a static one-time snapshot), react-native-maps
      // on Android can snapshot before that first paint settles, leaving the
      // whole marker blank/invisible (not just the halo frozen). The drop pin
      // has no animation and is safe to snapshot once.
      tracksViewChanges={variant === 'pickup'}
    >
      <View style={styles.wrap}>
        {variant === 'pickup' ? <PulsingHalo /> : null}
        <PinGlyph variant={variant} />
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  wrap: { width: 28, height: 38, alignItems: 'center', justifyContent: 'flex-end' },
  halo: { position: 'absolute', top: -6, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(14,143,163,0.25)' },
})

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant && a.position[0] === b.position[0] && a.position[1] === b.position[1]
)
