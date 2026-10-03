import type { ReactNode } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, Text } from '@ocar/mobile-shared'
import loginHeroImage from '../../../../assets/brand/login-hero.webp'

// Brand pink from the logo's teal + pink duo (see RideRequestOverlay's palette note).
const PINK = '#DC3E93'

export type HeroKind = 'standard' | 'return'

// One backdrop for every go-online surface so the three pages read as a single family.
//   standard: the golden-hour Bhubaneswar street photo under a deep teal wash.
//   return:   deep ink-teal with a drawn route arc, a teal start and a pink destination pin.
// Content is laid over a bottom scrim so white text always clears 4.5:1.
export function ModeHero({ kind, height, children }: { kind: HeroKind; height: number; children?: ReactNode }) {
  return (
    <View style={[styles.hero, { height }]}>
      {kind === 'standard' ? (
        <>
          <Image source={loginHeroImage} style={styles.photo} resizeMode="cover" accessibilityIgnoresInvertColors />
          <LinearGradient colors={['rgba(11,74,80,0.35)', 'rgba(7,14,16,0.92)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
        </>
      ) : (
        <>
          <LinearGradient colors={['#0B1417', '#0B4A50', '#0E8FA3']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <RouteArt />
          <LinearGradient colors={['rgba(7,14,16,0)', 'rgba(7,14,16,0.7)']} start={{ x: 0, y: 0.35 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        </>
      )}
      {children}
    </View>
  )
}

function RouteArt() {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 340 220" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <RadialGradient id="glow" cx="78%" cy="26%" r="42%">
          <Stop offset="0" stopColor={PINK} stopOpacity="0.34" />
          <Stop offset="1" stopColor={PINK} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="268" cy="62" r="120" fill="url(#glow)" />
      {/* the route: out from the start, a long bend, home to the destination. Kept in the upper
          band (y 55..112 of 220) so it never runs under the title and body at the bottom. */}
      <Path d="M46 110 C 108 110, 124 78, 186 78 S 246 70, 272 62" stroke="rgba(255,255,255,0.9)" strokeWidth={3} strokeLinecap="round" strokeDasharray="1 9" fill="none" />
      <Circle cx="46" cy="110" r="9" fill="rgba(255,255,255,0.18)" />
      <Circle cx="46" cy="110" r="5" fill="#FFFFFF" />
      <Circle cx="272" cy="62" r="16" fill="rgba(220,62,147,0.28)" />
      <Circle cx="272" cy="62" r="7" fill={PINK} />
    </Svg>
  )
}

// Frosted chip used on the hero: translucent white with a hairline, readable on photo and on gradient.
export function GlassChip({ icon, label }: { icon?: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.chip}>
      {icon ? <Feather name={icon} size={14} color={colors.inkInverse} /> : null}
      <Text style={styles.chipText}>{label}</Text>
    </View>
  )
}

// A number plate drawn like one: light plate, dark rim, one line, tabular figures.
export function PlateTile({ plate }: { plate: string }) {
  return (
    <View style={styles.plate} accessible accessibilityLabel={`Number plate ${plate}`}>
      <View style={styles.plateStripe}>
        <Text style={styles.plateStripeText}>IND</Text>
      </View>
      <Text style={styles.plateText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{plate}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#0B1417', boxShadow: '0 14px 32px rgba(11,74,80,0.28), 0 2px 6px rgba(20,23,26,0.08)' },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: spacing.sm + 4, height: 30, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.36)' },
  chipText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold, color: colors.inkInverse },
  plate: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: '#FAFBFB', borderRadius: 10, borderWidth: 2, borderColor: '#14171A', overflow: 'hidden' },
  plateStripe: { alignSelf: 'stretch', width: 30, backgroundColor: '#1D3F8F', alignItems: 'center', justifyContent: 'center' },
  plateStripeText: { fontSize: 9, lineHeight: 12, fontFamily: fonts.bold, color: '#FFFFFF' },
  plateText: { flexShrink: 1, paddingHorizontal: spacing.sm + 4, paddingVertical: 8, fontSize: 24, lineHeight: 30, fontFamily: fonts.bold, color: '#14171A', letterSpacing: 2, fontVariant: ['tabular-nums'] },
})
