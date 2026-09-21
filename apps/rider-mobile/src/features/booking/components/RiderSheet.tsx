import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography } from '@ocar/mobile-shared'

export type RiderSheetProps = {
  visible: boolean
  onClose: () => void
  riderName: string
  riderPhone: string
  onCommit: (name: string, phone: string) => void
  onClearToMyself: () => void
}

// Native equivalent of web's BookingForSheet (apps/user/components/booking/BookingForSheet.tsx)
// -- same two-view contract (pick "Myself" vs a saved/new rider, or drop into a
// name+phone form), built as a plain Modal instead of a framer-motion sheet.
export function RiderSheet({ visible, onClose, riderName, riderPhone, onCommit, onClearToMyself }: RiderSheetProps) {
  const insets = useSafeAreaInsets()
  const bookingForOther = riderName !== '' && riderPhone !== ''
  const [view, setView] = useState<'select' | 'form'>('select')
  const [nameDraft, setNameDraft] = useState('')
  const [phoneDraft, setPhoneDraft] = useState('')

  useEffect(() => {
    if (visible) setView('select')
  }, [visible])

  function goToForm(prefillName: string, prefillPhone: string) {
    setNameDraft(prefillName)
    setPhoneDraft(prefillPhone.replace('+91', ''))
    setView('form')
  }

  const canSave = nameDraft.trim().length > 0 && phoneDraft.length === 10

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />

        {view === 'select' ? (
          <>
            <Text style={styles.title}>Who&apos;s travelling?</Text>

            <Pressable
              onPress={onClearToMyself}
              style={[styles.row, !bookingForOther ? styles.rowActive : null]}
              accessibilityRole="button"
            >
              <View style={styles.avatar}>
                <Feather name="user" size={16} color={colors.inkInverse} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Myself</Text>
                <Text style={styles.rowSub}>My own trip</Text>
              </View>
              {!bookingForOther ? <View style={styles.radioActive} /> : null}
            </Pressable>

            {bookingForOther ? (
              <Pressable onPress={() => goToForm(riderName, riderPhone)} style={[styles.row, styles.rowActive]} accessibilityRole="button">
                <View style={styles.avatar}>
                  <Feather name="user" size={16} color={colors.inkInverse} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{riderName}</Text>
                  <Text style={styles.rowSub}>{riderPhone}</Text>
                </View>
                <View style={styles.radioActive} />
              </Pressable>
            ) : null}

            <Pressable onPress={() => goToForm('', '')} style={styles.addRow} accessibilityRole="button">
              <View style={styles.avatarMuted}>
                <Feather name="user-plus" size={18} color={colors.primary} />
              </View>
              <Text style={styles.addText}>Add new rider</Text>
            </Pressable>

            <Text style={styles.privacy}>Your contact details are never shared with the driver.</Text>
            <Button label="Confirm" onPress={onClose} accessibilityLabel="Confirm rider selection" />
          </>
        ) : (
          <>
            <View style={styles.formHeader}>
              <Pressable onPress={() => setView('select')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                <Feather name="chevron-left" size={20} color={colors.ink900} />
              </Pressable>
              <Text style={styles.title}>Rider details</Text>
            </View>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Rider's full name"
              placeholderTextColor={colors.ink400}
              selectionColor={colors.primary}
              cursorColor={colors.primary}
              maxLength={50}
              style={styles.input}
            />
            <TextInput
              value={phoneDraft}
              onChangeText={(v) => setPhoneDraft(v.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
              placeholderTextColor={colors.ink400}
              selectionColor={colors.primary}
              cursorColor={colors.primary}
              keyboardType="number-pad"
              maxLength={10}
              style={styles.input}
            />
            <Text style={styles.privacy}>Your contact details are never shared with the driver.</Text>
            <Button
              label="Save rider"
              disabled={!canSave}
              onPress={() => onCommit(nameDraft.trim(), `+91${phoneDraft}`)}
              accessibilityLabel="Save rider details"
            />
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.48)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, gap: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: radii.full, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radii.lg },
  rowActive: { backgroundColor: colors.primarySubtle },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarMuted: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  rowSub: { ...typography.caption, color: colors.primaryDark },
  radioActive: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  addText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  privacy: { ...typography.caption, color: colors.ink400, marginVertical: spacing.xs },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  input: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4 },
})
