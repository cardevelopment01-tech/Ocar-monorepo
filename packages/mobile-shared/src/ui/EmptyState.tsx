import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography, fonts } from '../theme/tokens'

export type EmptyStateProps = {
  title: string
  description?: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  title: {
    fontSize: typography.title.fontSize,
    fontFamily: fonts.semibold,
    color: colors.ink900,
  },
  description: {
    fontSize: typography.body.fontSize,
    fontFamily: fonts.regular,
    color: colors.ink600,
    textAlign: 'center',
  },
})
