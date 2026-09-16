import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { BackHandler, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, SlideInRight } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { Button, Input, colors, spacing, typography, mapOtpErrorCode } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { setupPushNotifications } from '@/services/notifications'
import { useAuthStore, type UserProfile } from '@/store/useAuthStore'

type Step = 'phone' | 'otp'

interface VerifyOtpResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
  principal: UserProfile
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
  const setAuth = useAuthStore((s) => s.setAuth)

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
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
        role: 'user',
        purpose: 'login',
      })
      if (res.data.otp) setOtp(res.data.otp)
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

  async function handleOtpSubmit() {
    if (otp.length !== 6 || loading || otpVerifyInFlightRef.current) return
    otpVerifyInFlightRef.current = true
    setError('')
    setLoading(true)
    try {
      const res = await api.post<VerifyOtpResponse>('/api/v1/auth/otp/verify', {
        phone: formatPhone(phone),
        otp,
        role: 'user',
        purpose: 'login',
      })
      const { tokens, principal } = res.data
      setAuth(tokens.accessToken, tokens.refreshToken, principal)
      void setupPushNotifications()
      router.replace('/(tabs)/home')
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
      {step === 'phone' ? (
        <Animated.View entering={FadeIn} style={styles.stepContainer}>
          <Text style={styles.title}>Welcome to Ocar</Text>
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
        </Animated.View>
      ) : (
        <Animated.View entering={SlideInRight} style={styles.stepContainer}>
          <Text style={styles.title}>Enter OTP</Text>
          <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>
          <Input
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            placeholder="6-digit code"
            accessibilityLabel="OTP code"
            accessibilityHint="Enter the 6-digit code sent by SMS"
            maxLength={6}
            editable={!loading}
          />
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Verify" onPress={handleOtpSubmit} loading={loading} disabled={otp.length !== 6} />
          <Button
            label={countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
            variant="ghost"
            onPress={handleResend}
            disabled={countdown > 0}
          />
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.bg },
  stepContainer: { gap: spacing.md },
  title: { ...typography.headline, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600 },
  error: { ...typography.label, color: colors.error },
})
