import { useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, colors, fonts, radii, spacing, typography, Text } from '@ocar/mobile-shared'
import { serverNow } from '@/services/api'
import { markStopArrived, markStopStatus } from '../api'
import { SlideToConfirm } from './SlideToConfirm'

export type StopCardProps = {
  rideId: string
  sequence: number
  /** One-way only: wait at a stop is metered, so arrival is its own step. */
  meterWait: boolean
  arrivedAt: string | null
  onResolved: () => void
}

function elapsed(since: string): string {
  const s = Math.max(0, Math.floor((serverNow() - new Date(since).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// The action half of a pending stop. Which stop it is ("Stop 1 of 2" + address) lives in the
// stage header above, so the sheet has exactly one headline. The trip cannot end while any
// stop is pending (backend hard-blocks end-otp with RIDE_HAS_PENDING_STOPS), so this is the
// driver's single next action while one is open: arrive -> (wait) -> continue, or skip.
export function StopCard({ rideId, sequence, meterWait, arrivedAt, onResolved }: StopCardProps) {
  const [submitting, setSubmitting] = useState<'arrived' | 'reached' | 'skipped' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!arrivedAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [arrivedAt])

  // Resolves true on success. The slide-to-confirm control resets itself on false.
  async function run(step: 'arrived' | 'reached' | 'skipped'): Promise<boolean> {
    if (submitting) return false
    setSubmitting(step)
    setError(null)
    try {
      if (step === 'arrived') await markStopArrived(rideId, sequence)
      else await markStopStatus(rideId, sequence, step)
      onResolved()
      return true
    } catch {
      setError("Couldn't update the stop. Try again.")
      return false
    } finally {
      setSubmitting(null)
    }
  }

  function confirmSkip() {
    Alert.alert('Skip this stop?', 'The rider will not be taken here.', [
      { text: 'Go back', style: 'cancel' },
      { text: 'Skip stop', style: 'destructive', onPress: () => { void run('skipped') } },
    ])
  }

  const waiting = meterWait && arrivedAt != null
  const needsArrival = meterWait && arrivedAt == null

  return (
    <View style={styles.card}>
      {waiting ? (
        <View style={styles.waitPill} accessibilityLabel={`Waiting ${elapsed(arrivedAt)}`}>
          <Feather name="clock" size={14} color={colors.ink900} />
          <Text style={styles.waitText}>Waiting {elapsed(arrivedAt)}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {/* Slides, not taps: arriving starts the metered wait clock and "continue" ends it, so a
          stray touch from a mounted phone must not be able to do either. */}
      {needsArrival ? (
        <SlideToConfirm
          label="Slide when you arrive"
          doneLabel="Arrived"
          disabled={submitting === 'skipped'}
          onConfirm={() => run('arrived')}
        />
      ) : (
        <SlideToConfirm
          label={waiting ? 'Slide to continue trip' : 'Slide when stop reached'}
          doneLabel={waiting ? 'Continuing' : 'Reached'}
          disabled={submitting === 'skipped'}
          onConfirm={() => run('reached')}
        />
      )}
      <Button
        label={submitting === 'skipped' ? 'Skipping…' : 'Skip this stop'}
        variant="ghost"
        loading={submitting === 'skipped'}
        disabled={submitting !== null}
        onPress={confirmSkip}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
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
