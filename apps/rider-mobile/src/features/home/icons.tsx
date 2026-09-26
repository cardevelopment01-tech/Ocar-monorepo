// SVG markup ported verbatim from ocar-homepage-reference.html (same viewBoxes,
// paths and stroke widths); only the wrapper changed to react-native-svg.
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { h } from '@/theme/homeTokens'

type P = { size?: number; color?: string }
const I = h.ivory
const stroke = (color: string, w = 1.4) => ({ stroke: color, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const SearchIcon = ({ size = 19, color = I }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Circle cx={7} cy={7} r={5.2} stroke={color} strokeWidth={1.4} />
    <Path d="M11 11L14.2 14.2" {...stroke(color)} />
  </Svg>
)

export const CalendarIcon = ({ size = 18, color = I }: P) => (
  <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <Rect x={1.5} y={2.5} width={11} height={10} rx={2} stroke={color} strokeWidth={1.3} />
    <Path d="M1.5 5.5H12.5" stroke={color} strokeWidth={1.3} />
    <Path d="M4 1.3V3.3" {...stroke(color, 1.3)} />
    <Path d="M10 1.3V3.3" {...stroke(color, 1.3)} />
  </Svg>
)

export const LocateIcon = ({ size = 17 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
    <Circle cx={9} cy={9} r={2.4} stroke={I} strokeWidth={1.3} />
    <Path d="M9 1.5V4" {...stroke(I, 1.3)} />
    <Path d="M9 14V16.5" {...stroke(I, 1.3)} />
    <Path d="M16.5 9H14" {...stroke(I, 1.3)} />
    <Path d="M4 9H1.5" {...stroke(I, 1.3)} />
  </Svg>
)

export const ClockIcon = ({ size = 18 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx={10} cy={10} r={7.25} stroke={I} strokeWidth={1.4} />
    <Path d="M10 6.2V10.2L12.7 12.5" {...stroke(I)} />
  </Svg>
)

export const ChevronIcon = ({ size = 14, color = I, w = 1.4 }: P & { w?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path d="M6 3.5L10.5 8L6 12.5" {...stroke(color, w)} />
  </Svg>
)

export const BackIcon = ({ size = 16 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path d="M10 3.5L5.5 8L10 12.5" {...stroke(I)} />
  </Svg>
)

export const CloseIcon = ({ size = 10 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path d="M3 3L13 13M13 3L3 13" {...stroke(I)} />
  </Svg>
)

export const ArrowUpRight = ({ size = 12 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path d="M4.5 11.5L11.5 4.5M11.5 4.5H5.5M11.5 4.5V10.5" {...stroke('#FFFFFF', 1.6)} />
  </Svg>
)

export const OneWayIcon = ({ size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Circle cx={4} cy={10} r={1.6} fill={I} />
    <Path d="M6.2 10H15.2" {...stroke(I)} />
    <Path d="M11.8 6.3L15.5 10L11.8 13.7" {...stroke(I)} />
  </Svg>
)

export const RoundTripIcon = ({ size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M4.5 8.2C4.7 5.8 6.9 4 9.5 4C12.2 4 14.5 5.9 15 8.3" {...stroke(I)} />
    <Path d="M12.6 5.6L15 8.3L16.9 6" {...stroke(I)} />
    <Path d="M15.5 11.8C15.3 14.2 13.1 16 10.5 16C7.8 16 5.5 14.1 5 11.7" {...stroke(I)} />
    <Path d="M7.4 14.4L5 11.7L3.1 14" {...stroke(I)} />
  </Svg>
)

export const RentalsIcon = ({ size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M4.3 12.8L5.3 9.3C5.5 8.6 6.1 8.1 6.8 8.1H13.2C13.9 8.1 14.5 8.6 14.7 9.3L15.7 12.8" {...stroke(I)} />
    <Rect x={3.3} y={12.8} width={13.4} height={2.8} rx={1.2} stroke={I} strokeWidth={1.4} />
    <Circle cx={6.5} cy={15.6} r={1} fill={I} />
    <Circle cx={13.5} cy={15.6} r={1} fill={I} />
  </Svg>
)

export const PlaneIcon = ({ size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z"
      fill="#E9C27E"
    />
  </Svg>
)

export const ShieldCheckIcon = ({ size = 19, color = '#4FD3E0', w = 1.6 }: P & { w?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 30 30" fill="none">
    <Path d="M15 3L25 7V14C25 20.5 20.8 25.7 15 27.5C9.2 25.7 5 20.5 5 14V7L15 3Z" stroke={color} strokeWidth={w} strokeLinejoin="round" />
    <Path d="M10.5 14.5L13.5 17.5L19.5 11" {...stroke(color, w + 0.2)} />
  </Svg>
)

export const TempleIcon = ({ size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 34 34" fill="none">
    <Path d="M17 3L19.5 9H14.5L17 3Z" fill="#E9C27E" />
    <Rect x={12.5} y={9} width={9} height={4.5} fill="#E9C27E" opacity={0.85} />
    <Path d="M10 13.5H24V29H10V13.5Z" stroke="#FFFFFF" strokeWidth={1.2} strokeOpacity={0.6} />
    <Path d="M10 18H24M14.5 29V23H19.5V29" stroke="#FFFFFF" strokeWidth={1.2} strokeOpacity={0.6} />
    <Circle cx={17} cy={8} r={1.2} fill="#E9C27E" />
  </Svg>
)

export const StarIcon = ({ size = 17, color = I }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <Path d="M10 2L12.2 7.2L18 7.8L13.6 11.6L14.9 17.3L10 14.2L5.1 17.3L6.4 11.6L2 7.8L7.8 7.2L10 2Z" fill={color} />
  </Svg>
)

// ---------- map pin (gradient is userSpaceOnUse, same coordinates as the file) ----------
export function MapPinIcon() {
  const d = 'M6 0.5C2.96 0.5 0.5 2.93 0.5 5.93C0.5 10.06 6 16.5 6 16.5C6 16.5 11.5 10.06 11.5 5.93C11.5 2.93 9.04 0.5 6 0.5Z'
  return (
    <Svg width={24} height={34} viewBox="0 0 12 17" fill="none">
      <Defs>
        <LinearGradient id="mapPinGrad" x1={1} y1={0} x2={11} y2={17} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor="#CFF3F5" />
          <Stop offset={0.42} stopColor="#14ABBD" />
          <Stop offset={1} stopColor="#0A5C66" />
        </LinearGradient>
      </Defs>
      {/* stand-in for filter:drop-shadow(0 3px 4px rgba(10,60,66,.25)), RN has no CSS filter */}
      <Path d={d} fill="rgba(10,60,66,0.16)" transform="translate(0 1.5)" />
      <Path d={d} fill="url(#mapPinGrad)" />
      <Circle cx={6} cy={5.9} r={2.15} fill="#FFFFFF" fillOpacity={0.7} />
    </Svg>
  )
}

export { NavIcon, type NavName } from '@ocar/mobile-shared'
