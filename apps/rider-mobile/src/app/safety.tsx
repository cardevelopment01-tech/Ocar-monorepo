import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Text, font, h, mapSaveError, spacing } from '@ocar/mobile-shared'
import { ScreenHeader } from '@/features/profile/ScreenHeader'
import { addEmergencyContact, deleteEmergencyContact, fetchEmergencyContacts, type EmergencyContact } from '@/features/profile/api'
import { confirmDialog } from '@/components/ui/confirm'
import { AddContactSheet } from '@/features/profile/AddContactSheet'

const MAX_CONTACTS = 3

export default function SafetyScreen() {
  const insets = useSafeAreaInsets()
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)

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
      setSheetOpen(false)
    } catch (e) {
      setErr(mapSaveError(e, 'Could not add this contact. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  function closeSheet() {
    setSheetOpen(false)
    setName('')
    setPhone('')
    setErr('')
  }

  function confirmRemove(c: EmergencyContact) {
    confirmDialog('Remove contact?', `${c.name} will no longer be alerted if you press SOS.`, [
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

  const atLimit = contacts.length >= MAX_CONTACTS

  return (
    <View style={styles.container}>
      <ScreenHeader title="Safety" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          If you press SOS during a ride, Ocar's safety team is alerted and these contacts get a text with your location.
        </Text>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>Emergency contacts</Text>
          {!loading && !failed ? <Text style={[styles.count, atLimit ? styles.countFull : null]}>{`${contacts.length} of ${MAX_CONTACTS}`}</Text> : null}
        </View>

        {loading ? (
          <ActivityIndicator color={h.teal} style={{ marginTop: spacing.md }} />
        ) : failed ? (
          <Pressable onPress={() => { setLoading(true); load() }}>
            <Text style={styles.retry}>Couldn't load your contacts. Tap to retry.</Text>
          </Pressable>
        ) : contacts.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Feather name="user-plus" size={26} color={h.tealText} /></View>
            <Text style={styles.emptyTitle}>No contacts yet</Text>
            <Text style={styles.emptyText}>Add someone who should know where you are if you ever press SOS.</Text>
            <View style={styles.emptyCta}>
              <Button variant="cta" label="Add a contact" onPress={() => setSheetOpen(true)} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              {contacts.map((c, i) => (
                <View key={c.id} style={[styles.row, i > 0 ? styles.rowBorder : null]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{c.name.trim().charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.rowSub}>{formatPhone(c.phone)}</Text>
                  </View>
                  <Pressable onPress={() => confirmRemove(c)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} style={({ pressed }) => [styles.remove, pressed ? styles.pressed : null]}>
                    <Feather name="x" size={16} color="#3C4247" />
                  </Pressable>
                </View>
              ))}
            </View>

            {atLimit ? (
              <Text style={styles.limitText}>You have added the maximum of {MAX_CONTACTS} contacts. Remove one to add another.</Text>
            ) : null}
          </>
        )}

        {!loading && !failed && contacts.length > 0 && !atLimit ? (
          <Pressable onPress={() => setSheetOpen(true)} accessibilityRole="button" accessibilityLabel="Add a contact" style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}>
            <View style={styles.addIcon}><Feather name="plus" size={16} color={h.tealText} /></View>
            <View style={styles.rowText}>
              <Text style={styles.addTitle}>Add a contact</Text>
              <Text style={styles.addSub}>Someone you trust, up to {MAX_CONTACTS}</Text>
            </View>
          </Pressable>
        ) : null}
      </ScrollView>

      <AddContactSheet
        visible={sheetOpen}
        onClose={closeSheet}
        name={name}
        onName={(t) => { setName(t); setErr('') }}
        phone={phone}
        onPhone={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); setErr('') }}
        canAdd={canAdd}
        saving={saving}
        error={err}
        onSubmit={add}
      />
    </View>
  )
}

// "+919861024517" -> "+91 98610 24517"
function formatPhone(p: string): string {
  const d = p.replace('+91', '')
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p.replace('+91', '+91 ')
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  content: { paddingHorizontal: 18, paddingTop: 2 },
  pressed: { opacity: 0.7 },
  intro: { fontFamily: font.m, fontSize: 14, lineHeight: 21, color: h.muted, marginHorizontal: 2, marginTop: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 12, marginHorizontal: 2 },
  sectionLabel: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  count: { fontFamily: font.sb, fontSize: 13, color: h.muted, fontVariant: ['tabular-nums'] },
  countFull: { color: '#9A6A12' },
  card: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05), inset 0 1px 0 rgba(255,255,255,0.9)', paddingHorizontal: 16 },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: h.line06 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.xb, fontSize: 15, color: h.tealText },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  rowSub: { fontFamily: font.m, fontSize: 13, color: h.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  remove: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  limitText: { fontFamily: font.m, fontSize: 13, lineHeight: 19, color: h.muted, marginTop: 14, marginHorizontal: 4 },
  addRow: { marginTop: 14, minHeight: 64, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(14,143,163,0.45)', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  addIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  addTitle: { fontFamily: font.b, fontSize: 14.5, color: h.tealText },
  addSub: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginTop: 1 },
  emptyCard: { alignItems: 'center', backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05)', paddingTop: 32, paddingBottom: 26, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: font.b, fontSize: 16, color: h.ivory, marginTop: 16 },
  emptyText: { fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: h.muted, textAlign: 'center', marginTop: 6, maxWidth: 260 },
  emptyCta: { marginTop: 20, alignSelf: 'stretch' },
  retry: { fontFamily: font.m, fontSize: 14, color: h.tealText, textAlign: 'center', marginTop: spacing.md },
})
