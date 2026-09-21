import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Card, colors, formatCurrency, spacing, typography } from '@ocar/mobile-shared'
import { formatPickupTime } from '@/lib/formatPickupTime'
import { RouteRow } from './RouteRow'
import type { UpcomingRide } from '../types'

export type UpcomingCardProps = {
  ride: UpcomingRide
  onOpen: () => void
  onCancel: () => void
  cancelling: boolean
}

// Matches web's UpcomingCard (history/page.tsx): a "Scheduled" pill + fare/pickup
// time up top, the route row, and a full-width "Cancel ride" footer button --
// this app had no scheduled-ride list or cancel action at all before.
export function UpcomingCard({ ride, onOpen, onCancel, cancelling }: UpcomingCardProps) {
  const fare = ride.fare != null ? formatCurrency(parseFloat(ride.fare)) : null

  return (
    <View style={styles.wrapper}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.scheduledPill}>
            <Feather name="calendar" size={11} color={colors.info} />
            <Text style={styles.scheduledText}>Scheduled</Text>
          </View>
          <View style={styles.topRight}>
            {fare ? <Text style={styles.fare}>{fare}</Text> : null}
            <Text style={styles.time}>{formatPickupTime(new Date(ride.scheduledFor))}</Text>
          </View>
        </View>

        <Pressable onPress={onOpen} accessibilityRole="button">
          <RouteRow origin={ride.originAddress ?? '—'} destination={ride.destinationAddress ?? '—'} />
        </Pressable>

        <Pressable
          onPress={onCancel}
          disabled={cancelling}
          style={styles.cancelBtn}
          accessibilityRole="button"
          accessibilityLabel="Cancel this scheduled ride"
        >
          <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel ride'}</Text>
        </Pressable>
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  card: { gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  scheduledPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.infoLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  scheduledText: { ...typography.caption, fontSize: 11, color: colors.info, fontWeight: '700' },
  topRight: { alignItems: 'flex-end', gap: 2 },
  fare: { ...typography.label, fontSize: 14, color: colors.ink900, fontWeight: '700' },
  time: { ...typography.caption, fontSize: 11, color: colors.ink400 },
  cancelBtn: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' },
  cancelText: { ...typography.caption, color: colors.error, fontWeight: '700' },
})
