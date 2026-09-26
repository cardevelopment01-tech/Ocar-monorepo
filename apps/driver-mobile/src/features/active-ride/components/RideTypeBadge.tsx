import { StyleSheet, View } from 'react-native'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'

export type RideTypeBadgeProps = { kind: 'rental' | 'return' }

// Same small uppercase pill web driver's TripInProgress.tsx shows next to the
// "Trip in Progress" label for rideType === 'rental' / 'round_trip' -- ported
// onto real tokens instead of web's hardcoded rgba() (colors.accent for
// rental, colors.warning for the return leg -- no purple token exists here,
// and warning already reads as "this leg is different" without inventing a
// new hex).
export function RideTypeBadge({ kind }: RideTypeBadgeProps) {
  const isRental = kind === 'rental'
  return (
    <View style={[styles.pill, { backgroundColor: isRental ? colors.accentLight : colors.warningLight }]}>
      <Text style={[styles.text, { color: isRental ? colors.accent : colors.warning }]}>
        {isRental ? 'RENTAL' : 'RETURN'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.xs + 2, paddingVertical: 2, borderRadius: radii.full },
  text: { ...typography.caption, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.4 },
})
