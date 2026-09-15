import { forwardRef } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/tokens'

export type InputProps = TextInputProps & {
  label?: string
  error?: string
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ label, error, style, ...inputProps }, ref) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.ink400}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.label.fontSize,
    fontWeight: typography.label.fontWeight,
    color: colors.ink600,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    fontSize: typography.caption.fontSize,
    color: colors.error,
  },
})
