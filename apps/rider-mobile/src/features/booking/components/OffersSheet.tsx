import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, h } from '@ocar/mobile-shared'

// TODO(backend): coupons/offers do not exist in the API yet (no endpoint, no ride field). This sheet is UI only:
// the parent passes `coupons` from a future endpoint, and discounts are computed by the server, never here.
export type OfferCoupon = { code: string; title: string; desc: string }

export type OffersSheetProps = {
  visible: boolean
  onClose: () => void
  coupons: OfferCoupon[]
  appliedCode: string | null
  onApply: (code: string) => void
  /** Free-text code entry. Left undefined until the backend can validate a code: the field then shows as unavailable. */
  onApplyCode?: (code: string) => void
}

export function OffersSheet({ visible, onClose, coupons, appliedCode, onApply, onApplyCode }: OffersSheetProps) {
  const insets = useSafeAreaInsets()
  const [code, setCode] = useState('')
  const canType = !!onApplyCode
  const canApply = canType && code.trim().length > 0
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close offers" />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
          <View style={s.handle} />
          <Text style={s.title}>Offers for this ride</Text>
          <Text style={s.sub}>One coupon can be applied per ride.</Text>

          <View style={s.codeRow}>
            <TextInput
              value={code}
              onChangeText={setCode}
              editable={canType}
              placeholder={canType ? 'Enter coupon code' : 'Coupon codes are coming soon'}
              placeholderTextColor={h.faint}
              autoCapitalize="characters"
              style={s.codeInput}
            />
            <Pressable
              disabled={!canApply}
              onPress={() => { onApplyCode?.(code.trim()); setCode('') }}
              style={[s.applyBtn, canApply ? { backgroundColor: h.tealCta } : null]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canApply }}
            >
              <Text style={[s.applyText, canApply ? { color: '#fff' } : null]}>Apply</Text>
            </Pressable>
          </View>

          <Text style={s.section}>Available coupons</Text>
          {coupons.length === 0 ? (
            <Text style={s.empty}>No coupons available right now.</Text>
          ) : (
            coupons.map((c) => {
              const applied = c.code === appliedCode
              return (
                <View key={c.code} style={[s.coupon, applied ? { borderColor: h.tealCta } : null]}>
                  <View style={s.stripe} />
                  <View style={s.couponBody}>
                    <View style={s.codeChip}><Text style={s.codeChipText}>{c.code}</Text></View>
                    <Text style={s.couponTitle}>{c.title}</Text>
                    <Text style={s.couponDesc}>{c.desc}</Text>
                  </View>
                  <Pressable
                    onPress={() => onApply(c.code)}
                    style={[s.couponBtn, applied ? s.couponBtnOn : null]}
                    accessibilityRole="button"
                    accessibilityLabel={`${applied ? 'Applied' : 'Apply'} ${c.code}`}
                  >
                    <Text style={[s.couponBtnText, applied ? { color: h.tealText } : { color: '#fff' }]}>{applied ? 'Applied' : 'Apply'}</Text>
                  </Pressable>
                </View>
              )
            })
          )}
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.5)' },
  sheet: { backgroundColor: h.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 12, paddingHorizontal: 18, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 18 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 4 },
  sub: { fontFamily: font.r, fontSize: 13.5, color: h.muted, marginBottom: 16 },
  codeRow: { flexDirection: 'row', alignItems: 'center', height: 52, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 16, paddingLeft: 16, paddingRight: 8, marginBottom: 16 },
  codeInput: { flex: 1, fontFamily: font.m, fontSize: 14.5, color: h.ivory, padding: 0 },
  applyBtn: { height: 36, paddingHorizontal: 16, borderRadius: 12, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontFamily: font.b, fontSize: 13.5, color: h.faint },
  section: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginHorizontal: 2, marginBottom: 10 },
  empty: { fontFamily: font.m, fontSize: 13.5, color: h.muted, marginHorizontal: 2, marginBottom: 6 },
  coupon: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, backgroundColor: h.surface, borderWidth: 1.5, borderColor: h.line08, borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: h.gold },
  couponBody: { flex: 1, minWidth: 0, paddingVertical: 14, paddingLeft: 20, paddingRight: 8 },
  codeChip: { alignSelf: 'flex-start', height: 24, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(214,165,82,0.8)', backgroundColor: '#FFF8E8', justifyContent: 'center', marginBottom: 8 },
  codeChipText: { fontFamily: font.xb, fontSize: 12.5, letterSpacing: 1.2, color: '#7A5410' },
  couponTitle: { fontFamily: font.b, fontSize: 15, color: h.ivory, marginBottom: 2 },
  couponDesc: { fontFamily: font.r, fontSize: 12.5, color: h.muted },
  couponBtn: { marginRight: 14, height: 38, paddingHorizontal: 18, borderRadius: 19, backgroundColor: h.tealCta, borderWidth: 1.5, borderColor: h.tealCta, alignItems: 'center', justifyContent: 'center' },
  couponBtnOn: { backgroundColor: h.tealWash },
  couponBtnText: { fontFamily: font.b, fontSize: 13.5 },
})
