import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { buttonRadius, colors, gradientPrimary, shadows, spacing, typography } from '../theme/tokens'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string
  variant?: ButtonVariant
  loading?: boolean
}

export function Button({ label, variant = 'primary', loading = false, disabled = false, ...pressableProps }: ButtonProps) {
  const isDisabled = !!disabled || loading

  const content = loading ? (
    <ActivityIndicator color={variant === 'primary' ? colors.inkInverse : colors.primary} />
  ) : (
    <Text style={[styles.label, variant === 'primary' ? styles.labelInverse : styles.labelPrimary]}>{label}</Text>
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
          colors={isDisabled ? [colors.ink400, colors.ink400] : gradientPrimary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.base, shadows.buttonPrimary]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.base, variantStyles[variant], isDisabled ? styles.disabled : null]}>{content}</View>
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
