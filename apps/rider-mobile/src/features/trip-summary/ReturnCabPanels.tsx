import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Button, font, h } from '@ocar/mobile-shared'
import { fetchFareEstimate, fetchReturnCabAvailable } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'
import { fleetImageFor } from '@/features/home/fleet'
import { fetchRouteLeg } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'

const GREEN_INK = '#0E7A52'
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type Fares = { standard: number | null; ret: number | null }

/**
 * What this trip would have cost as a standard cab and as a return cab, both priced now for the same car and route. Best effort:
 * until (or unless) both answer, nothing is claimed.
 */
function useReturnCabFares(ride: RideDetailExtra, enabled: boolean): Fares {
  const [fares, setFares] = useState<Fares>({ standard: null, ret: null })
  const categoryId = Number(ride.categoryId)
  const km = ride.estimatedKm ?? null
  const min = ride.estimatedMin ?? null
  const cityId = ride.originCityId != null ? Number(ride.originCityId) : null
  useEffect(() => {
    if (!enabled || !Number.isFinite(categoryId) || km == null || min == null) return
    let live = true
    const base = { categoryId, rideType: 'one_way' as const, distanceKm: km, durationMin: min, ...(cityId != null ? { cityId } : {}) }
    Promise.allSettled([fetchFareEstimate(base), fetchFareEstimate({ ...base, isReturnCab: true })]).then(([std, ret]) => {
      if (!live) return
      setFares({
        standard: std.status === 'fulfilled' ? std.value.breakdown.total : null,
        ret: ret.status === 'fulfilled' ? ret.value.breakdown.total : null,
      })
    })
    return () => { live = false }
  }, [enabled, categoryId, km, min, cityId])
  return fares
}

/**
 * Trip complete: what a return cab saved the rider, shown as one more line inside the usual fare ticket. 0 (nothing shown) unless the
 * standard fare really is higher. Worded "about" by the caller, because it is measured on the booked route: stops or extra km move the final fare.
 */
export function useReturnCabSaving(ride: RideDetailExtra, enabled: boolean): number {
  const { standard, ret } = useReturnCabFares(ride, enabled)
  return standard != null && ret != null && Math.round(standard) > Math.round(ret) ? Math.round(standard) - Math.round(ret) : 0
}

/**
 * The content of the sheet shown when a return-cab ride closed with no driver (only return-cab drivers are asked, and none took it).
 * Both ways forward are one tap from the fare screen with the trip already filled in: try the return cab again (only offered while one
 * is still on the route) or choose a standard car. Nothing is booked on the rider's behalf.
 */
export function ReturnCabRecovery({ ride }: { ride: RideDetailExtra }) {
  const router = useRouter()
  const { standard, ret } = useReturnCabFares(ride, true)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ride.destLat == null || ride.destLng == null) { setAvailable(false); return }
    let live = true
    fetchReturnCabAvailable({
      pickupLat: ride.originLat, pickupLng: ride.originLng, dropLat: ride.destLat, dropLng: ride.destLng, categoryId: Number(ride.categoryId),
    }).then((r) => { if (live) setAvailable(r.count > 0) }).catch(() => { if (live) setAvailable(false) })
    return () => { live = false }
  }, [ride.originLat, ride.originLng, ride.destLat, ride.destLng, ride.categoryId])

  async function openFare(preferStandard: boolean) {
    if (busy || ride.destLat == null || ride.destLng == null) return
    setBusy(true)
    try {
      const leg = await fetchRouteLeg(ride.originLat, ride.originLng, ride.destLat, ride.destLng, false).catch(() => null)
      const draft = useBookingDraftStore.getState()
      draft.reset()
      draft.setPickup({ address: ride.originAddress ?? 'Pickup', lat: ride.originLat, lng: ride.originLng })
      draft.setDrop({ address: ride.destinationAddress ?? 'Drop', lat: ride.destLat, lng: ride.destLng })
      draft.setRoute(ride.estimatedKm ?? leg?.distanceKm ?? 0, ride.estimatedMin ?? leg?.etaMin ?? 0, ride.originCityId != null ? Number(ride.originCityId) : null, leg?.polyline ?? [])
      draft.setRideType('one_way', true)
      draft.setSelectedCategoryId(Number(ride.categoryId))
      router.replace(preferStandard ? { pathname: '/booking/fare', params: { standard: '1' } } : '/booking/fare')
    } finally {
      setBusy(false)
    }
  }

  const carName = ride.bookedCategoryName ?? 'car'
  const img = ride.bookedCategoryName ? fleetImageFor(ride.bookedCategoryName.toLowerCase().replace(/\s+/g, '_')) : null
  const showRetry = available === true

  return (
    <View>
      <View style={s.head}>
        <View style={s.icon}><Feather name="repeat" size={24} color="#9A6A12" /></View>
        <View style={s.headText}>
          <Text style={s.title}>No return cab took this trip</Text>
          <Text style={s.sub}>The drivers heading your way are busy right now.</Text>
        </View>
      </View>

      {standard != null ? (
        <View style={s.stdCard}>
          {img ? <View collapsable={false} style={s.stdImgBox}><Image source={img} style={s.stdImg} resizeMode="contain" accessibilityIgnoresInvertColors /></View> : null}
          <View style={s.stdInfo}>
            <Text style={s.stdName} numberOfLines={1}>Standard {carName}</Text>
            <Text style={s.stdSub} numberOfLines={1}>Same route</Text>
          </View>
          <View style={s.stdFareBlock}>
            <Text style={s.stdFare}>{rupees(standard)}</Text>
            {ret != null && Math.round(standard) > Math.round(ret) ? <Text style={s.stdMore}>{rupees(standard - ret)} more</Text> : null}
          </View>
        </View>
      ) : null}

      {showRetry ? (
        <>
          <View style={s.cta}><Button variant="cta" label={ret != null ? `Try the return cab again · ${rupees(ret)}` : 'Try the return cab again'} onPress={() => void openFare(false)} loading={busy} /></View>
          <Text style={s.stillOn}>A return cab is still on your route.</Text>
          <Pressable onPress={() => void openFare(true)} disabled={busy} accessibilityRole="button" style={({ pressed }) => [s.secondary, pressed ? s.pressed : null]}>
            <Text style={s.secondaryText}>Choose a standard {carName}{standard != null ? ` · ${rupees(standard)}` : ''}</Text>
          </Pressable>
        </>
      ) : (
        <View style={s.cta}><Button variant="cta" label={standard != null ? `Choose a standard ${carName} · ${rupees(standard)}` : `Choose a standard ${carName}`} onPress={() => void openFare(true)} loading={busy} /></View>
      )}

      <Pressable onPress={() => router.replace('/(tabs)/home')} accessibilityRole="button" style={({ pressed }) => [s.homeLink, pressed ? s.pressed : null]}>
        <Text style={s.homeText}>Back to home</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FBF3E1', alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  sub: { fontFamily: font.m, fontSize: 13.5, lineHeight: 19, color: h.muted, marginTop: 3 },
  stdCard: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingLeft: 6, borderRadius: 22, backgroundColor: '#F2FAFB', borderWidth: 1, borderColor: 'rgba(14,143,163,0.18)' },
  stdImgBox: { width: 80, height: 50, alignItems: 'center', justifyContent: 'center' },
  stdImg: { width: 80, height: 50 },
  stdInfo: { flex: 1, minWidth: 0 },
  stdName: { fontFamily: font.xb, fontSize: 15, color: h.ivory },
  stdSub: { fontFamily: font.sb, fontSize: 12.5, color: h.tealText, marginTop: 2 },
  stdFareBlock: { alignItems: 'flex-end', flexShrink: 0 },
  stdFare: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },
  stdMore: { fontFamily: font.m, fontSize: 11.5, color: h.muted, marginTop: 1, fontVariant: ['tabular-nums'] },
  cta: { marginTop: 16 },
  stillOn: { fontFamily: font.sb, fontSize: 12.5, color: GREEN_INK, textAlign: 'center', marginTop: 9 },
  secondary: { marginTop: 12, minHeight: 52, borderRadius: 18, borderWidth: 1, borderColor: h.line08, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: font.b, fontSize: 15, color: h.ivory, fontVariant: ['tabular-nums'] },
  homeLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  homeText: { fontFamily: font.sb, fontSize: 14, color: h.muted },
  pressed: { opacity: 0.7 },
})
