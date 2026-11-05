import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, SlideModal, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { formatRupees, type AppliedOffer, type IneligibleOffer } from './offerModel'
import { OfferTicket } from './OfferTicket'

type Props = {
  visible: boolean
  onClose: () => void
  /** What is applied now (a typed code or an automatic offer). */
  applied: AppliedOffer | null
  /** The other offers that would apply, from the same check. */
  alternatives: AppliedOffer[]
  /** Automatic offers the rider is a little short of, shown greyed with how much more. */
  ineligible: IneligibleOffer[]
  /** The server's reason when the last typed code was refused. */
  codeMessage: string | null
  checking: boolean
  onApplyCode: (code: string) => void
  /** Pick another offer. Never called for the one already applied. */
  onChoose: (offer: AppliedOffer) => void
  onRemove: () => void
}

// Offers sheet (design review D4): a code field at the top, then the offers that apply, then the ones the rider is close
// to. Plain rows, no banners. The code input has a visible label, upper-case keyboard and a clear button.
export function OfferSheet({ visible, onClose, applied, alternatives, ineligible, codeMessage, checking, onApplyCode, onChoose, onRemove }: Props) {
  const insets = useSafeAreaInsets()
  const [code, setCode] = useState('')
  useEffect(() => { if (visible) setCode('') }, [visible])
  const canApply = code.trim().length >= 3 && !checking
  const eligible = [...(applied ? [applied] : []), ...alternatives]

  function apply() {
    if (!canApply) return
    onApplyCode(code)
    onClose()
  }

  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close offers" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerBadge}><Feather name="gift" size={20} color={colors.primaryDark} /></View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Offers</Text>
            <Text style={styles.headerSub}>Codes and offers for this ride</Text>
          </View>
        </View>

        <Text style={styles.label} nativeID="offer-code-label">Offer code</Text>
        <View style={styles.inputRow}>
          <TextInput
            value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={24} returnKeyType="done"
            onSubmitEditing={apply} placeholder="e.g. SAVE10" placeholderTextColor={colors.ink400} style={styles.input}
            accessibilityLabel="Offer code" accessibilityLabelledBy="offer-code-label"
          />
          {code !== '' ? (
            <Pressable onPress={() => setCode('')} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear code" hitSlop={6}>
              <Feather name="x" size={16} color={colors.ink600} />
            </Pressable>
          ) : null}
        </View>
        {codeMessage ? (
          <View style={styles.problemRow} accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={14} color={colors.error} />
            <Text style={styles.problem}>{codeMessage}</Text>
          </View>
        ) : null}
        <Button label={checking ? 'Checking…' : 'Apply'} onPress={apply} disabled={!canApply} accessibilityLabel="Apply this code" />

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {eligible.length > 0 ? <Text style={styles.section}>Available for this ride</Text> : null}
          {eligible.map((o, i) => (
            <Pressable key={o.offerId} onPress={() => { if (o.offerId !== applied?.offerId) onChoose(o); onClose() }}
              accessibilityRole="button" accessibilityState={{ selected: i === 0 && applied != null }} accessibilityLabel={`${o.name}. ${o.summary}. You save ${formatRupees(o.discount)}`}>
              <OfferTicket tone={i === 0 && applied ? 'applied' : 'available'} notch={colors.surface} title={o.code ?? o.name} subtitle={o.summary} saving={`Save ${formatRupees(o.discount)}`} />
            </Pressable>
          ))}

          {ineligible.length > 0 ? <Text style={styles.section}>Not yet</Text> : null}
          {ineligible.map((o) => (
            <OfferTicket key={o.offerId} tone="muted" notch={colors.surface} title={o.name} subtitle={o.message} accessibilityLabel={`${o.name}. ${o.summary}. ${o.message}`} />
          ))}

          {eligible.length === 0 && ineligible.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyBadge}><Feather name="tag" size={22} color={colors.ink400} /></View>
              <Text style={styles.empty}>No offers for this ride right now. Have a code? Enter it above.</Text>
            </View>
          ) : null}
        </ScrollView>

        {applied ? (
          <Pressable onPress={() => { onRemove(); onClose() }} style={styles.removeRow} accessibilityRole="button" accessibilityLabel="Remove the offer">
            <Text style={styles.removeText}>Remove offer</Text>
          </Pressable>
        ) : null}
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, maxHeight: '80%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  headerBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerSub: { ...typography.caption, color: colors.ink600 },
  title: { ...typography.headline, color: colors.ink900 },
  label: { ...typography.label, fontFamily: fonts.semibold, color: colors.ink600, marginBottom: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface2, marginBottom: spacing.sm },
  input: { ...typography.body, flex: 1, minHeight: 48, paddingHorizontal: spacing.md, fontFamily: fonts.semibold, color: colors.ink900, letterSpacing: 0.5 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  problem: { ...typography.body, flex: 1, color: colors.ink900 },
  list: { marginTop: spacing.md },
  listContent: { gap: spacing.xs, paddingBottom: spacing.sm },
  section: { ...typography.label, fontFamily: fonts.bold, color: colors.ink600, marginTop: spacing.xs },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.lg },
  offerOn: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  offerOff: { opacity: 0.7 },
  offerText: { flex: 1, minWidth: 0 },
  offerName: { ...typography.body, fontFamily: fonts.bold, color: colors.ink900 },
  offerSub: { ...typography.caption, color: colors.ink600 },
  save: { ...typography.body, fontFamily: fonts.bold, color: colors.moneyInk },
  why: { ...typography.caption, fontFamily: fonts.semibold, color: colors.ink600, maxWidth: 130, textAlign: 'right' },
  emptyBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyBadge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.body, color: colors.ink600, textAlign: 'center', maxWidth: 280 },
  removeRow: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  removeText: { ...typography.body, fontFamily: fonts.bold, color: colors.error },
})
