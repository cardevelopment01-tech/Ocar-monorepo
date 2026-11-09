import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h, shadow } from '@ocar/mobile-shared'

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
          <Feather name={a.icon} size={19} color={a.destructive ? h.danger : h.tealText} />
          <Text style={[styles.label, a.destructive && styles.labelDestructive]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, flexDirection: 'row', overflow: 'hidden', boxShadow: shadow.sm },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16, minHeight: 64 },
  divider: { borderRightWidth: 1, borderRightColor: h.line07 },
  pressed: { backgroundColor: '#F4F8F8' },
  label: { fontFamily: font.sb, fontSize: 12, color: h.ivory },
  labelDestructive: { color: h.danger },
})
