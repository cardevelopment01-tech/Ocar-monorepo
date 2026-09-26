import { ScrollView, StyleSheet, View } from 'react-native'
import { colors, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

export type StopTimelineProps = { stops: RideStop[] }

const ROW_HEIGHT = 56
const MAX_VISIBLE_ROWS = 3

// Full port of rider-mobile's StopTimeline.tsx (kept as a 1:1 port per
// explicit decision during /plan-eng-review, not a shared extraction --
// driver-mobile's copy adds the scroll cap below since this list here is
// persistent chrome sitting above the primary action, not the focus of the
// screen the way it is in rider-mobile's sheet).
//
// Empty state: renders nothing for zero stops (caller doesn't even need to
// guard this) -- collapses away entirely rather than showing an empty
// container, matching this plan's minimal-chrome direction.
// Overflow: caps at ~3 visible rows, scrolling within a fixed-height
// container beyond that, so a long stop list never pushes the map, SOS
// button, or the OTP/return CTA below it off-screen on smaller devices
// (locked during /plan-design-review, hardening design doc).
export function StopTimeline({ stops }: StopTimelineProps) {
  if (stops.length === 0) return null

  const capped = stops.length > MAX_VISIBLE_ROWS
  const list = (
    <View>
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

  if (!capped) return <View style={styles.container}>{list}</View>

  return (
    <ScrollView
      style={[styles.container, { maxHeight: ROW_HEIGHT * MAX_VISIBLE_ROWS }]}
      nestedScrollEnabled
      showsVerticalScrollIndicator
    >
      {list}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', minHeight: ROW_HEIGHT },
  dotCol: { alignItems: 'center', width: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border },
  textCol: { flex: 1, paddingBottom: spacing.sm },
  label: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  address: { ...typography.body, color: colors.ink900, fontFamily: fonts.medium },
  status: { ...typography.caption, fontFamily: fonts.bold },
})
