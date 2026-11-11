import type { ReactNode } from 'react'
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

// ── Rental route card rows (design: Rental.dc.html) ───────────────────────────────────────────────────────────────
// The card never grows with the number of stops: one summary row ("2 stops  Patia, Triumph Intl  +1  Edit  (+)") sits
// between pickup and drop. Edit opens Plan your stops; the round + opens Add a stop and is off at the cap.

const LINE = '#CBD5D7'

/** The dot-and-line column of the route card. `line` says which part of the connector this row draws. */
export function RouteRail({ line, children }: { line: 'down' | 'full' | 'up'; children: ReactNode }) {
  return (
    <View style={rail.col}>
      <View style={[rail.line, line === 'down' ? rail.down : line === 'up' ? rail.up : rail.full]} />
      {children}
    </View>
  )
}

/** "Patia, Bhubaneswar" -> "Patia Bhubaneswar"; long names read as their first two words. */
export function shortStopName(address: string): string {
  return (address.split(',')[0] ?? address).trim().split(' ').slice(0, 2).join(' ')
}

export function StopsSummaryRow({ stops, maxStops, onEdit, onAdd }: { stops: BookingPlace[]; maxStops: number; onEdit: () => void; onAdd: () => void }) {
  const n = stops.length
  const full = n >= maxStops
  return (
    <View style={sum.row}>
      <Pressable onPress={onEdit} style={({ pressed }) => [sum.main, pressed ? sum.pressed : null]} accessibilityRole="button" accessibilityLabel={n === 0 ? 'No stops. Edit stops' : `${n} stop${n === 1 ? '' : 's'}. Edit stops`}>
        <RouteRail line="full"><View style={sum.dot} /></RouteRail>
        <View style={sum.text}>
          <Text style={sum.title}>{n === 0 ? 'No stops' : `${n} ${n === 1 ? 'stop' : 'stops'}`}</Text>
          <Text style={sum.preview} numberOfLines={1}>{stops.slice(0, 2).map((s) => shortStopName(s.address)).join(', ')}</Text>
          {n > 2 ? <Text style={sum.more}>{`+${n - 2}`}</Text> : null}
        </View>
        <Text style={sum.edit}>Edit</Text>
      </Pressable>
      <Pressable
        onPress={onAdd}
        disabled={full}
        accessibilityRole="button"
        accessibilityLabel="Add a stop"
        accessibilityState={{ disabled: full }}
        accessibilityHint={full ? `You can add up to ${maxStops} stops` : undefined}
        style={({ pressed }) => [sum.add, full ? sum.addOff : null, pressed ? sum.pressed : null]}
      >
        <Feather name="plus" size={15} color={full ? '#B6BBBE' : h.tealText} />
      </Pressable>
    </View>
  )
}

const rail = StyleSheet.create({
  col: { width: 14, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', left: 6.25, width: 1.5, backgroundColor: LINE },
  full: { top: 0, bottom: 0 },
  down: { top: '50%', bottom: 0 },
  up: { top: 0, bottom: '50%' },
})
const sum = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  main: { flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { opacity: 0.7 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: h.gold, boxShadow: '0 0 0 3px #FFFFFF' },
  text: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  title: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  preview: { flexShrink: 1, fontFamily: font.m, fontSize: 13, color: h.muted },
  more: { fontFamily: font.b, fontSize: 13, color: h.muted },
  edit: { fontFamily: font.b, fontSize: 13, color: h.tealText },
  add: { width: 32, height: 32, borderRadius: 16, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  addOff: { backgroundColor: '#F4F5F1' },
})
