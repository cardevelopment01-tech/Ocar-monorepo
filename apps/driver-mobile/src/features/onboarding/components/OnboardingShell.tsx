import { useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography } from '@ocar/mobile-shared'

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie'] as const

export type OnboardingShellProps = {
  stepIndex: number
  title: string
  subtitle?: string
  children: ReactNode
  footer: ReactNode
  onBack?: () => void
}

// Direct port of the web onboarding wizard's shell (apps/driver/src/components/
// onboarding/OnboardingShell.tsx): back + step counter + animated progress bars
// up top, scrollable content, footer pinned to the bottom.
//
// Glossy-white pass: the step header is now a real floating glass layer
// (BlurView "light material" per DESIGN.md's Materials & Glass section) that
// sits absolutely over the scrolling content instead of a plain colored band
// -- content actually scrolls underneath it, which is the whole point of
// glass as a depth cue (Floating-Layer Rule). Body content stays solid white
// per that same rule; only this floating chrome gets the material.
export function OnboardingShell({ stepIndex, title, subtitle = 'Progress is saved automatically', children, footer, onBack }: OnboardingShellProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const activeIdx = Math.min(Math.max(stepIndex, 0), STEPS.length - 1)
  const [headerHeight, setHeaderHeight] = useState(0)

  function onHeaderLayout(e: LayoutChangeEvent) {
    setHeaderHeight(e.nativeEvent.layout.height)
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerHeight + spacing.md }]}
        keyboardShouldPersistTaps="handled"
      >
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>

      <View style={styles.headerFloat} onLayout={onHeaderLayout}>
        <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.headerTopEdge} />
        <View style={[styles.headerInner, { paddingTop: Math.max(insets.top, 24) }]}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={onBack ?? (() => { if (router.canGoBack()) router.back() })}
              style={styles.backBtn}
              accessibilityLabel="Go back"
              hitSlop={8}
            >
              <Feather name="arrow-left" size={20} color={colors.ink600} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepLabel}>Step {activeIdx + 1} of {STEPS.length}</Text>
              <Text style={styles.title}>{title}</Text>
            </View>
          </View>

          <View style={styles.barsRow}>
            {STEPS.map((_, i) => (
              <Animated.View
                key={i}
                entering={FadeIn.delay(i * 60)}
                style={[styles.bar, i <= activeIdx ? styles.barActive : null]}
              />
            ))}
          </View>
        </View>
      </View>

      <Animated.View
        entering={FadeInDown.duration(220)}
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
      >
        <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.footerTopEdge} />
        {footer}
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  subtitle: { ...typography.caption, color: colors.ink400, marginBottom: spacing.xs },
  headerFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  headerTopEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  headerInner: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  backBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  stepLabel: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  barsRow: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: radii.full, backgroundColor: 'rgba(15,23,42,0.08)' },
  barActive: { backgroundColor: colors.primary, ...shadows.buttonPrimary, shadowOpacity: 0.5, shadowRadius: 6, elevation: 4 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    overflow: 'hidden',
  },
  footerTopEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(15,23,42,0.06)',
  },
})
