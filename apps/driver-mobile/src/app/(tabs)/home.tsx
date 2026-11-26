import { useEffect, useRef, useState } from 'react'
import { Dimensions, Linking, Pressable, StyleSheet, Vibration, View } from 'react-native'
import * as Location from 'expo-location'
import MapView from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, Card, captureError, NotificationBell, OCAR_MAP_PROPS, PushPrimerSheet, useUnreadCount, PulseDot, card, colors, geo, h, shadow, useNavBottom, getCurrentOrLastKnownPosition, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { OnlineToggle } from '@/features/go-online/components/OnlineToggle'
import { BottomSheet } from '@/features/go-online/components/BottomSheet'
import { useGoOnlineFlow } from '@/features/go-online/useGoOnlineFlow'
import { useWalletGate } from '@/features/go-online/useWalletGate'
import { walletBlockMessage } from '@/features/go-online/walletGateMessage'
import { useSocketConnected } from '@/features/go-online/useSocketConnected'
import { ensureBackgroundTracking } from '@/services/location/backgroundTask'
import { useTrackingHealth } from '@/features/tracking-health/useTrackingHealth'
import { TrackingHealthCard } from '@/features/tracking-health/TrackingHealthCard'
import { useDocumentGate } from '@/features/go-online/useDocumentGate'
import { useNotificationPrimer } from '@/features/notifications/usePushSetup'
import { fetchEarningsSummary } from '@/features/earnings/api'
import type { EarningsSummary } from '@/features/earnings/types'
import CarMarker from '@/features/map/components/CarMarker'
import AddressCallout from '@/features/map/components/AddressCallout'
import { useVehicleKind } from '@/features/map/useVehicleKind'
import { MARKER_DP } from '@/features/map/vehicleKind'
import { fetchReverseGeocode } from '@/features/map/api'
import { useDriverLivePosition } from '@/features/active-ride/useDriverLivePosition'
import { INITIAL_RECENTER, nextRecenter, type RecenterState } from '@/features/map/recenter'
import { useReservations } from '@/features/reservations/useReservations'
import { UpcomingBookingCard } from '@/features/reservations/UpcomingBookingCard'
import { stageOf } from '@/features/reservations/format'
import { confirmReservation, startReservation } from '@/features/reservations/api'

// Same fallback center as the web driver app's Home.tsx (Bhubaneswar) -- shown
// until a real fix comes in, or forever if location is denied.
const DEFAULT_REGION = { latitude: 20.2961, longitude: 85.8245, latitudeDelta: 0.05, longitudeDelta: 0.05 }

// Rides this app has already opened for the driver after a booking started. Module-level, so going back to Home (or Home remounting) never opens the same ride again.
const openedBookingRides = new Set<string>()

const WINDOW_HEIGHT = Dimensions.get('window').height
// Room the "Reconnecting" strip takes at the top, so the wallet pill and bell move down instead of sitting under it.
const RECONNECT_STRIP_HEIGHT = 34
// Rough pre-layout guess (greeting + stats card, no error banners) -- only
// used for the first frame before onLayout below reports the sheet's real
// measured height; mapPadding switches to the real value the instant it's
// available.
const SHEET_HEIGHT_ESTIMATE = WINDOW_HEIGHT * 0.42

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const navBottom = useNavBottom()
  // the sheet floats above the tab pill: pill height + its own gap
  const sheetBottom = navBottom + geo.navHeight + 12
  const driver = useAuthStore((s) => s.driver)
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const mode = useDriverSessionStore((s) => s.mode)
  const destinationCityName = useDriverSessionStore((s) => s.destinationCityName)
  const flow = useGoOnlineFlow()
  const sessionCategoryId = useDriverSessionStore((s) => s.categoryId)
  // The driver's own vehicle on the map: the session's category once online (the vehicle on file if the session has none yet), the vehicle on file before that.
  const vehicleKind = useVehicleKind((isOnline ? sessionCategoryId : null) ?? flow.vehicle?.categoryId ?? null)
  const trackingFailed = useDriverSessionStore((s) => s.trackingFailed)
  const setTrackingFailed = useDriverSessionStore((s) => s.setTrackingFailed)
  const retryingTracking = useRef(false)
  function retryTracking(onDone?: () => void) {
    if (retryingTracking.current) return
    retryingTracking.current = true
    const sid = useDriverSessionStore.getState().sessionId ?? undefined
    ensureBackgroundTracking()
      .then(() => setTrackingFailed(false, sid))
      .catch((err) => captureError(err, { where: 'home_retry_tracking' }))
      .finally(() => { retryingTracking.current = false; onDone?.() })
  }
  const walletGate = useWalletGate()
  // Bookings an admin reserved for this driver: the next one is shown on this screen so it is never forgotten.
  const bookings = useReservations()
  const nextBooking = bookings.reservations[0] ?? null
  // A booking that went live and was handed to this driver while they were on Home: open the ride, once per ride.
  const openedRides = openedBookingRides
  useEffect(() => {
    for (const { rideId } of bookings.started) {
      if (openedRides.has(rideId)) continue
      openedRides.add(rideId)
      router.push(`/active-ride/${rideId}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings.started])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  // One short vibration the moment it is time to head out (the push carries the sound), only while the app is open.
  const lastStage = useRef<string | null>(null)
  const stageNow = nextBooking ? stageOf(nextBooking, bookings.now) : null
  useEffect(() => {
    if (stageNow === 'headout' && lastStage.current !== 'headout' && lastStage.current !== 'opens') Vibration.vibrate(250)
    lastStage.current = stageNow
  }, [stageNow])
  function startBooking() {
    if (!nextBooking || starting) return
    const id = nextBooking.rideId
    setStarting(true); setStartError(null)
    startReservation(id)
      .then(() => { openedRides.add(id); router.push(`/active-ride/${id}`) })
      .catch((err: Error) => setStartError(err.message))
      .finally(() => setStarting(false))
  }
  function confirmBooking() {
    if (!nextBooking) return
    confirmReservation(nextBooking.rideId).then(() => bookings.refresh()).catch((err) => captureError(err, { where: 'home_confirm_booking' }))
  }
  function navigateToPickup() {
    if (nextBooking?.pickupLat == null || nextBooking.pickupLng == null) return
    const { pickupLat: lat, pickupLng: lng } = nextBooking
    Linking.openURL(`google.navigation:q=${lat},${lng}&mode=d`).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {}))
  }
  const socketConnected = useSocketConnected()
  const showReconnecting = isOnline && !socketConnected
  const documentGate = useDocumentGate()
  const unreadNotifications = useUnreadCount()
  const primer = useNotificationPrimer()

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

  // Location can stop reaching the server while the driver still looks Online (permission or the phone's Location switch turned off, the
  // tracking service stopped, or no GPS). The card says which and offers the one fix, instead of leaving "ride requests incoming".
  const trackingHealth = useTrackingHealth(isOnline, trackingFailed)

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
        // (The camera move itself is the re-center effect below: a call made here can run before the native map is ready
        // and is then silently lost, leaving the camera on the default region and the driver's car off screen.)
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

  // Bring the camera onto the driver once the native map is ready and a position exists, and again once per online session
  // when live GPS arrives (see features/map/recenter.ts). Never on every GPS tick, so a driver who pans is not dragged back.
  const recenter = useRef<RecenterState>(INITIAL_RECENTER)
  // animateToRegion was a one-shot with no check, and on a real phone the camera sometimes stayed on the default Bhubaneswar view while
  // the car sat off screen. This moves with animateCamera (what the active-ride map uses), then reads the camera back and tries again,
  // up to 3 times, if it did not arrive. "Arrived" is within about 5 km: the map's bottom padding makes getCamera() report a centre
  // about 1 km off the target even when the car is correctly framed, so a tighter check kept retrying for nothing.
  // Each call gets its own generation: a newer call (or leaving the screen) makes every pending retry of an older one stop, so a late
  // retry can never drag the map back to a stale position, and each call has its own 3 tries.
  const cameraGen = useRef(0)
  useEffect(() => () => { cameraGen.current += 1 }, [])
  function moveCameraTo(target: [number, number]) {
    const gen = ++cameraGen.current
    let tries = 0
    const attempt = () => {
      const map = mapRef.current
      if (!map || gen !== cameraGen.current) return
      tries += 1
      map.animateCamera({ center: { latitude: target[0], longitude: target[1] }, zoom: 14 }, { duration: 600 })
      setTimeout(() => {
        if (gen !== cameraGen.current) return
        map.getCamera().then((cam) => {
          if (gen !== cameraGen.current) return
          const close = Math.abs(cam.center.latitude - target[0]) < 0.05 && Math.abs(cam.center.longitude - target[1]) < 0.05
          if (!close && tries < 3) attempt()
        }).catch(() => { if (tries < 3) attempt() })
      }, 1000)
    }
    attempt()
  }
  const livePosition = live?.position ?? null
  useEffect(() => {
    const out = nextRecenter(recenter.current, { mapReady, position: carPosition, livePosition, isOnline })
    recenter.current = out.state
    if (out.target) moveCameraTo(out.target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carPosition/livePosition are fresh arrays each render; the rules are idempotent
  }, [mapReady, isOnline, carPosition?.[0], carPosition?.[1], livePosition?.[0], livePosition?.[1]])

  // Actionable, not just informational, tapping goes straight to the screen that fixes it, matching
  // the rule every driver-app rejection writeup agrees on: never leave a driver guessing what to do next.
  const walletBlock = walletBlockMessage(walletGate)
  // A package driver is allowed online with no credit but gets no requests: say so instead of leaving them waiting.
  const packageNotice = walletGate.packageCredit?.exhausted
    ? { title: 'No ride credit left', message: 'You will not receive ride requests until you add credit. Choose a plan in your wallet.', actionLabel: 'Add credit', route: '/wallet' as const }
    : null
  const blockedBanner = documentGate.hasRejected
    ? { title: documentGate.title ?? (documentGate.isMissingUpload ? 'Action needed' : 'Document rejected'), message: documentGate.rejectionReason ?? 'Reupload it to go online again.', actionLabel: documentGate.issues.length > 0 && documentGate.issues.every((i) => i.reason === 'pending_review') ? 'View status' : 'Fix now', route: '/documents' as const }
    : walletGate.isFrozen
      ? { title: 'Wallet frozen', message: 'Contact support to go online again.', actionLabel: 'View wallet', route: '/wallet' as const }
      : walletBlock
        ? { ...walletBlock, actionLabel: 'Top up', route: '/wallet' as const }
        : null
  // What the banner shows. The no-credit notice is display-only: it never stops the driver going online (blockedBanner does that).
  const shownBanner = blockedBanner ?? packageNotice

  const toggleDisabled =
    flow.sessionCheck !== 'ready' || flow.checkingVerification || (!isOnline && (!!blockedBanner || !flow.vehicle))

  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  async function handleToggle() {
    if (isOnline) { setShowOfflineConfirm(true); return }
    const nextRoute = await flow.requestGoOnline()
    if (nextRoute) router.push(nextRoute)
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
        {...(mapReady ? { mapPadding: { top: 0, right: 0, bottom: sheetHeight + sheetBottom, left: 0 } } : {})}
        onMapReady={() => setMapReady(true)}
        showsUserLocation={false}
        showsMyLocationButton={false}
        loadingEnabled
        {...OCAR_MAP_PROPS}
      >
        {/* Own car icon instead of the OS's generic blue dot. Live position once
            online (real bearing available); the pre-online one-shot fix has no
            bearing, matching CarMarker's own contract for "no real bearing yet"
            (dimmed, not a fake north snap). */}
        {carPosition ? (
          <CarMarker position={carPosition} headingKnown={live?.headingKnown ?? false} opacity={0.85} kind={vehicleKind} />
        ) : null}
        {/* Real map-anchored Marker (see AddressCallout's own comment), not a
            screen-fixed overlay -- stays correctly pinned above the car
            through every pan/zoom instead of drifting off it. */}
        {carPosition && address ? <AddressCallout position={carPosition} address={address} carHalfHeight={MARKER_DP[vehicleKind].h / 2} /> : null}
      </MapView>
      {!isOnline ? <View style={styles.mapDim} pointerEvents="none" /> : null}

      {/* Minimal persistent HUD -- wallet balance and a notifications entry
          point, out of the way in the corners. */}
      {showReconnecting ? (
        <View style={[styles.offlineStrip, { top: insets.top }]} accessibilityLiveRegion="polite">
          <Text style={styles.offlineStripText}>Reconnecting… you may miss ride requests until it is back</Text>
        </View>
      ) : null}

      <View style={[styles.topRow, { top: insets.top + spacing.sm + (showReconnecting ? RECONNECT_STRIP_HEIGHT : 0) }]} pointerEvents="box-none">
        <View style={styles.walletPill}>
          <MaterialCommunityIcons name="currency-inr" size={13} color={colors.accent} />
          <Text style={styles.walletPillText}>{walletGate.loading ? '-' : Math.round(walletGate.balance).toLocaleString('en-IN')}</Text>
        </View>
        <NotificationBell count={unreadNotifications} onPress={() => router.push('/notifications')} style={styles.bellBtn} />
      </View>

      <View style={[styles.sheet, { bottom: sheetBottom }]} onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.date}>{todayLabel}</Text>
            <Text style={styles.greeting}>Hi, {firstName}</Text>
            <Text style={styles.subtext}>
              {isOnline ? (trackingHealth.issue ? "You're online, but we can't see your location" : "You're live, ride requests incoming") : 'Go online to start earning'}
            </Text>
          </View>
          <OnlineToggle isOnline={isOnline} onToggle={() => void handleToggle()} disabled={toggleDisabled} />
        </View>

        {isOnline ? (
          <TrackingHealthCard issue={trackingHealth.issue} recovered={trackingHealth.recovered} onRestart={() => retryTracking(trackingHealth.recheck)} />
        ) : null}

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

        {shownBanner ? (
          <Pressable onPress={() => router.push(shownBanner.route)} style={({ pressed }) => [styles.alertCard, pressed ? styles.pressedScale : null]} accessibilityRole="button">
            {/* Pulse only for the rejected-doc case, a frozen wallet doesn't get worse by the minute
                the way a rejected document review clock does, so it doesn't need the same urgency cue. */}
            {documentGate.hasRejected ? (
              <PulseDot color={colors.error} size={8} />
            ) : (
              <Feather name="alert-triangle" size={16} color={colors.error} />
            )}
            <View style={styles.alertBody}>
              <Text style={styles.alertTitle}>{shownBanner.title}</Text>
              <Text style={styles.alertText} numberOfLines={3}>{shownBanner.message}</Text>
            </View>
            <View style={styles.alertAction}>
              <Text style={styles.alertActionText}>{shownBanner.actionLabel}</Text>
              <Feather name="chevron-right" size={14} color={colors.error} />
            </View>
          </Pressable>
        ) : null}

        {nextBooking ? (
          <UpcomingBookingCard
            reservation={nextBooking}
            extra={bookings.reservations.length - 1}
            now={bookings.now}
            onPress={() => router.push('/reservations')}
            onStart={startBooking}
            onNavigate={navigateToPickup}
            onConfirm={confirmBooking}
            starting={starting}
            startError={startError}
          />
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
                <MaterialCommunityIcons name="currency-inr" size={13} color="#8A6420" />
                <Text style={[styles.statValue, styles.statValueOrange]}>
                  {summary ? Math.round(summary.totalEarnings).toLocaleString('en-IN') : '-'}
                </Text>
              </View>
              <Text style={styles.statLabel}>Earned</Text>
            </View>
            <View style={[styles.statCol, styles.statColDivider]}>
              <View style={styles.statValueRow}>
                <Feather name="clock" size={11} color={colors.ink600} />
                <Text style={styles.statValue}>{summary?.tripCount ?? '-'}</Text>
              </View>
              <Text style={styles.statLabel}>Trips</Text>
            </View>
            <View style={styles.statCol}>
              <View style={styles.statValueRow}>
                <Feather name="star" size={11} color={colors.ink600} />
                <Text style={styles.statValue}>{summary?.rating ?? '-'}</Text>
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
      </View>

      <BottomSheet visible={showOfflineConfirm} onClose={() => setShowOfflineConfirm(false)}>
        <View style={styles.confirmBody}>
          <View style={styles.confirmIconRing}>
            <View style={styles.confirmIcon}>
              <Feather name="power" size={26} color={colors.primary} />
            </View>
          </View>
          <Text style={styles.confirmTitle} accessibilityRole="header">Go offline?</Text>
          <Text style={styles.confirmText}>You will stop receiving ride requests until you go online again.</Text>
          <View style={styles.confirmActions}>
            <Button label="Stay online" onPress={() => setShowOfflineConfirm(false)} />
            <Button
              label="Go offline"
              variant="secondary"
              onPress={() => {
                setShowOfflineConfirm(false)
                void flow.goOffline()
              }}
            />
          </View>
        </View>
      </BottomSheet>
      <PushPrimerSheet
        visible={primer.visible}
        title="Don't miss a ride"
        message="Turn on notifications so Ocar can reach you when the app is closed."
        bullets={['New rides assigned to you', 'Document and wallet alerts', 'Messages from your rider']}
        enabling={primer.enabling}
        onEnable={() => { void primer.onEnable() }}
        onLater={primer.onLater}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  offlineStrip: { position: 'absolute', left: 0, right: 0, zIndex: 20, backgroundColor: colors.warning, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  offlineStripText: { ...typography.caption, color: colors.inkInverse, textAlign: 'center', fontFamily: fonts.bold },
  container: { flex: 1, backgroundColor: colors.bg },
  mapDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${colors.bg}59` },
  topRow: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  walletPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderRadius: radii.full, borderWidth: 1, borderColor: h.line08, height: 40, paddingHorizontal: spacing.sm + 6, boxShadow: shadow.sm },
  walletPillText: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  bellBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: h.line08, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  headerText: { flex: 1, gap: 2 },
  date: { ...typography.caption, color: colors.ink400 },
  greeting: { ...typography.headline, color: colors.ink900, fontSize: 22 },
  subtext: { ...typography.caption, color: colors.ink600 },
  card: { gap: spacing.sm },
  detail: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.errorLight, borderWidth: 1, borderColor: colors.error, borderRadius: 20, padding: spacing.md },
  alertBody: { flex: 1, gap: 2 },
  alertTitle: { ...typography.label, color: colors.error, fontFamily: fonts.bold, fontSize: 14 },
  alertText: { ...typography.caption, color: colors.ink600 },
  alertAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  alertActionText: { ...typography.caption, color: colors.error, fontFamily: fonts.bold },
  pressedScale: { transform: [{ scale: 0.98 }] },
  returnCabBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.successLight, borderRadius: 20, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  returnCabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  returnCabText: { ...typography.caption, color: colors.success, fontFamily: fonts.bold },
  sheet: {
    position: 'absolute',
    left: geo.gutter,
    right: geo.gutter,
    ...card,
    padding: spacing.md,
    gap: 14,
    boxShadow: shadow.lg,
  },
  unifiedCard: {
    backgroundColor: colors.surface2,
    borderRadius: 16,
    overflow: 'hidden',
  },
  statsRow: { flexDirection: 'row', paddingVertical: spacing.sm },
  statCol: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  statColDivider: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statValue: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  statValueOrange: { color: '#8A6420' },
  statLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
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
  actionLabel: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold },
  // One centered column: icon, title and body share an axis; the buttons span the full width.
  confirmBody: { paddingHorizontal: spacing.lg, alignItems: 'center' },
  confirmIconRing: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  confirmIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  confirmTitle: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.ink900, textAlign: 'center', marginTop: spacing.lg },
  confirmText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink600, textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 },
  confirmActions: { alignSelf: 'stretch', gap: spacing.sm + 2, marginTop: spacing.lg + 4 },
})
