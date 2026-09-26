import { StyleSheet, View } from 'react-native'
import { Card, colors, formatCurrency, spacing, typography, Text } from '@ocar/mobile-shared'
import type { Trip } from './types'

export function TripRow({ item }: { item: Trip }) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.address} numberOfLines={1}>
          {item.originAddress ?? 'Trip'}
        </Text>
        <Text style={styles.earning}>{formatCurrency(parseFloat(item.driverEarning))}</Text>
      </View>
      <Text style={styles.detail} numberOfLines={1}>
        {item.destinationAddress ?? ''}
      </Text>
      <Text style={styles.date}>{new Date(item.requestedAt).toLocaleDateString()}</Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  address: { ...typography.body, color: colors.ink900, flex: 1 },
  earning: { ...typography.title, color: colors.money },
  detail: { ...typography.label, color: colors.ink600 },
  date: { ...typography.caption, color: colors.ink400 },
})
