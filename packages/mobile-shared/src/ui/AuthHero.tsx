import { useEffect } from 'react'
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { h } from '../theme/brand'
import { typography } from '../theme/tokens'

const EASE = Easing.bezier(0.23, 1, 0.32, 1)
const LOGO_H = 26
// The wordmark's shape (480 x 203): drawn at its real proportions. The old screen forced it into a square, so it shrank to a sliver.
const LOGO_W = Math.round((LOGO_H * 480) / 203)

type Props = {
  image: ImageSourcePropType
  logo: ImageSourcePropType
  /** Visible height of the photo below the status bar. Eases to a new value when it changes (a step change, never the keyboard). */
  height: number
  /** Where the subject sits in the photo, 0 to 1 along the axis that gets cropped. */
  focus?: { x?: number; y?: number }
  headline?: string
  subline?: string
  /** Shows a round back button on the left, and moves the logo pill to the right. */
  onBack?: () => void
}

/** The photo header of the login screens: the brand photo with a soft scrim, the logo in a frosted pill, and either a headline over
 *  the photo (first step) or a back button (later steps). The sheet below overlaps its bottom 28 px. */
export function AuthHero({ image, logo, height, focus, headline, subline, onBack }: Props) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const total = height + insets.top
  const hv = useSharedValue(total)
  useEffect(() => {
    hv.value = withTiming(total, { duration: 420, easing: EASE })
  }, [total, hv])
  const boxStyle = useAnimatedStyle(() => ({ height: hv.value }))

  // Cover the width x height box by hand so the subject can be placed (RN has no object-position).
  const src = Image.resolveAssetSource(image)
  const ratio = src && src.width && src.height ? src.width / src.height : 1.6
  const boxH = total
  let imgW = width
  let imgH = width / ratio
  if (imgH < boxH) { imgH = boxH; imgW = boxH * ratio }
  const left = -(imgW - width) * (focus?.x ?? 0.5)
  const top = -(imgH - boxH) * (focus?.y ?? 0.25)

  return (
    <Animated.View style={[styles.box, boxStyle]}>
      <Image source={image} style={{ position: 'absolute', left, top, width: imgW, height: imgH }} resizeMode="cover" />
      <LinearGradient
        colors={['rgba(10,30,36,0.28)', 'rgba(10,30,36,0)', 'rgba(10,36,44,0.55)', 'rgba(10,36,44,0.82)']}
        locations={[0, 0.3, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.top, { top: insets.top + 12 }]}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to phone number" onPress={onBack} hitSlop={6} style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}>
            <Feather name="chevron-left" size={24} color={h.ivory} />
          </Pressable>
        ) : null}
        <View style={styles.pill}>
          <Image source={logo} style={{ width: LOGO_W, height: LOGO_H }} resizeMode="contain" accessibilityLabel="Ocar" />
        </View>
      </View>
      {headline ? (
        <Animated.View
          entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}
          style={styles.copy}
        >
          <Text style={styles.headline} maxFontSizeMultiplier={1.1}>{headline}</Text>
          {subline ? <Text style={styles.subline} maxFontSizeMultiplier={1.1}>{subline}</Text> : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#0B3A44' },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    height: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F8FBFB',
  },
  back: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F8FBFB',
  },
  pressed: { transform: [{ scale: 0.96 }] },
  // Sits above the sheet's 28 px overlap, over the scrim.
  copy: { position: 'absolute', left: 20, right: 20, bottom: 46 },
  headline: { ...typography.display, fontSize: 30, lineHeight: 33, letterSpacing: -0.6, color: '#fff', textShadowColor: 'rgba(10,30,36,0.35)', textShadowRadius: 14 },
  subline: { ...typography.body, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.92)', marginTop: 6 },
})
