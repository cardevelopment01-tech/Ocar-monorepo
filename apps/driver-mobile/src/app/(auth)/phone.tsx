import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { BackHandler, Dimensions, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, FadeIn, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Input, OtpBoxInput, colors, spacing, typography, mapOtpErrorCode, TERMS_URL, PRIVACY_URL } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { setupPushNotifications } from '@/services/notifications'
import { useAuthStore, type DriverProfile } from '@/store/useAuthStore'
import loginHeroImage from '../../../assets/brand/login-hero.png'
import logoMarkImage from '../../../assets/brand/logo-mark.png'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
// Fixed at module load, not reactive to rotation -- portrait-only auth screen.
// Must stay well under (screen height - typical keyboard height, ~40-45% of
// screen) -- the sheet's marginTop is HERO_HEIGHT-28, and with content
// top-anchored (see contentGroupInner below) everything the user needs to
// touch sits right after that margin. A taller hero here directly pushes
// the Send OTP button further down; at 0.68 it landed entirely behind the
// keyboard on a real device, unreachable regardless of any scroll/avoidance
// logic, since no pixel of it was rendered above the keyboard's window.
const HERO_HEIGHT = Dimensions.get('window').height * 0.3
// KeyboardAvoidingView, a hand-rolled collapsing-hero animation, and
// react-native-keyboard-controller's KeyboardProvider/KeyboardAwareScrollView
// were all tried and all failed identically on-device: this app runs with
// New Architecture enabled (required by Reanimated 4), and that library has
// an open, confirmed compatibility bug where its native keyboard-height
// listener never fires under Fabric on Android, so nothing built on top of
// it can auto-scroll. Falling back to a plain ScrollView: it doesn't
// auto-scroll the focused input into view, but a manual swipe always
// reaches it, which is a real working fallback instead of a dead screen.
// The hero and sheet are static -- no animation depends on keyboard state.

type Step = 'phone' | 'otp'

interface VerifyOtpResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
  principal: DriverProfile
  isNew: boolean
}

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

export default function PhoneScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [step, setStep] = useState<Step>('phone')
  // Which way the step transition should read -- forward when moving to OTP,
  // back when returning to phone entry, so exit and enter always share a
  // path (a screen that slides in from the right must leave to the right).
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const otpRequestInFlightRef = useRef(false)
  const otpVerifyInFlightRef = useRef(false)

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  // Android hardware/gesture back from the OTP sub-state returns to phone entry
  // instead of exiting the (auth) stack -- there's no second route to pop since
  // this is a same-screen transition, not a stack push.
  useEffect(() => {
    if (step !== 'otp') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDirection('back')
      setStep('phone')
      return true
    })
    return () => sub.remove()
  }, [step])

  function startCountdown() {
    setCountdown(30)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function handlePhoneSubmit() {
    if (phone.replace(/\D/g, '').length !== 10 || loading || otpRequestInFlightRef.current) return
    otpRequestInFlightRef.current = true
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ otp?: string }>('/api/v1/auth/otp/request', {
        phone: formatPhone(phone),
        role: 'driver',
        purpose: 'login',
      })
      if (res.data.otp) setOtp(res.data.otp)
      setDirection('forward')
      setStep('otp')
      startCountdown()
    } catch {
      setError('Check your connection and try again')
    } finally {
      setLoading(false)
      otpRequestInFlightRef.current = false
    }
  }

  async function handleResend() {
    if (countdown > 0 || otpRequestInFlightRef.current) return
    await handlePhoneSubmit()
  }

  // Auto-submit the instant all 6 digits land -- typed, pasted, or SMS-autofilled --
  // instead of making the driver also tap Verify. handleOtpSubmit's own guards
  // (length check, in-flight ref) make this safe to fire on every otp change.
  useEffect(() => {
    if (otp.length === 6) void handleOtpSubmit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only otp reaching 6 digits should trigger this
  }, [otp])

  async function handleOtpSubmit() {
    if (otp.length !== 6 || loading || otpVerifyInFlightRef.current) return
    otpVerifyInFlightRef.current = true
    setError('')
    setLoading(true)
    try {
      const res = await api.post<VerifyOtpResponse>('/api/v1/auth/otp/verify', {
        phone: formatPhone(phone),
        otp,
        role: 'driver',
        purpose: 'login',
      })
      const { tokens, principal } = res.data
      setAuth(tokens.accessToken, tokens.refreshToken, principal)
      void setupPushNotifications()
      setVerified(true)
      // Hold on the verified checkmark for a beat before swapping screens --
      // otherwise success is invisible, the OTP screen just vanishes.
      setTimeout(() => {
        // Route through "/" rather than straight to the tab shell -- its onboarding
        // gate decides between the wizard, pending-review, and the tabs/active-ride
        // relaunch check based on the driver's real status/onboarding_step.
        router.replace('/')
      }, 550)
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      setOtp('')
      setError(code ? mapOtpErrorCode(code) : 'Check your connection and try again')
    } finally {
      setLoading(false)
      otpVerifyInFlightRef.current = false
    }
  }

  return (
    <View style={styles.container}>
      {/* Persistent hero backdrop -- stays put behind both steps, only the
          sheet content below it swaps, matching the approved mockup's
          Full-Bleed Hero direction. Static -- KeyboardAwareScrollView below
          handles keyboard avoidance by scrolling its own content, not by
          this moving. */}
      <View style={[styles.hero, { height: HERO_HEIGHT }]}>
        <Image
          source={loginHeroImage}
          style={styles.heroImage}
          resizeMode="cover"
        />
        <LinearGradient colors={['transparent', colors.bg]} style={styles.heroFade} />
      </View>

      <View style={styles.sheetWrapper}>
        <Animated.View
          entering={FadeIn.duration(320)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          <View style={styles.handle} />
          {/* Handle stays pinned under the sheet's top edge (standard drag-affordance
              placement); only the logo+form group below it centers in the remaining
              space, which on a tall screen is much bigger than the group needs.
              Plain ScrollView (see the file-header comment): it won't auto-scroll
              a focused input into view above the keyboard, but the content is
              always manually reachable by swiping, unlike every keyboard-
              detection-based approach that was tried first. */}
          <ScrollView
            style={styles.contentGroup}
            contentContainerStyle={styles.contentGroupInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Image source={logoMarkImage} style={styles.logo} resizeMode="contain" />

            <Animated.View
            key={step}
            entering={
              step === 'phone'
                ? direction === 'back'
                  ? SlideInLeft.duration(300).easing(EASE_OUT)
                  : FadeIn.duration(320)
                : SlideInRight.duration(300).easing(EASE_OUT)
            }
            exiting={step === 'phone' ? SlideOutLeft.duration(220).easing(EASE_OUT) : SlideOutRight.duration(220).easing(EASE_OUT)}
            style={styles.stepContainer}
          >
            {step === 'phone' ? (
              <>
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Enter your registered mobile number</Text>
                <Input
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="10-digit mobile number"
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter your 10-digit mobile number"
                  maxLength={10}
                />
                {error ? (
                  <Text style={styles.error} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}
                <Button
                  label="Send OTP"
                  onPress={handlePhoneSubmit}
                  loading={loading}
                  disabled={phone.replace(/\D/g, '').length !== 10}
                />
                <Text style={styles.consent}>
                  By continuing you agree to our{' '}
                  <Text style={styles.consentLink} onPress={() => void Linking.openURL(TERMS_URL)}>Driver Partner Terms</Text>
                  {' '}&amp;{' '}
                  <Text style={styles.consentLink} onPress={() => void Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>Enter OTP</Text>
                <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>
                <OtpBoxInput
                  value={otp}
                  onChangeText={setOtp}
                  error={!!error}
                  autoFocus
                  editable={!loading && !verified}
                />
                {error ? (
                  <Text style={styles.error} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}
                <Button label="Verify" onPress={handleOtpSubmit} loading={loading} success={verified} disabled={otp.length !== 6} />
                <Button
                  label={countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
                  variant="ghost"
                  onPress={handleResend}
                  disabled={countdown > 0 || verified}
                />
              </>
            )}
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { position: 'absolute', top: 0, left: 0, right: 0 },
  heroImage: { width: '100%', height: '100%' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  sheetWrapper: { flex: 1 },
  // marginTop pulls the sheet up to overlap the hero's bottom edge -- the
  // rounded top corners read as "tucked under" the photo rather than a hard
  // seam between photo and card.
  sheet: {
    flex: 1,
    marginTop: HERO_HEIGHT - 28,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  // The sheet fills the rest of the screen below the hero (so the rounded card
  // still reaches the bottom edge), but the logo+form is far shorter than that
  // on a tall phone. Deliberately top-anchored (flex-start), not centered or
  // bottom-anchored: any leftover flex space this leaves lands below the
  // button, inside the same white sheet, where it's invisible -- rather than
  // above the button, which is what pushes it toward (or behind) the
  // keyboard's safe zone on a real device.
  contentGroup: { flex: 1, width: '100%' },
  contentGroupInner: { flexGrow: 1, width: '100%', alignItems: 'center', justifyContent: 'flex-start' },
  logo: { width: 56, height: 56, marginBottom: spacing.md },
  stepContainer: { width: '100%', gap: spacing.md },
  // Matches the onboarding carousel's boosted display scale -- the plain
  // headline size read as thin/generic next to the carousel's bold,
  // tight-tracked type right before this screen in the flow.
  title: { ...typography.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.5, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
  consent: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginTop: spacing.xs },
  consentLink: { color: colors.primary, fontWeight: '700' },
})
