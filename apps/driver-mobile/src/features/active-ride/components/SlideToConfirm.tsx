import { useState } from 'react'
import { StyleSheet, Vibration, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { Feather } from '@expo/vector-icons'
import { colors, radii, typography, fonts, Text } from '@ocar/mobile-shared'

const HANDLE = 52
const PAD = 4
const THRESHOLD = 0.7

export type SlideToConfirmProps = {
  label: string
  /** May return a promise. Resolving `false` (or rejecting) means the action failed and the
   *  slider springs back, so a failed server call never leaves it stuck on "Confirmed". */
  onConfirm: () => void | boolean | Promise<boolean | void>
  disabled?: boolean
  color?: string
  doneLabel?: string
}

// Ported from web's SwipeToConfirm (apps/driver/src/components/ui/SwipeToConfirm.tsx):
// same accident-proof "deliberate horizontal drag, not a tap a mounted phone
// hits by mistake" affordance, on Reanimated's Gesture.Pan (this codebase's
// existing gesture convention -- see RideRequestOverlay.tsx) instead of
// framer-motion drag.
//
// Every action on the ride sheet that tells the rider or the meter something (arrived at
// pickup, arrived at a stop, continue, start return, cash collected) is a slide, so a tap
// from a phone in a mount or a pocket can't fire one. Label is ink900, not the accent: the
// accent on a pale teal track is under 4.5:1, and the tinted fill already carries the color.
export function SlideToConfirm({ label, onConfirm, disabled = false, color = colors.primary, doneLabel = 'Confirmed' }: SlideToConfirmProps) {
  const [trackWidth, setTrackWidth] = useState(0)
  const [done, setDone] = useState(false)
  const x = useSharedValue(0)
  const maxX = Math.max(0, trackWidth - HANDLE - PAD * 2)

  function reset() {
    setDone(false)
    x.set(withSpring(0, { duration: 300, dampingRatio: 1 }))
  }

  function handleConfirmed() {
    setDone(true)
    Vibration.vibrate(30)
    const result = onConfirm()
    if (result instanceof Promise) {
      result.then((ok) => { if (ok === false) reset() }, reset)
    } else if (result === false) {
      reset()
    }
  }

  const pan = Gesture.Pan()
    .enabled(!disabled && !done && maxX > 0)
    .onChange((e) => {
      x.set(Math.min(Math.max(0, x.get() + e.changeX), maxX))
    })
    .onFinalize(() => {
      if (x.get() >= maxX * THRESHOLD) {
        x.set(withSpring(maxX, { duration: 220, dampingRatio: 1 }))
        scheduleOnRN(handleConfirmed)
      } else {
        x.set(withSpring(0, { duration: 260, dampingRatio: 1 }))
      }
    })

  const handleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }))
  const fillStyle = useAnimatedStyle(() => ({ width: x.get() + HANDLE }))

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { opacity: disabled ? 0.5 : 1 }]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Slide to confirm, or double tap"
      accessibilityState={{ disabled: disabled || done }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => { if (!disabled && !done) handleConfirmed() }}
    >
      <Animated.View style={[styles.fill, fillStyle, { backgroundColor: color }]} />
      <Text style={styles.label} pointerEvents="none" numberOfLines={1}>{done ? doneLabel : label}</Text>
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
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radii.full, opacity: 0.18 },
  // Centered in the space the handle leaves free, so the resting label looks centered.
  label: { ...typography.body, lineHeight: 20, fontSize: 15, fontFamily: fonts.bold, textAlign: 'center', color: colors.ink900, paddingLeft: HANDLE / 2 },
  handle: {
    position: 'absolute', left: PAD, top: PAD,
    width: HANDLE - PAD * 2, height: HANDLE - PAD * 2, borderRadius: radii.full,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
})
