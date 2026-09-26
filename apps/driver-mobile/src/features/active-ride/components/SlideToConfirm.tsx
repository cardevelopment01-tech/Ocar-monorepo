import { useState } from 'react'
import { StyleSheet, Vibration, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { colors, radii, typography, fonts, Text } from '@ocar/mobile-shared'

const HANDLE = 52
const PAD = 4
const THRESHOLD = 0.7

export type SlideToConfirmProps = {
  label: string
  onConfirm: () => void
  disabled?: boolean
  color?: string
}

// Ported from web's SwipeToConfirm (apps/driver/src/components/ui/SwipeToConfirm.tsx):
// same accident-proof "deliberate horizontal drag, not a tap a mounted phone
// hits by mistake" affordance, on Reanimated's Gesture.Pan (this codebase's
// existing gesture convention -- see RideRequestOverlay.tsx) instead of
// framer-motion drag.
export function SlideToConfirm({ label, onConfirm, disabled = false, color = colors.primary }: SlideToConfirmProps) {
  const [trackWidth, setTrackWidth] = useState(0)
  const [done, setDone] = useState(false)
  const x = useSharedValue(0)
  const maxX = Math.max(0, trackWidth - HANDLE - PAD * 2)

  function handleConfirmed() {
    setDone(true)
    Vibration.vibrate(30)
    onConfirm()
  }

  const pan = Gesture.Pan()
    .enabled(!disabled && !done && maxX > 0)
    .onChange((e) => {
      x.value = Math.min(Math.max(0, x.value + e.changeX), maxX)
    })
    .onFinalize(() => {
      if (x.value >= maxX * THRESHOLD) {
        x.value = withSpring(maxX, { damping: 22, stiffness: 260 })
        runOnJS(handleConfirmed)()
      } else {
        x.value = withSpring(0, { damping: 26, stiffness: 300 })
      }
    })

  const handleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + HANDLE }))

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Animated.View style={[styles.fill, fillStyle, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} pointerEvents="none">{done ? 'Confirmed' : label}</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.handle, handleStyle]}>
          <Feather name={done ? 'check' : 'chevrons-right'} size={20} color={color} />
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: HANDLE, borderRadius: radii.full, backgroundColor: colors.primarySubtle, padding: PAD, justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radii.full, opacity: 0.16 },
  label: { ...typography.body, fontFamily: fonts.bold, textAlign: 'center' },
  handle: {
    position: 'absolute', left: PAD, top: PAD,
    width: HANDLE - PAD * 2, height: HANDLE - PAD * 2, borderRadius: radii.full,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
})
