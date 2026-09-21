import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { markStopStatus } from '../api'

export type StopCardProps = {
  rideId: string
  sequence: number
  address: string | null
  onResolved: () => void
}

// The trip cannot end while any stop is still pending (backend hard-blocks
// end-otp with RIDE_HAS_PENDING_STOPS) -- this app had no UI anywhere for a
// driver to ever mark a rider-added stop reached or skipped, so hitting this
// state left a driver stuck seeing a generic "Could not confirm" error on the
// end-OTP card with no indication why, or any way out.
export function StopCard({ rideId, sequence, address, onResolved }: StopCardProps) {
  const [submitting, setSubmitting] = useState<'reached' | 'skipped' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resolve(status: 'reached' | 'skipped') {
    if (submitting) return
    setSubmitting(status)
    setError(null)
    try {
      await markStopStatus(rideId, sequence, status)
      onResolved()
    } catch {
      setError("Couldn't update the stop. Try again.")
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Feather name="map-pin" size={18} color={colors.warning} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.label}>Stop {sequence}</Text>
          <Text style={styles.address} numberOfLines={2}>{address ?? 'Stop location'}</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={submitting === 'reached' ? 'Marking…' : 'Mark stop reached'}
        loading={submitting === 'reached'}
        disabled={submitting !== null}
        onPress={() => void resolve('reached')}
      />
      <Button
        label={submitting === 'skipped' ? 'Skipping…' : 'Skip this stop'}
        variant="ghost"
        loading={submitting === 'skipped'}
        disabled={submitting !== null}
        onPress={() => void resolve('skipped')}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: { width: 44, height: 44, borderRadius: radii.lg, backgroundColor: colors.warningLight, alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, minWidth: 0, gap: 1 },
  label: { ...typography.caption, color: colors.ink400, fontWeight: '700', textTransform: 'uppercase' },
  address: { ...typography.title, color: colors.ink900 },
  error: { ...typography.label, color: colors.error },
})
