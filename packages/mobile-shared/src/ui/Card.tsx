import { StyleSheet, View, type ViewProps } from 'react-native'
import { colors, spacing } from '../theme/tokens'

export function Card({ style, ...viewProps }: ViewProps) {
  return <View style={[styles.card, style]} {...viewProps} />
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
})
