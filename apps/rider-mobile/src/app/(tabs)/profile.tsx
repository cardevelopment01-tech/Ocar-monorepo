import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
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
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d
}

export default function ProfileScreen() {
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
      <ScrollView contentContainerStyle={styles.content}>
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
            <Pressable onPress={openEdit} style={styles.editBtn} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            {[
              { value: String(stats?.total_rides ?? 0), label: 'Rides' },
              { value: stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '—', label: 'Rating', star: true },
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
            {MENU.map((item, i) => (
              <Pressable key={item.label} style={[styles.menuRow, i < MENU.length - 1 ? styles.menuRowBorder : null]}>
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
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(360)}>
          <Pressable onPress={() => setShowSignOut(true)} style={styles.signOutBtn}>
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
              <Pressable onPress={() => setShowSignOut(false)} style={styles.sheetCancelBtn}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleLogout} style={styles.sheetConfirmBtn}>
                <Text style={styles.sheetConfirmText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditing(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.editHeaderRow}>
              <Text style={styles.sheetTitle}>Edit profile</Text>
              <Pressable onPress={() => setEditing(false)} style={styles.closeBtn} hitSlop={8}>
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
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </View>
            {saveErr ? <Text style={styles.saveErr}>{saveErr}</Text> : null}
            <Pressable
              onPress={saveEdit}
              disabled={saving || editName.trim().length < 2}
              style={[styles.saveBtn, (saving || editName.trim().length < 2) ? styles.disabled : null]}
            >
              <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.saveGradient}>
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  headerCard: { backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.lg, ...shadows.card },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 64, height: 64, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '700', color: colors.inkInverse },
  headerInfo: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  phone: { ...typography.caption, color: colors.ink600 },
  email: { ...typography.caption, color: colors.ink400 },
  editBtn: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, borderRadius: radii.lg, backgroundColor: colors.primarySubtle },
  editBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight },
  statTile: { flex: 1, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: radii.lg, paddingVertical: spacing.sm + 4 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { ...typography.title, color: colors.ink900, fontWeight: '700' },
  statLabel: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.sm },
  menuCard: { backgroundColor: colors.surface, borderRadius: radii.xl, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 36, height: 36, borderRadius: radii.lg, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  menuSub: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.xl, paddingVertical: spacing.sm + 6, marginTop: spacing.md, ...shadows.card },
  signOutText: { ...typography.body, color: colors.error, fontWeight: '700' },
  version: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginTop: spacing.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  sheetBody: { ...typography.body, color: colors.ink600, marginTop: spacing.xs, marginBottom: spacing.lg },
  sheetActions: { flexDirection: 'row', gap: spacing.sm },
  sheetCancelBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  sheetCancelText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
  sheetConfirmBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.error, alignItems: 'center' },
  sheetConfirmText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, marginBottom: spacing.sm },
  inputIcon: { marginRight: 2 },
  input: { flex: 1, ...typography.body, color: colors.ink900, paddingVertical: spacing.sm + 4 },
  saveErr: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  saveBtn: { borderRadius: radii.lg, overflow: 'hidden', marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
  saveGradient: { paddingVertical: spacing.sm + 6, alignItems: 'center' },
  saveText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
