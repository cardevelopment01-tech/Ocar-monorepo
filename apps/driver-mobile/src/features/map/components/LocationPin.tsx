import { memo, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Marker } from 'react-native-maps'
import Svg, { Path, Ellipse, Circle } from 'react-native-svg'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { colors } from '@ocar/mobile-shared'

export type PinVariant = 'pickup' | 'drop'

export type LocationPinProps = {
  position: [number, number]
  variant: PinVariant
}

// Ported from rider-mobile's features/map/components/LocationPin.tsx (itself a
// pixel-match of web's apps/user/components/map/LocationPin.tsx) -- same
// teardrop pin + pulsing pickup halo everywhere in the product.
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
  const fill = variant === 'pickup' ? colors.success : colors.error

  return (
    <Marker coordinate={{ latitude: position[0], longitude: position[1] }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
      <View style={styles.wrap}>
        {variant === 'pickup' ? <PulsingHalo /> : null}
        <Svg width={28} height={38} viewBox="0 0 28 38">
          <Ellipse cx={14} cy={36.5} rx={5} ry={1.5} fill="rgba(0,0,0,0.18)" />
          <Path
            d="M14 1C6.82 1 1 6.82 1 14C1 21.2 7.4 28.6 14 37C20.6 28.6 27 21.2 27 14C27 6.82 21.18 1 14 1Z"
            fill={fill}
            stroke="#ffffff"
            strokeWidth={2}
          />
          <Circle cx={14} cy={13.5} r={4.5} fill="#ffffff" opacity={0.9} />
        </Svg>
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  wrap: { width: 28, height: 38, alignItems: 'center', justifyContent: 'flex-end' },
  halo: { position: 'absolute', top: -6, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(34,197,94,0.25)' },
})

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant && a.position[0] === b.position[0] && a.position[1] === b.position[1]
)
