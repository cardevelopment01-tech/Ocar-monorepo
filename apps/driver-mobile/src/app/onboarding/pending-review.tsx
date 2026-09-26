import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReactNode } from 'react'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { api } from '@/services/api'

// Scrollable + inset-aware: a rejected-docs list or big system fonts must never push content off a small
// screen, and the centred block clears the status bar / notch / gesture bar on every device.
function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

// Submitted -> In review -> Approved: shows where the application is instead of a bare "please wait".
function ReviewTimeline() {
  const steps = [
    { label: 'Submitted', state: 'done' as const },
    { label: 'In review', state: 'active' as const },
    { label: 'Approved', state: 'todo' as const },
  ]
  return (
    <View style={styles.timeline} accessibilityLabel="Application progress: submitted, in review, then approved">
      {steps.map((st, i) => (
        <View key={st.label} style={styles.tlItem}>
          <View style={styles.tlTrack}>
            <View style={[styles.tlLine, i === 0 && styles.tlLineHidden, st.state !== 'todo' && styles.tlLineOn]} />
            <View style={[styles.tlDot, st.state === 'done' && styles.tlDotDone, st.state === 'active' && styles.tlDotActive]}>
              {st.state === 'done' ? <Feather name="check" size={11} color="#FFFFFF" /> : null}
            </View>
            <View style={[styles.tlLine, i === steps.length - 1 && styles.tlLineHidden, st.state === 'done' && styles.tlLineOn]} />
          </View>
          <Text style={[styles.tlLabel, st.state === 'todo' && styles.tlLabelTodo]}>{st.label}</Text>
        </View>
      ))}
    </View>
  )
}

function PulsingIcon({ name, color, bg }: { name: React.ComponentProps<typeof Feather>['name']; color: string; bg: string }) {
  const reduced = useReducedMotion()
  const pulse = useSharedValue(1)

  useEffect(() => {
    if (reduced) return
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.9, { duration: 1400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    )
  }, [reduced, pulse])

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }))

  return (
    <Animated.View style={[styles.iconCircle, { backgroundColor: bg }, style]}>
      <Feather name={name} size={36} color={color} />
    </Animated.View>
  )
}

export default function PendingReviewScreen() {
  const router = useRouter()
  const driver = useAuthStore((s) => s.driver)
  const updateDriver = useAuthStore((s) => s.updateDriver)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (driver?.status === 'active') router.replace('/')
  }, [driver?.status, router])

  async function checkStatus() {
    setChecking(true)
    try {
      const res = await api.get('/api/v1/drivers/me')
      const fresh = res.data.driver as { status: string; onboarding_step: string }
      updateDriver({ status: fresh.status, onboarding_step: fresh.onboarding_step })
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    const id = setInterval(() => void checkStatus(), 30_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // docs_rejected drivers stay in the tab shell (Home's rejection banner + Profile's Documents row
  // are the actionable surfaces, see /documents) rather than landing on this screen; this component
  // only ever renders for a driver still mid-first-application (never yet approved).

  if (driver?.status === 'suspended') {
    return (
      <Screen>
        <PulsingIcon name="alert-triangle" color={colors.warning} bg={colors.warningLight} />
        <Text style={styles.title}>Account Suspended</Text>
        <Text style={styles.body}>Your driver account has been temporarily suspended. Please contact our support team for more information.</Text>
        {driver.code ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
            <Text style={styles.codeValuePrimary}>{driver.code}</Text>
            <Text style={styles.codeHint}>Provide this when contacting support</Text>
          </View>
        ) : null}
        <Button label={checking ? 'Checking…' : 'Check status'} variant="ghost" icon="refresh-cw" onPress={() => void checkStatus()} disabled={checking} />
      </Screen>
    )
  }

  if (driver?.status === 'banned') {
    return (
      <Screen>
        <PulsingIcon name="x-circle" color={colors.error} bg={colors.errorLight} />
        <Text style={styles.title}>Account Banned</Text>
        <Text style={styles.body}>
          Your driver account has been permanently deactivated due to a violation of our terms. You are no longer eligible to drive on Ocar.
        </Text>
        {driver.code ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
            <Text style={styles.codeValue}>{driver.code}</Text>
          </View>
        ) : null}
      </Screen>
    )
  }

  return (
    <Screen>
      <PulsingIcon name="clock" color={colors.primary} bg={colors.primarySubtle} />
      <Text style={styles.title}>Application Submitted</Text>
      <Text style={styles.body}>
        Our team is reviewing your documents. This typically takes 1–2 business days. You'll receive an SMS once your account is approved.
      </Text>
      <ReviewTimeline />
      {driver?.code ? (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
          <Text style={styles.codeValuePrimary}>{driver.code}</Text>
          <Text style={styles.codeHint}>Keep this for support enquiries</Text>
        </View>
      ) : null}
      <Button label={checking ? 'Checking…' : 'Check approval status'} variant="ghost" icon="refresh-cw" onPress={() => void checkStatus()} disabled={checking} />
      <Pressable onPress={clearAuth} hitSlop={10} accessibilityRole="button" style={styles.signOut}>
        <Text style={styles.signOutText}>Use a different number</Text>
      </Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.sm },
  timeline: { flexDirection: 'row', width: '100%', maxWidth: 320, marginBottom: spacing.md },
  tlItem: { flex: 1, alignItems: 'center', gap: 8 },
  tlTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tlLine: { flex: 1, height: 2, backgroundColor: colors.border },
  tlLineOn: { backgroundColor: colors.primary },
  tlLineHidden: { backgroundColor: 'transparent' },
  tlDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  tlDotActive: { borderColor: colors.primary, boxShadow: '0 0 0 4px rgba(14,143,163,0.16)' },
  tlLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink900 },
  tlLabelTodo: { color: colors.ink400 },
  signOut: { marginTop: spacing.sm, paddingVertical: spacing.xs },
  signOutText: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  iconCircle: { width: 88, height: 88, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  // 700 is the heaviest loaded weight -- '800' silently rendered identical.
  title: { ...typography.headline, color: colors.ink900, fontFamily: fonts.bold, textAlign: 'center' },
  body: { ...typography.body, color: colors.ink600, textAlign: 'center', marginBottom: spacing.md },
  codeCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, width: '100%', maxWidth: 320, alignItems: 'center', marginBottom: spacing.md },
  codeLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold, letterSpacing: 0.5, marginBottom: spacing.xs },
  // Both previously fell back to the OS default font -- codeValue never set a
  // fontFamily at all (typography.title's Jakarta family was there, but '800'
  // was still dead weight), and codeValuePrimary set raw fontSize/fontWeight
  // with no fontFamily key whatsoever, so a driver's own code -- arguably the
  // single most memorable string on this screen -- was silently off-brand.
  codeValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.ink600, letterSpacing: 2 },
  codeValuePrimary: { fontSize: 24, fontFamily: fonts.bold, color: colors.primary, letterSpacing: 2 },
  codeHint: { ...typography.caption, color: colors.ink400, marginTop: 2 },
})
