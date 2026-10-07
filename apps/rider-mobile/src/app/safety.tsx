import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Button, Input, Text, colors, fonts, mapSaveError, useKeyboardOffset, radii, spacing, typography } from '@ocar/mobile-shared'
import { ScreenHeader } from '@/features/profile/ScreenHeader'
import { addEmergencyContact, deleteEmergencyContact, fetchEmergencyContacts, type EmergencyContact } from '@/features/profile/api'

const MAX_CONTACTS = 3

export default function SafetyScreen() {
  const insets = useSafeAreaInsets()
  // edge-to-edge: the keyboard doesn't shrink the scroll area, so reserve its height at the end
  const kb = useKeyboardOffset()
  const kbSpacer = useAnimatedStyle(() => ({ height: kb.value }))
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function load() {
    setFailed(false)
    fetchEmergencyContacts().then(setContacts).catch(() => setFailed(true)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const canAdd = name.trim().length > 0 && /^[6-9]\d{9}$/.test(phone) && !saving

  async function add() {
    setSaving(true)
    setErr('')
    try {
      const c = await addEmergencyContact(name.trim(), phone)
      setContacts((prev) => [...prev, c])
      setName('')
      setPhone('')
    } catch (e) {
      setErr(mapSaveError(e, 'Could not add this contact. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  function confirmRemove(c: EmergencyContact) {
    Alert.alert('Remove contact?', `${c.name} will no longer be alerted if you press SOS.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setContacts((prev) => prev.filter((x) => x.id !== c.id))
          deleteEmergencyContact(c.id).catch(load)
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Safety" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <View style={styles.infoCard}>
          <View style={styles.infoIcon}><Feather name="shield" size={18} color={colors.primary} /></View>
          <Text style={styles.infoText}>
            If you press SOS during a ride, Ocar's safety team is alerted and these contacts get a text with your location.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Emergency contacts</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : failed ? (
          <Pressable onPress={() => { setLoading(true); load() }}>
            <Text style={styles.retry}>Couldn't load your contacts. Tap to retry.</Text>
          </Pressable>
        ) : (
          <View style={styles.card}>
            {contacts.length === 0 ? <Text style={styles.empty}>No contacts yet. Add someone you trust below.</Text> : null}
            {contacts.map((c, i) => (
              <View key={c.id} style={[styles.row, i < contacts.length - 1 ? styles.rowBorder : null]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{c.name}</Text>
                  <Text style={styles.rowSub}>{c.phone.replace('+91', '+91 ')}</Text>
                </View>
                <Pressable onPress={() => confirmRemove(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`}>
                  <Feather name="trash-2" size={17} color={colors.ink400} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {!loading && !failed && contacts.length < MAX_CONTACTS ? (
          <View style={styles.card}>
            <Text style={styles.formTitle}>Add a contact ({contacts.length}/{MAX_CONTACTS})</Text>
            <Input value={name} onChangeText={(t) => { setName(t); setErr('') }} placeholder="Name" maxLength={60} />
            <Input
              value={phone}
              onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); setErr('') }}
              placeholder="10-digit mobile number"
              keyboardType="number-pad"
              maxLength={10}
            />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button label="Add contact" onPress={add} loading={saving} disabled={!canAdd} />
          </View>
        ) : null}
        <Animated.View style={kbSpacer} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  infoCard: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, padding: spacing.md, alignItems: 'center' },
  infoIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  infoText: { ...typography.body, color: colors.ink600, flex: 1 },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, textTransform: 'uppercase', marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderLight, paddingBottom: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.body, color: colors.primary, fontFamily: fonts.bold },
  rowTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  rowSub: { ...typography.caption, color: colors.ink400 },
  empty: { ...typography.body, color: colors.ink400 },
  formTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  err: { ...typography.caption, color: colors.error },
  retry: { ...typography.body, color: colors.primary, textAlign: 'center', marginTop: spacing.md },
})
