import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg'
import { Button, SlideModal, Text, font, h } from '@ocar/mobile-shared'

const GREEN_INK = '#0E7A52'
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const REASONS = [
  'A driver is already heading your way. You take a seat on their trip home, so they do not drive back empty.',
  "You pay the return rate for the same car. The standard fare shown is today's real fare for this trip.",
  'Only return-cab drivers get this request. If none accept, we tell you and you can book a standard car in one tap.',
]

/** The drawn road: the driver's way home runs dotted, and your trip is the solid stretch along it. */
function RoutePicture() {
  return (
    <Svg width="100%" height={118} viewBox="0 0 350 118" accessibilityRole="image" accessibilityLabel="Your trip rides along the road the driver is already taking home">
      <Rect width={350} height={118} rx={20} fill="#F2FAFB" />
      <Path d="M36 78 C 120 78 150 34 232 34 S 292 56 300 56" stroke="#CBD5D7" strokeWidth={3} strokeDasharray="2 7" strokeLinecap="round" fill="none" />
      <Path d="M92 66 C 140 58 170 38 232 34" stroke="#0B8296" strokeWidth={5} strokeLinecap="round" fill="none" />
      <Circle cx={36} cy={78} r={6} fill="#FFFFFF" stroke="#8A9094" strokeWidth={2.5} />
      <Circle cx={92} cy={66} r={7} fill="#0E8FA3" stroke="#FFFFFF" strokeWidth={3} />
      <Rect x={225} y={27} width={14} height={14} rx={3.5} fill="#14171A" stroke="#FFFFFF" strokeWidth={3} />
      <Circle cx={300} cy={56} r={6} fill="#FFFFFF" stroke="#8A9094" strokeWidth={2.5} />
      <G fontSize={11.5} fontWeight="600">
        <SvgText x={40} y={104} textAnchor="middle" fill="#5F6468">Driver starts</SvgText>
        <SvgText x={104} y={50} textAnchor="middle" fill="#0A7788">Your pickup</SvgText>
        <SvgText x={232} y={20} textAnchor="middle" fill="#14171A">Your drop</SvgText>
        <SvgText x={296} y={82} textAnchor="middle" fill="#5F6468">Driver's home</SvgText>
      </G>
    </Svg>
  )
}

/**
 * "Why is a return cab cheaper?" (design: the "Why is it cheaper" sheet). It explains the deal before the rider commits, shows the
 * arithmetic behind the saving, and lets them choose the return cab from here. It never books: Book stays the one place that does.
 */
export function ReturnCabWhySheet({
  visible, onClose, fare, standardFare, onChoose,
}: {
  visible: boolean
  onClose: () => void
  fare: number | null
  standardFare: number | null
  onChoose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const save = fare != null && standardFare != null && Math.round(standardFare) > Math.round(fare) ? Math.round(standardFare) - Math.round(fare) : 0

  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={s.handle} />
        <View style={s.headRow}>
          <Text style={s.title}>Why is a return cab cheaper?</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [s.close, pressed ? s.pressed : null]}>
            <Feather name="x" size={16} color="#3C4247" />
          </Pressable>
        </View>

        <View style={s.picture}><RoutePicture /></View>

        <View style={s.reasons}>
          {REASONS.map((text, i) => (
            <View key={text} style={s.reasonRow}>
              <View style={s.num}><Text style={s.numText}>{i + 1}</Text></View>
              <Text style={s.reasonText}>{text}</Text>
            </View>
          ))}
        </View>

        {save > 0 && fare != null && standardFare != null ? (
          <>
            <Pressable
              onPress={() => setOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => [s.accordion, pressed ? s.pressed : null]}
            >
              <Text style={s.accordionText}>How the saving is worked out</Text>
              <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={h.faint} />
            </Pressable>
            {open ? (
              <View style={s.math}>
                <View style={s.mathRow}><Text style={s.mathLabel}>Standard fare, same car</Text><Text style={s.mathValue}>{rupees(standardFare)}</Text></View>
                <View style={s.mathRow}><Text style={s.mathLabel}>Return cab fare</Text><Text style={s.mathValue}>{rupees(fare)}</Text></View>
                <View style={s.mathLine} />
                <View style={s.mathRow}><Text style={s.mathSave}>You save</Text><Text style={s.mathSave}>{rupees(save)}</Text></View>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={s.cta}>
          <Button
            variant="cta"
            label={fare != null ? `Choose return cab · ${rupees(fare)}` : 'Choose return cab'}
            {...(save > 0 && standardFare != null ? { strikeLabel: rupees(standardFare) } : {})}
            onPress={onChoose}
          />
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}>
          <Text style={s.secondaryText}>Compare with standard cars</Text>
        </Pressable>
      </View>
    </SlideModal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 10, boxShadow: '0 -12px 40px rgba(20,23,26,0.18)' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  picture: { marginTop: 14 },
  reasons: { marginTop: 16, gap: 14 },
  reasonRow: { flexDirection: 'row', gap: 12 },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#DDF5EA', alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: font.xb, fontSize: 12.5, color: GREEN_INK },
  reasonText: { flex: 1, fontFamily: font.m, fontSize: 14, lineHeight: 20, color: '#3C4247' },
  accordion: { marginTop: 16, minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: h.line08, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  accordionText: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  math: { marginTop: 8, borderRadius: 16, backgroundColor: '#F7F6F1', paddingVertical: 12, paddingHorizontal: 16, gap: 8 },
  mathRow: { flexDirection: 'row', justifyContent: 'space-between' },
  mathLabel: { fontFamily: font.m, fontSize: 13.5, color: h.muted },
  mathValue: { fontFamily: font.sb, fontSize: 13.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  mathLine: { height: 1, backgroundColor: h.line08 },
  mathSave: { fontFamily: font.xb, fontSize: 13.5, color: GREEN_INK, fontVariant: ['tabular-nums'] },
  cta: { marginTop: 16 },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  secondaryText: { fontFamily: font.b, fontSize: 14.5, color: h.tealText },
})
