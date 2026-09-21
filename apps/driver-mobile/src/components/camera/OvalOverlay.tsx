import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg'
import { StyleSheet, View } from 'react-native'

// KYC-style oval guide. Uses a true SVG mask so everything OUTSIDE the oval
// curve is dark -- not just the four rectangular bands outside the oval's
// bounding box (that earlier version left the bounding box's four corners
// fully bright, reading as "a box with a circle drawn in it" rather than a
// real oval cutout, per live-device QA). No live face detection here or on
// web -- this is a framing guide, not a liveness check.
const OVAL_WIDTH_RATIO = 0.72
const OVAL_ASPECT = 3 / 4
const BRACKET_ARM = 22
const BRACKET_THICKNESS = 3

export function OvalOverlay({ dimmed, screenWidth, screenHeight }: { dimmed?: boolean; screenWidth: number; screenHeight: number }) {
  const ovalWidth = screenWidth * OVAL_WIDTH_RATIO
  const ovalHeight = ovalWidth / OVAL_ASPECT
  const cx = screenWidth / 2
  const cy = screenHeight / 2
  const rx = ovalWidth / 2
  const ry = ovalHeight / 2
  const scrimOpacity = dimmed ? 0.52 : 0.6

  const left = cx - rx
  const top = cy - ry

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={screenWidth} height={screenHeight}>
        <Defs>
          <Mask id="oval-cutout">
            <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill="white" />
            <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={screenWidth} height={screenHeight} fill={`rgba(0,0,0,${scrimOpacity})`} mask="url(#oval-cutout)" />
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
      </Svg>

      <View style={{ position: 'absolute', top, left, width: ovalWidth, height: ovalHeight }}>
        <View style={[styles.bracket, { top: 0, left: 0, width: BRACKET_ARM, height: BRACKET_THICKNESS }]} />
        <View style={[styles.bracket, { top: 0, left: 0, width: BRACKET_THICKNESS, height: BRACKET_ARM }]} />
        <View style={[styles.bracket, { top: 0, right: 0, width: BRACKET_ARM, height: BRACKET_THICKNESS }]} />
        <View style={[styles.bracket, { top: 0, right: 0, width: BRACKET_THICKNESS, height: BRACKET_ARM }]} />
        <View style={[styles.bracket, { bottom: 0, left: 0, width: BRACKET_ARM, height: BRACKET_THICKNESS }]} />
        <View style={[styles.bracket, { bottom: 0, left: 0, width: BRACKET_THICKNESS, height: BRACKET_ARM }]} />
        <View style={[styles.bracket, { bottom: 0, right: 0, width: BRACKET_ARM, height: BRACKET_THICKNESS }]} />
        <View style={[styles.bracket, { bottom: 0, right: 0, width: BRACKET_THICKNESS, height: BRACKET_ARM }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bracket: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 1.5 },
})
