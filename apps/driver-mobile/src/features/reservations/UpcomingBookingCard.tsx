import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, Text, colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { StatusPanel, TonePill, tonePill, type StatusTone } from '@/components/StatusCard'
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
 * Home panel for the driver's next reserved booking. One panel that changes with the time, so there is never a second thing to learn:
 *   later    calm: when, how far away, confirm or confirmed
 *   leaveby  the time to leave and how long the drive is, with Navigate
 *   headout  "Head to the pickup now", with Start now (opens the ride early, so the rider sees the driver on the way)
 *   opens    a countdown to the moment the ride opens by itself, with Start now
 * Time pressure is amber in the pill, never red: nothing here is broken, the driver just has something to do soon.
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
  const tone: StatusTone = urgent || needsConfirm ? 'attention' : reservation.confirmed && stage === 'later' ? 'ok' : 'info'
  const status = stage === 'opens' ? 'Going live' : stage === 'headout' ? 'Head out' : stage === 'leaveby' ? (needsConfirm ? 'Confirm' : 'Leave soon') : needsConfirm ? 'Confirm' : 'Confirmed'

  const opensMs = new Date(reservation.opensAt).getTime()
  const heading =
    stage === 'opens' ? `Opens in ${countdown(opensMs, clock)}`
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
    <StatusPanel onPress={onPress} accessibilityLabel={`Upcoming booking. ${status}. ${heading}. ${detail}`}>
      <View style={styles.top}>
        <TonePill tone={tone} label={status} />
        {aside ? <Text style={styles.aside}>{aside}</Text> : null}
      </View>

      <View style={styles.main}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{heading}</Text>
          {stage === 'later' ? <Feather name="chevron-right" size={18} color={colors.ink400} /> : null}
        </View>
        {stage === 'later' && reservation.pickup ? <Text style={styles.place} numberOfLines={1}>{reservation.pickup}</Text> : null}
        <Text style={styles.hint}>{detail}</Text>
      </View>

      {stage === 'leaveby' ? (
        <View style={styles.actions}>
          {needsConfirm ? <Button label="I will be there" icon="check" onPress={onConfirm} /> : null}
          <Button label="Navigate to pickup" icon="navigation" variant={needsConfirm ? 'secondary' : 'primary'} onPress={onNavigate} accessibilityLabel="Navigate to the pickup" />
        </View>
      ) : null}
      {urgent ? (
        <View style={styles.actions}>
          <Button label="Start now" icon="arrow-right" loading={starting} onPress={onStart} accessibilityLabel="Start now: open the ride and head to the pickup" />
        </View>
      ) : null}
      {startError ? <Text style={styles.error} accessibilityLiveRegion="polite">{startError}</Text> : null}

      {stage === 'later' && extra > 0 ? <Text style={styles.more}>{extra} more booking{extra === 1 ? '' : 's'} after this</Text> : null}
    </StatusPanel>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aside: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  main: { gap: 3 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typography.headline, fontSize: 22, lineHeight: 28, color: colors.ink900, fontVariant: ['tabular-nums'], flexShrink: 1 },
  place: { ...typography.label, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  hint: { ...typography.label, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  actions: { gap: spacing.sm },
  error: { ...typography.caption, color: tonePill.blocker.ink, fontFamily: fonts.semibold },
  more: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
})
