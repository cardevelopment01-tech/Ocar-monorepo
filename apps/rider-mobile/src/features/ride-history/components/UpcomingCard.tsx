import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { geo } from '@/theme/homeTokens'
import { Card, colors, formatCurrency, spacing, typography, fonts } from '@ocar/mobile-shared'
import { formatPickupTime } from '@/lib/formatPickupTime'
import { upcomingStatusLine, type AdvanceTerms } from '@/features/advance/advanceModel'
import { RouteRow } from './RouteRow'
import type { UpcomingRide } from '../types'

export type UpcomingCardProps = {
  ride: UpcomingRide
  onOpen: () => void
  onCancel: () => void
  onChangeTime: () => void
  terms: AdvanceTerms
  cancelling: boolean
}

// Matches web's UpcomingCard (history/page.tsx): a "Scheduled" pill + fare/pickup
// time up top, the route row, and a full-width "Cancel ride" footer button --
// this app had no scheduled-ride list or cancel action at all before.
export function UpcomingCard({ ride, onOpen, onCancel, onChangeTime, terms, cancelling }: UpcomingCardProps) {
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
          <RouteRow origin={ride.originAddress ?? '-'} destination={ride.destinationAddress ?? '-'} />
        </Pressable>

        <Text style={styles.statusLine}>{upcomingStatusLine(ride.scheduledFor, terms)}</Text>

        <View style={styles.actions}>
          <Pressable
            onPress={onChangeTime}
            disabled={cancelling}
            style={({ pressed }) => [styles.actionBtn, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityLabel="Change pickup time"
          >
            <Feather name="clock" size={13} color={colors.primary} />
            <Text style={styles.changeText}>Change time</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            disabled={cancelling}
            style={({ pressed }) => [styles.actionBtn, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityLabel="Cancel this scheduled ride"
          >
            <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel ride'}</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: geo.gutter, paddingVertical: spacing.xs },
  card: { gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  scheduledPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.infoLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  scheduledText: { ...typography.caption, fontSize: 11, color: colors.info, fontFamily: fonts.bold },
  topRight: { alignItems: 'flex-end', gap: 2 },
  fare: { ...typography.label, fontSize: 14, color: colors.ink900, fontFamily: fonts.bold },
  time: { ...typography.caption, fontSize: 11, color: colors.ink400 },
  statusLine: { ...typography.caption, color: colors.ink600 },
  actions: { flexDirection: 'row', paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  // 44pt minimum touch target, as everywhere in the app.
  actionBtn: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  changeText: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
  pressed: { transform: [{ scale: 0.97 }] },
  cancelText: { ...typography.caption, color: colors.error, fontFamily: fonts.bold },
})
