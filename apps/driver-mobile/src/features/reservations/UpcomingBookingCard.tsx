import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, PulseDot, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { clockOf, countdown, driveLine, guidance, inLabel, phaseOf, stageOf, whenLabel } from './format'
import type { Reservation } from './types'

type Props = {
  reservation: Reservation
  /** How many more bookings sit behind this one. */
  extra: number
  now: number
  onPress: () => void
  onStart: () => void
  onNavigate: () => void
  /** "I will be there", offered while the booking is still unconfirmed. */
  onConfirm: () => void
  starting: boolean
  /** The server's sentence when "Start now" was refused (go online first, finish your ride...). */
  startError: string | null
}

/**
 * Home card for the driver's next reserved booking. One card that changes with the time, so there is never a second thing to learn:
 *   later    calm: when, how far away, confirm or confirmed
 *   leaveby  the time to leave and how long the drive is, with Navigate
 *   headout  "Head to the pickup now", with Start now (opens the ride early, so the rider sees the driver on the way)
 *   opens    a countdown to the moment the ride opens by itself, with Start now
 */
export function UpcomingBookingCard({ reservation, extra, now, onPress, onStart, onNavigate, onConfirm, starting, startError }: Props) {
  const stage = stageOf(reservation, now)
  // The countdown is the only thing here that moves by the second.
  const [tick, setTick] = useState(now)
  useEffect(() => {
    if (stage !== 'opens') return
    setTick(Date.now())
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [stage])
  const clock = stage === 'opens' ? tick : now

  const pickupMs = new Date(reservation.pickupAt).getTime()
  const urgent = stage === 'headout' || stage === 'opens'
  const needsConfirm = !reservation.confirmed
  const phase = phaseOf(pickupMs, now)
  const accent = urgent ? colors.error : needsConfirm ? '#8A6420' : colors.success
  const chip = stage === 'opens' ? 'Going live' : stage === 'headout' ? 'Head out' : stage === 'leaveby' ? (needsConfirm ? 'Confirm' : 'Leave soon') : needsConfirm ? 'Confirm' : 'Confirmed'

  const opensMs = new Date(reservation.opensAt).getTime()
  const heading =
    stage === 'opens' ? `Booking opens in ${countdown(opensMs, clock)}`
    : stage === 'headout' ? 'Head to the pickup now'
    : stage === 'leaveby' ? `Leave by ${clockOf(reservation.leaveBy)}`
    : whenLabel(new Date(pickupMs), new Date(now))
  const aside = stage === 'later' || stage === 'leaveby' ? inLabel(stage === 'later' ? pickupMs : new Date(reservation.leaveBy).getTime(), now) : null
  const detail =
    stage === 'opens' ? 'We will open the ride for you. Tap Start now to go straight to it.'
    : stage === 'headout' ? `Booking at ${clockOf(reservation.pickupAt)}. ${driveLine(reservation.driveMin)}.`
    : stage === 'leaveby' ? `${driveLine(reservation.driveMin)}. Booking at ${clockOf(reservation.pickupAt)}.`
    : guidance(phase, reservation.confirmed)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming booking. ${heading}. ${detail}`}
      style={({ pressed }) => [styles.card, urgent ? styles.cardUrgent : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.top}>
        <View style={styles.titleRow}>
          {urgent ? <PulseDot color={colors.error} size={8} /> : <Feather name={stage === 'leaveby' ? 'clock' : 'calendar'} size={15} color={colors.primary} />}
          <Text style={styles.title}>Upcoming booking</Text>
        </View>
        <View style={[styles.chip, { borderColor: accent }]}>
          <Text style={[styles.chipText, { color: accent }]}>{chip}</Text>
        </View>
      </View>

      <Text style={styles.heading}>
        {heading}{aside ? <Text style={styles.aside}>  {aside}</Text> : null}
      </Text>
      {stage === 'later' && reservation.pickup ? <Text style={styles.place} numberOfLines={1}>{reservation.pickup}</Text> : null}
      <Text style={[styles.hint, urgent ? styles.hintUrgent : null]}>{detail}</Text>

      {stage === 'leaveby' ? (
        <View style={styles.action}>
          {needsConfirm ? <Button label="I will be there" icon="check" onPress={onConfirm} /> : null}
          <Button label="Navigate to pickup" icon="navigation" variant={needsConfirm ? 'ghost' : 'secondary'} onPress={onNavigate} accessibilityLabel="Navigate to the pickup" />
        </View>
      ) : null}
      {urgent ? (
        <View style={styles.action}>
          <Button label="Start now" icon="arrow-right" loading={starting} onPress={onStart} accessibilityLabel="Start now: open the ride and head to the pickup" />
        </View>
      ) : null}
      {startError ? <Text style={styles.error} accessibilityLiveRegion="polite">{startError}</Text> : null}

      {stage === 'later' ? (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{extra > 0 ? `${extra} more booking${extra === 1 ? '' : 's'}` : 'View details'}</Text>
          <Feather name="chevron-right" size={14} color={colors.ink400} />
        </View>
      ) : null}
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
  heading: { ...typography.headline, fontSize: 20, color: colors.ink900, fontFamily: fonts.bold, marginTop: 2 },
  aside: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },
  place: { ...typography.body, color: colors.ink600 },
  hint: { ...typography.caption, color: colors.ink600, marginTop: 2 },
  hintUrgent: { color: colors.error, fontFamily: fonts.semibold },
  action: { marginTop: spacing.sm, gap: spacing.xs },
  error: { ...typography.caption, color: colors.error, fontFamily: fonts.semibold, marginTop: spacing.xs },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: 2 },
  footerText: { ...typography.caption, color: colors.ink400 },
})
