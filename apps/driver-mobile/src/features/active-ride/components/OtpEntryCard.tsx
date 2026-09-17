import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Button, Card, Input, colors, spacing, typography } from '@ocar/mobile-shared'

export type OtpEntryCardProps = {
  title: string
  submitLabel: string
  loading: boolean
  error: string | null
  onSubmit: (otp: string) => void
}

// 4-digit ride OTP entry -- matches CLAUDE.md's ride-OTP convention (SHA-256
// hashed server-side, 4 digits, distinct from the 6-digit login OTP).
export function OtpEntryCard({ title, submitLabel, loading, error, onSubmit }: OtpEntryCardProps) {
  const [otp, setOtp] = useState('')

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Input
        value={otp}
        onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="0000"
        accessibilityLabel={title}
        {...(error ? { error } : {})}
      />
      <Button
        label={submitLabel}
        loading={loading}
        disabled={otp.length !== 4 || loading}
        onPress={() => onSubmit(otp)}
      />
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { ...typography.title, color: colors.ink900 },
})
