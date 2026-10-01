import { StyleSheet, View } from 'react-native'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'

export type RideTypeBadgeProps = { kind: 'rental' | 'return' | 'round_trip'; hours?: number | null }

// Ride-type pill shown next to the stage label for rental / the return leg of a round trip.
// Sentence case at the 12px caption size: the old 9px tracked-uppercase version was below
// the 14px mobile text floor and read as noise next to the stage label. colors.accent for
// rental, colors.warning for the return leg -- both on their own tinted backgrounds, with
// ink text so the label never relies on a low-contrast gold-on-cream pairing.
export function RideTypeBadge({ kind, hours }: RideTypeBadgeProps) {
  const isRental = kind === 'rental'
  const isRoundTrip = kind === 'round_trip'
  const label = isRental ? 'Rental' : isRoundTrip ? (hours ? `Round trip · ${hours}h` : 'Round trip') : 'Return leg'
  return (
    <View style={[styles.pill, { backgroundColor: isRental ? colors.accentLight : isRoundTrip ? colors.primarySubtle : colors.warningLight }]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.full },
  text: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
})
