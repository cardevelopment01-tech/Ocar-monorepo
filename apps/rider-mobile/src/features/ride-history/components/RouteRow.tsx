import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, spacing, typography, fonts } from '@ocar/mobile-shared'

export type RouteRowProps = {
  origin: string
  destination: string
  tint?: string
}

// Origin/destination two-dot connector -- matches web's route block (a small
// filled dot, a vertical line, a filled dot) used identically across
// RideCard/UpcomingCard/ActiveRideCard on history/page.tsx.
export function RouteRow({ origin, destination, tint = colors.primary }: RouteRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.dots}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <View style={styles.line} />
        <View style={[styles.dot, { backgroundColor: colors.ink900 }]} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.line1} numberOfLines={1}>{origin}</Text>
        <Text style={styles.line2} numberOfLines={1}>{destination}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={tint} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dots: { alignItems: 'center', gap: 2, alignSelf: 'stretch', paddingTop: 2, paddingBottom: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  line: { width: 1, flex: 1, minHeight: 20, backgroundColor: colors.border },
  textCol: { flex: 1, minWidth: 0, justifyContent: 'space-between', gap: spacing.xs },
  line1: { ...typography.label, fontSize: 14, color: colors.ink900, fontFamily: fonts.semibold },
  line2: { ...typography.label, fontSize: 14, color: colors.ink600, fontFamily: fonts.semibold },
})
