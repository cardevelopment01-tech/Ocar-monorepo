import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

export type PlaceRowProps = {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  address: string
  onPress: () => void
  last?: boolean
}

// One shared row shape for live autocomplete results, recent searches, and
// favourite (saved) places -- all three lists in the redesigned search screen
// render through this, so switching between them never changes row height,
// icon size, or spacing (the exact instability this replaced).
export function PlaceRow({ icon, label, address, onPress, last }: PlaceRowProps) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${address}`}
      >
        <View style={styles.iconWrap}>
          <Feather name={icon} size={15} color={colors.ink600} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          <Text style={styles.address} numberOfLines={1}>{address}</Text>
        </View>
      </Pressable>
      {!last ? <View style={styles.divider} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 4 },
  rowPressed: { opacity: 0.6 },
  iconWrap: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, gap: 1 },
  label: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  address: { ...typography.caption, color: colors.ink400 },
  divider: { marginLeft: 36 + spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight, borderStyle: 'dashed' },
})
