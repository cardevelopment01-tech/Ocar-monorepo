import Svg, { Defs, Mask, Rect } from 'react-native-svg'
import { StyleSheet, View } from 'react-native'

// Same masking approach as OvalOverlay (true SVG cutout, not rectangular
// scrim bands) but a wide rectangle sized for a number plate instead of an
// oval for a face -- standard plates are much wider than tall.
const RECT_WIDTH_RATIO = 0.82
const RECT_ASPECT = 3 / 1
const CORNER_ARM = 26
const CORNER_THICKNESS = 3
const RECT_RADIUS = 12

export function RectOverlay({ dimmed, screenWidth, screenHeight }: { dimmed?: boolean; screenWidth: number; screenHeight: number }) {
  const rectWidth = screenWidth * RECT_WIDTH_RATIO
  const rectHeight = rectWidth / RECT_ASPECT
  const cx = screenWidth / 2
  const cy = screenHeight / 2
  const left = cx - rectWidth / 2
  const top = cy - rectHeight / 2
  const scrimOpacity = dimmed ? 0.52 : 0.6

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={screenWidth} height={screenHeight}>
        <Defs>
          <Mask id="rect-cutout">
            <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill="white" />
            <Rect x={left} y={top} width={rectWidth} height={rectHeight} rx={RECT_RADIUS} ry={RECT_RADIUS} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill={`rgba(0,0,0,${scrimOpacity})`} mask="url(#rect-cutout)" />
        <Rect x={left} y={top} width={rectWidth} height={rectHeight} rx={RECT_RADIUS} ry={RECT_RADIUS} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
      </Svg>

      <View style={{ position: 'absolute', top, left, width: rectWidth, height: rectHeight }}>
        <View style={[styles.bracket, { top: 0, left: 0, width: CORNER_ARM, height: CORNER_THICKNESS }]} />
        <View style={[styles.bracket, { top: 0, left: 0, width: CORNER_THICKNESS, height: CORNER_ARM }]} />
        <View style={[styles.bracket, { top: 0, right: 0, width: CORNER_ARM, height: CORNER_THICKNESS }]} />
        <View style={[styles.bracket, { top: 0, right: 0, width: CORNER_THICKNESS, height: CORNER_ARM }]} />
        <View style={[styles.bracket, { bottom: 0, left: 0, width: CORNER_ARM, height: CORNER_THICKNESS }]} />
        <View style={[styles.bracket, { bottom: 0, left: 0, width: CORNER_THICKNESS, height: CORNER_ARM }]} />
        <View style={[styles.bracket, { bottom: 0, right: 0, width: CORNER_ARM, height: CORNER_THICKNESS }]} />
        <View style={[styles.bracket, { bottom: 0, right: 0, width: CORNER_THICKNESS, height: CORNER_ARM }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bracket: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 1.5 },
})
