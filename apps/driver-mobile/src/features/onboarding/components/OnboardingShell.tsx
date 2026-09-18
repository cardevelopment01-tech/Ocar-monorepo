import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn } from 'react-native-reanimated'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

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
export function OnboardingShell({ stepIndex, title, subtitle = 'Progress is saved automatically', children, footer, onBack }: OnboardingShellProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const activeIdx = Math.min(Math.max(stepIndex, 0), STEPS.length - 1)

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack ?? (() => router.back())} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {footer}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  backBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { ...typography.caption, color: colors.ink400, fontWeight: '600' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  barsRow: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: radii.full, backgroundColor: colors.border },
  barActive: { backgroundColor: colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  subtitle: { ...typography.caption, color: colors.ink400, marginBottom: spacing.xs },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
})
