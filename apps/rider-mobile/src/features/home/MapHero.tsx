import { useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import MapView from 'react-native-maps'
import Svg, { Circle, Path } from 'react-native-svg'
import { geo, shadow } from '@/theme/homeTokens'
import { OCAR_MAP_PROPS, OCAR_MAP_STYLE_QUIET } from '@/theme/mapStyle'
import { LocateIcon } from './icons'
import { LocationCallout, POINT } from './LocationCallout'
import { Press } from './Press'

const DEFAULT_CENTER = { lat: 20.2961, lng: 85.8245 } // Bhubaneswar
const LAT_SPAN = 0.0075
const PIN_BELOW_CENTER = geo.expanded / 2 - POINT

function mapRegion(c: { lat: number; lng: number }, width: number) {
  const perPx = LAT_SPAN / geo.expanded
  return { latitude: c.lat + PIN_BELOW_CENTER * perPx, longitude: c.lng, latitudeDelta: LAT_SPAN, longitudeDelta: perPx * width }
}

const road = (d: string, o: number, w: number) => <Path d={d} stroke={`rgba(20,23,26,${o})`} strokeWidth={w} />

export function MapHero({
  height,
  fade,
  address,
  coords,
  onLocate,
}: {
  height: SharedValue<number>
  /** 1 = map visible, 0 = collapsed (surface/pin/pill/locate fade out together). */
  fade: SharedValue<number>
  address: string
  /** Rider's GPS fix; null until located (map then sits on the Bhubaneswar default). */
  coords: { lat: number; lng: number } | null
  onLocate: () => void
}) {
  const box = useAnimatedStyle(() => ({ height: height.get() }))
  const { width } = useWindowDimensions()
  const mapRef = useRef<MapView>(null)
  // Styled map is rendered live only long enough to paint, then captured to a bitmap and unmounted:
  // a live GL map behind a collapsing, scrolling sheet costs frames on every device.
  const [snap, setSnap] = useState<string | null>(null)
  const ready = snap !== null
  // The map is laid out once at the expanded height and pinned to the hero's bottom edge, so the
  // collapsing box only *reveals* it, resizing a native map view every frame would jank the sheet.
  // The rider's point sits POINT px above the bottom, i.e. PIN_BELOW_CENTER px under the map's centre, so
  // the map centre is nudged north by that many px to put the location exactly under the pin tip.
  const region = mapRegion(coords ?? DEFAULT_CENTER, width)
  // ~110m grid: re-capture only when the rider has really moved
  const spot = `${(coords ?? DEFAULT_CENTER).lat.toFixed(3)},${(coords ?? DEFAULT_CENTER).lng.toFixed(3)}`
  useEffect(() => setSnap(null), [spot])
  const capture = () => {
    // onMapLoaded = tiles painted; the short delay lets labels finish fading in
    setTimeout(() => {
      mapRef.current?.takeSnapshot({ format: 'jpg', quality: 0.92, result: 'file' }).then(setSnap, () => {})
    }, 1500)
  }
  const surface = useAnimatedStyle(() => ({ opacity: fade.get() }))
  return (
    <Animated.View style={[styles.hero, box]}>
      <Animated.View style={[StyleSheet.absoluteFill, surface]}>
        {/* fallback illustration (the original reference art) shows until the real map has painted */}
        <LinearGradient
          colors={['#EAF6F6', '#E1F1F1', '#D8ECEC']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.392, y: -0.464 }}
          end={{ x: 0.608, y: 1.464 }}
          style={StyleSheet.absoluteFill}
        />
        {!ready ? (
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="none">
            {road('M-10 46 L410 74', 0.11, 6)}
            {road('M-10 122 L410 104', 0.08, 4)}
            {road('M46 -10 L24 270', 0.1, 5)}
            {road('M188 -10 L214 270', 0.11, 7)}
            {road('M328 -10 L304 270', 0.07, 4)}
            {road('M-10 196 L410 214', 0.08, 4)}
            {road('M-10 234 L410 168', 0.06, 3)}
            <Circle cx={112} cy={86} r={32} fill="rgba(14,143,163,0.09)" />
            <Circle cx={308} cy={184} r={24} fill="rgba(14,143,163,0.08)" />
          </Svg>
        ) : null}
        {snap ? (
          <>
            <Image source={{ uri: snap }} style={styles.map} resizeMode="cover" fadeDuration={250} />
            {/* canvas wash: unifies the map with the app palette and pushes stray street labels back */}
            <View style={[styles.map, { backgroundColor: 'rgba(246,251,251,0.32)' }]} pointerEvents="none" />
          </>
        ) : (
          <View style={[styles.map, { opacity: 0 }]} pointerEvents="none">
            <MapView
              key={spot}
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              initialRegion={region}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              onMapLoaded={capture}
              {...OCAR_MAP_PROPS}
              customMapStyle={OCAR_MAP_STYLE_QUIET}
            />
          </View>
        )}

        <View style={styles.locate}>
          <Press onPress={onLocate} scaleTo={0.9} duration={150} label="Locate me" style={styles.locateBtn}>
            <LocateIcon />
          </Press>
        </View>

        <LocationCallout height={height} address={address} />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden' },
  map: { position: 'absolute', left: 0, right: 0, bottom: 0, height: geo.expanded },
  // beside the location point, just under the callout pill (the pill now spans the full width up top)
  locate: { position: 'absolute', bottom: 26, right: 16 },
  locateBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
})
