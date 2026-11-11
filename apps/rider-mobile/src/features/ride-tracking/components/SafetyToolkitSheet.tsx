import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, SlideModal, Text, font, h } from '@ocar/mobile-shared'

type IconName = React.ComponentProps<typeof Feather>['name']

function Row({ icon, title, sub, onPress, danger }: { icon: IconName; title: string; sub: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} style={({ pressed }) => [styles.row, danger ? styles.rowDanger : null, pressed ? styles.pressed : null]}>
      <View style={[styles.rowIcon, danger ? styles.rowIconDanger : null]}><Feather name={icon} size={18} color={danger ? h.danger : h.tealText} /></View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger ? { color: h.danger } : null]}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={h.faint} />
    </Pressable>
  )
}

// The "Safety toolkit" before pickup (design: Driver.dc.html). Emergency help stays the first row, so the SOS sheet
// is never more than two taps away while the red SOS button is replaced by the Safety pill.
export function SafetyToolkitSheet({
  visible, onClose, onEmergency, onShareTrip, onContacts,
}: {
  visible: boolean
  onClose: () => void
  onEmergency: () => void
  /** Absent when this ride cannot be shared. */
  onShareTrip?: () => void
  onContacts: () => void
}) {
  const insets = useSafeAreaInsets()
  // Run the action after the sheet has closed, so two modals never fight over the screen.
  const then = (fn: () => void) => () => { onClose(); setTimeout(fn, 260) }
  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Safety toolkit</Text>
        <Text style={styles.sub}>Tools to stay safe before and during your ride.</Text>
        <View style={styles.list}>
          <Row icon="alert-triangle" title="Emergency help" sub="Call 112 or alert the Ocar safety team" onPress={then(onEmergency)} danger />
          {onShareTrip ? <Row icon="share" title="Share live trip" sub="Let family follow this ride" onPress={then(onShareTrip)} /> : null}
          <Row icon="user" title="Emergency contacts" sub="Notify them if you need help" onPress={then(onContacts)} />
        </View>
        <Button variant="cta" label="Done" onPress={onClose} />
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 18, paddingTop: 12, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 20 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 4 },
  sub: { fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: h.muted, marginBottom: 16 },
  list: { gap: 10, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: h.chip },
  rowDanger: { backgroundColor: h.dangerWash },
  pressed: { transform: [{ scale: 0.985 }] },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  rowIconDanger: { backgroundColor: '#FFFFFF' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.b, fontSize: 14.5, color: h.ivory },
  rowSub: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted, marginTop: 1 },
})
