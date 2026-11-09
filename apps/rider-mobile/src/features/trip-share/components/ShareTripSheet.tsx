import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ZoomIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Press, Button, SlideModal, font, h } from '@ocar/mobile-shared'
import { fetchEmergencyContacts, type EmergencyContact } from '@/features/profile/api'
import { SHARE_DISCLOSURE, maskPhone, shareMessage, summarizeSms, type CreatedShare } from '../model'
import type { TripShareState } from '../useTripShare'
import { ShareHero } from './ShareHero'

// "Share live trip": the phone's own share sheet (WhatsApp, SMS, anything) is the main way; saved contacts can also be texted
// by Ocar. Everything the sheet does goes through useTripShare, which keeps one request in flight at a time.
//
// It rides on the app's SlideModal (the scrim fades in place and only the sheet slides, with reduced motion respected) and the
// app's press feedback. The look: a live-route hero, then the sections rise in one after another.

async function openShare(url: string): Promise<void> {
  try { await Share.share({ message: shareMessage(url) }) } catch { /* the rider closed the share sheet */ }
}

const AVATAR_BG = ['#12A0B6', '#D6A552', '#7C6FD6', '#E0795A']
const initial = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()

const REASSURE: { icon: React.ComponentProps<typeof Feather>['name']; label: string }[] = [
  { icon: 'link-2', label: 'No app needed' },
  { icon: 'clock', label: 'Ends with your trip' },
  { icon: 'shield', label: 'Stop anytime' },
]

// A soft highlight that sweeps across the primary button now and then, so it reads as the one thing to press. Sits over the
// button and never takes a touch; off for reduced motion and while the button cannot be pressed.
function Sweep({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const x = useSharedValue(-1)
  useEffect(() => {
    if (!active || reduced) { x.set(-1); return }
    x.set(withRepeat(withSequence(withDelay(1600, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })), withTiming(-1, { duration: 0 })), -1, false))
  }, [active, reduced, x])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() * 220 }, { skewX: '-20deg' }] }))
  return (
    <View style={styles.sweepClip} pointerEvents="none">
      <Animated.View style={[styles.sweep, style]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.34)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  )
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
      <View style={styles.sheet} accessibilityViewIsModal>
        {/* Hero: art, handle, close, and the title written on top of it. */}
        <View>
          <ShareHero />
          <View style={styles.handle} pointerEvents="none" />
          <Press onPress={onClose} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.9} style={styles.closeBtn}>
            <Feather name="x" size={17} color="#FFFFFF" />
          </Press>
          <View style={styles.heroText} pointerEvents="none">
            <Text style={styles.title} accessibilityRole="header">Share live trip</Text>
            <Text style={styles.lead}>Anyone with the link follows your trip on a map, without installing Ocar.</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 18) + 6 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(380).delay(160)}>
            <View>
              <Button
                variant="cta"
                label={share.reusable || share.shares.length === 0 ? 'Share link' : 'Create a new link'}
                icon="share-2"
                loading={share.busy === 'link'}
                disabled={busy}
                onPress={() => void onShareLink()}
              />
              <Sweep active={!busy} />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(380).delay(240)} style={styles.reassureRow}>
            {REASSURE.map((r) => (
              <View key={r.label} style={styles.reassure}>
                <View style={styles.reassureIcon}><Feather name={r.icon} size={15} color={h.tealText} /></View>
                <Text style={styles.reassureText}>{r.label}</Text>
              </View>
            ))}
          </Animated.View>

          {share.shares.length > 0 && !share.reusable ? (
            <Text style={styles.note}>Links you shared earlier are listed under Manage. This phone no longer holds them, so make a new link to share again.</Text>
          ) : null}

          <Animated.View entering={FadeInDown.duration(380).delay(320)} style={styles.sectionRow}>
            <Text style={styles.section}>Send to my contacts</Text>
            {contacts && contacts.length > 0 ? <Text style={styles.sectionCount}>{contacts.length} saved</Text> : null}
          </Animated.View>

          {contacts === null ? (
            <ActivityIndicator color={h.teal} style={styles.loader} />
          ) : contactsFailed ? (
            <Animated.View entering={FadeInDown.duration(260)} style={styles.emptyBox}>
              <View style={[styles.emptyIcon, { backgroundColor: h.goldWash }]}><Feather name="wifi-off" size={20} color={h.goldInk} /></View>
              <Text style={styles.emptyText}>Could not load your contacts. Check your connection.</Text>
              <Button label="Try again" variant="soft" icon="refresh-cw" disabled={busy} onPress={loadContacts} />
            </Animated.View>
          ) : contacts.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(380).delay(380)} style={styles.emptyBox}>
              <View style={styles.emptyIcon}><Feather name="user-plus" size={20} color={h.tealText} /></View>
              <Text style={styles.emptyText}>Add a trusted contact to text them the link from here.</Text>
              <Button label="Add a trusted contact" variant="soft" icon="user-plus" disabled={busy} onPress={addContact} />
            </Animated.View>
          ) : (
            <View style={styles.contactBlock}>
              <View style={styles.contactList}>
                {contacts.map((c, i) => {
                  const on = picked.has(c.id)
                  return (
                    <Animated.View key={c.id} entering={FadeInDown.duration(340).delay(380 + i * 70)}>
                      <Press
                        onPress={() => toggle(c.id)}
                        disabled={busy}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on, disabled: busy }}
                        accessibilityLabel={`${c.name}, ${maskPhone(c.phone)}`}
                        scaleTo={0.985}
                        style={[styles.contactRow, on ? styles.contactRowOn : null]}
                      >
                        <View style={[styles.avatar, { backgroundColor: AVATAR_BG[i % AVATAR_BG.length] }]}>
                          <Text style={styles.avatarText}>{initial(c.name)}</Text>
                        </View>
                        <View style={styles.contactText}>
                          <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.contactPhone}>{maskPhone(c.phone)}</Text>
                        </View>
                        <View style={[styles.checkbox, on ? styles.checkboxOn : null]}>
                          {on ? <Animated.View entering={ZoomIn.springify().damping(12)}><Feather name="check" size={14} color="#FFFFFF" /></Animated.View> : null}
                        </View>
                      </Press>
                    </Animated.View>
                  )
                })}
              </View>
              <Button
                variant={picked.size > 0 ? 'cta' : 'soft'}
                label={picked.size > 0 ? `Send SMS (${picked.size})` : 'Send SMS'}
                icon="message-square"
                loading={share.busy === 'sms'}
                disabled={busy || picked.size === 0}
                onPress={() => void onSendSms()}
              />
              {contacts.length < 3 ? (
                <Pressable onPress={addContact} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
                  <Feather name="plus" size={15} color={h.tealText} />
                  <Text style={styles.linkText}>Add a contact</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {summary ? (
            <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOut.duration(140)} layout={LinearTransition.duration(220)} style={styles.resultBox} accessibilityLiveRegion="polite">
              {summary.sent.length > 0 ? (
                <View style={styles.resultRow}>
                  <Animated.View entering={ZoomIn.springify().damping(11).delay(120)} style={styles.resultCheck}><Feather name="check" size={15} color="#FFFFFF" /></Animated.View>
                  <Text style={styles.resultOk}>Sent to {summary.sent.map((s) => s.label).join(', ')}.</Text>
                </View>
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
            <Animated.View entering={FadeInDown.duration(240)} style={styles.errorBox} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <View style={styles.errorIcon}><Feather name="alert-circle" size={16} color={h.danger} /></View>
              <Text style={styles.error}>{share.error}</Text>
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.duration(380).delay(460)} style={styles.disclosureRow}>
            <Feather name="lock" size={14} color={h.faint} style={styles.lock} />
            <Text style={styles.disclosure}>{SHARE_DISCLOSURE}</Text>
          </Animated.View>
        </ScrollView>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%',
    backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden',
    boxShadow: '0 -12px 32px rgba(20,23,26,0.18)',
  },
  handle: { position: 'absolute', top: 10, alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  closeBtn: { position: 'absolute', top: 14, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  heroText: { position: 'absolute', left: 18, right: 96, bottom: 16 },
  title: { fontFamily: font.xb, fontSize: 24, letterSpacing: -0.5, color: '#FFFFFF' },
  lead: { fontFamily: font.m, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.86)', marginTop: 3 },
  scroll: { flexGrow: 0 },
  body: { gap: 14, paddingHorizontal: 18, paddingTop: 18 },
  sweepClip: { ...StyleSheet.absoluteFill, borderRadius: 18, overflow: 'hidden' },
  sweep: { position: 'absolute', top: 0, bottom: 0, width: 70 },
  reassureRow: { flexDirection: 'row', gap: 8 },
  reassure: { flex: 1, alignItems: 'center', gap: 7, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16, backgroundColor: h.chip },
  reassureIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  reassureText: { fontFamily: font.sb, fontSize: 11.5, lineHeight: 15, color: h.ivory, textAlign: 'center' },
  note: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 },
  section: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  sectionCount: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  loader: { paddingVertical: 18 },
  emptyBox: { alignItems: 'center', gap: 12, backgroundColor: h.chip, borderRadius: 22, padding: 18 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: font.m, fontSize: 14, lineHeight: 20, color: h.muted, textAlign: 'center' },
  contactBlock: { gap: 12 },
  contactList: { gap: 8 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, borderRadius: 20, backgroundColor: h.chip, borderWidth: 1.5, borderColor: 'transparent' },
  contactRowOn: { backgroundColor: '#F3FAFB', borderColor: h.tealCta },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.b, fontSize: 16, color: '#FFFFFF' },
  contactText: { flex: 1, minWidth: 0 },
  contactName: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  contactPhone: { fontFamily: font.m, fontSize: 12.5, color: h.muted, fontVariant: ['tabular-nums'] },
  checkbox: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(20,23,26,0.16)', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: h.tealCta, borderColor: h.tealCta },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4 },
  linkText: { fontFamily: font.b, fontSize: 13.5, color: h.tealText },
  resultBox: { gap: 8, backgroundColor: '#F3FAFB', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: 'rgba(14,143,163,0.22)' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultCheck: { width: 26, height: 26, borderRadius: 13, backgroundColor: h.live, alignItems: 'center', justifyContent: 'center' },
  resultOk: { flex: 1, fontFamily: font.sb, fontSize: 14, lineHeight: 20, color: h.tealText },
  failedRow: { gap: 2 },
  resultFail: { fontFamily: font.m, fontSize: 14, lineHeight: 20, color: h.danger },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: h.dangerWash, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  errorIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(194,59,59,0.12)', alignItems: 'center', justifyContent: 'center' },
  error: { flex: 1, fontFamily: font.sb, fontSize: 13.5, lineHeight: 19, color: h.danger },
  disclosureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingTop: 4 },
  lock: { marginTop: 2 },
  disclosure: { flex: 1, fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
})
