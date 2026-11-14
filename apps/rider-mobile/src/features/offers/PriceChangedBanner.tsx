import { useEffect, useRef } from 'react'
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'

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
      <Feather name="alert-triangle" size={16} color={h.ivory} />
      <Text style={styles.text}>{message}</Text>
      <Pressable style={styles.dismiss} onPress={onDismiss} hitSlop={6} accessibilityRole="button" accessibilityLabel="Dismiss price update">
        <Text style={styles.dismissText}>Dismiss</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: h.goldWash,
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8,
  },
  text: { fontSize: 14.5, lineHeight: 21, flex: 1, fontFamily: font.sb, color: h.ivory },
  dismiss: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 14.5, lineHeight: 21, fontFamily: font.b, color: h.tealText },
})
