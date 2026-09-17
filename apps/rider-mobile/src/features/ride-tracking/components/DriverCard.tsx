import { Image, StyleSheet, Text, View } from 'react-native'
import { Card, colors, spacing, typography } from '@ocar/mobile-shared'
import type { RideDetailExtra } from '../types'

export type DriverCardProps = {
  ride: RideDetailExtra
  stale: boolean
}

export function DriverCard({ ride, stale }: DriverCardProps) {
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
})
