import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { h, font, geo, sectionLabel, shadow } from '@/theme/homeTokens'
import { useNavClearance } from '@/features/home/FloatingTabBar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, Ionicons } from "@expo/vector-icons"
import Animated, { FadeInDown, FadeIn, useAnimatedStyle } from 'react-native-reanimated'
import { Button, Press, colors, radii, spacing, typography, TERMS_URL, DELETE_ACCOUNT_WARNING, getApiErrorMessage, requestAccountDeletion, sendTestError, useKeyboardOffset, mapSaveError, hasStorePage, openStorePage } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'
import { EMAIL_ERROR, isPlausibleEmail } from '@/utils/email'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchProfile, updateProfile, type ProfileStats } from '@/features/profile/api'
import { Chip, GroupedList, IconButton, ListRow } from '@/components/ui'

const ROUTES = { notifications: '/notification-settings', places: '/saved-places', safety: '/safety', offers: '/offers' } as const
const SUPPORT_EMAIL = 'grievance@ocarindia.com'
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=Ocar%20rider%20support`
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '-'
  const d = raw.replace(/\D/g, '')
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d
}

export default function ProfileScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const clearance = useNavClearance()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const updateUser = useAuthStore((s) => s.updateUser)

  // edge-to-edge breaks KeyboardAvoidingView on Android -- see useKeyboardOffset
  const kbOffset = useKeyboardOffset()
  const kbStyle = useAnimatedStyle(() => ({ paddingBottom: kbOffset.value }))
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [showSignOut, setShowSignOut] = useState(false)

  useEffect(() => {
    fetchProfile().then(setStats).catch(() => {})
  }, [])

  const displayName = stats?.name ?? user?.name ?? 'Rider'
  const displayPhone = normalizePhone(stats?.phone ?? user?.phone)
  const displayEmail = stats?.email ?? user?.email ?? null
  const initial = displayName.charAt(0).toUpperCase()

  function openEdit() {
    setEditName(displayName === 'Rider' ? '' : displayName)
    setEditEmail(displayEmail ?? '')
    setSaveErr('')
    setEditing(true)
  }

  async function saveEdit() {
    if (editName.trim().length < 2) { setSaveErr('Name must be at least 2 characters.'); return }
    if (editEmail.trim() && !isPlausibleEmail(editEmail)) { setSaveErr(EMAIL_ERROR); return }
    setSaving(true)
    setSaveErr('')
    try {
      const hadEmail = !!displayEmail
      const body: { full_name: string; email?: string | null } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      else if (hadEmail) body.email = null // field cleared -> remove the saved email
      // PATCH returns the bare user row (no rides/rating/wallet), so merge instead of replacing stats
      const fresh = await updateProfile(body)
      setStats((prev) => (prev ? { ...prev, name: fresh.name, email: fresh.email } : fresh))
      updateUser({ name: fresh.name, email: fresh.email })
      setEditing(false)
    } catch (err) {
      setSaveErr(mapSaveError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    // Revoke the refresh token on the server. Sent without waiting (the token is already read), so signing out is
    // instant and still works with no network.
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) void api.post('/api/v1/auth/logout', { refreshToken }, { timeout: 5000 }).catch(() => undefined)
    await teardownPushNotifications()
    clearAuth()
  }

  function confirmDeleteAccount() {
    Alert.alert('Delete your account?', DELETE_ACCOUNT_WARNING, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteAccountNow() },
    ])
  }

  async function deleteAccountNow() {
    try {
      await requestAccountDeletion(api)
    } catch (err) {
      Alert.alert('Could not delete your account', getApiErrorMessage(err, 'Please try again, or contact support.'))
      return
    }
    // The server already removed this device's push token; this clears the local FCM registration too.
    await teardownPushNotifications().catch(() => undefined)
    clearAuth()
  }

  const openSupport = () => void Linking.openURL(SUPPORT_MAILTO).catch(() => Alert.alert('Email us', SUPPORT_EMAIL))
  const go = (r: keyof typeof ROUTES) => () => router.push(ROUTES[r] as never)

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: clearance }]}>
        <Text style={styles.title}>Account</Text>

        <Animated.View entering={FadeIn.duration(420)}>
          <LinearGradient colors={['#FFFFFF', '#EEF8F9']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.hero}>
            <LinearGradient colors={['rgba(214,165,82,0)', 'rgba(214,165,82,0.8)', 'rgba(214,165,82,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.goldLine} />
            <View style={styles.headerRow}>
              <LinearGradient colors={['#12A0B6', '#0A7788']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </LinearGradient>
              <View style={styles.headerInfo}>
                <Text style={styles.name} numberOfLines={2}>{displayName}</Text>
                <Text style={styles.phone}>+91 {displayPhone}</Text>
                {displayEmail ? <Text style={styles.email} numberOfLines={1}>{displayEmail}</Text> : null}
              </View>
              <IconButton icon="edit-2" label="Edit profile" color={h.tealText} onPress={openEdit} />
            </View>

            {/* The wallet stat is gone from the UI by design; `stats.wallet_balance` is still fetched. */}
            <View style={styles.statsRow}>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>{String(stats?.total_rides ?? 0)}</Text>
                <Text style={styles.statLabel}>Rides taken</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statTile}>
                <View style={styles.statValueRow}>
                  <Ionicons name="star" size={17} color="#E2A93B" />
                  <Text style={styles.statValue}>{stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '-'}</Text>
                </View>
                <Text style={styles.statLabel}>Your rating</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.tiles}>
          <Press onPress={go('places')} scaleTo={0.98} label="Saved places" hit={styles.tileHit} style={styles.tile}>
            <View style={[styles.tileIcon, { backgroundColor: h.tealWash }]}><Feather name="map-pin" size={20} color={h.tealText} /></View>
            <Text style={styles.tileTitle}>Saved places</Text>
            <Text style={styles.tileSub}>Home, Work and more</Text>
          </Press>
          <Press onPress={go('offers')} scaleTo={0.98} label="Offers" hit={styles.tileHit} style={styles.tile}>
            <View style={[styles.tileIcon, { backgroundColor: h.goldWash }]}><Feather name="tag" size={20} color="#8A5F12" /></View>
            <Text style={styles.tileTitle}>Offers</Text>
            <Text style={styles.tileSub}>Discounts for rides</Text>
          </Press>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(140).duration(360)}>
          <Text style={styles.sectionLabel}>Preferences</Text>
          <GroupedList>
            <ListRow icon="credit-card" title="Payment" subtitle="Pay your driver in cash" right={<Chip label="Cash" tone="neutral" />} />
            <ListRow icon="bell" title="Notifications" subtitle="Alerts and preferences" onPress={go('notifications')} />
            <ListRow icon="shield" title="Safety" subtitle="Emergency contacts" onPress={go('safety')} />
          </GroupedList>

          <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Support</Text>
          <GroupedList>
            <ListRow icon="help-circle" title="Help and support" subtitle="Email our support team" onPress={openSupport} />
            {hasStorePage() ? <ListRow icon="star" title="Rate Ocar" subtitle="Tell others what you think" onPress={() => void openStorePage(null, { writeReview: true })} /> : null}
            {/* Deep-links to the hosted /legal/terms (which cross-links /legal/privacy). */}
            <ListRow icon="file-text" title="Terms and privacy" subtitle="Legal information" onPress={() => void Linking.openURL(TERMS_URL)} />
          </GroupedList>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(360)}>
          <Press onPress={() => setShowSignOut(true)} scaleTo={0.98} label="Sign out" style={styles.signOutBtn}>
            <Feather name="log-out" size={17} color={h.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Press>
          <Pressable onPress={confirmDeleteAccount} style={styles.deleteBtn} accessibilityRole="button">
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
          <Text style={styles.version} onLongPress={() => { sendTestError('rider'); Alert.alert('Monitoring test', 'Test error sent.') }}>Ocar v{APP_VERSION}</Text>
        </Animated.View>
      </ScrollView>

      <Modal visible={showSignOut} transparent animationType="fade" onRequestClose={() => setShowSignOut(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSignOut(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Sign out of Ocar?</Text>
            <Text style={styles.sheetBody}>You can sign back in anytime with your phone number. Your trip history stays safe.</Text>
            <Button variant="cta" label="Stay signed in" onPress={() => setShowSignOut(false)} />
            <Pressable onPress={handleLogout} style={styles.sheetSignOut} accessibilityRole="button">
              <Text style={styles.sheetSignOutText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <Animated.View style={[styles.backdrop, kbStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditing(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.editHeaderRow}>
              <Text style={[styles.sheetTitle, { marginBottom: 0 }]}>Edit profile</Text>
              <Pressable onPress={() => setEditing(false)} style={({ pressed }) => [styles.closeBtn, pressed ? styles.pressedScale : null]} hitSlop={8}>
                <Feather name="x" size={15} color={colors.ink600} />
              </Pressable>
            </View>
            <View style={styles.inputWrap}>
              <Feather name="user" size={15} color={colors.ink400} style={styles.inputIcon} />
              <TextInput
                value={editName}
                onChangeText={(t) => { setEditName(t); setSaveErr('') }}
                placeholder="Your full name"
                placeholderTextColor={colors.ink400}
                selectionColor={colors.primary}
                cursorColor={colors.primary}
                maxLength={120}
                autoFocus
                style={styles.input}
              />
            </View>
            <View style={styles.inputWrap}>
              <Feather name="mail" size={15} color={colors.ink400} style={styles.inputIcon} />
              <TextInput
                value={editEmail}
                onChangeText={(t) => { setEditEmail(t); setSaveErr('') }}
                placeholder="Email address (optional)"
                placeholderTextColor={colors.ink400}
                selectionColor={colors.primary}
                cursorColor={colors.primary}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </View>
            {saveErr ? <Text style={styles.saveErr}>{saveErr}</Text> : null}
            <Button variant="cta" label="Save changes" onPress={saveEdit} loading={saving} disabled={editName.trim().length < 2} />
          </View>
        </Animated.View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  // paddingBottom clears the floating tab bar (see _layout.tsx)
  content: { padding: geo.gutter, gap: 14 },
  title: { fontFamily: font.xb, fontSize: 28, letterSpacing: -0.7, color: h.ivory, marginHorizontal: 2, marginBottom: 4 },
  hero: { borderRadius: 26, borderWidth: 1, borderColor: h.line07, boxShadow: '0 6px 20px rgba(20,23,26,0.06), inset 0 1px 0 rgba(255,255,255,0.95)', paddingTop: 20, paddingHorizontal: 18, paddingBottom: 18, overflow: 'hidden' },
  goldLine: { position: 'absolute', top: 0, left: 24, right: 24, height: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px #FFFFFF, 0 0 0 4.5px rgba(214,165,82,0.75), 0 10px 22px rgba(14,143,163,0.28)' },
  avatarText: { fontSize: 29, fontFamily: font.b, color: '#FFFFFF' },
  headerInfo: { flex: 1, gap: 3 },
  name: { fontFamily: font.xb, fontSize: 20, lineHeight: 24, letterSpacing: -0.3, color: h.ivory },
  phone: { fontFamily: font.m, fontSize: 13.5, color: h.muted, fontVariant: ['tabular-nums'] },
  email: { fontFamily: font.m, fontSize: 12.5, color: h.faint },
  statsRow: { flexDirection: 'row', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: h.line08 },
  statTile: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: h.line08 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { fontFamily: font.xb, fontSize: 22, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: font.m, fontSize: 12, color: h.muted, marginTop: 2 },
  tiles: { flexDirection: 'row', gap: 12 },
  tileHit: { flex: 1 },
  tile: { padding: 16, backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: shadow.sm },
  tileIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  tileTitle: { fontFamily: font.b, fontSize: 15, color: h.ivory, marginBottom: 2 },
  tileSub: { fontFamily: font.r, fontSize: 12.5, color: h.muted },
  sectionLabel: { ...sectionLabel, marginHorizontal: 2, marginTop: 14, marginBottom: 10 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(194,59,59,0.28)', marginTop: 10 },
  signOutText: { fontFamily: font.b, fontSize: 15, color: h.danger },
  deleteBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 8 },
  deleteText: { fontFamily: font.sb, fontSize: 13, color: h.label },
  version: { fontFamily: font.r, fontSize: 12, color: h.faint, textAlign: 'center', marginTop: 2 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 30, boxShadow: '0 -10px 30px rgba(20,23,26,0.12)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.12)', alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 6 },
  sheetBody: { fontFamily: font.r, fontSize: 14, lineHeight: 21, color: h.muted, marginBottom: 20 },
  sheetSignOut: { height: 54, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  sheetSignOutText: { fontFamily: font.b, fontSize: 15.5, color: h.danger },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, marginBottom: spacing.sm },
  inputIcon: { marginRight: 2 },
  input: { flex: 1, ...typography.body, color: colors.ink900, paddingVertical: spacing.sm + 4 },
  saveErr: { ...typography.caption, color: h.danger, marginBottom: spacing.sm },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
