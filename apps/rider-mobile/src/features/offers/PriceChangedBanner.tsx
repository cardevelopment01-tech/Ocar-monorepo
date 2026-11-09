import { useEffect, useRef } from 'react'
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'

// Shown above the footer when the server answers 409 PRICE_CHANGED (design review D8): old price -> new price and why,
// announced assertively and given screen-reader focus. It is an inline banner, never a toast (a toast disappears before it
// is read) and never auto-books: the rider taps Book again on the new price.
export function PriceChangedBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const ref = useRef<View>(null)
  useEffect(() => {
    const node = ref.current ? findNodeHandle(ref.current) : null
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }, [message])
  return (
    <View ref={ref} style={styles.box} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={message}>
      <Feather name="alert-triangle" size={16} color={colors.ink900} />
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.dismiss} onPress={onDismiss} hitSlop={6} accessibilityRole="button" accessibilityLabel="Dismiss price update">
        <Text style={styles.dismissText}>Dismiss</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warningLight,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  text: { ...typography.body, flex: 1, fontFamily: fonts.semibold, color: colors.ink900 },
  dismiss: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { ...typography.body, fontFamily: fonts.bold, color: colors.primaryDark },
})
