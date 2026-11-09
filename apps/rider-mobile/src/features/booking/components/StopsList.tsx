import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'
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
              <Feather name="arrow-down" size={16} color={h.faint} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => onRemove(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove stop">
            <Feather name="x" size={16} color={h.faint} />
          </Pressable>
        </View>
      ))}
      {stops.length < maxStops ? (
        <Pressable onPress={onAdd} style={styles.addRow} accessibilityRole="button" accessibilityLabel="Add a stop">
          <Feather name="plus" size={15} color={h.tealText} />
          <Text style={styles.addText}>Add a stop</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05)', padding: 16, gap: 12 },
  label: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: h.gold },
  address: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(14,143,163,0.4)' },
  addText: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
})
