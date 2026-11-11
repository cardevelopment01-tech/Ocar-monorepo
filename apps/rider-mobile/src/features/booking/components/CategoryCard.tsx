import { memo } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, VehicleIcon, font, h } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'
import { fleetImageFor } from '@/features/home/fleet'

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
  // Set on the selected card when an offer applies: the fare shown is then the payable, with this gross struck through
  // above it and the saving as a line under the name (design review D3).
  grossFare?: number | null
  offerSavingText?: string | null
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Design: docs/designs/ocar-redesign/screens/Vehicles.dc.html. Selected = teal wash + teal border + halo;
// unavailable = greyed image, not selectable.
function CategoryCardBase({
  category, fareTotal, loading, selected, onPress, eta, disabled = false, variant = 'standard', savingsText,
  grossFare = null, offerSavingText = null,
}: CategoryCardProps) {
  const noCars = disabled
  const active = selected && !noCars
  const isReturnCab = variant === 'returnCab'
  const img = fleetImageFor(category.slug)
  const struck = grossFare != null
  return (
    <Pressable
      onPress={onPress}
      disabled={noCars}
      style={({ pressed }) => [styles.row, active ? styles.rowOn : null, pressed && !noCars ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${category.displayName}${fareTotal != null ? (grossFare != null ? `, was ${Math.round(grossFare)} rupees, now ${Math.round(fareTotal)} rupees` : `, fare rupees ${Math.round(fareTotal)}`) : ''}${offerSavingText ? `. ${offerSavingText}` : ''}`}
      accessibilityState={{ selected: active, disabled: noCars }}
    >
      {/* collapsable={false}: the opacity/grayscale of imgOff would otherwise make this wrapper appear and vanish as noCars flips, and Fabric then moves the Image between parents in one mount batch ("child already has a parent" crash on Android). */}
      <View collapsable={false} style={[styles.imgBox, noCars ? styles.imgOff : null]}>
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
        {offerSavingText ? <Text style={styles.offerSaving}>{offerSavingText}</Text> : null}
      </View>

      <View style={styles.fareBlock}>
        {loading ? (
          <Skeleton width={56} height={20} />
        ) : fareTotal != null ? (
          <>
            {struck ? <Text style={styles.old} accessibilityElementsHidden importantForAccessibility="no">{rupees(grossFare!)}</Text> : null}
            <Text style={[styles.fare, noCars ? { color: h.faint } : null]}>{rupees(fareTotal)}</Text>
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
  offerSaving: { fontFamily: font.b, fontSize: 12.5, color: h.tealText, marginTop: 3 },
  fareUnavailable: { fontFamily: font.m, fontSize: 15, color: h.faint },
})

export const CategoryCard = memo(CategoryCardBase)
