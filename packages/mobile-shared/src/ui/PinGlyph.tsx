import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg'

export type PinVariant = 'pickup' | 'drop' | 'stop'

// Same teardrop + gradient language as the home hero pin: teal for pickup, ink for drop,
// gold for stops, replaces the old green / red / amber flat pins.
const GRADS: Record<PinVariant, [string, string, string]> = {
  pickup: ['#CFF3F5', '#14ABBD', '#0A5C66'],
  drop: ['#8A959A', '#2A3136', '#14171A'],
  stop: ['#F6E3B8', '#D6A552', '#A97A2E'],
}

const D = 'M14 1C6.82 1 1 6.82 1 14C1 21.2 7.4 28.6 14 37C20.6 28.6 27 21.2 27 14C27 6.82 21.18 1 14 1Z'

export function PinGlyph({ variant, width = 28, height = 38 }: { variant: PinVariant; width?: number; height?: number }) {
  const [a, b, c] = GRADS[variant]
  const id = `pin-${variant}`
  return (
    <Svg width={width} height={height} viewBox="0 0 28 38">
      <Defs>
        <LinearGradient id={id} x1={2} y1={1} x2={26} y2={37} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={a} />
          <Stop offset={0.42} stopColor={b} />
          <Stop offset={1} stopColor={c} />
        </LinearGradient>
      </Defs>
      <Ellipse cx={14} cy={36.5} rx={5} ry={1.5} fill="rgba(10,60,66,0.22)" />
      <Path d={D} fill={`url(#${id})`} stroke="#FFFFFF" strokeWidth={1.6} />
      <Circle cx={14} cy={13.5} r={4.5} fill="#FFFFFF" fillOpacity={0.85} />
    </Svg>
  )
}
