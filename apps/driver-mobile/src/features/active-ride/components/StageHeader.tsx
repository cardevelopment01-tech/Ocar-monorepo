import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography, Text } from '@ocar/mobile-shared'

export type StageHeaderProps = {
  icon: React.ComponentProps<typeof Feather>['name']
  /** 'stop' re-tints the tile gold: a rider-added stop is a detour, not the trip itself. */
  tone?: 'brand' | 'stop'
  /** Where the driver is in the trip: "Heading to pickup", "Stop 1 of 2". */
  label: string
  /** Where they are going: an address or a name. The one thing to read at a glance. */
  title: string
  badge?: ReactNode
}

// The one header every ride stage shares, so moving from pickup to trip to return reads as
// a single sheet changing its content, not five different screens: icon tile, small status
// label, then the destination in the heaviest type on the sheet.
export function StageHeader({ icon, tone = 'brand', label, title, badge }: StageHeaderProps) {
  const stop = tone === 'stop'
  return (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: stop ? colors.warningLight : colors.primarySubtle }]}>
        <Feather name={icon} size={20} color={stop ? colors.ink900 : colors.primary} />
      </View>
      <View style={styles.text}>
        <View style={styles.labelRow}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          {badge}
        </View>
        <Text style={styles.title} numberOfLines={3}>{title}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // flex-start, not center: with a two-line title (long address, large font) the tile stays level with the label instead of floating mid-block.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md - 4 },
  tile: { width: 48, height: 48, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', gap: 2 },
  // wraps: at large font the badge drops under the label instead of squeezing it
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 2 },
  // ink600, not ink400: ink400 on white is 3.2:1, below the 4.5:1 this product commits to.
  label: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, flexShrink: 1 },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, lineHeight: 24 },
})
