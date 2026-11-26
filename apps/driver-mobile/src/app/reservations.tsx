import { useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, EmptyState, ErrorState, PulseDot, Text, captureError, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { BottomSheet } from '@/features/go-online/components/BottomSheet'
import { useReservations } from '@/features/reservations/useReservations'
import { confirmReservation, declineReservation } from '@/features/reservations/api'
import { clockOf, driveLine, guidance, inLabel, phaseOf, whenLabel } from '@/features/reservations/format'
import type { Reservation } from '@/features/reservations/types'

/**
 * Bookings an admin reserved for this driver. The driver stays free to take other rides; Ocar only sends ones that finish in time. Here they confirm
 * ("I will be there") or hand a booking back. Handing back inside the last hour is allowed but noted for the Ocar team, and the sheet says so first.
 */
export default function ReservationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { reservations, loading, error, now, refresh } = useReservations()
  const [busy, setBusy] = useState<string | null>(null)
  const [giveBack, setGiveBack] = useState<Reservation | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function confirm(r: Reservation) {
    setBusy(r.rideId); setFailure(null)
    try { await confirmReservation(r.rideId) }
    catch (err) { captureError(err, { where: 'reservation_confirm' }); setFailure('Could not confirm this booking. It may have been given to someone else.') }
    finally { setBusy(null); await refresh() }
  }

  async function handBack(r: Reservation) {
    setBusy(r.rideId); setFailure(null)
    try { await declineReservation(r.rideId); setGiveBack(null) }
    catch (err) { captureError(err, { where: 'reservation_decline' }); setFailure('Could not give this booking back. Please try again.'); setGiveBack(null) }
    finally { setBusy(null); await refresh() }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={18} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Upcoming bookings</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && reservations.length === 0 ? (
        <ErrorState message="Could not load your bookings." onRetry={() => void refresh()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)) }} tintColor={colors.primary} />}
        >
          {reservations.length === 0 ? (
            <EmptyState title="No upcoming bookings" description="When Ocar reserves a booking for you it shows up here, with a reminder before it starts." />
          ) : (
            <>
              <View style={styles.note}>
                <Feather name="info" size={15} color={colors.primary} />
                <Text style={styles.noteText}>Keep driving as usual. Ocar only sends you rides that finish in time for these bookings.</Text>
              </View>
              {failure ? <Text style={styles.failure} accessibilityLiveRegion="polite">{failure}</Text> : null}
              {reservations.map((r) => (
                <BookingCard key={r.rideId} r={r} now={now} busy={busy === r.rideId} onConfirm={() => void confirm(r)} onGiveBack={() => setGiveBack(r)} />
              ))}
            </>
          )}
        </ScrollView>
      )}

      <BottomSheet visible={giveBack !== null} onClose={() => setGiveBack(null)}>
        <View style={styles.sheetBody}>
          <Text style={styles.sheetTitle} accessibilityRole="header">Give this booking back?</Text>
          {giveBack ? <Text style={styles.sheetWhen}>{whenLabel(new Date(giveBack.pickupAt), new Date(now))}</Text> : null}
          <Text style={styles.sheetText}>
            {giveBack?.handBackIsLate
              ? 'This booking starts within the hour. You can give it back, but the Ocar team is told, and handing bookings back late often can affect the bookings you are offered.'
              : 'Ocar will find another driver for it. Please do this as early as you can.'}
          </Text>
          <View style={styles.sheetActions}>
            <Button label="Keep the booking" onPress={() => setGiveBack(null)} />
            <Button label="Give it back" variant="secondary" loading={giveBack !== null && busy === giveBack.rideId} onPress={() => { if (giveBack) void handBack(giveBack) }} />
          </View>
        </View>
      </BottomSheet>
    </View>
  )
}

function BookingCard({ r, now, busy, onConfirm, onGiveBack }: { r: Reservation; now: number; busy: boolean; onConfirm: () => void; onGiveBack: () => void }) {
  const pickupMs = new Date(r.pickupAt).getTime()
  const phase = phaseOf(pickupMs, now)
  const urgent = phase === 'ready' || phase === 'due'
  const label = r.rideType === 'round_trip' ? 'Round trip' : r.rideType === 'rental' ? 'Rental' : r.isReturnCab ? 'Return cab' : 'One way'
  return (
    <View style={[styles.card, urgent ? styles.cardUrgent : null]}>
      <View style={styles.cardTop}>
        <View style={styles.row}>
          {urgent ? <PulseDot color={colors.warning} size={8} /> : null}
          <Text style={styles.when}>{whenLabel(new Date(pickupMs), new Date(now))}</Text>
        </View>
        <Text style={styles.in}>{inLabel(pickupMs, now)}</Text>
      </View>
      <View style={styles.route}>
        <View style={styles.rail}><View style={styles.dotA} /><View style={styles.line} /><View style={styles.dotB} /></View>
        <View style={styles.places}>
          <Text style={styles.place} numberOfLines={2}>{r.pickup ?? 'Pickup'}</Text>
          <Text style={styles.place} numberOfLines={2}>{r.drop ?? 'Drop'}</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{label}</Text>
        {r.estimatedFare != null ? <Text style={styles.fare}>₹{r.estimatedFare.toLocaleString('en-IN')}</Text> : null}
      </View>
      <Text style={styles.meta}>Leave by {clockOf(r.leaveBy)}. {driveLine(r.driveMin)}.</Text>
      <Text style={[styles.hint, urgent ? styles.hintUrgent : null]}>{guidance(phase, r.confirmed)}</Text>
      <View style={styles.actions}>
        {r.confirmed ? (
          <View style={styles.confirmed}><Feather name="check-circle" size={16} color={colors.success} /><Text style={styles.confirmedText}>You confirmed</Text></View>
        ) : (
          <View style={styles.confirmWrap}><Button label="I will be there" icon="check" loading={busy} onPress={onConfirm} /></View>
        )}
        <Pressable onPress={onGiveBack} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Give this booking back" style={styles.giveBack}>
          <Text style={styles.giveBackText}>Can't make it</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.primarySubtle, borderRadius: radii.md, padding: spacing.md },
  noteText: { ...typography.caption, color: colors.ink600, flex: 1 },
  failure: { ...typography.caption, color: colors.error, fontFamily: fonts.semibold },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  cardUrgent: { borderColor: colors.warning, borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  when: { ...typography.headline, fontSize: 18, color: colors.ink900, fontFamily: fonts.bold },
  in: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  route: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  rail: { alignItems: 'center', paddingTop: 5, width: 12 },
  dotA: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  line: { width: 1.5, flex: 1, minHeight: 16, backgroundColor: colors.primaryLight, marginVertical: 2 },
  dotB: { width: 9, height: 9, borderRadius: 2, backgroundColor: colors.ink900 },
  places: { flex: 1, gap: spacing.sm },
  place: { ...typography.body, color: colors.ink900 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...typography.caption, color: colors.ink600 },
  fare: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  hint: { ...typography.caption, color: colors.ink600 },
  hintUrgent: { color: '#8A6420', fontFamily: fonts.semibold },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  confirmWrap: { flex: 1 },
  confirmed: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmedText: { ...typography.body, color: colors.success, fontFamily: fonts.semibold },
  giveBack: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  giveBackText: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  sheetBody: { padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold },
  sheetWhen: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  sheetText: { ...typography.body, color: colors.ink600 },
  sheetActions: { gap: spacing.sm, marginTop: spacing.sm },
})
