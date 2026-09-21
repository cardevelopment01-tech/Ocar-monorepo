import { StyleSheet, Text } from 'react-native'
import { colors, spacing, typography } from '@ocar/mobile-shared'

// Non-blocking, per the plan's per-screen table -- must never cover or disable the
// OTP/cash-collection UI, so this is a thin strip, not a modal or overlay.
export function ReconnectBanner() {
  return (
    <Text style={styles.banner} accessibilityLiveRegion="polite">
      Reconnecting…
    </Text>
  )
}

const styles = StyleSheet.create({
  banner: {
    ...typography.caption,
    color: colors.ink600,
    backgroundColor: colors.surface3,
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },
})
