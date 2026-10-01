import type { ReactNode } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather, FontAwesome } from '@expo/vector-icons'
import { colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { driverIdentity, type DriverIdentityView } from '@ocar/shared'
import type { RideDetail } from '@ocar/mobile-shared'

// Every place a rider sees their driver (live ride, chat, rate, history) renders through this file,
// so the identity reads identically everywhere: photo + rating chip, name, trips, verified,
// "Colour Brand Model", number plate. Facts/rules live in @ocar/shared and are shared with the web app.

export function driverViewFromRide(ride: RideDetail | null): DriverIdentityView {
  return driverIdentity({
    name: ride?.driverName ?? null,
    rating: ride?.driverRating ?? null,
    totalTrips: ride?.driverTotalTrips ?? null,
    verified: ride?.driverVerified ?? null,
    vehicleColor: ride?.vehicleColor ?? null,
    vehicleBrand: ride?.vehicleBrand ?? null,
    vehicleModel: ride?.vehicleModel ?? null,
    vehicleName: ride?.vehicleName ?? null,
    plate: ride?.vehicleNumberPlate ?? null,
  })
}

// History rows only know the driver's name; same avatar treatment, no vehicle facts.
export function driverViewFromName(name: string | null): DriverIdentityView {
  return driverIdentity({ name, rating: null, totalTrips: null, verified: null, vehicleColor: null, vehicleBrand: null, vehicleModel: null, vehicleName: null, plate: null })
}

const AVATAR = { lg: 68, md: 44, sm: 28 } as const

export function DriverAvatar({ view, photo, size = 'md', chip = false }: {
  view: DriverIdentityView; photo: string | null; size?: keyof typeof AVATAR; chip?: boolean
}) {
  const px = AVATAR[size]
  const box = { width: px, height: px, borderRadius: size === 'lg' ? 20 : size === 'md' ? 14 : 9 }
  return (
    <View style={[styles.avatarWrap, chip && { paddingBottom: 8 }]}>
      {photo ? (
        <Image source={{ uri: photo }} style={[styles.avatar, box]} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback, box]}>
          <Text style={[styles.avatarInitials, { fontSize: Math.round(px * 0.34) }]}>{view.initials}</Text>
        </View>
      )}
      {chip ? (
        <View style={styles.chip} accessibilityLabel={view.ratingText ? `Rated ${view.ratingText}` : 'New driver'}>
          {view.ratingText ? <FontAwesome name="star" size={10} color={colors.accent} /> : null}
          <Text style={styles.chipText}>{view.ratingText ?? 'New'}</Text>
        </View>
      ) : null}
    </View>
  )
}

export function PlateBadge({ plate }: { plate: string | null }) {
  if (!plate) return null
  return (
    <View style={styles.plate} accessibilityLabel={`Number plate ${plate}`}>
      <Text style={styles.plateText} numberOfLines={1}>{plate}</Text>
    </View>
  )
}

export function VehicleLine({ view }: { view: DriverIdentityView }) {
  return (
    <View style={styles.vehicle}>
      {view.swatch ? <View style={[styles.swatch, { backgroundColor: view.swatch }]} /> : null}
      <Text style={styles.vehicleText} numberOfLines={1}>{view.vehicleLine}</Text>
    </View>
  )
}

// Compact identity for chat header / rate: avatar, name, "★ 4.9 · 1,240 trips", vehicle + plate.
export function DriverRow({ view, photo, right }: { view: DriverIdentityView; photo: string | null; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <DriverAvatar view={view} photo={photo} size="md" />
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{view.name}</Text>
        <View style={styles.rowMeta}>
          {view.ratingText ? <><FontAwesome name="star" size={10} color={colors.accent} /><Text style={styles.rowMetaStrong}>{view.ratingText}</Text><Text style={styles.rowMetaText}>·</Text></> : null}
          <Text style={styles.rowMetaText} numberOfLines={1}>{view.tripsText}</Text>
        </View>
        <View style={styles.rowMeta}>
          {view.swatch ? <View style={[styles.swatchSm, { backgroundColor: view.swatch }]} /> : null}
          <Text style={[styles.rowMetaText, { flexShrink: 1 }]} numberOfLines={1}>{view.vehicleLine}{view.plate ? ` · ${view.plate}` : ''}</Text>
        </View>
      </View>
      {right}
    </View>
  )
}

// Rapido's "Start your order with PIN [9][2][6][5]" / Uber's "Share PIN" band: the one thing a rider
// reads aloud to a stranger at the car window. Thin single-line band -- only rendered once the driver
// has actually arrived (see ride/[id]/index.tsx), so it never sits around on "Generating..." for the
// whole en-route leg, and doesn't need its own explanatory hint line at that point in the flow.
export function PinBand({ otp, phase }: { otp: string | null; phase: 'start' | 'end' }) {
  const title = phase === 'start' ? 'Share PIN to start' : 'Share PIN to end'
  return (
    <View style={styles.pin} accessibilityLabel={otp ? `${title}: ${otp.split('').join(' ')}` : title}>
      <Text style={styles.pinTitle}>{title}</Text>
      {otp ? (
        <View style={styles.pinBoxes}>
          {otp.split('').map((d, i) => (
            <View key={i} style={styles.pinBox}><Text style={styles.pinDigit} maxFontSizeMultiplier={1.4}>{d}</Text></View>
          ))}
        </View>
      ) : (
        <Text style={styles.pinGenerating}>Generating…</Text>
      )}
    </View>
  )
}

// Uber/Rapido "Meet at <pickup>" + Get directions.
export function MeetAtRow({ address, lat, lng }: { address: string | null; lat: number | null; lng: number | null }) {
  if (!address) return null
  const url = lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null
  return (
    <View style={styles.meet}>
      <Feather name="map-pin" size={16} color={colors.primary} />
      <View style={styles.meetText}>
        <Text style={styles.meetLabel}>Meet at</Text>
        <Text style={styles.meetAddress} numberOfLines={1}>{address}</Text>
      </View>
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel="Get directions to pickup" style={styles.directions} hitSlop={8}>
          <Feather name="navigation" size={13} color={colors.primary} />
          <Text style={styles.directionsText}>Directions</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  avatarWrap: { alignItems: 'center', flexShrink: 0 },
  avatar: { borderWidth: 2, borderColor: colors.surface },
  avatarFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontFamily: fonts.bold, color: colors.primary },
  chip: { position: 'absolute', bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink900 },
  plate: { flexShrink: 0, borderWidth: 2, borderColor: colors.ink900, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.surface },
  plateText: { fontFamily: fonts.bold, fontSize: 14, letterSpacing: 1.6, color: colors.ink900 },
  vehicle: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.ink400 },
  swatchSm: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: colors.ink400 },
  vehicleText: { ...typography.label, color: colors.ink900, flexShrink: 1 },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowInfo: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { ...typography.label, fontSize: 15, fontFamily: fonts.bold, color: colors.ink900 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMetaStrong: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink600 },
  rowMetaText: { ...typography.caption, color: colors.ink400 },
  pin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  pinTitle: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 13, color: colors.inkInverse },
  pinBoxes: { flexDirection: 'row', gap: 5 },
  pinBox: { width: 28, height: 32, borderRadius: 9, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pinDigit: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink900 },
  pinGenerating: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInverse },
  meet: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  meetText: { flex: 1, minWidth: 0 },
  meetLabel: { ...typography.caption, color: colors.ink400 },
  meetAddress: { ...typography.label, color: colors.ink900 },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  directionsText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
})
