import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, spacing, typography, TERMS_URL, fonts, useNavClearance, card, sectionLabel, Text } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchDriverStats, updateDriverProfile, type DriverStats } from '@/features/profile/api'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: colors.successLight, text: colors.success },
  pending_docs: { bg: colors.surface2, text: colors.ink600 },
  pending_approval: { bg: colors.warningLight, text: colors.warning },
  docs_rejected: { bg: colors.errorLight, text: colors.error },
  suspended: { bg: colors.errorLight, text: colors.error },
  banned: { bg: colors.errorLight, text: colors.error },
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending_docs: 'Pending documents',
  pending_approval: 'Pending approval',
  docs_rejected: 'Action needed',
  suspended: 'Suspended',
  banned: 'Banned',
}

// Vehicle/Documents/Personal-info detail screens don't exist on mobile yet (web's
// /profile/vehicle, /profile/documents, /profile/personal have no mobile counterpart
// built this pass) -- rows stay visual-parity placeholders, same "known gap, not a
// stub" treatment as the driver-mobile Home screen's omitted Wallet row.
const PLACEHOLDER_MENU = [{ icon: 'truck' as const, label: 'Vehicle Details', sub: 'Registered vehicle' }]

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '-'
  return raw.replace('+91', '').trim()
}

export default function ProfileScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const clearance = useNavClearance()
  const driver = useAuthStore((s) => s.driver)
  const documentGate = useDocumentGate()
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
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: clearance }]}>
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
                <Text style={styles.badgeText}>{stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '-'}</Text>
                <Feather name="truck" size={12} color={colors.ink400} style={{ marginLeft: spacing.xs }} />
                <Text style={styles.badgeTextMuted}>{stats?.total_rides ?? 0} trips</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <View style={[styles.statusPill, { backgroundColor: statusStyle.bg }]}>
                <Text style={[styles.statusPillText, { color: statusStyle.text }]}>{STATUS_LABELS[driver?.status ?? ''] ?? driver?.status ?? '-'}</Text>
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
            <Pressable onPress={() => router.push('/documents')} style={[styles.menuRow, styles.menuRowBorder]} accessibilityRole="button">
              <View style={[styles.menuIcon, documentGate.hasRejected ? styles.menuIconAlert : null]}>
                <Feather name="file-text" size={15} color={documentGate.hasRejected ? colors.error : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Documents</Text>
                <Text style={styles.menuSub}>{documentGate.hasRejected ? 'Action needed' : 'Verified documents'}</Text>
              </View>
              {documentGate.hasRejected ? (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>Fix now</Text>
                </View>
              ) : missingDocs > 0 ? (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>{missingDocs} pending</Text>
                </View>
              ) : null}
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            {/* Not built yet, plain rows, no chevron, so they don't invite a tap that goes nowhere. */}
            {PLACEHOLDER_MENU.map((item, i) => (
              <View key={item.label} style={[styles.menuRow, i < PLACEHOLDER_MENU.length - 1 ? styles.menuRowBorder : null]}>
                <View style={styles.menuIcon}>
                  <Feather name={item.icon} size={15} color={colors.ink400} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuSub}>{item.sub}</Text>
                </View>
                <View style={styles.soonBadge}>
                  <Text style={styles.soonBadgeText}>Soon</Text>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160).duration(360)}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <View style={styles.menuCard}>
            <Pressable onPress={() => router.push('/wallet')} style={[styles.menuRow, styles.menuRowBorder]}>
              <View style={styles.menuIcon}>
                <Feather name="credit-card" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Wallet</Text>
                <Text style={styles.menuSub}>Compliance deposit & transactions</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            <View style={[styles.menuRow, styles.menuRowBorder]}>
              <View style={styles.menuIcon}>
                <Feather name="user" size={15} color={colors.ink400} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Personal & Emergency Info</Text>
                <Text style={styles.menuSub}>Address, ID & emergency contact</Text>
              </View>
              <View style={styles.soonBadge}>
                <Text style={styles.soonBadgeText}>Soon</Text>
              </View>
            </View>
            {/* The only functional row in this section -- deep-links to apps/user's
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
              <Pressable onPress={() => setShowSignOut(false)} style={({ pressed }) => [styles.sheetCancelBtn, pressed ? styles.pressedScale : null]}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleLogout} style={({ pressed }) => [styles.sheetConfirmBtn, pressed ? styles.pressedScale : null]}>
                <Text style={styles.sheetConfirmText}>Sign Out</Text>
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
            {saveErr ? <Text style={styles.saveErr}>{saveErr}</Text> : null}
            <Pressable
              onPress={saveEdit}
              disabled={saving || editName.trim().length < 2}
              style={({ pressed }) => [styles.saveBtn, (saving || editName.trim().length < 2) ? styles.disabled : null, pressed && !saving ? styles.pressedScale : null]}
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  headerCard: { ...card, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  avatar: { width: 60, height: 60, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontFamily: fonts.bold, color: colors.inkInverse },
  headerInfo: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  phone: { ...typography.caption, color: colors.ink600 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  badgeText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
  badgeTextMuted: { ...typography.caption, color: colors.ink400 },
  headerActions: { alignItems: 'flex-end', gap: spacing.xs },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.full },
  statusPillText: { fontSize: 11, fontFamily: fonts.bold },
  editBtn: { width: 32, height: 32, borderRadius: radii.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radii.full, backgroundColor: colors.surface2 },
  tagText: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  sectionLabel: { ...sectionLabel, marginBottom: 10, marginTop: spacing.sm },
  menuCard: { ...card, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  menuSub: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  menuIconAlert: { backgroundColor: colors.errorLight },
  alertBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.errorLight, marginRight: spacing.xs },
  alertBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.error },
  soonBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.surface2 },
  soonBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.ink400 },
  pendingBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.warningLight, marginRight: spacing.xs },
  pendingBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.warning },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: spacing.sm + 6, marginTop: spacing.md },
  signOutText: { ...typography.body, color: colors.error, fontFamily: fonts.bold },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  sheetBody: { ...typography.body, color: colors.ink600, marginTop: spacing.xs, marginBottom: spacing.lg },
  sheetActions: { flexDirection: 'row', gap: spacing.sm },
  sheetCancelBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  sheetCancelText: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  sheetConfirmBtn: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radii.lg, backgroundColor: colors.error, alignItems: 'center' },
  sheetConfirmText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  input: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, marginBottom: spacing.sm },
  saveErr: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 6, alignItems: 'center', marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  saveText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
})
