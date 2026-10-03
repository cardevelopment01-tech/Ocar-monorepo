import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, spacing } from '@ocar/mobile-shared'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const EASE_IN = Easing.bezier(0.4, 0, 1, 1)
// Edge-to-edge Modal: the 3-button Android nav bar is not in the safe-area insets here.
const ANDROID_NAV_CLEARANCE = 56

type Props = {
  visible: boolean
  onClose: () => void
  children: ReactNode
}

// Bottom sheet with its own enter/exit motion. The Modal's built-in `fade` dissolves the whole window, so the
// big white sheet fades out in place like a pale rectangle; here the scrim fades and the sheet slides, so
// closing reads as the sheet leaving. The Modal stays mounted until the exit finishes.
export function BottomSheet({ visible, onClose, children }: Props) {
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(visible)
  // Wait for the sheet to be laid out before sliding: the native Modal window is still being created at mount.
  const [laidOut, setLaidOut] = useState(false)
  const progress = useSharedValue(visible ? 1 : 0)

  const unmount = useCallback(() => { setMounted(false); setLaidOut(false) }, [])

  useEffect(() => {
    if (visible) {
      setMounted(true)
    } else {
      progress.set(
        withTiming(0, { duration: reduced ? 140 : 220, easing: EASE_IN, reduceMotion: ReduceMotion.Never }, (finished) => {
          if (finished) scheduleOnRN(unmount)
        }),
      )
    }
  }, [visible, reduced, progress, unmount])

  useEffect(() => {
    if (visible && mounted && laidOut) {
      progress.set(withTiming(1, { duration: reduced ? 160 : 280, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }))
    }
  }, [visible, mounted, laidOut, reduced, progress])

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }))
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reduced ? progress.get() : 1,
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * height }],
  }))

  if (!mounted) return null

  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? ANDROID_NAV_CLEARANCE : 0) + spacing.md

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.root} onLayout={() => setLaidOut(true)}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: bottomPad }, sheetStyle]}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(7,20,23,0.58)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: spacing.sm + 2, maxHeight: '92%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
})
