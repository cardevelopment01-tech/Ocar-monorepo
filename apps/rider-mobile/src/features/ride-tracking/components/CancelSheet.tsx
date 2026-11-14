import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { Button, font, h, useKeyboardOffset } from '@ocar/mobile-shared'

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
              <Feather name="x" size={16} color={h.muted} />
            </Pressable>
          </View>

          {feeWarning ? (
            <View style={styles.feeWarning}>
              <Feather name="alert-circle" size={17} color={h.goldInk} style={{ marginTop: 1 }} />
              <Text style={styles.feeWarningText}>
                A small cancellation fee may apply since your driver has already arrived at your pick up point.
              </Text>
            </View>
          ) : null}

          <Text style={styles.reasonHeading}>Why are you cancelling?</Text>
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
                  <View style={[styles.radio, active ? styles.radioActive : null]}>{active ? <Feather name="check" size={13} color="#FFFFFF" /> : null}</View>
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
              placeholderTextColor={h.faint}
              selectionColor={h.teal}
              cursorColor={h.teal}
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
            accessibilityRole="button"
            style={({ pressed }) => [styles.confirmBtn, !canSubmit || submitting ? styles.confirmOff : null, pressed && canSubmit && !submitting ? styles.pressedScale : null]}
          >
            <Text style={styles.confirmText}>{submitting ? 'Cancelling…' : 'Confirm cancellation'}</Text>
          </Pressable>
          <Button variant="soft" label="Keep my ride" onPress={onClose} disabled={submitting} />
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.5)' },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 30, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  feeWarning: { flexDirection: 'row', gap: 10, backgroundColor: h.goldWash, borderRadius: 16, padding: 14, marginBottom: 16 },
  feeWarningText: { fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: h.ivory, flex: 1 },
  reasonHeading: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginBottom: 10 },
  reasonList: { gap: 8, marginBottom: 16 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 16, borderRadius: 18, backgroundColor: h.chip, borderWidth: 1.5, borderColor: 'transparent' },
  reasonRowActive: { backgroundColor: h.dangerWash, borderColor: h.danger },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'rgba(20,23,26,0.16)', alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: h.danger, borderColor: h.danger },
  reasonLabel: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory },
  reasonLabelActive: { color: h.danger },
  otherInput: { fontFamily: font.m, fontSize: 14.5, color: h.ivory, backgroundColor: h.chip, borderWidth: 1.5, borderColor: h.line08, borderRadius: 18, padding: 16, minHeight: 80, textAlignVertical: 'top', marginBottom: 16 },
  confirmBtn: { height: 56, backgroundColor: h.danger, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 10, boxShadow: '0 12px 24px rgba(194,59,59,0.28)' },
  confirmOff: { backgroundColor: '#E8C9C9', boxShadow: 'none' },
  failedText: { fontFamily: font.m, fontSize: 13, color: h.danger, marginBottom: 10 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  confirmText: { fontFamily: font.b, fontSize: 15.5, color: '#FFFFFF' },
})
