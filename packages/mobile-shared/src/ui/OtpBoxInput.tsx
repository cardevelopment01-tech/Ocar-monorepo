import { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { h } from '../theme/brand'
import { colors, radii, fonts } from '../theme/tokens'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

export type OtpBoxInputProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style' | 'maxLength'> & {
  length?: number
  value: string
  onChangeText: (value: string) => void
  error?: boolean
  // The code was accepted: boxes turn green. `busy`: it is being checked, boxes breathe softly.
  success?: boolean
  busy?: boolean
  autoFocus?: boolean
  // Login's 6-digit code sizes boxes to the default (42x60) since that's the
  // widest row this component has to fit without overflowing the sheet's
  // padding. A 4-digit ride-start/end PIN has plenty of spare width at that
  // size and reads as small/washed-out for what's meant to be the one high-
  // stakes number on screen (matches Uber/Ola's own bigger, bolder PIN boxes
  // for exactly this moment) -- callers with fewer boxes can size up.
  boxWidth?: number
  boxHeight?: number
  digitFontSize?: number
  gap?: number
}

// Digit-box OTP entry matching web's OtpInput (apps/driver/src/components/ui/OtpInput.tsx,
// same component reused by apps/user's login) -- one real TextInput (invisible, stretched
// over the row) drives every box, which is what keeps the SMS-autofill hints
// (textContentType="oneTimeCode" / autoComplete="sms-otp") working: iOS's QuickType bar and
// Android's Autofill framework both key off a real focused TextInput, not a fake one assembled
// from N separate inputs.
export function OtpBoxInput({
  length = 6, value, onChangeText, error = false, success = false, busy = false, autoFocus, boxWidth, boxHeight, digitFontSize, gap, ...inputProps
}: OtpBoxInputProps) {
  const inputRef = useRef<TextInput>(null)
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  // The box the next keystroke lands in -- highlighted so the row always shows
  // where you are, the way Stripe/Apple's own OTP fields do.
  const activeIndex = Math.min(value.length, length - 1)

  useEffect(() => {
    if (!autoFocus) return undefined
    const t = setTimeout(() => inputRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [autoFocus])

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={[styles.row, gap != null ? { gap } : null]}>
      {digits.map((digit, i) => (
        <OtpBox
          key={i}
          digit={digit}
          error={error}
          success={success}
          busy={busy}
          active={i === activeIndex}
          {...(boxWidth !== undefined ? { width: boxWidth } : {})}
          {...(boxHeight !== undefined ? { height: boxHeight } : {})}
          {...(digitFontSize !== undefined ? { fontSize: digitFontSize } : {})}
        />
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        caretHidden
        accessibilityLabel="OTP code"
        style={styles.hiddenInput}
        {...inputProps}
      />
    </Pressable>
  )
}

function OtpBox({
  digit, error, success, busy, active, width, height, fontSize,
}: { digit: string; error: boolean; success: boolean; busy: boolean; active: boolean; width?: number; height?: number; fontSize?: number }) {
  const filled = digit !== ''
  const reduced = useReducedMotion()
  // A thin caret in the box the next digit lands in, blinking slowly: the real caret is hidden (it has nowhere sensible to sit over six boxes).
  const showCaret = active && !filled && !error && !success && !busy
  const caret = useSharedValue(1)
  useEffect(() => {
    if (!showCaret || reduced) { caret.value = 1; return }
    caret.value = withRepeat(withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [showCaret, reduced, caret])
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }))
  // While the code is checked the filled boxes breathe, so the screen is visibly working.
  const pulse = useSharedValue(1)
  useEffect(() => {
    if (!busy || reduced) { pulse.value = withTiming(1, { duration: 120 }); return }
    pulse.value = withRepeat(withTiming(0.55, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true)
  }, [busy, reduced, pulse])
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }))

  // Momentary pop on fill, not a persistent scale -- every box rests at scale 1
  // so the row stays flush (a permanent scale on filled boxes, which is what
  // the web version does, is exactly what made the row look misaligned here:
  // a box sitting at 1.06 forever is visibly bigger than its resting neighbors).
  // Digit state reads entirely through color/border -- deliberately no drop
  // shadow, which made a filled box look like its own little floating card
  // nested inside the screen's Card (a real anti-pattern, not a taste call).
  const style = useAnimatedStyle(() => {
    // No pop on an error: the effect re-runs when `error` flips, and a 1.16 pop on top of the shake made the boxes overlap their neighbours.
    const scale = filled && !error
      ? withSequence(withTiming(1.16, { duration: 90, easing: EASE_OUT }), withSpring(1, { duration: 260, dampingRatio: 0.65 }))
      : withTiming(1, { duration: 120, easing: EASE_OUT })
    const shakeX = error
      ? withSequence(
          withTiming(-4, { duration: 40 }),
          withTiming(4, { duration: 60 }),
          withTiming(-3, { duration: 60 }),
          withTiming(0, { duration: 60 })
        )
      : withTiming(0, { duration: 0 })
    return { transform: [{ scale }, { translateX: shakeX }] }
  }, [filled, error])

  const boxState = error ? styles.boxError : success ? styles.boxSuccess : filled ? styles.boxFilled : active && !busy ? styles.boxActive : styles.boxDefault
  const digitState = error ? styles.digitError : success ? styles.digitSuccess : filled ? styles.digitFilled : null

  const sizeStyle = (width != null || height != null) ? { width: width ?? BOX_SIZE, height: height ?? 60 } : null

  return (
    <Animated.View style={[styles.box, boxState, sizeStyle, style, pulseStyle]}>
      {showCaret ? <Animated.View style={[styles.caret, caretStyle]} /> : null}
      <Text style={[styles.digit, fontSize != null ? { fontSize } : null, digitState]}>{digit}</Text>
    </Animated.View>
  )
}

// 48 with an 8pt gap left zero margin on a real device (a 6-box row's
// natural width came out equal to the sheet's full padded content width,
// confirmed via the exact rendered bounds -- box 1's left edge sat flush on
// the padding boundary and box 6's right edge flush on the other, no visible
// gutter on either side, which read as the row being cut off even though
// nothing was actually clipped). Smaller box + tighter gap guarantees real
// margin regardless of the exact screen width.
const BOX_SIZE = 42

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  hiddenInput: { position: 'absolute', width: '100%', height: '100%', opacity: 0 },
  box: {
    width: BOX_SIZE,
    height: 60,
    borderRadius: radii.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDefault: { borderColor: colors.border, backgroundColor: colors.surface2 },
  // The next box to fill gets a quiet brand-tinted ring -- a cursor, effectively,
  // without a blinking caret (which caretHidden intentionally suppresses on the
  // real input since the caret has nowhere sensible to render over 6 boxes).
  boxActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  boxFilled: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  boxError: { borderColor: colors.error, backgroundColor: colors.errorLight },
  boxSuccess: { borderColor: colors.success, backgroundColor: colors.successLight },
  caret: { position: 'absolute', width: 2, height: 26, borderRadius: 1, backgroundColor: colors.primary },
  // Plus Jakarta Sans Bold, not Space Grotesk -- web's digit boxes on both
  // apps are just `font-bold` (the default body font), never `font-display`.
  // Confirmed by reading both web OtpInput components directly: neither one
  // applies font-display anywhere. 700 is the heaviest weight useAppFonts loads.
  digit: { fontSize: 24, fontFamily: fonts.bold, color: colors.ink900 },
  digitFilled: { color: colors.primary },
  digitError: { color: colors.error },
  digitSuccess: { color: h.liveInk },
})
