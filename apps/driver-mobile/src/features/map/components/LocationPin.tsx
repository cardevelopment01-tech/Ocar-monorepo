import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Marker } from 'react-native-maps'
import { PinGlyph } from '@ocar/mobile-shared'

export type PinVariant = 'pickup' | 'drop' | 'stop'

export type LocationPinProps = {
  position: [number, number]
  variant: PinVariant
}

// Ported from rider-mobile's features/map/components/LocationPin.tsx (itself a
// pixel-match of web's apps/user/components/map/LocationPin.tsx) -- same
// teardrop pin + pickup halo everywhere in the product.
// The halo is static on purpose: a Google marker's children are rasterised to one bitmap
// (tracksViewChanges={false}), so a looping animation here never showed on Android and
// only kept a UI-thread frame callback running for the whole leg.
function Halo() {
  return <View style={styles.halo} />
}

function LocationPin({ position, variant }: LocationPinProps) {
  return (
    <Marker coordinate={{ latitude: position[0], longitude: position[1] }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
      <View style={styles.wrap}>
        {variant === 'pickup' ? <Halo /> : null}
        <PinGlyph variant={variant} />
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  wrap: { width: 28, height: 38, alignItems: 'center', justifyContent: 'flex-end' },
  halo: { position: 'absolute', top: -6, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(14,143,163,0.18)' },
})

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant && a.position[0] === b.position[0] && a.position[1] === b.position[1]
)
