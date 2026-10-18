import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { h } from '@/theme/homeTokens'
import { useNavClearance } from '@/features/home/FloatingTabBar'
import { card, geo, sectionLabel } from '@/theme/homeTokens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn, useAnimatedStyle } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, spacing, typography, TERMS_URL, DELETE_ACCOUNT_WARNING, getApiErrorMessage, requestAccountDeletion, fonts, useKeyboardOffset, mapSaveError, hasStorePage, openStorePage } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'
import { EMAIL_ERROR, isPlausibleEmail } from '@/utils/email'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchProfile, updateProfile, type ProfileStats } from '@/features/profile/api'

// `go` = live row (chevron); rows without it are inert and show `badge` (default "Soon").
type Go = 'notifications' | 'places' | 'safety' | 'support'
type MenuItem = { icon: React.ComponentProps<typeof Feather>['name']; label: string; sub: string; go?: Go; badge?: string }
const MENU: MenuItem[] = [
  { icon: 'bell', label: 'Notifications', sub: 'Alerts & preferences', go: 'notifications' },
  { icon: 'map-pin', label: 'Saved places', sub: 'Home, Work & more', go: 'places' },
  { icon: 'shield', label: 'Safety', sub: 'Emergency contacts', go: 'safety' },
  { icon: 'credit-card', label: 'Payment', sub: 'Pay your driver in cash', badge: 'Cash' },
  { icon: 'help-circle', label: 'Help & Support', sub: 'Email our support team', go: 'support' },
]
const ROUTES: Record<Exclude<Go, 'support'>, string> = { notifications: '/notification-settings', places: '/saved-places', safety: '/safety' }
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

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: clearance }]}>
        <Animated.View entering={FadeIn.duration(420)} style={styles.headerCard}>
          <View style={styles.headerRow}>
            <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </LinearGradient>
            <View style={styles.headerInfo}>
              <Text style={styles.name} numberOfLines={2}>{displayName}</Text>
              <Text style={styles.phone}>+91 {displayPhone}</Text>
              {displayEmail ? <Text style={styles.email} numberOfLines={1}>{displayEmail}</Text> : null}
            </View>
            <Pressable onPress={openEdit} style={({ pressed }) => [styles.editBtn, pressed ? styles.pressedScale : null]} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            {[
              { value: String(stats?.total_rides ?? 0), label: 'Rides' },
              { value: stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '-', label: 'Rating', star: true },
              { value: formatWallet(stats?.wallet_balance ?? 0), label: 'Wallet' },
            ].map((s) => (
              <View key={s.label} style={styles.statTile}>
                <View style={styles.statValueRow}>
                  {s.star ? <Feather name="star" size={11} color={colors.warning} /> : null}
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{s.value}</Text>
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(360)}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.menuCard}>
            {MENU.map((item) => {
              const live = item.go !== undefined
              const onPress = () => (item.go === 'support' ? void Linking.openURL(SUPPORT_MAILTO).catch(() => Alert.alert('Email us', SUPPORT_EMAIL)) : item.go ? router.push(ROUTES[item.go] as never) : undefined)
              return (
                <Pressable key={item.label} disabled={!live} onPress={onPress} style={[styles.menuRow, styles.menuRowBorder]}>
                  <View style={styles.menuIcon}>
                    <Feather name={item.icon} size={15} color={live ? colors.primary : colors.ink400} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuLabel}>{item.label}</Text>
                    <Text style={styles.menuSub}>{item.sub}</Text>
                  </View>
                  {live ? (
                    <Feather name="chevron-right" size={14} color={colors.ink400} />
                  ) : (
                    <View style={styles.soonBadge}>
                      <Text style={styles.soonBadgeText}>{item.badge ?? 'Soon'}</Text>
                    </View>
                  )}
                </Pressable>
              )
            })}
            {hasStorePage() ? (
              <Pressable style={[styles.menuRow, styles.menuRowBorder]} onPress={() => void openStorePage(null, { writeReview: true })} accessibilityRole="button">
                <View style={styles.menuIcon}>
                  <Feather name="star" size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>Rate Ocar</Text>
                  <Text style={styles.menuSub}>Tell others what you think</Text>
                </View>
                <Feather name="chevron-right" size={14} color={colors.ink400} />
              </Pressable>
            ) : null}
            {/* The only functional row in this menu -- deep-links to apps/user's
                hosted /legal/terms (which itself cross-links to /legal/privacy)
                rather than duplicating the legal text natively. */}
            <Pressable style={styles.menuRow} onPress={() => void Linking.openURL(TERMS_URL)}>
              <View style={styles.menuIcon}>
                <Feather name="file-text" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Terms & Privacy</Text>
                <Text style={styles.menuSub}>Legal information</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(360)}>
          <Pressable onPress={() => setShowSignOut(true)} style={({ pressed }) => [styles.signOutBtn, pressed ? styles.pressedScale : null]}>
            <Feather name="log-out" size={15} color={colors.error} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
          <Pressable onPress={confirmDeleteAccount} style={styles.deleteBtn} accessibilityRole="button">
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
          <Text style={styles.version}>Ocar v{APP_VERSION}</Text>
        </Animated.View>
      </ScrollView>

      <Modal visible={showSignOut} transparent animationType="fade" onRequestClose={() => setShowSignOut(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSignOut(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Sign out?</Text>
            <Text style={styles.sheetBody}>You will be signed out of your Ocar account.</Text>
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setShowSignOut(false)} style={({ pressed }) => [styles.sheetCancelBtn, pressed ? styles.pressedScale : null]}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleLogout} style={({ pressed }) => [styles.sheetConfirmBtn, pressed ? styles.pressedScale : null]}>
                <Text style={styles.sheetConfirmText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <Animated.View style={[styles.backdrop, kbStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditing(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.editHeaderRow}>
              <Text style={styles.sheetTitle}>Edit profile</Text>
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
            <Pressable
              onPress={saveEdit}
              disabled={saving || editName.trim().length < 2}
              style={({ pressed }) => [styles.saveBtn, (saving || editName.trim().length < 2) ? styles.disabled : null, pressed && !saving ? styles.pressedScale : null]}
            >
              <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.saveGradient}>
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      </Modal>
    </View>
  )
}

// whole rupees when there are no paise, otherwise two decimals; en-IN digit grouping
const formatWallet = (n: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n)}`

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  // paddingBottom clears the floating tab bar (see _layout.tsx)
  content: { padding: geo.gutter, gap: spacing.md },
  headerCard: { ...card, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontFamily: fonts.bold, color: colors.inkInverse },
  headerInfo: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, fontSize: 17 },
  phone: { ...typography.caption, color: colors.ink600 },
  email: { ...typography.caption, color: colors.ink400 },
  editBtn: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, borderRadius: radii.lg, backgroundColor: colors.primarySubtle },
  editBtnText: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight },
  statTile: { flex: 1, alignItems: 'center', paddingHorizontal: 6, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingVertical: spacing.sm + 4 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  statLabel: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  sectionLabel: { ...sectionLabel, marginBottom: 10, marginTop: spacing.sm },
  menuCard: { ...card, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  menuSub: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  soonBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.surface2 },
  soonBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.ink400 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: spacing.sm + 6, marginTop: spacing.md },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  deleteText: { ...typography.caption, color: colors.ink400, textDecorationLine: 'underline' },
  signOutText: { ...typography.body, color: colors.error, fontFamily: fonts.bold },
  version: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginTop: spacing.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  sheetBody: { ...typography.body, color: colors.ink600, marginTop: spacing.xs, marginBottom: spacing.lg },
  sheetActions: { flexDirection: 'row', gap: spacing.sm },
  sheetCancelBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  sheetCancelText: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  sheetConfirmBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.error, alignItems: 'center' },
  sheetConfirmText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, marginBottom: spacing.sm },
  inputIcon: { marginRight: 2 },
  input: { flex: 1, ...typography.body, color: colors.ink900, paddingVertical: spacing.sm + 4 },
  saveErr: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  saveBtn: { borderRadius: radii.lg, overflow: 'hidden', marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  saveGradient: { paddingVertical: spacing.sm + 6, alignItems: 'center' },
  saveText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
})
