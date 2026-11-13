import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Button, SlideModal, Text, font, h, useKeyboardOffset } from '@ocar/mobile-shared'

// "Add a contact" bottom sheet (design: Safety.dc.html). It only holds the two fields; the screen keeps the draft, the
// validation (name present, 10-digit Indian mobile), the add call and its error handling.
export function AddContactSheet({
  visible, onClose, name, onName, phone, onPhone, canAdd, saving, error, onSubmit,
}: {
  visible: boolean
  onClose: () => void
  name: string
  onName: (v: string) => void
  phone: string
  onPhone: (v: string) => void
  canAdd: boolean
  saving: boolean
  error: string
  onSubmit: () => void
}) {
  const insets = useSafeAreaInsets()
  const kb = useKeyboardOffset()
  const kbSpacer = useAnimatedStyle(() => ({ height: kb.value }))
  const [focus, setFocus] = useState<'name' | 'phone' | null>(null)

  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <View style={styles.headRow}>
          <Text style={styles.title}>Add a contact</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}>
            <Feather name="x" size={16} color="#3C4247" />
          </Pressable>
        </View>
        <Text style={styles.sub}>They will get a text with your location if you press SOS.</Text>

        <Text style={styles.label}>Name</Text>
        <View style={[styles.field, focus === 'name' ? styles.fieldOn : null]}>
          <TextInput
            value={name}
            onChangeText={onName}
            onFocus={() => setFocus('name')}
            onBlur={() => setFocus((f) => (f === 'name' ? null : f))}
            placeholder="Full name"
            placeholderTextColor={h.faint}
            selectionColor={h.teal}
            cursorColor={h.teal}
            maxLength={60}
            autoCapitalize="words"
            style={styles.input}
          />
        </View>

        <Text style={[styles.label, { marginTop: 14 }]}>Mobile number</Text>
        <View style={[styles.field, focus === 'phone' ? styles.fieldOn : null]}>
          <Text style={styles.prefix}>+91</Text>
          <View style={styles.divider} />
          <TextInput
            value={phone}
            onChangeText={onPhone}
            onFocus={() => setFocus('phone')}
            onBlur={() => setFocus((f) => (f === 'phone' ? null : f))}
            placeholder="00000 00000"
            placeholderTextColor={h.faint}
            selectionColor={h.teal}
            cursorColor={h.teal}
            keyboardType="number-pad"
            maxLength={10}
            style={[styles.input, styles.phoneInput]}
          />
        </View>
        <Text style={styles.hint}>10 digits, no spaces</Text>

        {error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={styles.cta}>
          <Button variant="cta" label="Add contact" onPress={onSubmit} loading={saving} disabled={!canAdd} />
        </View>
        <Animated.View style={kbSpacer} />
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 10, boxShadow: '0 -12px 40px rgba(20,23,26,0.18)' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: font.b, fontSize: 18, letterSpacing: -0.2, color: h.ivory },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  sub: { fontFamily: font.m, fontSize: 13, color: h.muted, marginTop: 4, marginBottom: 18 },
  label: { fontFamily: font.sb, fontSize: 12.5, color: h.muted, marginBottom: 6 },
  field: { height: 52, borderRadius: 16, backgroundColor: '#F7F6F1', borderWidth: 1.5, borderColor: 'rgba(20,23,26,0.06)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  fieldOn: { borderColor: h.teal },
  input: { flex: 1, fontFamily: font.sb, fontSize: 15, color: h.ivory, padding: 0 },
  phoneInput: { fontVariant: ['tabular-nums'] },
  prefix: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  divider: { width: 1, height: 22, backgroundColor: 'rgba(20,23,26,0.12)' },
  hint: { fontFamily: font.m, fontSize: 12, color: h.faint, marginTop: 6 },
  err: { fontFamily: font.m, fontSize: 13, color: h.danger, marginTop: 10 },
  cta: { marginTop: 20 },
})
