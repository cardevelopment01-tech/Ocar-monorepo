import { forwardRef } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { colors, fonts, spacing, typography } from '../theme/tokens'

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
        selectionColor={colors.primary}
        cursorColor={colors.primary}
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
    fontFamily: fonts.medium,
    color: colors.ink600,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    fontFamily: fonts.regular,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    fontSize: typography.caption.fontSize,
    fontFamily: fonts.regular,
    color: colors.error,
  },
})
