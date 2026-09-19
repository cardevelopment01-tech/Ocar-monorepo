import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography } from '../theme/tokens'
import type { SOSTriggerResult } from '../api/types'

export type { SOSTriggerResult } from '../api/types'

export type SOSButtonProps = {
  enabled: boolean
  onTrigger: () => Promise<SOSTriggerResult>
  emergencyPhoneNumber?: string | null
}

type FailureState = null | { reason: 'rate_limited' | 'error' }

const SUCCESS_PILL_MS = 2000

export function SOSButton({ enabled, onTrigger, emergencyPhoneNumber }: SOSButtonProps) {
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<FailureState>(null)
  const [canCall, setCanCall] = useState(false)
  const [sent, setSent] = useState(false)
  const pulse = useSharedValue(1)
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }))
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  if (!enabled) return null

  function stopPulse() {
    pulse.value = withTiming(1, { duration: 200 })
  }

  function showSentBriefly() {
    setSent(true)
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    successTimerRef.current = setTimeout(() => setSent(false), SUCCESS_PILL_MS)
  }

  async function handlePress() {
    setSending(true)
    setFailure(null)
    setSent(false)
    const first = await onTrigger()
    if (first.ok) {
      setSending(false)
      stopPulse()
      showSentBriefly()
      return
    }
    if (first.reason === 'rate_limited') {
      setSending(false)
      stopPulse()
      setFailure({ reason: 'rate_limited' })
      return
    }
    // One automatic retry, only for a plain error -- never for rate_limited.
    const retry = await onTrigger()
    setSending(false)
    stopPulse()
    if (retry.ok) {
      showSentBriefly()
      return
    }
    setFailure({ reason: retry.reason })
    if (emergencyPhoneNumber) {
      Linking.canOpenURL(`tel:${emergencyPhoneNumber}`).then(setCanCall)
    }
  }

  function handleCall() {
    if (emergencyPhoneNumber) Linking.openURL(`tel:${emergencyPhoneNumber}`)
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={pulseStyle}>
        <Pressable
          onPress={handlePress}
          disabled={sending}
          hitSlop={8}
          accessible
          accessibilityLabel="Emergency SOS, double tap to send alert"
          accessibilityRole="button"
          style={({ pressed }) => [styles.circle, pressed ? styles.pressed : null]}
          onPressIn={() => {
            pulse.value = withRepeat(withSequence(withTiming(1.02, { duration: 1500 }), withTiming(1, { duration: 1500 })), -1, true)
          }}
        >
          {sending ? <ActivityIndicator color={colors.inkInverse} testID="sos-sending-indicator" /> : <Text style={styles.icon}>SOS</Text>}
        </Pressable>
      </Animated.View>

      {sent ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.successPill}>
          <Text style={styles.successText}>Alert sent</Text>
        </Animated.View>
      ) : null}

      {failure ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.failurePill}>
          <Text style={styles.failureText}>
            {failure.reason === 'rate_limited' ? 'Too many alerts sent. Contact support if this is urgent.' : 'SOS not sent — tap to retry'}
          </Text>
          {failure.reason === 'error' ? (
            <Pressable onPress={handlePress} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      {failure?.reason === 'error' && emergencyPhoneNumber && canCall ? (
        <Pressable onPress={handleCall} style={[styles.callPill, !canCall ? styles.callPillFull : null]}>
          <Text style={styles.callText}>Call emergency contact</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: spacing.xl, right: spacing.md, zIndex: 10, alignItems: 'flex-end', gap: spacing.xs },
  circle: {
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.buttonPrimary,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  icon: { ...typography.label, color: colors.inkInverse, fontWeight: '700' },
  failurePill: {
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 220,
  },
  failureText: { ...typography.caption, color: colors.error, flexShrink: 1 },
  successPill: {
    backgroundColor: colors.successLight,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    maxWidth: 220,
  },
  successText: { ...typography.caption, color: colors.success },
  retryText: { ...typography.label, color: colors.error, fontWeight: '700' },
  callPill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
  },
  callPillFull: { alignSelf: 'stretch' },
  callText: { ...typography.label, color: colors.ink900 },
})
