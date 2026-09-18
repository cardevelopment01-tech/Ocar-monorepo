import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons, Feather } from '@expo/vector-icons'
import { Skeleton, colors, spacing, typography } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'

export type CategoryCardProps = {
  category: VehicleCategory
  fareTotal: number | null
  loading: boolean
  selected: boolean
  onPress: () => void
}

// Matches the real web app's select-ride row (apps/user/app/(main)/select-ride/page.tsx):
// icon square that tints when active, name + seat count, fare on the right, a left
// accent border for the selected state instead of a border+checkmark combo.
export function CategoryCard({ category, fareTotal, loading, selected, onPress }: CategoryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected ? styles.rowSelected : null, pressed ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${category.displayName}${fareTotal != null ? `, fare rupees ${Math.round(fareTotal)}` : ''}`}
      accessibilityState={{ selected }}
    >
      <View style={[styles.iconWrap, selected ? styles.iconWrapSelected : null]}>
        <Ionicons name="car-outline" size={26} color={selected ? colors.primary : colors.ink600} />
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, selected ? styles.nameSelected : null]}>{category.displayName}</Text>
        <View style={styles.seatsRow}>
          <Feather name="users" size={10} color={colors.ink400} />
          <Text style={styles.seatsText}>{category.maxPassengers} seats</Text>
        </View>
      </View>

      <View style={styles.fareBlock}>
        {loading ? (
          <Skeleton width={56} height={20} />
        ) : fareTotal != null ? (
          <Text style={[styles.fare, selected ? styles.nameSelected : null]}>{`₹${Math.round(fareTotal)}`}</Text>
        ) : (
          <Text style={styles.fareUnavailable}>—</Text>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    marginBottom: spacing.xs,
  },
  rowSelected: { backgroundColor: colors.primarySubtle, borderLeftColor: colors.primary, borderRadius: 12 },
  rowPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSelected: { backgroundColor: colors.surface },
  info: { flex: 1, gap: 2 },
  name: { ...typography.title, color: colors.ink900 },
  nameSelected: { color: colors.primaryDark },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  seatsText: { ...typography.caption, color: colors.ink400 },
  fareBlock: { minWidth: 56, alignItems: 'flex-end' },
  fare: { ...typography.title, color: colors.ink900 },
  fareUnavailable: { ...typography.body, color: colors.ink400 },
})
