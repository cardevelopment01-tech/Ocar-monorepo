import { memo, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { font, h } from '@ocar/mobile-shared'
import { Marker } from 'react-native-maps'
import { PinGlyph, type PinVariant } from './PinGlyph'

export type { PinVariant }

export type LocationPinProps = {
  position: [number, number]
  variant: PinVariant
  /** A small white tag above the pin ("Your pickup"). */
  label?: string
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

function LocationPin({ position, variant, label }: LocationPinProps) {
  const [track, setTrack] = useState(true)
  useEffect(() => {
    setTrack(true)
    const t = setTimeout(() => setTrack(false), SNAPSHOT_MS)
    return () => clearTimeout(t)
  }, [variant, label])
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={track}
      zIndex={variant === 'pickup' ? 8 : 6}
    >
      <View style={label ? styles.wrapLabelled : null}>
        {label ? <View style={styles.tag}><Text style={styles.tagText} numberOfLines={1}>{label}</Text></View> : null}
        <View style={variant === 'pickup' ? styles.wrapPickup : styles.wrap}>
          {variant === 'pickup' ? <View style={styles.halo} /> : null}
          <PinGlyph variant={variant} />
        </View>
      </View>
    </Marker>
  )
}

const styles = StyleSheet.create({
  wrap: { width: 28, height: 38, alignItems: 'center', justifyContent: 'flex-end' },
  // A marker is drawn from its own view's bounds, so the halo (40 px, centred on the pin's head) has to fit INSIDE them: at
  // 28 px wide it was cut into a pale rectangle behind the pin. The pin keeps its size and its tip stays at the bottom centre.
  wrapPickup: { width: 44, height: 45, alignItems: 'center', justifyContent: 'flex-end' },
  wrapLabelled: { alignItems: 'center', paddingHorizontal: 4 },
  tag: { height: 26, paddingHorizontal: 12, borderRadius: 13, backgroundColor: '#FFFFFF', justifyContent: 'center', marginBottom: 2, boxShadow: '0 2px 8px rgba(20,23,26,0.16)' },
  tagText: { fontFamily: font.b, fontSize: 11.5, color: h.ivory },
  halo: { position: 'absolute', top: 0, left: 2, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(14,143,163,0.18)' },
})

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant && a.label === b.label && a.position[0] === b.position[0] && a.position[1] === b.position[1]
)
