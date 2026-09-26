import Svg, { Circle, G, Path } from 'react-native-svg'
import { h } from '../theme/brand'

const I = h.ivory

// ---------- bottom-nav icons: outline (inactive) / filled (active) ----------
export type NavName = 'home' | 'fleet' | 'trips' | 'account' | 'earnings' | 'map'

export function NavIcon({ name, active }: { name: NavName; active: boolean }) {
  const o = { stroke: I, strokeWidth: 1.4 }
  const T = h.teal
  const C = h.canvas
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
      {name === 'home' && !active && (
        <G>
          <Path d="M3.5 9.3L10 3.3L16.5 9.3V16.2C16.5 16.75 16.05 17.2 15.5 17.2H4.5C3.95 17.2 3.5 16.75 3.5 16.2V9.3Z" {...o} strokeLinejoin="round" />
          <Path d="M8.1 17.2V13.1C8.1 12.55 8.55 12.1 9.1 12.1H10.9C11.45 12.1 11.9 12.55 11.9 13.1V17.2" {...o} strokeLinejoin="round" />
        </G>
      )}
      {name === 'home' && active && (
        <G>
          <Path d="M10 3.1L17.3 9.9V16.2C17.3 16.75 16.85 17.2 16.3 17.2H3.7C3.15 17.2 2.7 16.75 2.7 16.2V9.9L10 3.1Z" fill={T} />
          <Path d="M8.3 17.2V13.3C8.3 12.75 8.75 12.3 9.3 12.3H10.7C11.25 12.3 11.7 12.75 11.7 13.3V17.2Z" fill="#FFFFFF" />
        </G>
      )}
      {name === 'fleet' && !active && (
        <G>
          <Circle cx={10} cy={10} r={6.5} {...o} />
          <Circle cx={10} cy={10} r={1.8} {...o} />
          <Path d="M10 3.5V8.2M4.7 13.2L8.6 11.2M15.3 13.2L11.4 11.2" {...o} strokeLinecap="round" />
        </G>
      )}
      {name === 'fleet' && active && (
        <G>
          <Circle cx={10} cy={10} r={6.8} fill={T} />
          <Circle cx={10} cy={10} r={4.3} fill={C} />
          <Circle cx={10} cy={10} r={1.9} fill={T} />
        </G>
      )}
      {name === 'trips' && !active && (
        <G>
          <Path d="M5.5 3.5H14.5V16.5L12.5 15L10.5 16.5L8.5 15L6.5 16.5L5.5 15V3.5Z" {...o} strokeLinejoin="round" />
          <Path d="M7.5 7H12.5M7.5 10H12.5" {...o} strokeLinecap="round" />
        </G>
      )}
      {name === 'trips' && active && (
        <G>
          <Path d="M5.5 3.5H14.5V16.5L12.5 15L10.5 16.5L8.5 15L6.5 16.5L5.5 15V3.5Z" fill={T} />
          <Path d="M7.5 7H12.5M7.5 10H12.5" stroke={C} strokeWidth={1.4} strokeLinecap="round" />
        </G>
      )}
      {name === 'account' && !active && (
        <G>
          <Circle cx={10} cy={7} r={3} {...o} />
          <Path d="M4 16.5C4 13 6.5 11 10 11C13.5 11 16 13 16 16.5" {...o} strokeLinecap="round" />
        </G>
      )}
      {name === 'account' && active && (
        <G>
          <Circle cx={10} cy={6.8} r={3.2} fill={T} />
          <Path d="M3.6 16.5C3.6 12.9 6.4 10.6 10 10.6C13.6 10.6 16.4 12.9 16.4 16.5C16.4 16.5 3.6 16.5 3.6 16.5Z" fill={T} />
        </G>
      )}
      {name === 'earnings' && !active && (
        <G>
          <Circle cx={10} cy={10} r={6.6} {...o} />
          <Path d="M7.6 7.3H12.4M7.6 9.6H12.4M8.4 7.3C11.6 7.3 11.6 12 8.4 12L11.8 14.4" {...o} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      )}
      {name === 'earnings' && active && (
        <G>
          <Circle cx={10} cy={10} r={7} fill={T} />
          <Path d="M7.6 7.3H12.4M7.6 9.6H12.4M8.4 7.3C11.6 7.3 11.6 12 8.4 12L11.8 14.4" stroke="#FFFFFF" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      )}
      {name === 'map' && !active && (
        <G>
          <Path d="M3.5 5.2L7.2 3.6L12.8 5.4L16.5 3.8V14.8L12.8 16.4L7.2 14.6L3.5 16.2V5.2Z" {...o} strokeLinejoin="round" />
          <Path d="M7.2 3.6V14.6M12.8 5.4V16.4" {...o} />
        </G>
      )}
      {name === 'map' && active && (
        <G>
          <Path d="M3.5 5.2L7.2 3.6L12.8 5.4L16.5 3.8V14.8L12.8 16.4L7.2 14.6L3.5 16.2V5.2Z" fill={T} />
          <Path d="M7.2 3.6V14.6M12.8 5.4V16.4" stroke={C} strokeWidth={1.2} />
        </G>
      )}
    </Svg>
  )
}
