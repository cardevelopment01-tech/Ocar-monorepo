import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { h } from '../theme/brand'
import { buttonRadius, colors, fonts, gradientPrimary, shadows, spacing } from '../theme/tokens'

// 'cta' / 'soft' are the rider redesign's 56px / 50px buttons (18 / 16 radius); the others are unchanged.
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'cta' | 'soft'

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string
  variant?: ButtonVariant
  loading?: boolean
  // Momentary post-success state (e.g. OTP verified) -- crossfades in a
  // checkmark instead of the label, then the caller swaps screens shortly
  // after. Distinct from `loading` since both can never be true together.
  success?: boolean
  // Leading icon (e.g. camera, refresh-cw) -- several onboarding CTAs pair
  // one with the label; hidden automatically during loading/success since
  // those already have their own icon (spinner / checkmark).
  icon?: React.ComponentProps<typeof Feather>['name']
  // 'cta' only: the price before an offer, shown struck through after the label ("Book Sedan · ₹600 ₹750").
  strikeLabel?: string
}

export function Button({ label, variant = 'primary', loading = false, success = false, icon, strikeLabel, disabled = false, ...pressableProps }: ButtonProps) {
  const isDisabled = !!disabled || loading || success
  // Loading/success still read as "the brand button, mid-action" -- only an
  // explicit `disabled` prop should gray the gradient out.
  const looksDisabled = !!disabled && !loading && !success
  const iconColor = variant === 'primary' ? colors.inkInverse : colors.primary

  const content = success ? (
    <Animated.View key="success" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.row}>
      <Feather name="check" size={18} color={iconColor} />
      <Text style={[styles.label, variant === 'primary' ? styles.labelInverse : styles.labelPrimary]}>Verified</Text>
    </Animated.View>
  ) : loading ? (
    <Animated.View key="loading" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
      <ActivityIndicator color={iconColor} />
    </Animated.View>
  ) : (
    <Animated.View key="idle" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={icon ? styles.row : null}>
      {icon ? <Feather name={icon} size={16} color={iconColor} /> : null}
      <Text style={[styles.label, variant === 'primary' ? styles.labelInverse : styles.labelPrimary]}>{label}</Text>
    </Animated.View>
  )

  if (variant === 'cta' || variant === 'soft') {
    const cta = variant === 'cta'
    const dim = !!disabled && !loading && !success
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        style={({ pressed }) => [
          cta ? styles.cta : styles.soft,
          { backgroundColor: cta ? h.tealCta : h.tealWash },
          cta && !dim ? { boxShadow: '0 12px 24px rgba(14,143,163,0.30)' } : null,
          dim ? styles.disabled : null,
          pressed && !isDisabled ? styles.pressed : null,
        ]}
        {...pressableProps}
      >
        {loading ? <ActivityIndicator color={cta ? '#fff' : h.tealText} /> : (
          <View style={styles.row}>
            {icon ? <Feather name={icon} size={17} color={cta ? '#fff' : h.tealText} /> : null}
            <Text style={[styles.ctaLabel, { color: cta ? '#fff' : h.tealText }]}>{label}</Text>
            {strikeLabel ? <Text style={styles.ctaStrike}>{strikeLabel}</Text> : null}
          </View>
        )}
      </Pressable>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [styles.pressWrapper, pressed && !isDisabled ? styles.pressed : null]}
      {...pressableProps}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={looksDisabled ? (['#86C7D2', '#86C7D2']) : gradientPrimary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.base, shadows.buttonPrimary]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.base, variantStyles[variant], looksDisabled ? styles.disabled : null]}>{content}</View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressWrapper: { borderRadius: buttonRadius },
  pressed: { transform: [{ scale: 0.98 }] },
  base: {
    borderRadius: buttonRadius,
    // CTAs match the home screen's 16px-padding buttons (both apps)
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 14.5,
    fontFamily: fonts.bold,
  },
  labelInverse: {
    color: colors.inkInverse,
  },
  labelPrimary: {
    color: colors.primary,
  },
  cta: { height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  soft: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  ctaLabel: { fontSize: 16, fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  ctaStrike: { fontSize: 13.5, fontFamily: fonts.semibold, color: 'rgba(255,255,255,0.62)', textDecorationLine: 'line-through', marginLeft: 4, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
})

const variantStyles = StyleSheet.create({
  secondary: {
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
})
