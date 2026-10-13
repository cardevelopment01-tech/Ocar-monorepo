import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts } from '../theme/tokens'

type Props = {
  count: number
  onPress: () => void
  /** The button's own look (size, background, border) -- each screen keeps its existing style. */
  style?: StyleProp<ViewStyle>
  iconSize?: number
  iconColor?: string
}

export function NotificationBell({ count, onPress, style, iconSize = 16, iconColor = colors.ink600 }: Props) {
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications'
  return (
    <Pressable onPress={onPress} style={[styles.base, style]} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Feather name="bell" size={iconSize} color={iconColor} />
      {count > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.inkInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12, fontFamily: fonts.bold, color: colors.inkInverse },
})
