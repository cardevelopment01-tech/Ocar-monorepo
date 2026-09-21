import { useEffect } from 'react'
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

export type SplashOverlayProps = {
  logoSource: ImageSourcePropType
  onDone: () => void
  durationMs?: number
}

const LOGO_SIZE = 120
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

// Mirrors both web apps' SplashScreen.tsx (byte-identical between apps/driver and
// apps/user): dark #0F0D1A background, a pink/teal glow behind the logo. Native
// Android/iOS splash can only show one static image, so this JS overlay renders
// right after it to carry motion the static image can't, then unmounts to reveal
// the real screen underneath. The logo mark itself is untouched brand asset --
// everything below is choreography around it, not a replacement for it.
//
// Every animated value here drives only `transform`/`opacity` (rotation, scale,
// translateX, opacity) -- no layout properties, no blur -- so this stays GPU
// composited and cheap enough for a low-end Android device, not just a flagship.
export function SplashOverlay({ logoSource, onDone, durationMs = 1450 }: SplashOverlayProps) {
  const overlayOpacity = useSharedValue(1)
  const glowOpacity = useSharedValue(0)
  const glowScale = useSharedValue(0.8)
  const glowRotate = useSharedValue(0)
  const glowBreath = useSharedValue(1)
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.92)
  const sweepX = useSharedValue(-1)

  useEffect(() => {
    // 1. Glow blooms in first -- the backdrop arrives before the mark does.
    glowOpacity.value = withTiming(1, { duration: 350, easing: EASE_OUT })
    glowScale.value = withTiming(1, { duration: 500, easing: EASE_OUT })
    // A slow continuous drift for the life of the splash -- rotation gives the
    // gradient actual motion instead of sitting there as a flat tinted shape,
    // and the breathing scale reads as "alive" without ever looking gestural.
    glowRotate.value = withRepeat(withTiming(360, { duration: 9000, easing: Easing.linear }), -1)
    glowBreath.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1
    )

    // 2. Logo settles in on top of the now-visible glow.
    logoOpacity.value = withDelay(150, withTiming(1, { duration: 400, easing: EASE_OUT }))
    logoScale.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.exp) }))

    // 3. A single light sweep across the mark once it's settled -- the
    // "premium reveal" glint, not a loop (frequency: once per app open).
    sweepX.value = withDelay(650, withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }))

    const timer = setTimeout(() => {
      overlayOpacity.value = withTiming(0, { duration: 450 }, (finished) => {
        if (finished) runOnJS(onDone)()
      })
    }, durationMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [])

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }))
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ rotate: `${glowRotate.value}deg` }, { scale: glowScale.value * glowBreath.value }],
  }))
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }))
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value * LOGO_SIZE * 2 }, { rotate: '20deg' }],
  }))

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
      <Animated.View style={[styles.glow, glowStyle]}>
        <LinearGradient
          colors={['#DC3E93', '#0A9FB0', 'transparent']}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={[styles.logoClip, logoStyle]}>
        <Image source={logoSource} style={styles.logo} resizeMode="contain" />
        <Animated.View style={[styles.sweep, sweepStyle]}>
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
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
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    // Android does not clip children to borderRadius without this -- omitting
    // it left the rectangular gradient inside rendering as a literal square
    // that rotated in place instead of a circular glow.
    overflow: 'hidden',
    opacity: 0.32,
  },
  // overflow:hidden turns this into the sweep's clip mask -- no masking library
  // needed, the sweep band simply can't paint outside the logo's own bounds.
  logoClip: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    overflow: 'hidden',
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  sweep: {
    position: 'absolute',
    top: -LOGO_SIZE,
    left: -LOGO_SIZE / 2,
    width: LOGO_SIZE / 3,
    height: LOGO_SIZE * 3,
  },
})
