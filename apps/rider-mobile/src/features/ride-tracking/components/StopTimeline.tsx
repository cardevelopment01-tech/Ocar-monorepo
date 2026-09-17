import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

export type StopTimelineProps = { stops: RideStop[] }

// Compact vertical stop list -- mirrors the web's RouteTimeline for stop rows: a
// dot per stop (color reflects reached/pending/skipped), connected by a line.
export function StopTimeline({ stops }: StopTimelineProps) {
  return (
    <View style={styles.container}>
      {stops.map((stop, i) => {
        const dotColor = stop.status === 'reached' ? colors.success : stop.status === 'skipped' ? colors.ink400 : colors.primary
        return (
          <View key={stop.id} style={styles.row}>
            <View style={styles.dotCol}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              {i < stops.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.textCol}>
              <Text style={styles.label}>Stop {stop.sequence}</Text>
              <Text style={styles.address} numberOfLines={1}>{stop.address ?? `Stop ${i + 1}`}</Text>
            </View>
            <Text style={[styles.status, { color: dotColor }]}>
              {stop.status === 'reached' ? 'Reached' : stop.status === 'skipped' ? 'Skipped' : 'Pending'}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dotCol: { alignItems: 'center', width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border },
  textCol: { flex: 1, paddingBottom: spacing.sm },
  label: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  address: { ...typography.body, color: colors.ink900, fontWeight: '500' },
  status: { ...typography.caption, fontWeight: '700' },
})
