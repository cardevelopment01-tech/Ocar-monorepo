import { ScrollView, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

export type StopTimelineProps = { stops: RideStop[] }

const ROW_HEIGHT = 52
const MAX_VISIBLE_ROWS = 3
const NODE = 22

// The full stop plan, in the order the driver will visit. Each stop's state is carried by its
// node (check / dash / filled / hollow) AND a word, never by color alone. The first pending
// stop reads "Next" so the list answers "where am I going" without comparing statuses.
//
// Empty state: renders nothing for zero stops (caller doesn't even need to guard this).
// Overflow: caps at ~3 visible rows, scrolling within a fixed-height container beyond that,
// so a long stop list never pushes the map, SOS button, or the OTP/return CTA off-screen on
// smaller devices (locked during /plan-design-review, hardening design doc).
export function StopTimeline({ stops }: StopTimelineProps) {
  if (stops.length === 0) return null

  const nextSequence = stops.find((s) => s.status === 'pending')?.sequence
  const capped = stops.length > MAX_VISIBLE_ROWS
  const list = (
    <View>
      {stops.map((stop, i) => {
        const isNext = stop.sequence === nextSequence
        const word = stop.status === 'reached' ? 'Reached' : stop.status === 'skipped' ? 'Skipped' : isNext ? 'Next' : 'Pending'
        return (
          <View key={stop.id} style={styles.row}>
            <View style={styles.nodeCol}>
              <View style={[styles.node, stop.status === 'reached' && styles.nodeReached, stop.status === 'skipped' && styles.nodeSkipped, stop.status === 'pending' && (isNext ? styles.nodeNext : styles.nodePending)]}>
                {stop.status === 'reached' ? <Feather name="check" size={13} color={colors.inkInverse} /> : null}
                {stop.status === 'skipped' ? <Feather name="minus" size={13} color={colors.ink600} /> : null}
                {isNext ? <View style={styles.nextDot} /> : null}
              </View>
              {i < stops.length - 1 ? <View style={[styles.line, stop.status === 'reached' && styles.lineDone]} /> : null}
            </View>
            <View style={styles.textCol}>
              <Text style={styles.label}>Stop {stop.sequence}</Text>
              <Text style={[styles.address, stop.status === 'skipped' && styles.addressMuted]} numberOfLines={1}>{stop.address ?? `Stop ${i + 1}`}</Text>
            </View>
            <Text style={[styles.status, isNext && styles.statusNext]}>{word}</Text>
          </View>
        )
      })}
    </View>
  )

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Stops</Text>
      {capped ? (
        <ScrollView style={{ maxHeight: ROW_HEIGHT * MAX_VISIBLE_ROWS }} nestedScrollEnabled showsVerticalScrollIndicator>
          {list}
        </ScrollView>
      ) : (
        list
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  row: { flexDirection: 'row', gap: spacing.md - 4, alignItems: 'flex-start', minHeight: ROW_HEIGHT },
  nodeCol: { alignItems: 'center', width: NODE },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: 'center', justifyContent: 'center' },
  nodeReached: { backgroundColor: colors.success },
  nodeSkipped: { backgroundColor: colors.surface3 },
  nodeNext: { backgroundColor: colors.primary },
  nodePending: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  nextDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkInverse },
  line: { width: 2, flex: 1, minHeight: 14, marginVertical: 3, borderRadius: 1, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.success },
  textCol: { flex: 1, minWidth: 0, paddingBottom: spacing.sm + 2 },
  // ink600 throughout: ink400 (3.2:1 on white) fails the 4.5:1 floor for text this size.
  label: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  address: { ...typography.body, fontSize: 15, lineHeight: 22, color: colors.ink900, fontFamily: fonts.semibold },
  addressMuted: { color: colors.ink600 },
  status: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, marginTop: 2 },
  statusNext: { color: colors.primaryDark },
})
