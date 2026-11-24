import { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn, FadeOut, ReduceMotion, ZoomIn } from 'react-native-reanimated'
import { h } from '../theme/brand'
import { colors, fonts, spacing, typography } from '../theme/tokens'
import { formatPhoneDisplay, normalizeIndianPhoneInput } from '../utils/phone'

type Props = {
  /** Ten digits at most, no country code. */
  value: string
  onChangeText: (digits: string) => void
  /** Dims the field and ignores typing, but keeps focus: switching a TextInput to editable={false} drops the keyboard on Android. */
  locked?: boolean
  autoFocus?: boolean
  onSubmitEditing?: () => void
}

/** The login phone number field: +91 in front, the number grouped 98765 43210, a teal ring while it has focus and a check at ten digits.
 *  A paste of "+91 98765 43210" or "098765 43210" becomes the right ten digits. */
export function PhoneField({ value, onChangeText, locked = false, autoFocus, onSubmitEditing }: Props) {
  const ref = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!autoFocus) return undefined
    // After the step's entrance animation has started, as OtpBoxInput does: focusing during mount can lose the keyboard on Android.
    // On a cold start (login is the first screen) the window may not have focus yet, so the field takes focus but the keyboard stays
    // down: if it is not up a moment later, blur and focus once more to raise it.
    const first = setTimeout(() => ref.current?.focus(), 250)
    const retry = setTimeout(() => {
      const input = ref.current
      if (!input || Keyboard.isVisible()) return
      input.blur()
      input.focus()
    }, 1100)
    return () => { clearTimeout(first); clearTimeout(retry) }
  }, [autoFocus])

  const ready = value.length === 10
  return (
    <View style={[styles.field, focused ? styles.focused : null, locked ? styles.locked : null]}>
      <Text style={styles.cc} maxFontSizeMultiplier={1.1}>+91</Text>
      <View style={styles.divider} />
      <TextInput
        ref={ref}
        value={formatPhoneDisplay(value)}
        onChangeText={(t) => { if (!locked) onChangeText(normalizeIndianPhoneInput(t)) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        placeholderTextColor="#B3BABD"
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        maxLength={11}
        accessibilityLabel="Phone number"
        accessibilityHint="Enter your 10-digit mobile number"
        style={styles.input}
        maxFontSizeMultiplier={1.1}
      />
      {ready ? (
        <Animated.View entering={ZoomIn.duration(220).reduceMotion(ReduceMotion.System)} style={styles.badge}>
          <Feather name="check" size={14} color="#fff" />
        </Animated.View>
      ) : null}
    </View>
  )
}

/** A line under a field or the code boxes: an icon and a sentence, for hints and errors. Same height whether or not it has anything to say. */
export function FieldMessage({ tone = 'hint', children }: { tone?: 'hint' | 'error'; children?: string }) {
  return (
    <View style={styles.msgSlot}>
      {children ? (
        <Animated.View key={tone + children} entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)} style={styles.msgRow} accessibilityLiveRegion={tone === 'error' ? 'polite' : 'none'}>
          {tone === 'error' ? <Feather name="alert-circle" size={17} color={h.danger} style={styles.msgIcon} /> : null}
          <Text style={[styles.msg, tone === 'error' ? styles.msgError : null]}>{children}</Text>
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    height: 60, borderRadius: 18, borderWidth: 2, borderColor: h.line10, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: 12,
  },
  focused: { borderColor: colors.primary, boxShadow: '0 0 0 4px rgba(14,143,163,0.14)' },
  locked: { opacity: 0.7 },
  cc: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink900 },
  divider: { width: 1, height: 26, backgroundColor: colors.border },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 22, letterSpacing: 0.4, color: colors.ink900, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: h.tealCta },
  msgSlot: { minHeight: 44, paddingTop: 10 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  msgIcon: { marginTop: 1 },
  msg: { ...typography.label, fontSize: 13, lineHeight: 18, color: h.muted, flexShrink: 1 },
  msgError: { color: h.danger, fontWeight: '600' },
})
