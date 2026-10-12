import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

const PINK = '#DC3E93' // Ocar brand pink

/** The rider's own position: a brand-pink dot with a heading beam fanning out of its top. Drawn pointing north; the
 *  map Marker rotates it by the compass heading. */
export function UserDot({ size = 76 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 76 76">
      <Defs>
        <LinearGradient id="beam" x1={38} y1={38} x2={38} y2={4} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={PINK} stopOpacity={0.5} />
          <Stop offset={1} stopColor={PINK} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d="M38 38 L19.5 6 A37 37 0 0 1 56.5 6 Z" fill="url(#beam)" />
      <Circle cx={38} cy={38} r={11} fill="#FFFFFF" />
      <Circle cx={38} cy={38} r={8} fill={PINK} />
    </Svg>
  )
}
