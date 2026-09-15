import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/tokens'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string
  variant?: ButtonVariant
  loading?: boolean
}

export function Button({ label, variant = 'primary', loading = false, disabled = false, ...pressableProps }: ButtonProps) {
  const isDisabled = !!disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
      ]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.inkInverse : colors.primary} />
      ) : (
        <Text style={[styles.label, variant === 'primary' ? styles.labelInverse : styles.labelPrimary]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
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
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface3,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
})
