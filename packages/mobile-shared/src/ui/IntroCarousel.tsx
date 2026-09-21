import { useRef, useState } from 'react'
import {
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { Button } from './Button'
import { colors, spacing, typography } from '../theme/tokens'

export type IntroPage = {
  image: ImageSourcePropType
  title: string
  subtitle: string
}

export type IntroCarouselProps = {
  pages: IntroPage[]
  onDone: () => void
}

// First-launch intro: a plain ScrollView with pagingEnabled -- native paging,
// no swiper library. Three static pages don't earn a new dependency (or the
// native rebuild that would come with one); pagingEnabled is a one-line,
// platform-native feature that already does exactly this. Full-bleed real
// photography per page (Uber-style), not an icon-in-a-circle -- the icon
// version read as a placeholder, not a finished screen.
export function IntroCarousel({ pages, onDone }: IntroCarouselProps) {
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const scrollRef = useRef<ScrollView>(null)
  const [index, setIndex] = useState(0)
  const isLast = index === pages.length - 1

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
  }

  function goNext() {
    if (isLast) {
      onDone()
      return
    }
    scrollRef.current?.scrollTo({ x: width * (index + 1), animated: true })
  }

  return (
    <View style={styles.container}>
      {!isLast ? (
        <Pressable onPress={onDone} style={[styles.skip, { top: insets.top + spacing.sm }]} hitSlop={8}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      ) : null}

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
      >
        {pages.map((page, i) => (
          <View key={i} style={[styles.page, { width }]}>
            <View style={styles.imageWrap}>
              <Image source={page.image} style={styles.pageImage} resizeMode="cover" />
              {/* Same photo-to-surface fade the login hero uses -- keeps the
                  two first-run screens feeling like one visual language
                  instead of the photo cutting hard into the panel. */}
              <LinearGradient colors={['transparent', colors.primarySubtle]} style={styles.imageFade} />
            </View>
            <View style={styles.textArea}>
              <Text style={styles.title}>{page.title}</Text>
              <Text style={styles.subtitle}>{page.subtitle}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {pages.map((_, i) => (
            <Dot key={i} active={i === index} />
          ))}
        </View>
        <Button label={isLast ? 'Get Started' : 'Next'} onPress={goNext} />
      </View>
    </View>
  )
}

function Dot({ active }: { active: boolean }) {
  const style = useAnimatedStyle(() => ({
    width: withTiming(active ? 22 : 8, { duration: 220 }),
    opacity: withTiming(active ? 1 : 0.35, { duration: 220 }),
  }))
  return <Animated.View style={[styles.dot, style]} />
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // A scrim pill, not bare text -- "Skip" sits over photos of very different
  // brightness (a sunlit street, a night street), and dark text on a dark
  // photo was reading as invisible rather than just low-contrast.
  skip: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: 9999,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  skipText: { ...typography.label, color: colors.inkInverse, fontWeight: '700' },
  page: { flex: 1 },
  // 56% previously left textArea (the remaining 44%) far taller than two lines
  // of copy need, so even bottom-anchoring the text just moved the dead space
  // above it instead of removing it. A bigger photo shrinks the surplus.
  imageWrap: { width: '100%', height: '78%' },
  pageImage: { width: '100%', height: '100%' },
  imageFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 64 },
  // A tinted panel, not stark white, plus big left-aligned type instead of
  // small centered type -- centering a modest headline in a plain white
  // void is what read as "empty"; a confident, edge-anchored headline on a
  // brand-tinted ground fills the same space with presence instead of air.
  // justifyContent: 'flex-end' -- textArea fills all space between the image
  // and the bottom-pinned footer, which on a tall screen is much taller than
  // two lines of copy; top-aligned (the default) left a large dead gap between
  // the subtitle and the dots/button below it. Anchoring the text to the
  // bottom of this region groups it tightly with its footer CTA and pushes
  // the empty space to just below the image instead, reading as breathing
  // room after the photo rather than a void in the middle of the screen.
  textArea: {
    flex: 1,
    backgroundColor: colors.primarySubtle,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  title: { ...typography.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.6, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600, maxWidth: '90%' },
  footer: { backgroundColor: colors.primarySubtle, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
})
