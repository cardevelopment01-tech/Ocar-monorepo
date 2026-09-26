import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Card, colors, formatCurrency, spacing, typography, type RideHistoryItem, fonts } from '@ocar/mobile-shared'
import { StatusBadge } from './StatusBadge'
import { RouteRow } from './RouteRow'

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export type RideHistoryRowProps = {
  item: RideHistoryItem
  onPress: (id: string) => void
}

// Matches web's RideCard (history/page.tsx): status badge + fare/date up top,
// route connector in the middle, driver name row at the bottom -- replacing
// this row's previous flat "date / route / fare" layout with the same
// information hierarchy web uses.
function RideHistoryRowBase({ item, onPress }: RideHistoryRowProps) {
  const fare = item.fare != null ? formatCurrency(parseFloat(item.fare)) : null

  return (
    <Pressable onPress={() => onPress(item.id)} style={styles.wrapper} accessibilityRole="button">
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <StatusBadge status={item.status} />
          <View style={styles.topRight}>
            {fare ? <Text style={styles.fare}>{fare}</Text> : null}
            <Text style={styles.date}>{fmt(item.requestedAt)}</Text>
          </View>
        </View>

        <RouteRow origin={item.originAddress ?? '-'} destination={item.destinationAddress ?? '-'} />

        {item.driverName ? (
          <View style={styles.driverRow}>
            <Feather name="map-pin" size={12} color={colors.ink400} />
            <Text style={styles.driverText}>
              Driver: <Text style={styles.driverName}>{item.driverName}</Text>
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  )
}

export const RideHistoryRow = memo(RideHistoryRowBase)

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  card: { gap: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  topRight: { alignItems: 'flex-end', gap: 2 },
  fare: { ...typography.label, fontSize: 14, color: colors.ink900, fontFamily: fonts.bold },
  date: { ...typography.caption, fontSize: 11, color: colors.ink400 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  driverText: { ...typography.caption, color: colors.ink400 },
  driverName: { color: colors.ink600, fontFamily: fonts.semibold },
})
