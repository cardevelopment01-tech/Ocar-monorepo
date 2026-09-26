import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { h } from '@/theme/homeTokens'
import { useNavClearance } from '@/features/home/FloatingTabBar'
import { card, sectionLabel } from '@/theme/homeTokens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, spacing, typography, TERMS_URL, fonts } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchProfile, updateProfile, type ProfileStats } from '@/features/profile/api'

// Menu items are visual-parity ports of the web profile page's inert placeholders --
// apps/user/app/(main)/profile/page.tsx's own MENU items have no working nav
// wired yet either (see CLAUDE.md's "Known UI Caveats"), so these stay
// non-functional the same way, not a mobile-specific gap.
const MENU = [
  { icon: 'map-pin' as const, label: 'Saved places', sub: 'Home, Work & more' },
  { icon: 'credit-card' as const, label: 'Payment methods', sub: 'UPI, Cards & Wallet' },
  { icon: 'bell' as const, label: 'Notifications', sub: 'Push & SMS alerts' },
  { icon: 'shield' as const, label: 'Safety', sub: 'Emergency contacts' },
  { icon: 'help-circle' as const, label: 'Help & Support', sub: 'FAQs, raise a ticket' },
]

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '-'
  const d = raw.replace(/\D/g, '')
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const clearance = useNavClearance()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const updateUser = useAuthStore((s) => s.updateUser)

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
    setSaving(true)
    setSaveErr('')
    try {
      const body: { full_name: string; email?: string } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      const fresh = await updateProfile(body)
      setStats(fresh)
      updateUser({ name: fresh.name, email: fresh.email })
      setEditing(false)
    } catch {
      setSaveErr('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    await teardownPushNotifications()
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
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
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
              { value: `₹${stats?.wallet_balance ?? 0}`, label: 'Wallet' },
            ].map((s) => (
              <View key={s.label} style={styles.statTile}>
                <View style={styles.statValueRow}>
                  {s.star ? <Feather name="star" size={11} color={colors.warning} /> : null}
                  <Text style={styles.statValue}>{s.value}</Text>
                </View>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(360)}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.menuCard}>
            {MENU.map((item) => (
              <Pressable key={item.label} style={[styles.menuRow, styles.menuRowBorder]}>
                <View style={styles.menuIcon}>
                  <Feather name={item.icon} size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuSub}>{item.sub}</Text>
                </View>
                <Feather name="chevron-right" size={14} color={colors.ink400} />
              </Pressable>
            ))}
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
          <Text style={styles.version}>Ocar v1.0.0</Text>
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
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
                onChangeText={setEditEmail}
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  // paddingBottom clears the floating tab bar (see _layout.tsx)
  content: { padding: spacing.lg, gap: spacing.md },
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
  statTile: { flex: 1, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: radii.lg, paddingVertical: spacing.sm + 4 },
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
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: spacing.sm + 6, marginTop: spacing.md },
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
