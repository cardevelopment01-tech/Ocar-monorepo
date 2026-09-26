import { StyleSheet, Text, View } from 'react-native'
import { colors, fonts, spacing, typography } from '../theme/tokens'
import { Button } from './Button'

export type ErrorStateProps = {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  message: {
    fontSize: typography.body.fontSize,
    fontFamily: fonts.regular,
    color: colors.ink600,
    textAlign: 'center',
  },
})
