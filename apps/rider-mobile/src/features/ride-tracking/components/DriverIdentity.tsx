import { useState, type ReactNode } from 'react'
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather, FontAwesome } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { font, h } from '@ocar/mobile-shared'
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

const AVATAR = { lg: 56, md: 44, sm: 28 } as const

export function DriverAvatar({ view, photo, size = 'md', chip = false }: {
  view: DriverIdentityView; photo: string | null; size?: keyof typeof AVATAR; chip?: boolean
}) {
  const px = AVATAR[size]
  // A photo URL that fails to load (expired link, offline) must fall back to the initials, not a blank circle.
  const [photoFailed, setPhotoFailed] = useState(false)
  const box = { width: px, height: px, borderRadius: px / 2 }
  return (
    <View style={[styles.avatarWrap, chip && { paddingBottom: 9, paddingRight: 8 }]}>
      {photo && !photoFailed ? (
        <View style={[styles.avatar, box]}><Image source={{ uri: photo }} style={box} onError={() => setPhotoFailed(true)} accessibilityIgnoresInvertColors /></View>
      ) : (
        <LinearGradient colors={['#12A0B6', '#0A7788']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.avatar, styles.avatarFallback, box]}>
          <Text style={[styles.avatarInitials, { fontSize: Math.round(px * 0.34) }]}>{view.initials}</Text>
        </LinearGradient>
      )}
      {chip ? (
        <View style={styles.chip} accessibilityLabel={view.ratingText ? `Rated ${view.ratingText}` : 'New driver'}>
          {view.ratingText ? <FontAwesome name="star" size={10} color="#E2A93B" /> : null}
          <Text style={styles.chipText}>{view.ratingText ?? 'New'}</Text>
        </View>
      ) : null}
    </View>
  )
}

export function PlateBadge({ plate, large = false }: { plate: string | null; large?: boolean }) {
  if (!plate) return null
  return (
    // Drawn like a plate (same as the driver app): IND stripe, light plate, dark rim, one line.
    <View style={[styles.plate, large && styles.plateLg]} accessible accessibilityLabel={`Number plate ${plate}`}>
      <View style={[styles.plateStripe, large && styles.plateStripeLg]}><Text style={styles.plateStripeText}>IND</Text></View>
      <Text style={[styles.plateText, large && styles.plateTextLg]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{plate}</Text>
    </View>
  )
}

export function VehicleLine({ view, swatch = true, lines = 1 }: { view: DriverIdentityView; swatch?: boolean; lines?: number }) {
  return (
    <View style={styles.vehicle}>
      {swatch && view.swatch ? <View style={[styles.swatch, { backgroundColor: view.swatch }]} /> : null}
      <Text style={styles.vehicleText} numberOfLines={lines}>{view.vehicleLine}</Text>
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
          {view.ratingText ? <><FontAwesome name="star" size={10} color="#E2A93B" /><Text style={styles.rowMetaStrong}>{view.ratingText}</Text><Text style={styles.rowMetaText}>·</Text></> : null}
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
      <Feather name="map-pin" size={16} color={h.tealText} />
      <View style={styles.meetText}>
        <Text style={styles.meetLabel}>Meet at</Text>
        <Text style={styles.meetAddress} numberOfLines={1}>{address}</Text>
      </View>
      {url ? (
        <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel="Get directions to pickup" style={styles.directions} hitSlop={8}>
          <Feather name="navigation" size={13} color={h.tealText} />
          <Text style={styles.directionsText}>Directions</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  avatarWrap: { alignItems: 'center', flexShrink: 0 },
  // Gold ring (the redesign's driver / profile avatar): white gap, then a thin gold line.
  avatar: { boxShadow: '0 0 0 2.5px #FFFFFF, 0 0 0 4px rgba(214,165,82,0.7)' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontFamily: font.b, color: '#FFFFFF' },
  chip: { position: 'absolute', bottom: -2, right: -8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: h.surface, borderRadius: 11, height: 22, paddingHorizontal: 7, boxShadow: '0 2px 6px rgba(20,23,26,0.16)' },
  chipText: { fontFamily: font.b, fontSize: 11.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  // Yellow like an Indian commercial (taxi) plate, so riders can tell it is a registered commercial vehicle.
  plate: { flexShrink: 0, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8C927', borderRadius: 8, borderWidth: 1.5, borderColor: h.ivory, overflow: 'hidden' },
  plateLg: { borderRadius: 10, borderWidth: 2 },
  plateStripeLg: { width: 26 },
  plateTextLg: { paddingHorizontal: 14, paddingVertical: 8, fontSize: 21, lineHeight: 28, letterSpacing: 1.4 },
  plateStripe: { alignSelf: 'stretch', width: 20, backgroundColor: '#1D3F8F', alignItems: 'center', justifyContent: 'center' },
  plateStripeText: { fontFamily: font.b, fontSize: 8, lineHeight: 11, color: '#FFFFFF' },
  plateText: { flexShrink: 1, paddingHorizontal: 8, paddingVertical: 5, fontFamily: font.xb, fontSize: 15, lineHeight: 20, letterSpacing: 0.8, color: h.ivory, fontVariant: ['tabular-nums'] },
  vehicle: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: h.faint },
  swatchSm: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: h.faint },
  vehicleText: { fontFamily: font.sb, fontSize: 13, color: h.ivory, flexShrink: 1 },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { flex: 1, minWidth: 0, gap: 1 },
  rowName: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMetaStrong: { fontFamily: font.b, fontSize: 12, color: h.muted },
  rowMetaText: { fontFamily: font.r, fontSize: 12, color: h.muted },
  pin: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#F3FAFB', borderWidth: 1, borderColor: 'rgba(14,143,163,0.22)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  pinTitle: { flex: 1, minWidth: 0, fontFamily: font.sb, fontSize: 13, color: h.tealText },
  pinBoxes: { flexDirection: 'row', gap: 5 },
  pinBox: { width: 30, height: 36, borderRadius: 9, backgroundColor: h.surface, borderWidth: 1, borderColor: 'rgba(14,143,163,0.22)', alignItems: 'center', justifyContent: 'center' },
  pinDigit: { fontFamily: font.xb, fontSize: 20, color: h.ivory, fontVariant: ['tabular-nums'] },
  pinGenerating: { fontFamily: font.sb, fontSize: 12, color: h.tealText },
  meet: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.chip, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  meetText: { flex: 1, minWidth: 0 },
  meetLabel: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  meetAddress: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0, minHeight: 44 },
  directionsText: { fontFamily: font.b, fontSize: 12.5, color: h.tealText },
})
