import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography } from '../theme/tokens'

export type SOSTriggerResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'error' }

export type SOSButtonProps = {
  enabled: boolean
  onTrigger: () => Promise<SOSTriggerResult>
  emergencyPhoneNumber?: string | null
}

type FailureState = null | { reason: 'rate_limited' | 'error' }

export function SOSButton({ enabled, onTrigger, emergencyPhoneNumber }: SOSButtonProps) {
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<FailureState>(null)
  const [canCall, setCanCall] = useState(false)
  const pulse = useSharedValue(1)

  if (!enabled) return null

  async function handlePress() {
    setSending(true)
    setFailure(null)
    const first = await onTrigger()
    if (first.ok) {
      setSending(false)
      return
    }
    if (first.reason === 'rate_limited') {
      setSending(false)
      setFailure({ reason: 'rate_limited' })
      return
    }
    // One automatic retry, only for a plain error -- never for rate_limited.
    const retry = await onTrigger()
    setSending(false)
    if (retry.ok) return
    setFailure({ reason: retry.reason })
    if (emergencyPhoneNumber) {
      Linking.canOpenURL(`tel:${emergencyPhoneNumber}`).then(setCanCall)
    }
  }

  function handleCall() {
    if (emergencyPhoneNumber) Linking.openURL(`tel:${emergencyPhoneNumber}`)
  }

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }))

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
          <Text style={styles.icon}>SOS</Text>
        </Pressable>
      </Animated.View>

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
