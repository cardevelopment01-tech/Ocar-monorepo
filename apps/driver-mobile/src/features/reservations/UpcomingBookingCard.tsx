import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { PulseDot, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { guidance, inLabel, phaseOf, whenLabel } from './format'
import type { Reservation } from './types'

type Props = { reservation: Reservation; extra: number; now: number; onPress: () => void }

/**
 * Home card for the driver's next reserved booking: when, how far away, and the one thing to do about it. It is calm until the booking is
 * 30 minutes away, then it turns into a "be ready" call. `extra` is how many more bookings sit behind it.
 */
export function UpcomingBookingCard({ reservation, extra, now, onPress }: Props) {
  const pickupMs = new Date(reservation.pickupAt).getTime()
  const phase = phaseOf(pickupMs, now)
  const urgent = phase === 'ready' || phase === 'due'
  const needsConfirm = !reservation.confirmed
  const status = urgent ? 'Be ready' : needsConfirm ? 'Confirm' : 'Confirmed'
  const accent = urgent ? colors.error : needsConfirm ? '#8A6420' : colors.success

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming booking ${whenLabel(new Date(pickupMs), new Date(now))}, ${inLabel(pickupMs, now)}. ${status}.`}
      style={({ pressed }) => [styles.card, urgent ? styles.cardUrgent : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.top}>
        <View style={styles.titleRow}>
          {urgent ? <PulseDot color={colors.error} size={8} /> : <Feather name="calendar" size={15} color={colors.primary} />}
          <Text style={styles.title}>Upcoming booking</Text>
        </View>
        <View style={[styles.chip, { borderColor: accent }]}>
          <Text style={[styles.chipText, { color: accent }]}>{status}</Text>
        </View>
      </View>
      <Text style={styles.when}>{whenLabel(new Date(pickupMs), new Date(now))}<Text style={styles.in}>  {inLabel(pickupMs, now)}</Text></Text>
      {reservation.pickup ? <Text style={styles.place} numberOfLines={1}>{reservation.pickup}</Text> : null}
      <Text style={[styles.hint, urgent ? styles.hintUrgent : null]} numberOfLines={2}>{guidance(phase, reservation.confirmed)}</Text>
      <View style={styles.footer}>
        <Text style={styles.footerText}>{extra > 0 ? `${extra} more booking${extra === 1 ? '' : 's'}` : 'View details'}</Text>
        <Feather name="chevron-right" size={14} color={colors.ink400} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.primaryLight, padding: spacing.md, gap: 4 },
  cardUrgent: { borderColor: colors.error, borderWidth: 1.5, backgroundColor: colors.errorLight },
  pressed: { transform: [{ scale: 0.985 }] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { ...typography.caption, fontFamily: fonts.bold },
  when: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold, marginTop: 2 },
  in: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  place: { ...typography.body, color: colors.ink600 },
  hint: { ...typography.caption, color: colors.ink600, marginTop: 2 },
  hintUrgent: { color: colors.error, fontFamily: fonts.semibold },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: 2 },
  footerText: { ...typography.caption, color: colors.ink400 },
})
