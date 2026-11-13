import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, SlideModal, font, h } from '@ocar/mobile-shared'
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
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerBadge}><Feather name="gift" size={20} color="#8A5F12" /></View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Offers</Text>
            <Text style={styles.headerSub}>Codes and offers for this ride</Text>
          </View>
        </View>

        <Text style={styles.label} nativeID="offer-code-label">Offer code</Text>
        <View style={styles.inputRow}>
          <TextInput
            value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={24} returnKeyType="done"
            onSubmitEditing={apply} placeholder="e.g. SAVE10" placeholderTextColor={h.faint} style={styles.input}
            accessibilityLabel="Offer code" accessibilityLabelledBy="offer-code-label"
          />
          {code !== '' ? (
            <Pressable onPress={() => setCode('')} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear code" hitSlop={6}>
              <Feather name="x" size={16} color={h.muted} />
            </Pressable>
          ) : null}
        </View>
        {codeMessage ? (
          <View style={styles.problemRow} accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={14} color={h.danger} />
            <Text style={styles.problem}>{codeMessage}</Text>
          </View>
        ) : null}
        <Button variant="cta" label={checking ? 'Checking…' : 'Apply'} onPress={apply} disabled={!canApply} accessibilityLabel="Apply this code" />

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {eligible.length > 0 ? <Text style={styles.section}>Available for this ride</Text> : null}
          {eligible.map((o, i) => (
            <Pressable key={o.offerId} onPress={() => { if (o.offerId !== applied?.offerId) onChoose(o); onClose() }}
              accessibilityRole="button" accessibilityState={{ selected: i === 0 && applied != null }} accessibilityLabel={`${o.name}. ${o.summary}. You save ${formatRupees(o.discount)}`}>
              <OfferTicket tone={i === 0 && applied ? 'applied' : 'available'} notch={h.canvas} title={o.code ?? o.name} subtitle={o.summary} saving={`Save ${formatRupees(o.discount)}`} />
            </Pressable>
          ))}

          {ineligible.length > 0 ? <Text style={styles.section}>Almost there</Text> : null}
          {ineligible.map((o) => (
            <OfferTicket key={o.offerId} tone="muted" notch={h.canvas} title={o.name} subtitle={o.message} accessibilityLabel={`${o.name}. ${o.summary}. ${o.message}`} />
          ))}

          {eligible.length === 0 && ineligible.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyBadge}><Feather name="tag" size={22} color="#8A5F12" /></View>
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
  sheet: { backgroundColor: h.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 18, paddingTop: 12, maxHeight: '86%', boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  headerBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: h.goldWash, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerSub: { fontFamily: font.m, fontSize: 13.5, color: h.muted },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  label: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: h.line10, borderRadius: 16, backgroundColor: h.surface, marginBottom: 10 },
  input: { flex: 1, minHeight: 52, paddingHorizontal: 16, fontFamily: font.sb, fontSize: 14.5, color: h.ivory, letterSpacing: 0.8 },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  problem: { flex: 1, fontFamily: font.m, fontSize: 13.5, color: h.danger },
  list: { marginTop: 16 },
  listContent: { gap: 10, paddingBottom: 10 },
  section: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginTop: 4, marginHorizontal: 2 },
  emptyBox: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  emptyBadge: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(214,165,82,0.6)', backgroundColor: h.goldWash, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: font.m, fontSize: 14, lineHeight: 20, color: h.muted, textAlign: 'center', maxWidth: 280 },
  removeRow: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontFamily: font.b, fontSize: 14.5, color: h.danger },
})
