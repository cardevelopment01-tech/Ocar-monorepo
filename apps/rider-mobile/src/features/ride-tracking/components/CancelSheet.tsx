import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

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

  const reasons = feeWarning ? AFTER_REASONS : BEFORE_REASONS
  const canSubmit = selected !== null && (selected !== 'other' || otherText.trim().length > 0)

  async function handleConfirm() {
    if (!selected || submitting) return
    setSubmitting(true)
    await onConfirm(selected, selected === 'other' ? otherText.trim() : undefined)
    setSubmitting(false)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submitting && onClose()} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Cancel your ride?</Text>
            <Pressable onPress={onClose} disabled={submitting} style={styles.closeBtn} hitSlop={8}>
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
                  style={[styles.reasonRow, active ? styles.reasonRowActive : null]}
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
              multiline
              maxLength={200}
              style={styles.otherInput}
            />
          ) : null}

          <Pressable
            onPress={handleConfirm}
            disabled={!canSubmit || submitting}
            style={[styles.confirmBtn, (!canSubmit || submitting) ? styles.disabled : null]}
          >
            <Text style={styles.confirmText}>{submitting ? 'Cancelling…' : 'Confirm cancellation'}</Text>
          </Pressable>
          <Pressable onPress={onClose} disabled={submitting} style={styles.keepBtn}>
            <Text style={styles.keepText}>Keep my ride</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  feeWarning: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.lg, padding: spacing.sm + 4, marginBottom: spacing.md },
  feeWarningText: { ...typography.body, color: colors.ink900, flex: 1, fontWeight: '500' },
  reasonHeading: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.sm },
  reasonList: { gap: spacing.sm, marginBottom: spacing.md },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: colors.border },
  reasonRowActive: { backgroundColor: colors.errorLight, borderColor: colors.error },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
  radioActive: { borderWidth: 5, borderColor: colors.error },
  reasonLabel: { ...typography.body, color: colors.ink600, fontWeight: '500' },
  reasonLabelActive: { color: colors.error },
  otherInput: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, minHeight: 72, textAlignVertical: 'top', marginBottom: spacing.md },
  confirmBtn: { backgroundColor: colors.error, borderRadius: radii.lg, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  disabled: { opacity: 0.4 },
  confirmText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  keepBtn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingVertical: spacing.sm + 4, alignItems: 'center' },
  keepText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
})
