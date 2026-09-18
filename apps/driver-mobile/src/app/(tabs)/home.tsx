import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import MapView from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, Card, colors, getCurrentOrLastKnownPosition, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { OnlineToggle } from '@/features/go-online/components/OnlineToggle'
import { useGoOnlineFlow } from '@/features/go-online/useGoOnlineFlow'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { fetchEarningsSummary } from '@/features/earnings/api'
import type { EarningsSummary } from '@/features/earnings/types'

// Same fallback center as the web driver app's Home.tsx (Bhubaneswar) -- shown
// until a real fix comes in, or forever if location is denied.
const DEFAULT_REGION = { latitude: 20.2961, longitude: 85.8245, latitudeDelta: 0.05, longitudeDelta: 0.05 }

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const driver = useAuthStore((s) => s.driver)
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const mode = useDriverSessionStore((s) => s.mode)
  const destinationCityName = useDriverSessionStore((s) => s.destinationCityName)
  const flow = useGoOnlineFlow()
  const walletGate = useWalletGate()
  const documentGate = useDocumentGate()

  const [region, setRegion] = useState(DEFAULT_REGION)
  const [summary, setSummary] = useState<EarningsSummary | null>(null)
  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)

  useEffect(() => {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => (status === 'granted' ? getCurrentOrLastKnownPosition() : null))
      .then((pos) => {
        if (pos) setRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchEarningsSummary('today').then(setSummary).catch(() => {})
  }, [])

  const blockedReason = documentGate.hasRejected
    ? (documentGate.rejectionReason ?? 'A document was rejected. Check your profile.')
    : walletGate.isFrozen
      ? 'Your wallet is frozen. Contact support.'
      : null

  const toggleDisabled =
    flow.sessionCheck !== 'ready' || flow.checkingVerification || (!isOnline && (!!blockedReason || !flow.vehicle))

  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  async function handleToggle() {
    if (isOnline) { setShowOfflineConfirm(true); return }
    const nextRoute = await flow.requestGoOnline()
    router.push(nextRoute)
  }

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        region={region}
        showsUserLocation
        showsMyLocationButton={false}
        pointerEvents="none"
      />
      {!isOnline ? <View style={styles.mapDim} pointerEvents="none" /> : null}

      <View style={[styles.floating, { top: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.date}>{todayLabel}</Text>
            <Text style={styles.greeting}>Hi, {firstName}</Text>
            <Text style={styles.subtext}>
              {isOnline ? "You're live, ride requests incoming" : 'Go online to start earning'}
            </Text>
          </View>
          <OnlineToggle isOnline={isOnline} onToggle={() => void handleToggle()} disabled={toggleDisabled} />
        </View>

        {isOnline && mode === 'return_cab' ? (
          <View style={styles.returnCabBanner}>
            <View style={styles.returnCabDot} />
            <Text style={styles.returnCabText}>
              Return Cab Mode{destinationCityName ? `, heading to ${destinationCityName}` : ''}
            </Text>
          </View>
        ) : null}

        {flow.vehicleLoading ? null : !flow.vehicle ? (
          <Card style={styles.card}>
            <Text style={styles.detail}>No vehicle registered</Text>
          </Card>
        ) : null}

        {blockedReason ? (
          <Card style={styles.card}>
            <Text style={styles.error}>{blockedReason}</Text>
          </Card>
        ) : null}

        {flow.error ? (
          <Card style={styles.card}>
            <Text style={styles.error}>{flow.error}</Text>
          </Card>
        ) : null}

        {flow.sessionCheck === 'failed' ? (
          <Card style={styles.card}>
            <Text style={styles.error}>Couldn't check your status.</Text>
            <Button label="Retry" onPress={flow.retrySessionCheck} />
          </Card>
        ) : null}
      </View>

      <View style={styles.sheet}>
        {/* One unified card: stats + quick actions, no nested chip cards --
            matches the real web app's Home.tsx exactly (its own comment calls
            out replacing three separately-floating pill blocks with this). */}
        <View style={styles.unifiedCard}>
          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <View style={styles.statValueRow}>
                <MaterialCommunityIcons name="currency-inr" size={13} color={colors.accentOrange} />
                <Text style={[styles.statValue, styles.statValueOrange]}>
                  {summary ? Math.round(summary.totalEarnings).toLocaleString('en-IN') : '—'}
                </Text>
              </View>
              <Text style={styles.statLabel}>Earned</Text>
            </View>
            <View style={[styles.statCol, styles.statColDivider]}>
              <View style={styles.statValueRow}>
                <Feather name="clock" size={11} color={colors.ink600} />
                <Text style={styles.statValue}>{summary?.tripCount ?? '—'}</Text>
              </View>
              <Text style={styles.statLabel}>Trips</Text>
            </View>
            <View style={styles.statCol}>
              <View style={styles.statValueRow}>
                <Feather name="star" size={11} color={colors.ink600} />
                <Text style={styles.statValue}>{summary?.rating ?? '—'}</Text>
              </View>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          </View>

          <Pressable
            onPress={() => router.push('/earnings')}
            style={styles.actionRow}
            accessibilityRole="button"
          >
            <View style={styles.actionLeft}>
              <Feather name="trending-up" size={15} color={colors.primary} />
              <Text style={styles.actionLabel}>Earnings</Text>
            </View>
            <Feather name="chevron-right" size={14} color={colors.ink400} />
          </Pressable>
        </View>

        <View style={styles.statusLine}>
          <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
          <Text style={styles.statusText}>
            {isOnline ? 'Searching for nearby rides — stay in the area for faster matching' : 'Tap the toggle above to go online'}
          </Text>
        </View>
      </View>

      <Modal visible={showOfflineConfirm} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <Card style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Go offline?</Text>
            <Text style={styles.confirmBody}>You'll stop receiving ride requests until you go online again.</Text>
            <View style={styles.confirmActions}>
              <Button label="Cancel" variant="secondary" onPress={() => setShowOfflineConfirm(false)} />
              <Button
                label="Go Offline"
                onPress={() => {
                  setShowOfflineConfirm(false)
                  void flow.goOffline()
                }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  mapDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${colors.bg}59` },
  floating: { position: 'absolute', left: spacing.md, right: spacing.md, gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  date: { ...typography.caption, color: colors.ink400 },
  greeting: { ...typography.headline, color: colors.ink900 },
  subtext: { ...typography.caption, color: colors.ink600 },
  card: { gap: spacing.sm },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
  returnCabBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.successLight, borderRadius: 20, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  returnCabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  returnCabText: { ...typography.caption, color: colors.success, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  unifiedCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  statsRow: { flexDirection: 'row', paddingVertical: spacing.sm },
  statCol: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  statColDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statValue: { ...typography.label, color: colors.ink900, fontWeight: '800' },
  statValueOrange: { color: colors.accentOrange },
  statLabel: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  actionLabel: { ...typography.label, color: colors.ink900, fontWeight: '600' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOnline: { backgroundColor: colors.accentOrange },
  statusDotOffline: { backgroundColor: colors.ink400 },
  statusText: { ...typography.caption, color: colors.ink600, flex: 1 },
  confirmBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: `${colors.ink900}72`, padding: spacing.lg },
  confirmCard: { gap: spacing.sm },
  confirmTitle: { ...typography.headline, color: colors.ink900 },
  confirmBody: { ...typography.body, color: colors.ink600 },
  confirmActions: { flexDirection: 'row', gap: spacing.sm },
})
