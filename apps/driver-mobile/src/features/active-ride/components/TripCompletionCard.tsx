import { StyleSheet, Text } from 'react-native'
import { Button, Card, colors, formatCurrency, spacing, typography } from '@ocar/mobile-shared'

export type TripCompletionCardProps = {
  fareEarned: number
  onBackToOnline: () => void
}

// Design review's top journey-arc finding: the reward moment (fare earned)
// was previously missing entirely -- drivers snapped straight back to the
// toggle screen with no closure. This card is the fix.
export function TripCompletionCard({ fareEarned, onBackToOnline }: TripCompletionCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Trip complete</Text>
      <Text style={styles.fare}>{formatCurrency(fareEarned)}</Text>
      <Text style={styles.detail}>earned this trip</Text>
      <Button label="Back to online" onPress={onBackToOnline} />
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, alignItems: 'center' },
  title: { ...typography.title, color: colors.ink900 },
  fare: { ...typography.display, color: colors.money },
  detail: { ...typography.body, color: colors.ink600 },
})
