import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography, Text, getApiErrorMessage } from '@ocar/mobile-shared'
import { serverNow } from '@/services/api'
import { markStopArrived, markStopStatus, reportStopUnreachable } from '../api'
import { SlideToConfirm } from './SlideToConfirm'

export type StopCardProps = {
  rideId: string
  sequence: number
  /** One-way only: wait at a stop is metered, so arrival is its own step. */
  meterWait: boolean
  arrivedAt: string | null
  /** Set once the driver has asked the rider to skip this stop. */
  unreachableRequestedAt?: string | null
  onResolved: () => void
}

function elapsed(since: string): string {
  const s = Math.max(0, Math.floor((serverNow() - new Date(since).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The action half of a pending stop. Which stop it is ("Stop 1 of 2" + address) lives in the
// stage header above, so the sheet has exactly one headline. The trip cannot end while any
// stop is pending (backend hard-blocks end-otp with RIDE_HAS_PENDING_STOPS), so this is the
// driver's single next action while one is open: arrive -> (wait) -> continue. Only the
// rider can skip a stop; "can't reach" (overflow menu) just asks them to.
export function StopCard({ rideId, sequence, meterWait, arrivedAt, unreachableRequestedAt, onResolved }: StopCardProps) {
  const [submitting, setSubmitting] = useState<'arrived' | 'reached' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!arrivedAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [arrivedAt])

  // Resolves true on success. The slide-to-confirm control resets itself on false.
  async function run(step: 'arrived' | 'reached'): Promise<boolean> {
    if (submitting) return false
    setSubmitting(step)
    setError(null)
    try {
      if (step === 'arrived') await markStopArrived(rideId, sequence)
      else await markStopStatus(rideId, sequence, step)
      onResolved()
      return true
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't update the stop. Try again."))
      return false
    } finally {
      setSubmitting(null)
    }
  }

  // Deliberately tucked behind an overflow menu, not a button on the sheet: it is a rare
  // escape hatch (closed road, unsafe spot), and a prominent one is how drivers used to
  // reject rider-added stops. It only asks the rider; the rider decides.
  function confirmUnreachable() {
    Alert.alert(
      "Can't reach this stop?",
      "We'll ask the rider to skip it. You'll need to wait for their answer before you can continue.",
      [
        { text: 'Go back', style: 'cancel' },
        {
          text: 'Ask rider to skip',
          onPress: () => {
            setError(null)
            reportStopUnreachable(rideId, sequence)
              .then(onResolved)
              .catch((err) => setError(getApiErrorMessage(err, "Couldn't send that request. Try again.")))
          },
        },
      ],
    )
  }

  function openMore() {
    Alert.alert('More', undefined, [
      { text: "Can't reach this stop", onPress: confirmUnreachable },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const waiting = meterWait && arrivedAt != null
  const needsArrival = meterWait && arrivedAt == null

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        {waiting ? (
          <View style={styles.waitPill} accessibilityLabel={`Waiting ${elapsed(arrivedAt)}`}>
            <Feather name="clock" size={14} color={colors.ink900} />
            <Text style={styles.waitText}>Waiting {elapsed(arrivedAt)}</Text>
          </View>
        ) : <View />}
        {unreachableRequestedAt ? null : (
          <Pressable
            onPress={openMore}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="More stop options"
            style={styles.moreButton}
          >
            <Feather name="more-horizontal" size={20} color={colors.ink600} />
          </Pressable>
        )}
      </View>
      {unreachableRequestedAt ? (
        <View style={styles.askedNote}>
          <Feather name="clock" size={14} color={colors.ink900} />
          <Text style={styles.waitText}>Asked the rider to skip this stop. Waiting for their reply.</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {/* Slides, not taps: arriving starts the metered wait clock and "continue" ends it, so a
          stray touch from a mounted phone must not be able to do either. */}
      {needsArrival ? (
        <SlideToConfirm
          label="Slide when you arrive"
          doneLabel="Arrived"
          onConfirm={() => run('arrived')}
        />
      ) : (
        <SlideToConfirm
          label={waiting ? 'Slide to continue trip' : 'Slide when stop reached'}
          doneLabel={waiting ? 'Continuing' : 'Reached'}
          onConfirm={() => run('reached')}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreButton: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  askedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.warningLight,
    borderRadius: radii.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md - 4,
  },
  // A running meter, not a status chip: tabular digits would be ideal; Plus Jakarta's
  // numerals are tabular enough at this size that the pill doesn't jitter each second.
  waitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    backgroundColor: colors.warningLight,
    borderRadius: radii.full,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md - 4,
  },
  waitText: { ...typography.label, color: colors.ink900, fontFamily: fonts.bold },
  error: { ...typography.label, color: colors.error },
})
