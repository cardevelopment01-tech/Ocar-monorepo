import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeInDown, FadeIn, useAnimatedStyle } from 'react-native-reanimated'
import { colors, gradientPrimary, radii, spacing, typography, TERMS_URL, DELETE_ACCOUNT_WARNING, getApiErrorMessage, requestAccountDeletion, fonts, useKeyboardOffset, mapSaveError, useNavClearance, card, sectionLabel, Text } from '@ocar/mobile-shared'
import Constants from 'expo-constants'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { teardownPushNotifications } from '@/services/notifications'
import { fetchDriverStats, updateDriverProfile, type DriverStats } from '@/features/profile/api'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { onboardingApi, type PickedFile } from '@/features/onboarding/api'
import { SelfieCapture } from '@/components/camera/SelfieCapture'
import { PHOTO_CHANGE_WARNING, shouldWarnBeforePhotoChange } from '@/features/onboarding/photoChange'

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


const SUPPORT_EMAIL = 'grievance@ocarindia.com'
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=Ocar%20driver%20support`
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'

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

  // edge-to-edge breaks KeyboardAvoidingView on Android -- see useKeyboardOffset
  const kbOffset = useKeyboardOffset()
  const kbStyle = useAnimatedStyle(() => ({ paddingBottom: kbOffset.value }))
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [missingDocs, setMissingDocs] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [showSignOut, setShowSignOut] = useState(false)

  const [statsFailed, setStatsFailed] = useState(false)

  const loadStats = useCallback(() => {
    setStatsFailed(false)
    fetchDriverStats()
      .then(({ stats: s, onboarding }) => {
        setStats(s)
        setMissingDocs(onboarding.missing_documents.length)
      })
      .catch(() => setStatsFailed(true))
  }, [])

  // Refetch whenever the tab comes into focus, so stats that failed to load (or were never fetched because the
  // connection dropped) recover without restarting the app.
  useFocusEffect(useCallback(() => { loadStats() }, [loadStats]))

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoStatus, setPhotoStatus] = useState<string | null>(null)
  const photoRejected = photoStatus === 'rejected'
  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  useEffect(() => {
    onboardingApi.getDocumentStatus()
      .then((s) => {
        setPhotoUrl(s.photos['profile_photo']?.url ?? null)
        setPhotoStatus(s.photos['profile_photo']?.status ?? null)
      })
      .catch(() => {}) // avatar falls back to the initial
  }, [])

  function openPhotoCamera() {
    if (!shouldWarnBeforePhotoChange(photoStatus)) { setPhotoOpen(true); return }
    Alert.alert(PHOTO_CHANGE_WARNING.title, PHOTO_CHANGE_WARNING.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: () => setPhotoOpen(true) },
    ])
  }

  async function replacePhoto(file: PickedFile) {
    setPhotoOpen(false)
    setPhotoBusy(true)
    try {
      const res = await onboardingApi.uploadDriverDoc(file, 'profile_photo')
      setPhotoUrl(res.file_url)
      setPhotoStatus('pending') // replaced: now awaiting review
    } catch (err) {
      Alert.alert("Couldn't update photo", mapSaveError(err))
    } finally {
      setPhotoBusy(false)
    }
  }

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
      const hadEmail = !!driver?.email
      const body: { full_name: string; email?: string | null } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      else if (hadEmail) body.email = null // field cleared -> remove the saved email
      const updated = await updateDriverProfile(body)
      updateDriver({ full_name: updated.full_name, email: updated.email })
      setEditing(false)
    } catch (err) {
      setSaveErr(mapSaveError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    // Tell the server: it revokes the refresh token and takes an online driver offline, so nobody can be matched to a
    // phone nobody is signed in on. Sent without waiting (the token is already read), so signing out is instant and
    // still works with no network.
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
            <Pressable onPress={openPhotoCamera} disabled={photoBusy} accessibilityRole="button" accessibilityLabel="Change profile photo">
              <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.avatarImg} resizeMethod="resize" /> : <Text style={styles.avatarText}>{initial}</Text>}
                {photoBusy ? <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.inkInverse} /> : null}
              </LinearGradient>
              <View style={[styles.avatarBadge, photoRejected ? styles.avatarBadgeRejected : null]}>
                <Feather name={photoRejected ? 'alert-circle' : 'camera'} size={11} color={photoRejected ? colors.error : colors.ink600} />
              </View>
            </Pressable>
            <View style={styles.headerInfo}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.phone}>+91 {displayPhone}</Text>
              <View style={styles.badgeRow}>
                <Feather name="star" size={12} color={colors.warning} />
                <Text style={styles.badgeText}>{stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '-'}</Text>
                <Feather name="truck" size={12} color={colors.ink400} style={{ marginLeft: spacing.xs }} />
                <Text style={styles.badgeTextMuted}>{stats ? stats.total_rides : '-'} total trips</Text>
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

          {statsFailed ? (
            <Pressable onPress={loadStats} accessibilityRole="button">
              <Text style={styles.statsRetry}>Couldn't load your stats. Tap to retry.</Text>
            </Pressable>
          ) : null}

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
          <Text style={styles.sectionLabel}>Vehicle & documents</Text>
          <View style={styles.menuCard}>
            <Pressable onPress={() => router.push('/documents')} style={[styles.menuRow, styles.menuRowBorder]} accessibilityRole="button">
              <View style={[styles.menuIcon, documentGate.hasRejected ? styles.menuIconAlert : null]}>
                <Feather name="file-text" size={15} color={documentGate.hasRejected ? colors.error : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Documents</Text>
                <Text style={styles.menuSub}>{documentGate.hasRejected ? 'Action needed' : missingDocs > 0 ? 'Upload to get verified' : 'Verified documents'}</Text>
              </View>
              {documentGate.hasRejected ? (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>Fix now</Text>
                </View>
              ) : missingDocs > 0 ? (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>Incomplete</Text>
                </View>
              ) : null}
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            <Pressable onPress={() => router.push('/onboarding/vehicle?edit=1')} style={styles.menuRow} accessibilityRole="button">
              <View style={styles.menuIcon}>
                <Feather name="truck" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Vehicle Details</Text>
                <Text style={styles.menuSub}>Registered vehicle</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160).duration(360)}>
          <Text style={styles.sectionLabel}>Account</Text>
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
            <Pressable onPress={() => router.push('/notifications')} style={[styles.menuRow, styles.menuRowBorder]} accessibilityRole="button">
              <View style={styles.menuIcon}>
                <Feather name="bell" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Notifications</Text>
                <Text style={styles.menuSub}>Ride, document & wallet alerts</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            <Pressable onPress={() => router.push('/onboarding/personal?edit=1')} style={[styles.menuRow, styles.menuRowBorder]} accessibilityRole="button">
              <View style={styles.menuIcon}>
                <Feather name="user" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Personal & Emergency Info</Text>
                <Text style={styles.menuSub}>Address, ID & emergency contact</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            <Pressable onPress={() => void Linking.openURL(SUPPORT_MAILTO).catch(() => Alert.alert('Email us', SUPPORT_EMAIL))} style={[styles.menuRow, styles.menuRowBorder]} accessibilityRole="button">
              <View style={styles.menuIcon}>
                <Feather name="help-circle" size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>Help & Support</Text>
                <Text style={styles.menuSub}>Email our support team</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </Pressable>
            {/* Deep-links to apps/user's hosted /legal/terms (cross-links to /legal/privacy) instead of duplicating legal text. */}
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
          <Pressable onPress={confirmDeleteAccount} style={styles.deleteBtn} accessibilityRole="button">
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
          <Text style={styles.version}>Ocar Driver v{APP_VERSION}</Text>
        </Animated.View>
      </ScrollView>

      <SelfieCapture visible={photoOpen} onCancel={() => setPhotoOpen(false)} onConfirm={(f) => void replacePhoto(f)} />

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
        </Animated.View>
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
  avatarImg: { width: 60, height: 60, borderRadius: radii.xl },
  avatarBadge: { position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarBadgeRejected: { borderColor: colors.error },
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
  statsRetry: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold, marginTop: spacing.md },
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
  pendingBadge: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full, backgroundColor: colors.warningLight, marginRight: spacing.xs },
  pendingBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.warning },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: spacing.sm + 6, marginTop: spacing.md },
  version: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginTop: spacing.md },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  deleteText: { ...typography.caption, color: colors.ink400, textDecorationLine: 'underline' },
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
