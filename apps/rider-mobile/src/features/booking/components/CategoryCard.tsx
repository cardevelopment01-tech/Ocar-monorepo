import { memo } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, VehicleIcon, font, h } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'
import { fleetImageFor } from '@/features/home/fleet'
import { Chip } from '@/components/ui'

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
  // TODO(backend): coupons don't exist yet. When a coupon is applied the parent passes the original fare and the
  // amount saved (both computed by the server); the card only renders them.
  originalFare?: number | null
  couponSaving?: number | null
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Design: docs/designs/ocar-redesign/screens/Vehicles.dc.html. Selected = teal wash + teal border + halo;
// unavailable = greyed image, not selectable.
function CategoryCardBase({
  category, fareTotal, loading, selected, onPress, eta, disabled = false, variant = 'standard', savingsText,
  originalFare, couponSaving,
}: CategoryCardProps) {
  const noCars = disabled
  const active = selected && !noCars
  const isReturnCab = variant === 'returnCab'
  const img = fleetImageFor(category.slug)
  const saved = !!couponSaving && couponSaving > 0
  return (
    <Pressable
      onPress={onPress}
      disabled={noCars}
      style={({ pressed }) => [styles.row, active ? styles.rowOn : null, pressed && !noCars ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${category.displayName}${fareTotal != null ? `, fare rupees ${Math.round(fareTotal)}` : ''}`}
      accessibilityState={{ selected: active, disabled: noCars }}
    >
      <View style={[styles.imgBox, noCars ? styles.imgOff : null]}>
        {img ? (
          <Image source={img} style={styles.vehicleImg} resizeMode="contain" accessibilityIgnoresInvertColors />
        ) : (
          <VehicleIcon slug={category.slug} size={44} />
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{category.displayName}</Text>
          {isReturnCab ? (
            <View style={styles.rcBadge}><Text style={styles.rcBadgeText}>Return cab</Text></View>
          ) : (
            <View style={styles.seats}>
              <Feather name="user" size={12} color={h.muted} />
              <Text style={styles.seatsText}>{category.maxPassengers}</Text>
            </View>
          )}
        </View>
        {isReturnCab ? (
          <Text style={[styles.sub, { color: h.live }]}>{savingsText}</Text>
        ) : noCars ? (
          <Text style={[styles.sub, { color: h.label }]}>No cars nearby right now</Text>
        ) : eta && eta.etaMin > 0 ? (
          <Text style={[styles.sub, { color: h.tealText }]}>{eta.etaMin} min away</Text>
        ) : null}
      </View>

      <View style={styles.fareBlock}>
        {loading ? (
          <Skeleton width={56} height={20} />
        ) : fareTotal != null ? (
          <>
            {saved && originalFare != null ? <Text style={styles.old}>{rupees(originalFare)}</Text> : null}
            <Text style={[styles.fare, noCars ? { color: h.faint } : null]}>{rupees(fareTotal)}</Text>
            {saved ? <View style={styles.saveChip}><Chip label={`Save ${rupees(couponSaving!)}`} tone="teal" /></View> : null}
          </>
        ) : (
          <Text style={styles.fareUnavailable}>-</Text>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 10,
    paddingRight: 16,
    backgroundColor: h.surface,
    borderWidth: 1.5,
    borderColor: h.line08,
    borderRadius: 20,
    marginBottom: 12,
    boxShadow: '0 2px 8px rgba(20,23,26,0.05)',
  },
  rowOn: { backgroundColor: '#F3FAFB', borderColor: h.tealCta, boxShadow: '0 0 0 4px rgba(14,143,163,0.10), 0 2px 8px rgba(20,23,26,0.06)' },
  rowPressed: { transform: [{ scale: 0.985 }] },
  imgBox: { width: 96, height: 60, alignItems: 'center', justifyContent: 'center' },
  imgOff: { opacity: 0.45, filter: [{ grayscale: 1 }] },
  vehicleImg: { width: 96, height: 60 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  name: { fontFamily: font.b, fontSize: 16, color: h.ivory, flexShrink: 1 },
  seats: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  seatsText: { fontFamily: font.sb, fontSize: 12, color: h.muted, fontVariant: ['tabular-nums'] },
  rcBadge: { backgroundColor: '#DDF5EA', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rcBadgeText: { fontFamily: font.sb, fontSize: 11.5, color: h.live },
  sub: { fontFamily: font.sb, fontSize: 12.5 },
  fareBlock: { minWidth: 56, alignItems: 'flex-end' },
  old: { fontFamily: font.r, fontSize: 12, color: h.faint, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'], marginBottom: 1 },
  fare: { fontFamily: font.xb, fontSize: 17, letterSpacing: -0.2, color: h.ivory, fontVariant: ['tabular-nums'] },
  saveChip: { marginTop: 5 },
  fareUnavailable: { fontFamily: font.m, fontSize: 15, color: h.faint },
})

export const CategoryCard = memo(CategoryCardBase)
