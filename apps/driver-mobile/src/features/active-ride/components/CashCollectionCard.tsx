import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, colors, formatCurrency, radii, spacing, typography, fonts, Text, SlideModal } from '@ocar/mobile-shared'
import { SlideToConfirm } from './SlideToConfirm'

export type CashCollectionCardProps = {
  expectedFare: number
  riderName?: string | null
  loading: boolean
  error: string | null
  onConfirmFull: () => void | boolean | Promise<boolean | void>
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
        {/* A rupee glyph, not Feather's dollar-sign: this is an INR fare. */}
        <View style={styles.iconCircle}>
          <Text style={styles.rupee}>₹</Text>
        </View>
        <Text style={styles.heroLabel}>Collect cash from {riderName ?? 'the rider'}</Text>
        <Text style={styles.heroFare} accessibilityLabel={`${formatCurrency(expectedFare)} to collect`}>{formatCurrency(expectedFare)}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SlideToConfirm
        label={`Slide to confirm collected ${formatCurrency(expectedFare)}`}
        onConfirm={onConfirmFull}
        disabled={loading}
        color={colors.success}
      />

      <Pressable onPress={() => { setSheetOpen(true); setPendingConfirm(false) }} disabled={loading} style={styles.altBtn} accessibilityRole="button">
        <Text style={styles.altBtnText}>Different amount or not collected</Text>
        <Feather name="chevron-right" size={16} color={colors.ink600} />
      </Pressable>

      <SlideModal visible={sheetOpen} onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => !loading && setSheetOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Adjust cash collected</Text>
            <Pressable onPress={() => setSheetOpen(false)} disabled={loading} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={20} color={colors.ink900} />
            </Pressable>
          </View>

          <Text style={styles.inputLabel}>Amount actually collected (₹)</Text>
          <TextInput
            value={customAmount}
            onChangeText={(t) => { setCustomAmount(t.replace(/[^0-9.]/g, '')); setPendingConfirm(false) }}
            keyboardType="decimal-pad"
            placeholder={String(Math.round(expectedFare))}
            placeholderTextColor={colors.ink600}
            style={styles.input}
          />

          {pendingConfirm ? (
            <Text style={styles.deviationWarning}>
              That's well off the {formatCurrency(expectedFare)} fare. Tap again to confirm ₹{customAmount || '0'}.
            </Text>
          ) : null}

          {pendingConfirm ? (
            <Pressable
              onPress={confirmCustomAmount}
              disabled={loading}
              style={[styles.confirmBtn, styles.confirmBtnDanger, loading ? styles.disabled : null]}
              accessibilityRole="button"
            >
              <Text style={styles.confirmBtnText}>{loading ? 'Saving…' : `Yes, confirm ₹${customAmount || '0'}`}</Text>
            </Pressable>
          ) : (
            <Button
              label={loading ? 'Saving…' : `Confirm ₹${customAmount || '0'} collected`}
              loading={loading}
              disabled={loading || customAmount === ''}
              onPress={confirmCustomAmount}
            />
          )}

          <Pressable
            onPress={() => { setSheetOpen(false); onPartialOrNotCollected({ notCollected: true, note: '' }) }}
            disabled={loading}
            style={styles.notCollectedBtn}
          >
            <Text style={styles.notCollectedText}>Cash not collected</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </SlideModal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
    shadowColor: colors.success, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  rupee: { fontSize: 34, lineHeight: 40, fontFamily: fonts.bold, color: colors.inkInverse },
  heroLabel: { ...typography.body, lineHeight: 22, color: colors.ink600, fontFamily: fonts.semibold },
  heroFare: { fontSize: 48, fontFamily: fonts.bold, color: colors.ink900, lineHeight: 56 },
  error: { ...typography.label, color: colors.error, textAlign: 'center' },
  // A real 48px target, not a caption floating under the slider.
  altBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 48, borderRadius: radii.lg },
  altBtnText: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  backdrop: { backgroundColor: 'transparent' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, gap: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.xs },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...typography.headline, color: colors.ink900 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  inputLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  input: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, fontSize: 20, fontFamily: fonts.bold, color: colors.ink900 },
  deviationWarning: { ...typography.label, color: colors.error, textAlign: 'center' },
  confirmBtn: { paddingVertical: 15, borderRadius: radii.lg, backgroundColor: colors.primary, alignItems: 'center' },
  confirmBtnDanger: { backgroundColor: colors.error },
  confirmBtnText: { fontSize: 14.5, color: colors.inkInverse, fontFamily: fonts.bold },
  notCollectedBtn: { minHeight: 48, justifyContent: 'center', borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.error, alignItems: 'center' },
  notCollectedText: { fontSize: 14.5, color: colors.error, fontFamily: fonts.bold },
  disabled: { opacity: 0.6 },
})
