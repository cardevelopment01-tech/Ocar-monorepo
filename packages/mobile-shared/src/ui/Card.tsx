import { StyleSheet, View, type ViewProps } from 'react-native'
import { colors, radii, shadows, spacing } from '../theme/tokens'

export function Card({ style, ...viewProps }: ViewProps) {
  return <View style={[styles.card, style]} {...viewProps} />
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...shadows.card,
  },
})
