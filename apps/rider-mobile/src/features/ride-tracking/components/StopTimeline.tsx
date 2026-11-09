import { Pressable, StyleSheet, Text, View } from 'react-native'
import { font, h } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

// `onSkip` set = rider may drop a pending stop (live trip only; the trip summary omits it).
export type StopTimelineProps = { stops: RideStop[]; onSkip?: (stop: RideStop) => void }

// Compact vertical stop list -- mirrors the web's RouteTimeline for stop rows: a
// dot per stop (color reflects reached/pending/skipped), connected by a line.
export function StopTimeline({ stops, onSkip }: StopTimelineProps) {
  return (
    <View style={styles.container}>
      {stops.map((stop, i) => {
        const dotColor = stop.status === 'reached' ? h.live : stop.status === 'skipped' ? h.faint : h.teal
        return (
          <View key={stop.id} style={styles.row}>
            <View style={styles.dotCol}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              {i < stops.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.textCol}>
              <Text style={styles.label}>Stop {stop.sequence}</Text>
              <Text style={styles.address} numberOfLines={2}>{stop.address ?? `Stop ${i + 1}`}</Text>
            </View>
            {stop.status === 'pending' && onSkip ? (
              <Pressable
                onPress={() => onSkip(stop)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Skip stop ${stop.sequence}`}
              >
                <Text style={[styles.status, { color: h.danger }]}>Skip</Text>
              </Pressable>
            ) : (
              <Text style={[styles.status, { color: dotColor }]}>
                {stop.status === 'reached' ? 'Reached' : stop.status === 'skipped' ? 'Skipped' : 'Pending'}
              </Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 0 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dotCol: { alignItems: 'center', width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 0, flex: 1, minHeight: 20, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  textCol: { flex: 1, paddingBottom: 12 },
  label: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  address: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  status: { fontFamily: font.b, fontSize: 12.5 },
})
