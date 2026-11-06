import Svg, { Path, Line, Rect, Circle } from 'react-native-svg'
import { colors } from '@ocar/mobile-shared'

// The car silhouette shared by every car on the rider's maps (the assigned car and the nearby ones), so they cannot drift
// apart. Matches web's CarMarker.tsx: same body, windshield, headlight and taillight dots.
export function CarGlyph({ dim = false }: { dim?: boolean }) {
  return (
    <Svg width={22} height={36} viewBox="0 0 32 52" style={{ opacity: dim ? 0.55 : 1 }}>
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
  )
}
