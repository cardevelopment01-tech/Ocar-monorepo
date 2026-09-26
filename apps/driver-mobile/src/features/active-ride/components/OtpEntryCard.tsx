import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { Button, colors, fonts, radii, spacing, typography, Text } from '@ocar/mobile-shared'
import { OtpKeypad } from './OtpKeypad'

export type OtpEntryCardProps = {
  phase: 'start' | 'end'
  riderName: string | null | undefined
  error: string | null
  // Resolves true when the server accepted the code.
  onSubmit: (otp: string) => Promise<boolean>
}

const COPY = {
  start: { cta: 'Enter rider OTP', hint: 'Ask the rider for their 4-digit code once they are in the cab', title: 'Start OTP', done: 'Trip started' },
  end: { cta: 'Enter end OTP', hint: 'Ask the rider for the end code once you reach the drop', title: 'End OTP', done: 'Trip ended' },
} as const

/**
 * The OTP step. The ride sheet only shows one button; the code is typed in a focused sheet with an
 * in-app number pad. The sheet mounts fresh each time, so stale digits can never auto-submit, and it
 * verifies as soon as the 4th digit lands.
 */
export function OtpEntryCard({ phase, riderName, error, onSubmit }: OtpEntryCardProps) {
  const [open, setOpen] = useState(false)
  const copy = COPY[phase]
  return (
    <View style={styles.card}>
      <Text style={styles.hint}>{copy.hint}</Text>
      <Button label={copy.cta} icon="lock" onPress={() => setOpen(true)} />
      <OtpSheet visible={open} phase={phase} riderName={riderName} error={error} onSubmit={onSubmit} onClose={() => setOpen(false)} />
    </View>
  )
}

function OtpSheet({ visible, phase, riderName, error, onSubmit, onClose }: OtpEntryCardProps & { visible: boolean; onClose: () => void }) {
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const shake = useSharedValue(0)
  const rise = useSharedValue(0)
  const copy = COPY[phase]
  const accent = phase === 'start' ? colors.primary : colors.warning
  // Scale with screen height: short phones get tighter keys and boxes so the pad never crowds the header.
  const keyHeight = Math.max(46, Math.min(64, Math.round(height * 0.068)))
  const boxSize = height < 700 ? { w: 56, h: 66 } : { w: 64, h: 76 }

  useEffect(() => {
    if (visible) {
      setOtp('')
      setBusy(false)
      setDone(false)
      setFailed(false)
      rise.set(0)
      rise.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }))
    }
  }, [visible, rise])

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - rise.get()) * 60 }], opacity: rise.get() }))
  const boxesStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }))

  async function submit(code: string) {
    setBusy(true)
    const ok = await onSubmit(code)
    if (ok) {
      setDone(true)
      // The parent switches screens on success; this only closes the sheet if it is still mounted.
      setTimeout(onClose, 700)
      return
    }
    setBusy(false)
    setFailed(true)
    setOtp('')
    shake.set(withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 80 }), withTiming(-8, { duration: 80 }), withTiming(0, { duration: 60 })))
  }

  function onDigit(d: string) {
    if (busy || done || otp.length >= 4) return
    const next = otp + d
    setOtp(next)
    setFailed(false)
    if (next.length === 4) void submit(next)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && onClose()} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={() => !busy && onClose()} accessibilityLabel="Close" />
        <Animated.View style={[styles.sheet, sheetStyle, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={[styles.kicker, { color: accent }]}>{copy.title.toUpperCase()}</Text>
              <Text style={styles.title} numberOfLines={2}>{riderName ? `Ask ${riderName} for the code` : 'Ask the rider for the code'}</Text>
            </View>
            <Pressable onPress={() => !busy && onClose()} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.ink900} />
            </Pressable>
          </View>

          <Animated.View style={[styles.boxes, boxesStyle]} accessibilityLabel={`${copy.title}, ${otp.length} of 4 digits entered`}>
            {[0, 1, 2, 3].map((i) => {
              const active = !done && !busy && i === Math.min(otp.length, 3)
              return (
                <View key={i} style={[styles.box, { width: boxSize.w, height: boxSize.h }, active && { borderColor: accent }, failed && styles.boxError, done && styles.boxDone]}>
                  <Text style={styles.boxDigit} maxFontSizeMultiplier={1.2}>{otp[i] ?? ''}</Text>
                </View>
              )
            })}
          </Animated.View>

          <View style={styles.status} accessibilityLiveRegion="polite">
            {done ? (
              <View style={styles.statusRow}><Feather name="check-circle" size={16} color={colors.success} /><Text style={[styles.statusText, { color: colors.success }]}>{copy.done}</Text></View>
            ) : busy ? (
              <Text style={[styles.statusText, { color: colors.ink600 }]}>Verifying...</Text>
            ) : failed && error ? (
              <Text style={[styles.statusText, { color: colors.error }]}>{error}. Ask the rider to check and try again.</Text>
            ) : (
              <Text style={[styles.statusText, { color: colors.ink400 }]}>The code verifies automatically</Text>
            )}
          </View>

          <OtpKeypad onDigit={onDigit} onBackspace={() => { if (!busy && !done) { setOtp((o) => o.slice(0, -1)); setFailed(false) } }} keyHeight={keyHeight} disabled={busy || done} />
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  hint: { ...typography.body, color: colors.ink600 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,20,22,0.5)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, maxHeight: '96%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2 },
  title: { ...typography.title, color: colors.ink900 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  box: { borderRadius: radii.xl, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  boxError: { borderColor: colors.error, backgroundColor: colors.errorLight },
  boxDone: { borderColor: colors.success, backgroundColor: colors.successLight },
  boxDigit: { fontFamily: fonts.bold, fontSize: 30, color: colors.ink900 },
  status: { minHeight: 22, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { ...typography.caption, textAlign: 'center' },
})
