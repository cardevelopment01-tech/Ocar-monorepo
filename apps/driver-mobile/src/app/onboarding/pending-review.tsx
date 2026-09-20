import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { api } from '@/services/api'
import { onboardingApi, type DocumentStatus } from '@/features/onboarding/api'

const DOC_LABELS: Record<string, string> = {
  profile_photo: 'Profile Photo', driving_license: 'Driving Licence',
  aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)',
  driving_license_front: 'Driving Licence (Front)', driving_license_back: 'Driving Licence (Back)',
  vehicle_rc: 'RC Book', insurance: 'Insurance Certificate', permit: 'Commercial Permit',
  pollution_cert: 'Pollution Certificate (PUC)', fitness_cert: 'Fitness Certificate',
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
  const [checking, setChecking] = useState(false)
  const [docStatus, setDocStatus] = useState<DocumentStatus | null>(null)

  useEffect(() => {
    if (driver?.status === 'active') router.replace('/')
  }, [driver?.status, router])

  useEffect(() => {
    if (driver?.status === 'docs_rejected') {
      onboardingApi.getDocumentStatus().then(setDocStatus).catch(() => {})
    }
  }, [driver?.status])

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

  if (driver?.status === 'docs_rejected') {
    const rejectedDocs = [
      ...Object.entries(docStatus?.photos ?? {}).filter(([, v]) => v.status === 'rejected'),
      ...Object.entries(docStatus?.vehicle_docs ?? {}).filter(([, v]) => v.status === 'rejected'),
    ]
    return (
      <View style={styles.container}>
        <PulsingIcon name="file-minus" color={colors.warning} bg={colors.warningLight} />
        <Text style={styles.title}>Documents Need Fixing</Text>
        <Text style={styles.body}>
          {docStatus?.rejection_reason ?? 'Some of your documents were rejected. Please fix them and resubmit your application.'}
        </Text>
        {rejectedDocs.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>REJECTED DOCUMENTS</Text>
            {rejectedDocs.map(([key, v]) => (
              <View key={key} style={{ marginBottom: spacing.xs }}>
                <Text style={styles.rejectedDoc}>{DOC_LABELS[key] ?? key}</Text>
                {v.rejection_note ? <Text style={styles.rejectedNote}>{v.rejection_note}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.btnWrap}>
          <Button label="Fix Documents" onPress={() => router.replace('/onboarding/documents')} />
        </View>
        {driver.code ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
            <Text style={styles.codeValue}>{driver.code}</Text>
          </View>
        ) : null}
      </View>
    )
  }

  if (driver?.status === 'suspended') {
    return (
      <View style={styles.container}>
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
      </View>
    )
  }

  if (driver?.status === 'banned') {
    return (
      <View style={styles.container}>
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
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <PulsingIcon name="clock" color={colors.primary} bg={colors.primarySubtle} />
      <Text style={styles.title}>Application Submitted</Text>
      <Text style={styles.body}>
        Our team is reviewing your documents. This typically takes 1–2 business days. You'll receive an SMS once your account is approved.
      </Text>
      {driver?.code ? (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR DRIVER CODE</Text>
          <Text style={styles.codeValuePrimary}>{driver.code}</Text>
          <Text style={styles.codeHint}>Keep this for support enquiries</Text>
        </View>
      ) : null}
      <Button label={checking ? 'Checking…' : 'Check approval status'} variant="ghost" icon="refresh-cw" onPress={() => void checkStatus()} disabled={checking} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, paddingHorizontal: spacing.xl, gap: spacing.sm },
  iconCircle: { width: 80, height: 80, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  // 700 is the heaviest loaded weight -- '800' silently rendered identical.
  title: { ...typography.headline, color: colors.ink900, fontWeight: '700', textAlign: 'center' },
  body: { ...typography.body, color: colors.ink600, textAlign: 'center', marginBottom: spacing.md },
  card: { backgroundColor: colors.surface2, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, width: '100%', maxWidth: 320, marginBottom: spacing.md },
  cardLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  rejectedDoc: { ...typography.body, color: colors.warning, fontWeight: '700' },
  rejectedNote: { ...typography.caption, color: colors.ink400 },
  btnWrap: { width: '100%', maxWidth: 320, marginBottom: spacing.md },
  codeCard: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, width: '100%', maxWidth: 320, alignItems: 'center', marginBottom: spacing.md },
  codeLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  // Both previously fell back to the OS default font -- codeValue never set a
  // fontFamily at all (typography.title's Jakarta family was there, but '800'
  // was still dead weight), and codeValuePrimary set raw fontSize/fontWeight
  // with no fontFamily key whatsoever, so a driver's own code -- arguably the
  // single most memorable string on this screen -- was silently off-brand.
  codeValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, fontWeight: '700', color: colors.ink600, letterSpacing: 2 },
  codeValuePrimary: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, fontWeight: '700', color: colors.primary, letterSpacing: 2 },
  codeHint: { ...typography.caption, color: colors.ink400, marginTop: 2 },
})
