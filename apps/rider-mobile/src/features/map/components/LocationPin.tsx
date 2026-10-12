import { memo, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Marker } from 'react-native-maps'
import { PinGlyph, type PinVariant } from './PinGlyph'

export type { PinVariant }

export type LocationPinProps = {
  position: [number, number]
  variant: PinVariant
}

// Matches web's LocationPin.tsx (apps/user/components/map/LocationPin.tsx): a
// teardrop map pin (not the default OS pin) with a white ring dot, plus a soft
// halo on pickup only (draws the eye to "you are here").
// The halo is static. It used to loop a reanimated animation inside the marker, which forced
// tracksViewChanges=true for the pin's whole life: react-native-maps then re-rasterised the
// marker to a bitmap about 25 times a second (the single biggest steady CPU/battery cost on the
// ride screen). Instead the marker is tracked just long enough to paint once, then frozen --
// the same "track briefly, then freeze" pattern MapHero's user dot uses.
const SNAPSHOT_MS = 700

function LocationPin({ position, variant }: LocationPinProps) {
  const [track, setTrack] = useState(true)
  useEffect(() => {
    setTrack(true)
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [variant])
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={track}
    >
      <View style={styles.wrap}>
        {variant === 'pickup' ? <View style={styles.halo} /> : null}
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
