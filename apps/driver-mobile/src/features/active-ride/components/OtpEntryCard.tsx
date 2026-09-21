import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button, OtpBoxInput, colors, radii, spacing, typography } from '@ocar/mobile-shared'

export type OtpEntryCardProps = {
  title: string
  subtitle?: string
  submitLabel: string
  loading: boolean
  error: string | null
  onSubmit: (otp: string) => void | Promise<void>
}

// 4-digit ride OTP entry -- matches CLAUDE.md's ride-OTP convention (SHA-256
// hashed server-side, 4 digits, distinct from the 6-digit login OTP).
// Uses the same OtpBoxInput as login (digit boxes, SMS-autofill hint,
// pop/shake feedback) instead of a plain text field with a "0000"
// placeholder -- this is the same "read a code off your screen" moment as
// login, it should not look like a lesser version of it.
//
// Manual submit only -- this used to auto-submit the instant the 4th digit
// landed. Combined with a real bug (this component wasn't remounting between
// the start-OTP and end-OTP screens -- see the parent's `key` comment), that
// meant the *previous* OTP's leftover digits auto-fired an end-trip
// verification the instant the end-OTP card appeared, using a code the rider
// never even gave for that step. A manual "tap to verify" step means a stale
// value can never silently submit itself, and it matches how Uber/Ola's own
// driver apps treat this exact screen -- confirming pickup/drop-off is a
// deliberate act, not a side effect of typing.
export function OtpEntryCard({ title, subtitle, submitLabel, loading, error, onSubmit }: OtpEntryCardProps) {
  const [otp, setOtp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const busy = loading || submitting
  const canSubmit = otp.length === 4 && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit(otp)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {otp.length === 4 && !busy ? (
          <View style={styles.readyPill}>
            <Text style={styles.readyPillText}>Ready to verify</Text>
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <OtpBoxInput
        length={4}
        value={otp}
        onChangeText={setOtp}
        error={!!error}
        autoFocus
        editable={!busy}
        accessibilityLabel={title}
        // Bigger and bolder than login's 6-digit boxes -- this is the one
        // number that matters at pickup/drop-off, matching Uber/Ola's own
        // large PIN-entry treatment for this exact moment, not a shrunk-down
        // reuse of the login row.
        boxWidth={64}
        boxHeight={76}
        digitFontSize={30}
        gap={14}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={submitting ? 'Verifying…' : submitLabel}
        loading={busy}
        disabled={!canSubmit}
        onPress={() => void handleSubmit()}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.title, color: colors.ink900 },
  readyPill: { backgroundColor: colors.successLight, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  readyPillText: { ...typography.caption, fontSize: 11, color: colors.success, fontWeight: '700' },
  subtitle: { ...typography.body, color: colors.ink600, marginTop: -spacing.xs },
  error: { ...typography.label, color: colors.error },
})
