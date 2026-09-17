import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, colors, formatCurrency, spacing, typography, type RideHistoryItem } from '@ocar/mobile-shared'

const STATUS_LABELS: Record<string, string> = {
  requested: 'Requested',
  accepted: 'Driver assigned',
  driver_arrived: 'Driver arrived',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_drivers: 'No drivers available',
}

const STATUS_COLORS: Record<string, string> = {
  completed: colors.success,
  cancelled: colors.error,
  no_drivers: colors.error,
  in_progress: colors.info,
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? colors.warning
}

function fareOf(item: RideHistoryItem): number | null {
  const raw = item.totalFinal ?? item.totalEstimated
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export type RideHistoryRowProps = {
  item: RideHistoryItem
  onPress: (id: string) => void
}

function RideHistoryRowBase({ item, onPress }: RideHistoryRowProps) {
  const fare = fareOf(item)
  const dateStr = formatDate(item.createdAt)
  const origin = item.originAddress ?? 'Pickup'
  const destination = item.destinationAddress ?? 'Destination'
  const fareStr = fare !== null ? formatCurrency(fare) : 'Fare pending'
  const label = statusLabel(item.status)

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${dateStr}, ${origin} to ${destination}, ${fareStr}, ${label}`}
      style={styles.wrapper}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.routeCol}>
            <Text style={styles.date}>{dateStr}</Text>
            <Text style={styles.route} numberOfLines={1}>{origin} → {destination}</Text>
          </View>
          <View style={styles.fareCol}>
            <Text style={styles.fare}>{fareStr}</Text>
            <Text style={[styles.status, { color: statusColor(item.status) }]}>{label}</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  )
}

export const RideHistoryRow = memo(RideHistoryRowBase)

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  routeCol: { flex: 1, gap: 2 },
  fareCol: { alignItems: 'flex-end', gap: 2 },
  date: { ...typography.caption, color: colors.ink400 },
  route: { ...typography.body, color: colors.ink900 },
  fare: { ...typography.title, color: colors.ink900 },
  status: { ...typography.caption, fontWeight: '600' },
})
