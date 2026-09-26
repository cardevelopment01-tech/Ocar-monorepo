import { useState } from 'react'
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, formatCurrency, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { SlideToConfirm } from './SlideToConfirm'

export type CashCollectionCardProps = {
  expectedFare: number
  riderName?: string | null
  loading: boolean
  error: string | null
  onConfirmFull: () => void
  onPartialOrNotCollected: (input: { collectedAmount?: number; notCollected?: boolean; note: string }) => void
}

// A 20%-off-quote custom amount needs a second tap to confirm -- same
// deviation guard as web's CollectCash.tsx.
const DEVIATION_CONFIRM_THRESHOLD = 0.2

// Ported from web's CollectCash.tsx (apps/driver/src/pages/ActiveRide/CollectCash.tsx):
// big fare hero + slide-to-confirm as the one-tap happy path, "different
// amount" opening a sheet for a custom figure or "not collected" -- the
// previous version here was a guessed two-button layout with no slider.
export function CashCollectionCard({
  expectedFare,
  riderName,
  loading,
  error,
  onConfirmFull,
  onPartialOrNotCollected,
}: CashCollectionCardProps) {
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState(false)

  function confirmCustomAmount() {
    const parsed = parseFloat(customAmount)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const deviates = expectedFare > 0 && Math.abs(parsed - expectedFare) / expectedFare > DEVIATION_CONFIRM_THRESHOLD
    if (deviates && !pendingConfirm) {
      setPendingConfirm(true)
      return
    }
    setSheetOpen(false)
    onPartialOrNotCollected({ collectedAmount: parsed, note: '' })
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <Feather name="dollar-sign" size={32} color={colors.inkInverse} />
        </View>
        <Text style={styles.heroLabel}>Collect cash from rider</Text>
        <Text style={styles.heroFare}>{formatCurrency(expectedFare)}</Text>
        <Text style={styles.heroSub}>Cash{riderName ? ` · ${riderName}` : ''}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SlideToConfirm
        label={`Slide to confirm collected ${formatCurrency(expectedFare)}`}
        onConfirm={onConfirmFull}
        disabled={loading}
        color={colors.success}
      />

      <Pressable onPress={() => { setSheetOpen(true); setPendingConfirm(false) }} disabled={loading} style={styles.altBtn}>
        <Text style={styles.altBtnText}>Different amount / not collected</Text>
      </Pressable>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => !loading && setSheetOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Adjust cash collected</Text>
            <Pressable onPress={() => setSheetOpen(false)} disabled={loading} hitSlop={8} accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.ink400} />
            </Pressable>
          </View>

          <Text style={styles.inputLabel}>Amount actually collected (₹)</Text>
          <TextInput
            value={customAmount}
            onChangeText={(t) => { setCustomAmount(t.replace(/[^0-9.]/g, '')); setPendingConfirm(false) }}
            keyboardType="decimal-pad"
            placeholder={String(Math.round(expectedFare))}
            placeholderTextColor={colors.ink400}
            style={styles.input}
          />

          {pendingConfirm ? (
            <Text style={styles.deviationWarning}>
              That's well off the {formatCurrency(expectedFare)} fare. Tap again to confirm ₹{customAmount || '0'}.
            </Text>
          ) : null}

          <Pressable
            onPress={confirmCustomAmount}
            disabled={loading || customAmount === ''}
            style={[styles.confirmBtn, pendingConfirm ? styles.confirmBtnDanger : null, (loading || customAmount === '') ? styles.disabled : null]}
          >
            <Text style={styles.confirmBtnText}>
              {loading ? 'Saving…' : pendingConfirm ? `Yes, confirm ₹${customAmount || '0'}` : `Confirm ₹${customAmount || '0'} collected`}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => { setSheetOpen(false); onPartialOrNotCollected({ notCollected: true, note: '' }) }}
            disabled={loading}
            style={styles.notCollectedBtn}
          >
            <Text style={styles.notCollectedText}>Cash not collected</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  hero: { alignItems: 'center', gap: 2, paddingVertical: spacing.sm },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    shadowColor: colors.success, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  heroLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  heroFare: { fontSize: 48, fontFamily: fonts.bold, color: colors.ink900, lineHeight: 54 },
  heroSub: { ...typography.caption, color: colors.ink400 },
  error: { ...typography.label, color: colors.error, textAlign: 'center' },
  altBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  altBtnText: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  backdrop: { backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, gap: spacing.xs },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.sm },
  sheetTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  inputLabel: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, fontSize: 18, fontFamily: fonts.bold, color: colors.ink900, marginBottom: spacing.sm },
  deviationWarning: { ...typography.caption, color: colors.error, textAlign: 'center', marginBottom: spacing.sm },
  confirmBtn: { paddingVertical: spacing.sm + 6, borderRadius: radii.lg, backgroundColor: colors.primary, alignItems: 'center', marginBottom: spacing.sm },
  confirmBtnDanger: { backgroundColor: colors.error },
  confirmBtnText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  notCollectedBtn: { paddingVertical: spacing.sm + 6, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.error, alignItems: 'center' },
  notCollectedText: { ...typography.body, color: colors.error, fontFamily: fonts.bold },
  disabled: { opacity: 0.6 },
})
