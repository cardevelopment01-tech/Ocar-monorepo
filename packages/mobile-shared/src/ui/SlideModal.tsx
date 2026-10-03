import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const EASE_IN = Easing.bezier(0.4, 0, 1, 1)
const ENTER_MS = 280
const EXIT_MS = 220

type Props = {
  visible: boolean
  onRequestClose: () => void
  /** The sheet content. Its own wrapper must be transparent: the dark scrim is drawn here, separately. */
  children: ReactNode
  scrimColor?: string
}

// Drop-in for <Modal transparent animationType="slide">. The built-in `slide` moves the WHOLE window, so the
// dark scrim rides up and down with the sheet. Here the scrim fades in place and only the sheet slides. The
// Modal stays mounted until the exit finishes.
export function SlideModal({ visible, onRequestClose, children, scrimColor = 'rgba(7,20,23,0.58)' }: Props) {
  const { height } = useWindowDimensions()
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(visible)
  // The enter animation waits for the sheet to be laid out: starting it while the native Modal window is still
  // being created eats the first frames, so the sheet pops in instead of sliding.
  const [laidOut, setLaidOut] = useState(false)
  const progress = useSharedValue(visible ? 1 : 0)
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current)
    if (visible) {
      setMounted(true)
    } else {
      const ms = reduced ? 140 : EXIT_MS
      progress.set(withTiming(0, { duration: ms, easing: EASE_IN, reduceMotion: ReduceMotion.Never }))
      unmountTimer.current = setTimeout(() => { setMounted(false); setLaidOut(false) }, ms + 40)
    }
    return () => { if (unmountTimer.current) clearTimeout(unmountTimer.current) }
  }, [visible, reduced, progress])

  useEffect(() => {
    if (visible && mounted && laidOut) {
      progress.set(withTiming(1, { duration: reduced ? 160 : ENTER_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }))
    }
  }, [visible, mounted, laidOut, reduced, progress])

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }))
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reduced ? progress.get() : 1,
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * height }],
  }))

  if (!mounted) return null

  return (
    <Modal visible transparent animationType="none" onRequestClose={onRequestClose}>
      <View style={styles.root} onLayout={() => setLaidOut(true)}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }, scrimStyle]} />
        <Animated.View style={[styles.sheetLayer, sheetStyle]}>{children}</Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheetLayer: { flex: 1 },
})
