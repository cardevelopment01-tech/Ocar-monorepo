import { Image, StyleSheet, Text, View } from 'react-native'
import { Card, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import type { RideDetailExtra } from '../types'

export type DriverCardProps = {
  ride: RideDetailExtra
  stale: boolean
  // Fused into this card, not a separate one elsewhere on the page -- this is
  // the one piece of UI a rider reads aloud to a stranger at their car
  // window, under time pressure. It belongs in the same glance as "is this
  // my driver", not buried mid-scroll past the fare row (Uber's own
  // placement: the PIN sits on the driver row itself).
  otp?: string | null
  otpLabel?: string
}

export function DriverCard({ ride, stale, otp, otpLabel }: DriverCardProps) {
  const vehicleLine = [ride.vehicleBrand, ride.vehicleModel].filter(Boolean).join(' ') || ride.vehicleName || 'Vehicle'

  return (
    <Card style={styles.card} accessibilityRole="summary" accessibilityLabel={`Driver ${ride.driverName ?? 'assigned'}`}>
      <View style={styles.row}>
        {ride.driverPhoto ? (
          <Image source={{ uri: ride.driverPhoto }} style={styles.photo} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Text style={styles.photoInitial}>{(ride.driverName ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name}>{ride.driverName ?? 'Your driver'}</Text>
          <Text style={styles.meta}>
            {ride.driverRating ? `★ ${ride.driverRating}` : 'New driver'} · {vehicleLine}
          </Text>
          <Text style={styles.plate}>{ride.vehicleNumberPlate ?? '—'}</Text>
        </View>
        {otp ? (
          <View style={styles.pinChip} accessibilityLabel={`${otpLabel ?? 'PIN'}: ${otp.split('').join(' ')}`}>
            <Text style={styles.pinLabel}>{otpLabel ?? 'PIN'}</Text>
            <Text style={styles.pinDigits} maxFontSizeMultiplier={2}>{otp}</Text>
          </View>
        ) : null}
      </View>
      {stale ? (
        <Text style={styles.staleNote} accessibilityLiveRegion="polite">
          Driver's location hasn't updated in a few minutes
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  photo: { width: 56, height: 56, borderRadius: 28 },
  photoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  photoInitial: { ...typography.title, color: colors.primary },
  info: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900 },
  meta: { ...typography.body, color: colors.ink600 },
  plate: { ...typography.label, color: colors.ink900, letterSpacing: 1 },
  staleNote: { ...typography.caption, color: colors.warning },
  pinChip: {
    alignItems: 'center',
    backgroundColor: colors.primarySubtle,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    gap: 2,
  },
  pinLabel: { ...typography.caption, color: colors.primaryDark, fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },
  pinDigits: {
    fontFamily: typography.display.fontFamily,
    fontWeight: typography.display.fontWeight,
    fontSize: 22,
    letterSpacing: 3,
    color: colors.ink900,
  },
})
