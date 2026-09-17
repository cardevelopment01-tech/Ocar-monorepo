import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'

export type CategoryCardProps = {
  category: VehicleCategory
  fareTotal: number | null
  loading: boolean
  selected: boolean
  onPress: () => void
}

// Selected state uses a visible border + checkmark (not color alone -- the
// plan's Design-phase note flags color-only selection as a contrast/colorblind
// concern), matching DESIGN.md's `card` token look with a `chip-active`-style
// treatment layered on top when selected.
export function CategoryCard({ category, fareTotal, loading, selected, onPress }: CategoryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.displayName}${fareTotal != null ? `, fare rupees ${Math.round(fareTotal)}` : ''}`}
      accessibilityState={{ selected }}
    >
      <Card style={[styles.card, selected ? styles.cardSelected : null]}>
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{category.displayName}</Text>
          </View>
          <View style={styles.fareBlock}>
            {loading ? (
              <Skeleton width={56} height={20} />
            ) : fareTotal != null ? (
              <Text style={styles.fare}>{`₹${Math.round(fareTotal)}`}</Text>
            ) : (
              <Text style={styles.fareUnavailable}>—</Text>
            )}
          </View>
          {selected ? (
            <View style={styles.checkmark} accessibilityElementsHidden>
              <Text style={styles.checkmarkText}>✓</Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderColor: 'transparent', marginBottom: spacing.sm },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  info: { flex: 1 },
  name: { ...typography.title, color: colors.ink900 },
  fareBlock: { minWidth: 56, alignItems: 'flex-end' },
  fare: { ...typography.title, color: colors.ink900 },
  fareUnavailable: { ...typography.body, color: colors.ink400 },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: { color: colors.inkInverse, fontSize: 13, fontWeight: '700' },
})
