import { StyleSheet, Text } from 'react-native'
import { Card, colors, spacing, typography } from '@ocar/mobile-shared'

export type CashCollectionBannerProps = {
  amount: string | null
}

// Cash collection itself is a driver-only action (POST /rides/:id/collect-cash requires
// req.driver) -- the backend never emits a confirmation event back to the rider's room
// once collected, so this is a passive "pay the driver" notice, not a confirm button.
export function CashCollectionBanner({ amount }: CashCollectionBannerProps) {
  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.title}>Trip complete</Text>
      <Text style={styles.body}>
        {amount ? `Please pay ₹${amount} in cash to your driver.` : 'Please pay your driver in cash.'}
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, backgroundColor: colors.warningLight },
  title: { ...typography.title, color: colors.ink900 },
  body: { ...typography.body, color: colors.ink600 },
})
