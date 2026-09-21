import { memo } from 'react'
import { Marker } from 'react-native-maps'
import Svg, { Path, Line, Rect, Circle } from 'react-native-svg'
import { colors } from '@ocar/mobile-shared'

export type CarMarkerProps = {
  position: [number, number]
  heading?: number
  /** False until a real bearing has been derived from two GPS fixes -- renders
   *  at reduced opacity instead of a fake 0°/north snap (matches web's CarMarker). */
  headingKnown?: boolean
  /** Overrides the headingKnown-derived opacity -- for callers (e.g. an idle
   *  home screen) that want the marker to read as more solid without
   *  dishonestly claiming a real bearing via headingKnown. */
  opacity?: number
}

// Ported from rider-mobile's features/map/components/CarMarker.tsx (itself a
// pixel-match of web's apps/user/components/map/CarMarker.tsx) -- same car
// silhouette everywhere in the product, not a driver-mobile-specific redesign.
// react-native-maps rotates the whole Marker natively (rotation + flat), so no
// manual transform is needed here.
function CarMarker({ position, heading = 0, headingKnown = true, opacity }: CarMarkerProps) {
  return (
    <Marker
      coordinate={{ latitude: position[0], longitude: position[1] }}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={heading % 360}
      flat
      tracksViewChanges={false}
      zIndex={10}
    >
      <Svg width={22} height={36} viewBox="0 0 32 52" style={{ opacity: opacity ?? (headingKnown ? 1 : 0.55) }}>
        <Path
          d="M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z"
          fill={colors.ink900}
        />
        <Path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />
        <Line x1={8} y1={8} x2={24} y2={8} stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
        <Rect x={7} y={20} width={18} height={12} rx={2} fill="rgba(255,255,255,0.07)" />
        <Line x1={5} y1={29} x2={27} y2={29} stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
        <Rect x={9} y={36} width={14} height={8} rx={2} fill="rgba(255,255,255,0.30)" />
        <Circle cx={9} cy={7} r={2} fill="#FCD34D" />
        <Circle cx={23} cy={7} r={2} fill="#FCD34D" />
        <Circle cx={9} cy={47} r={1.5} fill="#F87171" opacity={0.8} />
        <Circle cx={23} cy={47} r={1.5} fill="#F87171" opacity={0.8} />
      </Svg>
    </Marker>
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  (a.heading ?? 0) === (b.heading ?? 0) &&
  (a.headingKnown ?? true) === (b.headingKnown ?? true) &&
  a.opacity === b.opacity
)
