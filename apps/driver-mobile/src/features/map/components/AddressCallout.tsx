import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Marker } from 'react-native-maps'
import { Feather } from '@expo/vector-icons'
import { colors, radii, shadows, spacing, typography, fonts, Text } from '@ocar/mobile-shared'

export type AddressCalloutProps = {
  position: [number, number]
  address: string
}

// A real map-anchored Marker, not a screen-fixed overlay -- anchor {x:0.5,
// y:1} puts the tail's tip (not the pill's center) exactly on `position`, so
// react-native-maps reprojects the whole thing correctly on every pan/zoom
// instead of it drifting away from the car marker the moment the map moves.
function AddressCallout({ position, address }: AddressCalloutProps) {
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      zIndex={9}
    >
      {/* collapsable={false} is load-bearing, not a hint: with no background of
          its own this View is a collapse candidate, and Android drops it (and
          therefore its paddingBottom) from the native hierarchy before
          react-native-maps snapshots the marker -- which silently deletes the
          car clearance below. */}
      <View style={styles.wrap} collapsable={false}>
        <View style={styles.pill}>
          <Feather name="map-pin" size={11} color={colors.primary} />
          <Text style={styles.pillText} numberOfLines={1}>{address}</Text>
        </View>
        <View style={styles.tail} />
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  // CarMarker is anchored at its own centre (0.5,0.5), so its 36px-tall SVG
  // extends 18px above this same coordinate. This bottom padding -- NOT an
  // empty spacer View, which Android collapses out of the native hierarchy
  // before react-native-maps snapshots the marker -- is what pushes the
  // visible pill+tail clear of the car's roof.
  wrap: { alignItems: 'center', paddingBottom: 18 + 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 150,
    backgroundColor: 'rgb(253,254,254)',
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: 'rgba(14,143,163,0.22)',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 3,
    ...shadows.card,
  },
  pillText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.semibold, flexShrink: 1 },
  // A rotated square clipped to its bottom-right corner reads as a downward
  // triangle -- the standard RN "CSS triangle" trick, no image asset needed.
  tail: {
    width: 10,
    height: 10,
    marginTop: -5,
    backgroundColor: 'rgb(253,254,254)',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(14,143,163,0.22)',
    transform: [{ rotate: '45deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 1, height: 1 },
  },
})

export default memo(AddressCallout, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  a.address === b.address
)
