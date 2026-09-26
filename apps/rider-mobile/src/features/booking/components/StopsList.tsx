import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import type { BookingPlace } from '../store'

export type StopsListProps = {
  stops: BookingPlace[]
  maxStops: number
  onAdd: () => void
  onRemove: (index: number) => void
  onSwap: (index: number) => void
}

// Native equivalent of web's RouteTimeline "stop" nodes (apps/user/components/route/RouteTimeline.tsx)
// -- a flat list of added stops with remove/reorder, plus an "Add a stop" row
// while under the cap. Matches web's MAX_STOPS = 3.
export function StopsList({ stops, maxStops, onAdd, onRemove, onSwap }: StopsListProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{stops.length === 0 ? 'Plan your stops · optional' : `${stops.length} of ${maxStops} stops`}</Text>
      {stops.map((s, i) => (
        <View key={`${s.lat}-${s.lng}`} style={styles.row}>
          <View style={styles.dot} />
          <Text style={styles.address} numberOfLines={1}>{s.address}</Text>
          {i < stops.length - 1 ? (
            <Pressable onPress={() => onSwap(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Move stop down">
              <Feather name="arrow-down" size={14} color={colors.ink400} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => onRemove(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove stop">
            <Feather name="x" size={14} color={colors.ink400} />
          </Pressable>
        </View>
      ))}
      {stops.length < maxStops ? (
        <Pressable onPress={onAdd} style={styles.addRow} accessibilityRole="button" accessibilityLabel="Add a stop">
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={styles.addText}>Add a stop</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderLight, padding: spacing.md, gap: spacing.sm },
  label: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  address: { ...typography.body, color: colors.ink900, fontFamily: fonts.medium, flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  addText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
})
