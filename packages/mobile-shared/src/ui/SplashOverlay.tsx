import { useEffect } from 'react'
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

export type SplashOverlayProps = {
  logoSource: ImageSourcePropType
  onDone: () => void
  durationMs?: number
}

// Mirrors both web apps' SplashScreen.tsx (byte-identical between apps/driver and
// apps/user): dark #0F0D1A background, a pink/teal radial glow behind the logo,
// fade+scale in, hold, fade out. Native Android/iOS splash can only show one
// static image, so this JS overlay renders right after it to carry the same
// motion the web apps use, then unmounts to reveal the real screen underneath.
export function SplashOverlay({ logoSource, onDone, durationMs = 1200 }: SplashOverlayProps) {
  const overlayOpacity = useSharedValue(1)
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.92)

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 400 })
    logoScale.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.exp) })
    const timer = setTimeout(() => {
      overlayOpacity.value = withTiming(0, { duration: 450 }, (finished) => {
        if (finished) runOnJS(onDone)()
      })
    }, durationMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [])

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }))
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }))

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
      <Animated.View style={[styles.glowPink, logoStyle]} />
      <Animated.View style={[styles.glowTeal, logoStyle]} />
      <Animated.View style={logoStyle}>
        <Image source={logoSource} style={styles.logo} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0F0D1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  // Two overlapping tinted circles approximate the web version's two-stop
  // radial gradient (pink center -> teal mid -> transparent), since RN has
  // no native radial-gradient primitive.
  glowTeal: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#0A9FB0',
    opacity: 0.28,
  },
  glowPink: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#DC3E93',
    opacity: 0.35,
  },
  logo: { width: 120, height: 120 },
})
