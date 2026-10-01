import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, shadows } from '@ocar/mobile-shared'
import { card } from '@/theme/homeTokens'

export type RideAction = {
  key: string
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  onPress: () => void
  destructive?: boolean
}

/** Action strip under the driver card (Uber's Share / Safety / Cancel row): icon over label, equal tiles
 *  in one card with hairline dividers, the same shape as the home screen's trip-type launcher. */
export function RideActions({ actions }: { actions: RideAction[] }) {
  if (actions.length === 0) return null
  return (
    <View style={styles.card}>
      {actions.map((a, i) => (
        <Pressable
          key={a.key}
          onPress={a.onPress}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={({ pressed }) => [styles.tile, i < actions.length - 1 && styles.divider, pressed && styles.pressed]}
        >
          <Feather name={a.icon} size={19} color={a.destructive ? colors.error : colors.primary} />
          <Text style={[styles.label, a.destructive && styles.labelDestructive]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { ...card, flexDirection: 'row', overflow: 'hidden', ...shadows.card },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 18 },
  divider: { borderRightWidth: 1, borderRightColor: 'rgba(20,23,26,0.06)' },
  pressed: { backgroundColor: 'rgba(20,23,26,0.04)' },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink900 },
  labelDestructive: { color: colors.error },
})
