import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Press, Button, SlideModal, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchEmergencyContacts, type EmergencyContact } from '@/features/profile/api'
import { SHARE_DISCLOSURE, maskPhone, shareMessage, summarizeSms, type CreatedShare } from '../model'
import type { TripShareState } from '../useTripShare'

// "Share live trip": the phone's own share sheet (WhatsApp, SMS, anything) is the main way; saved contacts can also be texted
// by Ocar. Everything the sheet does goes through useTripShare, which keeps one request in flight at a time.
//
// It rides on the app's SlideModal (the scrim fades in place and only the sheet slides, with reduced motion respected) and the
// app's press feedback, so it moves like every other sheet in the app instead of fading in as one block.

async function openShare(url: string): Promise<void> {
  try { await Share.share({ message: shareMessage(url) }) } catch { /* the rider closed the share sheet */ }
}

export function ShareTripSheet({ visible, onClose, share }: { visible: boolean; onClose: () => void; share: TripShareState }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null)
  const [contactsFailed, setContactsFailed] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sent, setSent] = useState<CreatedShare[] | null>(null)

  // Fresh contacts and a clean slate every time the sheet opens (the rider may just have added one on the Safety screen).
  useEffect(() => {
    if (!visible) return
    setPicked(new Set())
    setSent(null)
    share.clearError()
    void share.refresh()
    loadContacts()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open only
  }, [visible])

  // A request that failed is shown as a failure with a retry: showing "no contacts" would send the rider to add one they already have.
  function loadContacts() {
    setContacts(null)
    setContactsFailed(false)
    fetchEmergencyContacts().then(setContacts).catch(() => { setContacts([]); setContactsFailed(true) })
  }

  const busy = share.busy !== null
  const summary = sent ? summarizeSms(sent) : null

  const onShareLink = async () => {
    const url = share.reusable?.url ?? (await share.createLink())
    if (url) await openShare(url)
  }
  const onSendSms = async () => {
    const created = await share.sendToContacts([...picked])
    if (created) { setSent(created); setPicked(new Set()) }
  }
  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const addContact = () => { onClose(); router.push('/safety') }

  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && onClose()} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">Share live trip</Text>
          <Press onPress={onClose} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.9} style={styles.closeBtn}>
            <Feather name="x" size={16} color={colors.ink600} />
          </Press>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.lead}>Anyone you send the link to can follow your trip on a map, without installing Ocar.</Text>

          <Button
            label={share.reusable || share.shares.length === 0 ? 'Share link' : 'Create a new link'}
            icon="share-2"
            loading={share.busy === 'link'}
            disabled={busy}
            onPress={() => void onShareLink()}
          />

          {share.shares.length > 0 && !share.reusable ? (
            <Text style={styles.note}>Links you shared earlier are listed under Manage. This phone no longer holds them, so make a new link to share again.</Text>
          ) : null}

          <Text style={styles.section}>Send to my contacts</Text>
          {contacts === null ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : contactsFailed ? (
            <Animated.View entering={FadeInDown.duration(240)} style={styles.emptyBox}>
              <Text style={styles.emptyText}>Could not load your contacts. Check your connection.</Text>
              <Button label="Try again" variant="secondary" icon="refresh-cw" disabled={busy} onPress={loadContacts} />
            </Animated.View>
          ) : contacts.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(240)} style={styles.emptyBox}>
              <Text style={styles.emptyText}>Add a trusted contact to text them the link from here.</Text>
              <Button label="Add a trusted contact" variant="secondary" icon="user-plus" disabled={busy} onPress={addContact} />
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown.duration(240)} style={styles.contactBlock}>
              <View style={styles.contactList}>
                {contacts.map((c) => {
                  const on = picked.has(c.id)
                  return (
                    <Press
                      key={c.id}
                      onPress={() => toggle(c.id)}
                      disabled={busy}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: busy }}
                      accessibilityLabel={`${c.name}, ${maskPhone(c.phone)}`}
                      scaleTo={0.985}
                      style={[styles.contactRow, on ? styles.contactRowOn : null]}
                    >
                      <View style={[styles.checkbox, on ? styles.checkboxOn : null]}>
                        {on ? <Animated.View entering={ZoomIn.duration(140)}><Feather name="check" size={14} color={colors.inkInverse} /></Animated.View> : null}
                      </View>
                      <View style={styles.contactText}>
                        <Text style={styles.contactName}>{c.name}</Text>
                        <Text style={styles.contactPhone}>{maskPhone(c.phone)}</Text>
                      </View>
                    </Press>
                  )
                })}
              </View>
              <Button
                label={picked.size > 0 ? `Send SMS (${picked.size})` : 'Send SMS'}
                variant="secondary"
                icon="message-square"
                loading={share.busy === 'sms'}
                disabled={busy || picked.size === 0}
                onPress={() => void onSendSms()}
              />
              {contacts.length < 3 ? (
                <Pressable onPress={addContact} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
                  <Text style={styles.linkText}>Add a contact</Text>
                </Pressable>
              ) : null}
            </Animated.View>
          )}

          {summary ? (
            <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(140)} layout={LinearTransition.duration(220)} style={styles.resultBox} accessibilityLiveRegion="polite">
              {summary.sent.length > 0 ? (
                <Text style={styles.resultOk}>Sent to {summary.sent.map((s) => s.label).join(', ')}.</Text>
              ) : null}
              {summary.failed.map((f) => (
                <View key={f.id} style={styles.failedRow}>
                  <Text style={styles.resultFail}>SMS not sent to {f.label}. Share the link instead.</Text>
                  <Pressable onPress={() => void openShare(f.url)} style={styles.linkBtn} accessibilityRole="button">
                    <Text style={styles.linkText}>Share link</Text>
                  </Pressable>
                </View>
              ))}
            </Animated.View>
          ) : null}

          {share.error ? (
            <Animated.Text entering={FadeInDown.duration(200)} style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{share.error}</Animated.Text>
          ) : null}

          <Text style={styles.disclosure}>{SHARE_DISCLOSURE}</Text>
        </ScrollView>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%',
    backgroundColor: colors.surface, borderTopLeftRadius: radii['3xl'], borderTopRightRadius: radii['3xl'],
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    boxShadow: '0 -6px 32px rgba(14,143,163,0.10)', // DESIGN.md sheet shadow: teal-tinted, directional
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(14,143,163,0.15)', alignSelf: 'center', marginBottom: spacing.md }, // DESIGN.md: teal-tinted 40x4 handle
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.md, paddingBottom: spacing.md },
  lead: { ...typography.body, color: colors.ink600 },
  note: { ...typography.caption, color: colors.ink600 },
  section: { ...typography.label, color: colors.ink600, fontFamily: fonts.bold, marginTop: spacing.sm },
  loader: { paddingVertical: spacing.md },
  emptyBox: { gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radii.lg, padding: spacing.md },
  emptyText: { ...typography.body, color: colors.ink600 },
  contactBlock: { gap: spacing.md },
  contactList: { gap: spacing.xs },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: 'transparent' },
  contactRowOn: { backgroundColor: colors.primarySubtle, borderColor: colors.primaryLight },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  contactText: { flex: 1 },
  contactName: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold, lineHeight: 22 },
  contactPhone: { ...typography.caption, color: colors.ink600 },
  linkBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  linkText: { ...typography.label, color: colors.primaryDark, fontFamily: fonts.bold },
  resultBox: { gap: spacing.xs, backgroundColor: colors.primarySubtle, borderRadius: radii.lg, padding: spacing.md },
  resultOk: { ...typography.body, color: colors.primaryDark, fontFamily: fonts.semibold, lineHeight: 22 },
  failedRow: { gap: 2 },
  resultFail: { ...typography.body, color: colors.error, lineHeight: 22 },
  error: { ...typography.body, color: colors.error, lineHeight: 22 },
  disclosure: { ...typography.caption, color: colors.ink600 },
})
