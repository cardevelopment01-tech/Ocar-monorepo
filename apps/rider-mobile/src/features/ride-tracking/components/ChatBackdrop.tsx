import { StyleSheet } from 'react-native'
import Svg, { Circle, Defs, G, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'
import { h } from '@ocar/mobile-shared'

// The chat's wallpaper: quiet travel line-art (pins, cars, a dotted route, a compass ring, a shield) tiled in an offset grid
// at ~6% brand teal, under two very soft light washes. Static and non-interactive, so it costs nothing while the list scrolls.

const TILE = 168
const INK = '#0E8FA3'

export function ChatBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <RadialGradient id="washTeal" cx="88%" cy="6%" r="70%">
          <Stop offset="0" stopColor="#0E8FA3" stopOpacity="0.10" />
          <Stop offset="1" stopColor="#0E8FA3" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="washGold" cx="6%" cy="96%" r="65%">
          <Stop offset="0" stopColor="#D6A552" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#D6A552" stopOpacity="0" />
        </RadialGradient>
        <Pattern id="doodles" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
          <G stroke={INK} strokeOpacity="0.07" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
            {/* map pin */}
            <G transform="translate(18 16)">
              <Path d="M12 30s10-8.6 10-17a10 10 0 0 0-20 0c0 8.4 10 17 10 17z" />
              <Circle cx="12" cy="13" r="3.6" />
            </G>
            {/* car */}
            <G transform="translate(96 22) rotate(-8 20 12)">
              <Path d="M3 18l3-8a4 4 0 0 1 3.7-2.6h14.6A4 4 0 0 1 28 10l3 8v7H3z" />
              <Circle cx="10" cy="25" r="3" />
              <Circle cx="24" cy="25" r="3" />
            </G>
            {/* dotted route with end marks */}
            <G transform="translate(14 92)">
              <Circle cx="4" cy="30" r="3.2" />
              <Path d="M8 28c14-26 30 10 44-8s22-4 30-14" strokeDasharray="1 6" />
              <Rect x="82" y="1" width="8" height="8" rx="2.4" />
            </G>
            {/* compass ring */}
            <G transform="translate(112 96)">
              <Circle cx="18" cy="18" r="15" />
              <Path d="M18 8l4 10-4 10-4-10z" />
            </G>
            {/* shield */}
            <G transform="translate(70 66)">
              <Path d="M10 2l9 3.4v7c0 5.7-3.8 9.8-9 11.4C4.8 22.200 1 18.100 1 12.400v-7z" />
              <Path d="M6 12l3 3 5-5.600" />
            </G>
          </G>
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={h.canvas} />
      <Rect width="100%" height="100%" fill="url(#doodles)" />
      <Rect width="100%" height="100%" fill="url(#washTeal)" />
      <Rect width="100%" height="100%" fill="url(#washGold)" />
    </Svg>
  )
}
