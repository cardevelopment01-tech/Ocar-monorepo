import Svg, { Path, Line, Rect, Circle } from 'react-native-svg'
import { colors } from '@ocar/mobile-shared'
import type { VehicleKind } from '../vehicleKind'

// The top-down vehicle drawn on the rider's maps, one per vehicle category so the rider can tell an auto rickshaw from a car
// (and a hatchback from an SUV) at a glance. Cars share one body and differ in size and a detail or two; the van is a long box and
// the auto rickshaw is its own three-wheeler shape. Matches web's CarMarker for the sedan. All are drawn facing up (the marker
// rotates them to the heading).

const CAR_BODY = 'M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z'
const GOLD = '#E3B341'

/** Rendered size (px) of each kind: a hatchback is smaller than a sedan, an SUV and a van are bigger. */
export const GLYPH_SIZE: Record<VehicleKind, { w: number; h: number }> = {
  hatchback: { w: 20, h: 32 },
  sedan: { w: 22, h: 36 },
  suv: { w: 24, h: 39 },
  luxury: { w: 22, h: 39 },
  van: { w: 24, h: 44 },
  auto: { w: 22, h: 30 },
}

function Car({ kind }: { kind: 'hatchback' | 'sedan' | 'suv' | 'luxury' }) {
  const lamp = kind === 'luxury' ? GOLD : '#FCD34D'
  return (
    <>
      <Path d={CAR_BODY} fill={colors.ink900} />
      <Path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />
      <Line x1={8} y1={8} x2={24} y2={8} stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
      <Rect x={7} y={20} width={18} height={12} rx={2} fill="rgba(255,255,255,0.07)" />
      <Line x1={5} y1={29} x2={27} y2={29} stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
      <Rect x={9} y={36} width={14} height={8} rx={2} fill="rgba(255,255,255,0.30)" />
      {kind === 'suv' ? (
        <>
          {/* roof rails */}
          <Line x1={7} y1={21} x2={7} y2={37} stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} />
          <Line x1={25} y1={21} x2={25} y2={37} stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} />
        </>
      ) : null}
      {kind === 'luxury' ? <Line x1={16} y1={19} x2={16} y2={36} stroke={GOLD} strokeWidth={1.2} /> : null}
      <Circle cx={9} cy={7} r={2} fill={lamp} />
      <Circle cx={23} cy={7} r={2} fill={lamp} />
      <Circle cx={9} cy={47} r={1.5} fill="#F87171" opacity={0.8} />
      <Circle cx={23} cy={47} r={1.5} fill="#F87171" opacity={0.8} />
    </>
  )
}

function Van() {
  return (
    <>
      <Rect x={4} y={3} width={24} height={56} rx={5} fill={colors.ink900} />
      <Path d="M8,7 L24,7 L25,16 L7,16 Z" fill="rgba(255,255,255,0.82)" />
      <Rect x={7} y={19} width={18} height={28} rx={2} fill="rgba(255,255,255,0.10)" />
      <Line x1={7} y1={33} x2={25} y2={33} stroke="rgba(255,255,255,0.16)" strokeWidth={0.8} />
      <Rect x={9} y={50} width={14} height={6} rx={2} fill="rgba(255,255,255,0.30)" />
      <Circle cx={9} cy={6} r={2} fill="#FCD34D" />
      <Circle cx={23} cy={6} r={2} fill="#FCD34D" />
      <Circle cx={9} cy={56} r={1.5} fill="#F87171" opacity={0.8} />
      <Circle cx={23} cy={56} r={1.5} fill="#F87171" opacity={0.8} />
    </>
  )
}

function Auto() {
  return (
    <>
      {/* one front wheel, a yellow canopy over a black body, two rear wheels */}
      <Rect x={13} y={1} width={6} height={9} rx={3} fill={colors.ink900} />
      <Rect x={2} y={29} width={5} height={11} rx={2} fill={colors.ink900} />
      <Rect x={25} y={29} width={5} height={11} rx={2} fill={colors.ink900} />
      <Path d="M5,17 C5,12 9,9 16,9 C23,9 27,12 27,17 L27,37 C27,41 24,43 16,43 C8,43 5,41 5,37 Z" fill={colors.ink900} />
      <Path d="M6,19 C6,14 9,11 16,11 C23,11 26,14 26,19 L26,36 C26,39 23,41 16,41 C9,41 6,39 6,36 Z" fill="#F5C518" />
      <Rect x={9} y={12} width={14} height={5} rx={2} fill="rgba(20,23,26,0.55)" />
      <Line x1={16} y1={19} x2={16} y2={39} stroke="rgba(20,23,26,0.18)" strokeWidth={1} />
      <Circle cx={16} cy={7} r={1.8} fill="#FCD34D" />
    </>
  )
}

export function VehicleGlyph({ kind = 'sedan', dim = false }: { kind?: VehicleKind; dim?: boolean }) {
  const { w, h } = GLYPH_SIZE[kind]
  const box = kind === 'van' ? '0 0 32 62' : kind === 'auto' ? '0 0 32 44' : '0 0 32 52'
  return (
    <Svg width={w} height={h} viewBox={box} style={{ opacity: dim ? 0.55 : 1 }}>
      {kind === 'van' ? <Van /> : kind === 'auto' ? <Auto /> : <Car kind={kind} />}
    </Svg>
  )
}
