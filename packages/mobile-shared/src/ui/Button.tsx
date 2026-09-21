import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { buttonRadius, colors, gradientPrimary, shadows, spacing, typography } from '../theme/tokens'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

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
}

export function Button({ label, variant = 'primary', loading = false, success = false, icon, disabled = false, ...pressableProps }: ButtonProps) {
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
          colors={looksDisabled ? [colors.ink400, colors.ink400] : gradientPrimary}
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
  pressed: { transform: [{ scale: 0.97 }] },
  base: {
    borderRadius: buttonRadius,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: typography.body.fontSize,
    fontWeight: typography.title.fontWeight,
  },
  labelInverse: {
    color: colors.inkInverse,
  },
  labelPrimary: {
    color: colors.primary,
  },
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
