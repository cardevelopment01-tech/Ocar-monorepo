import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, VehicleIcon, colors, spacing, typography } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'

export type CategoryEta = { count: number; etaMin: number }

export type CategoryCardProps = {
  category: VehicleCategory
  fareTotal: number | null
  loading: boolean
  selected: boolean
  onPress: () => void
  // Nearest-driver ETA for this category, from the same nearby-drivers poll
  // the map already runs -- null while unpolled, { count: 0 } once polled with
  // nothing found. Mirrors web's driverEta memo (select-ride/page.tsx).
  eta?: CategoryEta | null
  disabled?: boolean
  // 'returnCab' renders the green "Return Cab" badge + savings line instead of
  // seat count/ETA -- matches web's discounted-return-driver row treatment
  // (apps/user/app/(main)/select-ride/page.tsx).
  variant?: 'standard' | 'returnCab'
  savingsText?: string
}

// Matches the real web app's select-ride row (apps/user/app/(main)/select-ride/page.tsx):
// icon square that tints when active, name + seat count + live ETA, fare on the
// right, a left accent border for the selected state instead of a border+checkmark combo.
export function CategoryCard({
  category, fareTotal, loading, selected, onPress, eta, disabled = false, variant = 'standard', savingsText,
}: CategoryCardProps) {
  const noCars = disabled
  const active = selected && !noCars
  const isReturnCab = variant === 'returnCab'
  return (
    <Pressable
      onPress={onPress}
      disabled={noCars}
      style={({ pressed }) => [
        styles.row,
        active ? (isReturnCab ? styles.rowSelectedReturnCab : styles.rowSelected) : null,
        noCars ? styles.rowDisabled : null,
        pressed && !noCars ? styles.rowPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${category.displayName}${fareTotal != null ? `, fare rupees ${Math.round(fareTotal)}` : ''}`}
      accessibilityState={{ selected: active, disabled: noCars }}
    >
      <View style={[styles.iconWrap, active ? styles.iconWrapSelected : null]}>
        <VehicleIcon slug={category.slug} size={36} />
      </View>

      <View style={styles.info}>
        {isReturnCab ? (
          <View style={styles.returnCabBadgeRow}>
            <Text style={styles.returnCabBadge}>RETURN CAB</Text>
            <Text style={[styles.name, active ? { color: colors.success } : null]}>{category.displayName}</Text>
          </View>
        ) : (
          <Text style={[styles.name, active ? styles.nameSelected : null]}>{category.displayName}</Text>
        )}
        <View style={styles.seatsRow}>
          {isReturnCab ? (
            <Text style={styles.savingsText}>{savingsText}</Text>
          ) : (
            <>
              <Feather name="users" size={10} color={colors.ink400} />
              <Text style={styles.seatsText}>{category.maxPassengers} seats</Text>
              {noCars ? (
                <Text style={styles.noCarsText}>No cars nearby</Text>
              ) : eta && eta.etaMin > 0 ? (
                <View style={styles.etaRow}>
                  <Feather name="clock" size={9} color={active ? colors.primary : colors.success} />
                  <Text style={[styles.etaText, { color: active ? colors.primary : colors.success }]}>{eta.etaMin} min away</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View style={styles.fareBlock}>
        {loading ? (
          <Skeleton width={56} height={20} />
        ) : fareTotal != null ? (
          <Text style={[styles.fare, active ? (isReturnCab ? { color: colors.success } : styles.nameSelected) : null]}>{`₹${Math.round(fareTotal)}`}</Text>
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
  rowSelectedReturnCab: { backgroundColor: colors.successLight, borderLeftColor: colors.success, borderRadius: 12 },
  rowDisabled: { opacity: 0.35 },
  rowPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: {
    width: 64,
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
  returnCabBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  returnCabBadge: {
    ...typography.caption, fontSize: 9, fontWeight: '700', color: colors.success,
    backgroundColor: colors.successLight, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2,
    overflow: 'hidden', letterSpacing: 0.4,
  },
  savingsText: { ...typography.caption, fontWeight: '600', color: colors.success },
  seatsText: { ...typography.caption, color: colors.ink400 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 4 },
  etaText: { ...typography.caption, fontWeight: '600' },
  noCarsText: { ...typography.caption, color: colors.error, fontWeight: '600', marginLeft: 4 },
  fareBlock: { minWidth: 56, alignItems: 'flex-end' },
  fare: { ...typography.title, color: colors.ink900 },
  fareUnavailable: { ...typography.body, color: colors.ink400 },
})
