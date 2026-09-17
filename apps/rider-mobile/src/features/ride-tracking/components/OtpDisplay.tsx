import { StyleSheet, Text, View } from 'react-native'
import { Card, colors, spacing, typography } from '@ocar/mobile-shared'

export type OtpDisplayProps = {
  label: string
  otp: string | null
}

// This is the one piece of UI a rider reads aloud to a stranger -- large, high-contrast
// text, and no fixed height on the container so it doesn't clip at large Android
// font-scale settings (default allowFontScaling stays on).
export function OtpDisplay({ label, otp }: OtpDisplayProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.otpRow} accessibilityLabel={`${label}: ${otp ? otp.split('').join(' ') : 'unavailable'}`}>
        <Text style={styles.otp} maxFontSizeMultiplier={3}>
          {otp ?? '····'}
        </Text>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: spacing.sm },
  label: { ...typography.label, color: colors.ink600, textTransform: 'uppercase' },
  otpRow: { minHeight: 56, justifyContent: 'center' },
  otp: {
    fontFamily: typography.display.fontFamily,
    fontWeight: typography.display.fontWeight,
    fontSize: 48,
    letterSpacing: 12,
    color: colors.ink900,
  },
})
