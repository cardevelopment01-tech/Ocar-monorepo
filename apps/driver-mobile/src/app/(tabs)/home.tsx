import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import * as Location from 'expo-location'
import MapView from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Button, Card, colors, formatCurrency, getCurrentOrLastKnownPosition, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { LocationDisclosure } from '@/features/go-online/LocationDisclosure'
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

  const switchDisabled =
    flow.sessionCheck !== 'ready' || flow.goingOnline || (!isOnline && (!!blockedReason || !flow.vehicle))

  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

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
          <Switch
            value={isOnline}
            disabled={switchDisabled}
            onValueChange={(next) => (next ? flow.requestGoOnline() : setShowOfflineConfirm(true))}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.surface}
          />
        </View>

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
        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{summary ? formatCurrency(summary.totalEarnings) : '—'}</Text>
            <Text style={styles.statLabel}>Earned</Text>
          </View>
          <View style={[styles.statCol, styles.statColDivider]}>
            <Text style={styles.statValue}>{summary?.tripCount ?? '—'}</Text>
            <Text style={styles.statLabel}>Trips</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statValue}>{summary?.rating ?? '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
        </View>

        <Pressable onPress={() => router.push('/earnings')} accessibilityRole="button">
          <Card style={styles.actionCard}>
            <Text style={styles.actionLabel}>Earnings</Text>
            <Text style={styles.actionChevron}>›</Text>
          </Card>
        </Pressable>

        <View style={styles.statusLine}>
          <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
          <Text style={styles.statusText}>
            {isOnline ? 'Searching for nearby rides — stay in the area for faster matching' : 'Tap the toggle above to go online'}
          </Text>
        </View>
      </View>

      <LocationDisclosure
        visible={flow.showDisclosure}
        onAccept={() => void flow.handleDisclosureAccept()}
        onDecline={flow.handleDisclosureDecline}
      />

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
  statsRow: { flexDirection: 'row' },
  statCol: { flex: 1, alignItems: 'center', gap: 2 },
  statColDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statValue: { ...typography.title, color: colors.ink900 },
  statLabel: { ...typography.caption, color: colors.ink400 },
  actionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  actionLabel: { ...typography.label, color: colors.ink900, fontWeight: '600' },
  actionChevron: { ...typography.title, color: colors.ink400 },
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
