import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchDriverStats, updateDriverProfile, type DriverStats } from '@/features/profile/api'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: colors.successLight, text: colors.success },
  pending_approval: { bg: colors.warningLight, text: colors.warning },
  suspended: { bg: colors.errorLight, text: colors.error },
  banned: { bg: colors.errorLight, text: colors.error },
}

// Vehicle/Documents/Personal-info detail screens don't exist on mobile yet (web's
// /profile/vehicle, /profile/documents, /profile/personal have no mobile counterpart
// built this pass) -- rows stay visual-parity placeholders, same "known gap, not a
// stub" treatment as the driver-mobile Home screen's omitted Wallet row.
const MENU = [
  { icon: 'truck' as const, label: 'Vehicle Details', sub: 'Registered vehicle' },
  { icon: 'file-text' as const, label: 'Documents', sub: 'Verified documents' },
  { icon: 'user' as const, label: 'Personal & Emergency Info', sub: 'Address, ID & emergency contact' },
]

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  return raw.replace('+91', '').trim()
}

export default function ProfileScreen() {
  const driver = useAuthStore((s) => s.driver)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const updateDriver = useAuthStore((s) => s.updateDriver)
  const isOnline = useDriverSessionStore((s) => s.isOnline)

  const [stats, setStats] = useState<DriverStats | null>(null)
  const [missingDocs, setMissingDocs] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [showSignOut, setShowSignOut] = useState(false)

  useEffect(() => {
    fetchDriverStats()
      .then(({ stats: s, onboarding }) => {
        setStats(s)
        setMissingDocs(onboarding.missing_documents.length)
      })
      .catch(() => {})
  }, [])

  const displayName = driver?.full_name ?? driver?.code ?? 'Driver'
  const displayPhone = normalizePhone(driver?.phone)
  const initial = displayName.charAt(0).toUpperCase()
  const statusStyle = STATUS_COLORS[driver?.status ?? ''] ?? { bg: colors.surface3, text: colors.ink400 }

  function openEdit() {
    setEditName(driver?.full_name ?? '')
    setEditEmail(driver?.email ?? '')
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
      const updated = await updateDriverProfile(body)
      updateDriver({ full_name: updated.full_name, email: updated.email })
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
              <View style={styles.badgeRow}>
                <Feather name="star" size={12} color={colors.warning} />
                <Text style={styles.badgeText}>{stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '—'}</Text>
                <Feather name="truck" size={12} color={colors.ink400} style={{ marginLeft: spacing.xs }} />
                <Text style={styles.badgeTextMuted}>{stats?.total_rides ?? 0} trips</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <View style={[styles.statusPill, { backgroundColor: statusStyle.bg }]}>
                <Text style={[styles.statusPillText, { color: statusStyle.text }]}>{driver?.status ?? '—'}</Text>
              </View>
              <Pressable onPress={openEdit} style={styles.editBtn} accessibilityRole="button" accessibilityLabel="Edit profile">
                <Feather name="edit-2" size={13} color={colors.ink600} />
              </Pressable>
            </View>
          </View>

          {stats && stats.top_tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {stats.top_tags.map((t) => (
                <View key={t.label} style={styles.tag}>
                  <Text style={styles.tagText}>{t.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(360)}>
          <Text style={styles.sectionLabel}>VEHICLE & DOCUMENTS</Text>
          <View style={styles.menuCard}>
            {MENU.slice(0, 2).map((item, i) => (
              <Pressable key={item.label} style={[styles.menuRow, i === 0 ? styles.menuRowBorder : null]}>
                <View style={styles.menuIcon}>
                  <Feather name={item.icon} size={15} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuSub}>{item.sub}</Text>
                </View>
                {item.icon === 'file-text' && missingDocs > 0 ? (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>{missingDocs} pending</Text>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={14} color={colors.ink400} />
              </Pressable>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160).duration(360)}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.menuCard}>
            <Pressable style={styles.menuRow}>
              <View style={styles.menuIcon}>
                <Feather name="user" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>{MENU[2]!.label}</Text>
                <Text style={styles.menuSub}>{MENU[2]!.sub}</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(220).duration(360)}>
          <Pressable onPress={() => setShowSignOut(true)} style={styles.signOutBtn}>
            <Feather name="log-out" size={15} color={colors.error} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>

      <Modal visible={showSignOut} transparent animationType="fade" onRequestClose={() => setShowSignOut(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSignOut(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Sign out?</Text>
            <Text style={styles.sheetBody}>
              {isOnline ? "You're currently online. You'll be taken offline and signed out." : 'You will be signed out of your account.'}
            </Text>
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setShowSignOut(false)} style={styles.sheetCancelBtn}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleLogout} style={styles.sheetConfirmBtn}>
                <Text style={styles.sheetConfirmText}>Sign Out</Text>
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
            <TextInput
              value={editName}
              onChangeText={(t) => { setEditName(t); setSaveErr('') }}
              placeholder="Your full name"
              placeholderTextColor={colors.ink400}
              maxLength={120}
              autoFocus
              style={styles.input}
            />
            <TextInput
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="Email address (optional)"
              placeholderTextColor={colors.ink400}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            {saveErr ? <Text style={styles.saveErr}>{saveErr}</Text> : null}
            <Pressable
              onPress={saveEdit}
              disabled={saving || editName.trim().length < 2}
              style={[styles.saveBtn, (saving || editName.trim().length < 2) ? styles.disabled : null]}
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  avatar: { width: 60, height: 60, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.inkInverse },
  headerInfo: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  phone: { ...typography.caption, color: colors.ink600 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  badgeText: { ...typography.caption, color: colors.ink900, fontWeight: '700' },
  badgeTextMuted: { ...typography.caption, color: colors.ink400 },
  headerActions: { alignItems: 'flex-end', gap: spacing.xs },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.full },
  statusPillText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  editBtn: { width: 32, height: 32, borderRadius: radii.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radii.full, backgroundColor: colors.surface2 },
  tagText: { ...typography.caption, color: colors.ink600, fontWeight: '600' },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.sm },
  menuCard: { backgroundColor: colors.surface, borderRadius: radii.xl, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 36, height: 36, borderRadius: radii.lg, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  menuSub: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  pendingBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.warningLight, marginRight: spacing.xs },
  pendingBadgeText: { fontSize: 10, fontWeight: '700', color: colors.warning },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.errorLight, borderWidth: 1, borderColor: colors.error, borderRadius: radii.xl, paddingVertical: spacing.sm + 6, marginTop: spacing.md },
  signOutText: { ...typography.body, color: colors.error, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  sheetBody: { ...typography.body, color: colors.ink600, marginTop: spacing.xs, marginBottom: spacing.lg },
  sheetActions: { flexDirection: 'row', gap: spacing.sm },
  sheetCancelBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  sheetCancelText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
  sheetConfirmBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.error, alignItems: 'center' },
  sheetConfirmText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  input: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, marginBottom: spacing.sm },
  saveErr: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 6, alignItems: 'center', marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
  saveText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
