import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button, OtpBoxInput, colors, spacing, typography } from '@ocar/mobile-shared'

export type OtpEntryCardProps = {
  title: string
  submitLabel: string
  loading: boolean
  error: string | null
  onSubmit: (otp: string) => void
}

// 4-digit ride OTP entry -- matches CLAUDE.md's ride-OTP convention (SHA-256
// hashed server-side, 4 digits, distinct from the 6-digit login OTP).
// Uses the same OtpBoxInput as login (digit boxes, SMS-autofill hint,
// pop/shake feedback) instead of a plain text field with a "0000"
// placeholder -- this is the same "read a code off your screen" moment as
// login, it should not look like a lesser version of it.
export function OtpEntryCard({ title, submitLabel, loading, error, onSubmit }: OtpEntryCardProps) {
  const [otp, setOtp] = useState('')

  // Auto-submit the instant all 4 digits land, matching login's OTP step --
  // a driver mid-handover with the rider shouldn't also need to tap Verify.
  useEffect(() => {
    if (otp.length === 4) onSubmit(otp)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only otp reaching 4 digits should trigger this
  }, [otp])

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <OtpBoxInput
        length={4}
        value={otp}
        onChangeText={setOtp}
        error={!!error}
        autoFocus
        editable={!loading}
        accessibilityLabel={title}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={submitLabel}
        loading={loading}
        disabled={otp.length !== 4 || loading}
        onPress={() => onSubmit(otp)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { ...typography.title, color: colors.ink900 },
  error: { ...typography.label, color: colors.error },
})
