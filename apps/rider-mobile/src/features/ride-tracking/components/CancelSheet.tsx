import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, useKeyboardOffset, fonts } from '@ocar/mobile-shared'

// Same reason lists + copy as apps/user/app/(main)/ride/[id]/CancelSheet.tsx.
const BEFORE_REASONS = [
  { code: 'changed_mind', label: 'Changed my mind' },
  { code: 'booked_by_mistake', label: 'Booked by mistake' },
  { code: 'found_another_ride', label: 'Found another ride' },
  { code: 'emergency', label: 'Emergency' },
]
const AFTER_REASONS = [
  { code: 'driver_too_far', label: 'Driver is too far away' },
  { code: 'driver_not_responding', label: 'Driver not responding' },
  { code: 'driver_behavior', label: 'Driver behavior issue' },
  { code: 'emergency', label: 'Emergency' },
  { code: 'other', label: 'Other reason' },
]

export type CancelSheetProps = {
  visible: boolean
  feeWarning: boolean
  onClose: () => void
  onConfirm: (reasonCode: string, reason?: string) => Promise<void>
}

export function CancelSheet({ visible, feeWarning, onClose, onConfirm }: CancelSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  // The sheet stays mounted between opens (only the Modal toggles), so without this the last
  // reason and note reappear pre-selected the next time it opens.
  useEffect(() => {
    if (!visible) {
      setSelected(null)
      setOtherText('')
      setSubmitting(false)
      setFailed(false)
    }
  }, [visible])

  const reasons = feeWarning ? AFTER_REASONS : BEFORE_REASONS
  const canSubmit = selected !== null && (selected !== 'other' || otherText.trim().length > 0)
  const keyboardOffset = useKeyboardOffset()
  // Same gap as AddStopSheet: this Modal's bottom-docked sheet had no
  // keyboard handling, so the "Other reason" text box could sit behind the
  // keyboard the instant it was focused.
  const keyboardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -keyboardOffset.get() }] }))

  async function handleConfirm() {
    if (!selected || submitting) return
    setSubmitting(true)
    setFailed(false)
    try {
      await onConfirm(selected, selected === 'other' ? otherText.trim() : undefined)
    } catch {
      // Stay open and say so: closing silently made a failed cancel look like it worked.
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submitting && onClose()} />
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Cancel your ride?</Text>
            <Pressable onPress={onClose} disabled={submitting} style={({ pressed }) => [styles.closeBtn, pressed ? styles.pressedScale : null]} hitSlop={8}>
              <Feather name="x" size={16} color={colors.ink600} />
            </Pressable>
          </View>

          {feeWarning ? (
            <View style={styles.feeWarning}>
              <Feather name="alert-circle" size={15} color={colors.warning} style={{ marginTop: 1 }} />
              <Text style={styles.feeWarningText}>
                A small cancellation fee may apply since your driver has already accepted.
              </Text>
            </View>
          ) : null}

          <Text style={styles.reasonHeading}>WHY ARE YOU CANCELLING?</Text>
          <View style={styles.reasonList}>
            {reasons.map((r) => {
              const active = selected === r.code
              return (
                <Pressable
                  key={r.code}
                  onPress={() => setSelected(r.code)}
                  style={({ pressed }) => [styles.reasonRow, active ? styles.reasonRowActive : null, pressed ? styles.pressedScale : null]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.radio, active ? styles.radioActive : null]} />
                  <Text style={[styles.reasonLabel, active ? styles.reasonLabelActive : null]}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {selected === 'other' ? (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder="Tell us more…"
              placeholderTextColor={colors.ink400}
              selectionColor={colors.primary}
              cursorColor={colors.primary}
              multiline
              maxLength={200}
              style={styles.otherInput}
            />
          ) : null}

          {failed ? (
            <Text style={styles.failedText} accessibilityLiveRegion="polite">
              We could not cancel the ride. Check your connection and try again.
            </Text>
          ) : null}

          <Pressable
            onPress={handleConfirm}
            disabled={!canSubmit || submitting}
            style={({ pressed }) => [styles.confirmBtn, (!canSubmit || submitting) ? styles.disabled : null, pressed && canSubmit && !submitting ? styles.pressedScale : null]}
          >
            <Text style={styles.confirmText}>{submitting ? 'Cancelling…' : 'Confirm cancellation'}</Text>
          </Pressable>
          <Pressable onPress={onClose} disabled={submitting} style={({ pressed }) => [styles.keepBtn, pressed ? styles.pressedScale : null]}>
            <Text style={styles.keepText}>Keep my ride</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  feeWarning: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.md },
  feeWarningText: { ...typography.body, color: colors.ink900, flex: 1, fontFamily: fonts.medium },
  reasonHeading: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, letterSpacing: 0.5, marginBottom: spacing.sm },
  reasonList: { gap: spacing.sm, marginBottom: spacing.md },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: colors.border },
  reasonRowActive: { backgroundColor: colors.errorLight, borderColor: colors.error },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
  radioActive: { borderWidth: 5, borderColor: colors.error },
  reasonLabel: { ...typography.body, color: colors.ink600, fontFamily: fonts.medium },
  reasonLabelActive: { color: colors.error },
  otherInput: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, minHeight: 72, textAlignVertical: 'top', marginBottom: spacing.md },
  confirmBtn: { backgroundColor: colors.error, borderRadius: radii.lg, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  failedText: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  disabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  confirmText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  keepBtn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  keepText: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
})
