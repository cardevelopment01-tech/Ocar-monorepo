import { StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, Text } from '@ocar/mobile-shared'

export type ArrivedBannerProps = { riderName?: string | null }

// Matches web driver app's "arrived" top-card treatment (NavigateToPickup.tsx
// lines 355-370): a filled primary-color icon box with a check mark + bold
// "Pick up {name}" line. Web swaps this in for the maneuver banner once
// nearPickup goes true; driver-mobile doesn't track proximity, so this shows
// for the whole driver_arrived status instead -- same visual language, gives
// this state its own identity instead of reusing head-to-pickup's plain title.
export function ArrivedBanner({ riderName }: ArrivedBannerProps) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <Feather name="check" size={22} color={colors.inkInverse} strokeWidth={2.5} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        Pick up {riderName ?? 'the rider'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBox: { width: 44, height: 44, borderRadius: radii.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.title, color: colors.ink900, flexShrink: 1 },
})
