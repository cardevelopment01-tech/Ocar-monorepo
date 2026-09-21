import { useEffect, useRef, useState } from 'react'
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import MapView from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, Card, colors, getCurrentOrLastKnownPosition, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { OnlineToggle } from '@/features/go-online/components/OnlineToggle'
import { useGoOnlineFlow } from '@/features/go-online/useGoOnlineFlow'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { fetchEarningsSummary } from '@/features/earnings/api'
import type { EarningsSummary } from '@/features/earnings/types'
import CarMarker from '@/features/map/components/CarMarker'
import AddressCallout from '@/features/map/components/AddressCallout'
import { fetchReverseGeocode } from '@/features/map/api'
import { useDriverLivePosition } from '@/features/active-ride/useDriverLivePosition'

// Same fallback center as the web driver app's Home.tsx (Bhubaneswar) -- shown
// until a real fix comes in, or forever if location is denied.
const DEFAULT_REGION = { latitude: 20.2961, longitude: 85.8245, latitudeDelta: 0.05, longitudeDelta: 0.05 }

const WINDOW_HEIGHT = Dimensions.get('window').height
// Rough pre-layout guess (greeting + stats card, no error banners) -- only
// used for the first frame before onLayout below reports the sheet's real
// measured height; mapPadding switches to the real value the instant it's
// available.
const SHEET_HEIGHT_ESTIMATE = WINDOW_HEIGHT * 0.42

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

  const mapRef = useRef<MapView>(null)
  const [region, setRegion] = useState(DEFAULT_REGION)
  const [hasFix, setHasFix] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [summary, setSummary] = useState<EarningsSummary | null>(null)
  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)
  // The bottom sheet covers a real, content-dependent chunk of the screen
  // (grows with blockedReason/error cards) -- measured via onLayout below
  // rather than a hardcoded height, so mapPadding keeps the driver's own
  // position framed in the open part of the map, not hidden behind the sheet.
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT_ESTIMATE)
  // mapPadding crashes ("setPadding on a null object reference") if set before
  // the native GoogleMap instance finishes initializing -- same class of
  // race as the pickup-pin/fitToCoordinates issue fixed in rider-mobile this
  // session. Withhold it until onMapReady confirms the native map exists.
  const [mapReady, setMapReady] = useState(false)
  // The one-shot fix below is only for the very first pin before the driver
  // ever goes online -- once online, this tracks the actual live position
  // (same GPS watch active-ride screens use), so this pin stops silently
  // drifting away from reality as the driver moves. Previously this screen
  // never updated after its first snapshot, sourced from getCurrentOrLastKnownPosition
  // (which can fall back to a STALE cached OS fix, not even a fresh one) --
  // a driver who'd moved since that snapshot saw themselves somewhere they
  // hadn't been in a while, with nothing on screen indicating it was stale.
  const live = useDriverLivePosition(isOnline)

  useEffect(() => {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => (status === 'granted' ? getCurrentOrLastKnownPosition() : null))
      .then((pos) => {
        if (!pos) return
        const fixRegion = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
        setRegion(fixRegion)
        setHasFix(true)
        // Imperative one-time camera move, not a controlled `region` prop --
        // the map is a real pannable/zoomable surface now (per this session's
        // decision to enable that), and a controlled `region` would fight the
        // driver's own gestures on every re-render after this.
        mapRef.current?.animateToRegion(fixRegion, 600)
        // One-shot on the initial fix, matching the pill's purpose (where am I
        // right now) rather than live-updating on every GPS tick -- this screen
        // doesn't track the driver's position continuously the way an active
        // trip does.
        fetchReverseGeocode(pos.coords.latitude, pos.coords.longitude)
          .then((place) => setAddress(place.address))
          .catch(() => {})
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchEarningsSummary('today').then(setSummary).catch(() => {})
  }, [])

  const carPosition: [number, number] | null = live?.position ?? (hasFix ? [region.latitude, region.longitude] : null)

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
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        // Real pan/zoom now, not a static backdrop -- the driver's own fix
        // still lands the camera there once via mapRef.animateToRegion above,
        // but nothing here re-asserts a controlled `region` afterward, so it
        // never fights the driver's own gesture.
        // Without this, the driver's own position frames on the FULL window
        // height, landing right under the bottom sheet's top edge (roughly
        // half the screen) instead of the open map area above it. Prop
        // omitted entirely (not passed as undefined -- exactOptionalPropertyTypes
        // forbids that) until mapReady, matching the guard below.
        {...(mapReady ? { mapPadding: { top: 0, right: 0, bottom: sheetHeight, left: 0 } } : {})}
        onMapReady={() => setMapReady(true)}
        showsUserLocation={false}
        showsMyLocationButton={false}
        loadingEnabled
        loadingIndicatorColor={colors.primary}
        loadingBackgroundColor={colors.surface}
      >
        {/* Own car icon instead of the OS's generic blue dot. Live position once
            online (real bearing available); the pre-online one-shot fix has no
            bearing, matching CarMarker's own contract for "no real bearing yet"
            (dimmed, not a fake north snap). */}
        {carPosition ? (
          <CarMarker position={carPosition} headingKnown={live?.headingKnown ?? false} opacity={0.85} />
        ) : null}
        {/* Real map-anchored Marker (see AddressCallout's own comment), not a
            screen-fixed overlay -- stays correctly pinned above the car
            through every pan/zoom instead of drifting off it. */}
        {carPosition && address ? <AddressCallout position={carPosition} address={address} /> : null}
      </MapView>
      {!isOnline ? <View style={styles.mapDim} pointerEvents="none" /> : null}

      {/* Minimal persistent HUD -- wallet balance and a notifications entry
          point, out of the way in the corners. */}
      <View style={[styles.topRow, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.walletPill}>
          <MaterialCommunityIcons name="currency-inr" size={13} color={colors.accentOrange} />
          <Text style={styles.walletPillText}>{walletGate.loading ? '—' : Math.round(walletGate.balance).toLocaleString('en-IN')}</Text>
        </View>
        {/* No notifications feature exists yet in driver-mobile (unlike the
            web app) -- visual-parity placeholder only, same treatment as
            rider-mobile profile's inert MENU rows. */}
        <View style={styles.bellBtn} accessibilityElementsHidden>
          <Feather name="bell" size={15} color={colors.ink600} />
        </View>
      </View>

      <View style={styles.sheet} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
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
  topRow: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  walletPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderRadius: radii.full, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, ...shadows.card },
  walletPillText: { ...typography.label, color: colors.ink900, fontWeight: '800' },
  bellBtn: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.card },
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
