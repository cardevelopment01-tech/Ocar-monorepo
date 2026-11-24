import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { BackHandler, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, {
  Easing,
  FadeIn,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { smsRetriever } from '@ocar/expo-sms-retriever'
import {
  AuthHero, Button, FieldMessage, OtpBoxInput, OtpResendRow, OtpStatusLine, PhoneField,
  colors, fonts, formatPhoneDisplay, h, mapOtpErrorCode, otpWaitStatus, spacing, track, typography,
  PRIVACY_URL, TERMS_URL, Text, useOtpAutoRead, useOtpWaitSeconds,
} from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { setupPushNotifications } from '@/services/notifications'
import { useAuthStore, type DriverProfile } from '@/store/useAuthStore'
import loginHeroImage from '../../../assets/brand/login-hero.webp'
import logoMarkImage from '../../../assets/brand/logo-mark.png'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
// Photo heights below the status bar. Fixed per STEP, never derived from the keyboard: react-native-keyboard-controller's keyboard-height
// listener never fires under New Architecture on Android (KeyboardAvoidingView, a collapsing hero and KeyboardAwareScrollView were all tried
// and failed), so the content has to fit above a ~300 px keyboard by construction. Phone step: photo + field + button + terms. OTP step: the
// photo eases down so the boxes, status line, button and resend row still clear the keyboard.
const PHONE_HERO = 250
const OTP_HERO = 180
const OTP_RESEND_AFTER_SEC = 30
const WRONG_CODE_HOLD_MS = 700

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
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [step, setStep] = useState<Step>('phone')
  // Which way the step transition should read -- forward when moving to OTP,
  // back when returning to phone entry, so exit and enter always share a
  // path (a screen that slides in from the right must leave to the right).
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  // True for a moment after a wrong code: the boxes shake and keep the digits so the driver can see what they typed, then clear.
  const [wrong, setWrong] = useState(false)
  const [countdown, setCountdown] = useState(0)
  // Android SMS auto-read: the phone listens for the one code SMS and fills the boxes (the 6-digit effect below then verifies).
  // waitKey restarts the "how long has it been" clock on every send, so Resend starts the calm waiting state afresh.
  const [waitKey, setWaitKey] = useState(0)
  const autoRead = useOtpAutoRead(smsRetriever, setOtp)
  const waitSec = useOtpWaitSeconds(step === 'otp' && !verified, waitKey)
  const waitStatus = otpWaitStatus({
    elapsedSec: waitSec, autoReading: autoRead.listening, detected: autoRead.detected, typed: otp.length,
    canResend: countdown === 0, verifying, success: verified, error,
  })

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const otpRequestInFlightRef = useRef(false)
  const otpVerifyInFlightRef = useRef(false)

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current)
    }
  }, [])

  // Back to the phone step: the round back button, the Edit link and Android's hardware/gesture back all do this -- there's no second
  // route to pop since this is a same-screen transition, not a stack push.
  function handleEdit() {
    setDirection('back')
    setStep('phone')
    setOtp('')
    setError('')
    setWrong(false)
    autoRead.disarm()
  }

  useEffect(() => {
    if (step !== 'otp') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleEdit()
      return true
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleEdit only calls setters and autoRead.disarm
  }, [step])

  function startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(OTP_RESEND_AFTER_SEC)
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
    // Listen BEFORE the SMS can exist; tell the server whether we are, so it only uses the auto-read wording when it can work.
    const autoReadStarted = await autoRead.arm()
    try {
      const res = await api.post<{ otp?: string }>('/api/v1/auth/otp/request', {
        phone: formatPhone(phone),
        role: 'driver',
        purpose: 'login',
        autoRead: autoReadStarted,
      })
      if (res.data.otp) setOtp(res.data.otp)
      setDirection('forward')
      setStep('otp')
      setWaitKey((k) => k + 1)
      startCountdown()
    } catch {
      autoRead.disarm()
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

  function handleOtpChange(value: string) {
    // Typing is ignored (not blocked with editable={false}, which would drop the keyboard) while a code is checked or a wrong one shows.
    if (loading || verified || wrong) return
    if (error) setError('')
    setOtp(value)
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
    setVerifying(true)
    try {
      const res = await api.post<VerifyOtpResponse>('/api/v1/auth/otp/verify', {
        phone: formatPhone(phone),
        otp,
        role: 'driver',
        purpose: 'login',
      })
      const { tokens, principal } = res.data
      setAuth(tokens.accessToken, tokens.refreshToken, principal)
      track('login_success')
      void setupPushNotifications()
      setVerified(true)
      // No navigation here: signing in makes (auth)/_layout redirect to "/", the gate that picks the onboarding wizard,
      // a ride in progress or Home. Navigating again from here opened Home a second time.
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      setError(code ? mapOtpErrorCode(code) : 'Check your connection and try again')
      // Shake with the digits still showing, then clear for the next try.
      setWrong(true)
      if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current)
      wrongTimerRef.current = setTimeout(() => {
        setOtp('')
        setWrong(false)
      }, WRONG_CODE_HOLD_MS)
    } finally {
      setLoading(false)
      setVerifying(false)
      otpVerifyInFlightRef.current = false
    }
  }

  // Six boxes plus gaps must fit the sheet's padded width with a margin on a 360 px phone.
  const boxWidth = Math.min(46, Math.floor((width - spacing.lg * 2 - 24 - 5 * 8) / 6))

  return (
    <View style={styles.container}>
      <AuthHero
        image={loginHeroImage}
        logo={logoMarkImage}
        height={step === 'phone' ? PHONE_HERO : OTP_HERO}
        focus={{ x: 0.46, y: 0.5 }}
        {...(step === 'phone'
          ? { headline: 'Drive with Ocar.', subline: 'Sign in with the number you registered with.' }
          : { onBack: handleEdit })}
      />

      <Animated.View
        entering={FadeIn.duration(320)}
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
      >
        {/* Plain ScrollView: it won't auto-scroll a focused input into view above the keyboard (see the note on PHONE_HERO), but the
            content is always reachable by swiping, and staying top-anchored and compact keeps it above the keyboard in the first place. */}
        <ScrollView
          style={styles.contentGroup}
          contentContainerStyle={styles.contentGroupInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
                <Text style={styles.label}>Mobile number</Text>
                <PhoneField
                  value={phone}
                  onChangeText={(digits) => {
                    if (error) setError('')
                    setPhone(digits)
                  }}
                  locked={loading}
                  autoFocus
                  onSubmitEditing={handlePhoneSubmit}
                />
                <FieldMessage tone={error ? 'error' : 'hint'}>{error || "We'll text you a 6-digit code."}</FieldMessage>
                <Button
                  variant="cta"
                  label="Get code"
                  onPress={handlePhoneSubmit}
                  loading={loading}
                  disabled={phone.length !== 10}
                  flatDisabled
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
                <View>
                  <Text style={styles.title}>Enter the code</Text>
                  <View style={styles.sentRow}>
                    <Text style={styles.subtitle}>
                      Sent to <Text style={styles.subtitleStrong}>+91 {formatPhoneDisplay(phone)}</Text>
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Change phone number" onPress={handleEdit} hitSlop={8} style={styles.edit}>
                      <Feather name="edit-2" size={14} color={h.tealText} />
                      <Text style={styles.editLabel}>Edit</Text>
                    </Pressable>
                  </View>
                </View>
                <OtpBoxInput
                  value={otp}
                  onChangeText={handleOtpChange}
                  error={wrong}
                  success={verified}
                  busy={verifying}
                  autoFocus
                  boxWidth={boxWidth}
                  boxHeight={58}
                  gap={8}
                />
                <OtpStatusLine status={waitStatus} />
                <Button variant="cta" flatDisabled label="Verify" onPress={handleOtpSubmit} loading={verifying} success={verified} disabled={otp.length !== 6 || wrong} />
                {verifying || verified ? (
                  <View style={styles.resendSpacer} />
                ) : (
                  <OtpResendRow seconds={countdown} total={OTP_RESEND_AFTER_SEC} onResend={handleResend} disabled={loading} />
                )}
              </>
            )}
          </Animated.View>
        </ScrollView>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // marginTop pulls the sheet up over the photo's bottom edge: the rounded top corners read as "tucked over" the photo, not a seam.
  sheet: {
    flex: 1,
    marginTop: -28,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg - 4,
    paddingTop: 26,
    boxShadow: '0 -10px 28px rgba(20,23,26,0.07)',
  },
  // Top-anchored, never centred or bottom-anchored: leftover space lands below the button, inside the same white sheet, instead of above
  // it where it would push the button toward the keyboard.
  contentGroup: { flex: 1, width: '100%' },
  contentGroupInner: { flexGrow: 1, width: '100%', justifyContent: 'flex-start' },
  stepContainer: { width: '100%', gap: spacing.sm },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink900, marginBottom: 2 },
  title: { ...typography.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.5, color: colors.ink900 },
  sentRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  subtitle: { ...typography.body, fontSize: 14, lineHeight: 20, color: colors.ink600 },
  subtitleStrong: { fontFamily: fonts.bold, color: colors.ink900 },
  edit: { height: 44, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 5 },
  editLabel: { fontFamily: fonts.bold, fontSize: 14, color: h.tealText },
  resendSpacer: { height: 44 },
  consent: { ...typography.caption, color: h.label, textAlign: 'center', marginTop: spacing.sm },
  consentLink: { color: h.tealText, fontFamily: fonts.bold },
})
