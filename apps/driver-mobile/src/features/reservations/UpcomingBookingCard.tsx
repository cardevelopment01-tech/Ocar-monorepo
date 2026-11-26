import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Text, colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { NoticeBlock, NoticeRow, TonePill, tonePill } from '@/components/Notices'
import { clockOf, countdown, driveLine, inLabel, stageOf, whenLabel } from './format'
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
 * The driver's next reserved booking, as one entry in Home's notice group. It is a single 64 px row until there is something to do, and only then grows:
 *   later    a row: when, which pickup, how long to go ("Today, 6:22 PM  in 1h 56m")
 *   leaveby  a block: the time to leave and the drive, with Navigate (and "I will be there" if not yet confirmed)
 *   headout  a block: "Head to the pickup now", with Start now (opens the ride early, so the rider sees the driver on the way)
 *   opens    a block: a countdown to the moment the ride opens by itself, with Start now
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

  const pickupMs = new Date(reservation.pickupAt).getTime()
  const needsConfirm = !reservation.confirmed

  if (stage === 'later') {
    const message = extra > 0 ? `Next booking · ${extra} more after this` : needsConfirm ? 'Tap to confirm' : `Next booking · ${reservation.pickup ?? 'confirmed'}`
    return (
      <NoticeRow
        tone={needsConfirm ? 'attention' : 'ok'}
        title={whenLabel(new Date(pickupMs), new Date(now))}
        message={message}
        aside={inLabel(pickupMs, now)}
        onPress={onPress}
      />
    )
  }

  const status = stage === 'opens' ? 'Going live' : stage === 'headout' ? 'Head out' : needsConfirm ? 'Confirm' : 'Leave soon'
  const opensMs = new Date(reservation.opensAt).getTime()
  const heading = stage === 'opens' ? `Opens in ${countdown(opensMs, tick)}` : stage === 'headout' ? 'Head to the pickup now' : `Leave by ${clockOf(reservation.leaveBy)}`
  const aside = stage === 'leaveby' ? inLabel(new Date(reservation.leaveBy).getTime(), now) : `Booking at ${clockOf(reservation.pickupAt)}`
  // The booking time is already in the corner for 'head out' and 'opens'; 'leave by' shows how long to go there instead.
  const detail = stage === 'opens' ? "We'll open the ride for you. Start now to go straight to it." : stage === 'headout' ? `${driveLine(reservation.driveMin)}.` : `${driveLine(reservation.driveMin)} · Booking at ${clockOf(reservation.pickupAt)}`

  return (
    <NoticeBlock onPress={onPress} accessibilityLabel={`Upcoming booking. ${status}. ${heading}. ${detail}`}>
      <View style={styles.top}>
        <TonePill tone="attention" label={status} />
        <Text style={styles.aside}>{aside}</Text>
      </View>
      <Text style={[styles.heading, stage === 'opens' ? styles.headingBig : stage === 'headout' ? styles.headingSmall : null]}>{heading}</Text>
      <Text style={styles.detail}>{detail}</Text>

      {stage === 'leaveby' ? (
        <View style={styles.buttons}>
          {needsConfirm ? <View style={styles.primary}><Button label="I will be there" onPress={onConfirm} /></View> : null}
          <View style={needsConfirm ? styles.secondary : styles.primary}>
            <Button label={needsConfirm ? 'Navigate' : 'Navigate to pickup'} icon="navigation" variant={needsConfirm ? 'soft' : 'primary'} onPress={onNavigate} accessibilityLabel="Navigate to the pickup" />
          </View>
        </View>
      ) : (
        <Button label="Start now" icon="arrow-right" loading={starting} onPress={onStart} accessibilityLabel="Start now: open the ride and head to the pickup" />
      )}
      {startError ? <Text style={styles.error} accessibilityLiveRegion="polite">{startError}</Text> : null}
    </NoticeBlock>
  )
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aside: { ...typography.label, fontFamily: fonts.semibold, fontSize: 13, color: colors.ink600, fontVariant: ['tabular-nums'] },
  heading: { ...typography.headline, fontSize: 24, lineHeight: 30, color: colors.ink900, fontVariant: ['tabular-nums'] },
  headingBig: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  headingSmall: { fontSize: 22, lineHeight: 28 },
  detail: { ...typography.label, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink600, marginTop: -6 },
  buttons: { flexDirection: 'row', gap: spacing.sm + 2 },
  primary: { flex: 1.3 },
  secondary: { flex: 1 },
  error: { ...typography.caption, color: tonePill.blocker.ink, fontFamily: fonts.semibold },
})
