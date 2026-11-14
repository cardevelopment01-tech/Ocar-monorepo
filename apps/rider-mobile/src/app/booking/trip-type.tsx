import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { Button, font, h, shadow } from '@ocar/mobile-shared'
import type { FareEstimate } from '@ocar/mobile-shared'
import { fetchFareEstimate } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'
import { Chip, IconButton } from '@/components/ui'

// Representative category for the headline estimate, same convention as
// web's trip-type/page.tsx -- actual vehicle is chosen on the next screen.
const ESTIMATE_CATEGORY_ID = 2
const ROUND_TRIP_MIN_HOURS = 4

type Choice = 'one_way' | 'round_trip'
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Matches web's /trip-type (apps/user/app/(main)/trip-type/page.tsx): shown
// when the destination is outstation and the rider never declared a ride
// type (search bar, saved places, recent trips, popular routes) -- lets them
// pick One Way vs Round Trip with a real fare comparison instead of the app
// silently guessing. The card selects; the bottom button continues (same two
// navigations as before, one per choice).
export default function TripTypeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const setRideType = useBookingDraftStore((s) => s.setRideType)

  const [oneWayEst, setOneWayEst] = useState<FareEstimate | null>(null)
  const [roundTripEst, setRoundTripEst] = useState<FareEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [choice, setChoice] = useState<Choice>('one_way')

  useEffect(() => {
    if (distanceKm === null || durationMin === null) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchFareEstimate({
        categoryId: ESTIMATE_CATEGORY_ID, rideType: 'one_way',
        distanceKm, durationMin, ...(originCityId !== null ? { cityId: originCityId } : {}),
      }).catch(() => null),
      fetchFareEstimate({
        categoryId: ESTIMATE_CATEGORY_ID, rideType: 'round_trip',
        distanceKm, durationMin, tripHours: ROUND_TRIP_MIN_HOURS, ...(originCityId !== null ? { cityId: originCityId } : {}),
      }).catch(() => null),
    ]).then(([ow, rt]) => {
      if (cancelled) return
      setOneWayEst(ow)
      setRoundTripEst(rt)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [distanceKm, durationMin, originCityId])

  const cheaperOneWay = !!(oneWayEst && roundTripEst && oneWayEst.breakdown.total <= roundTripEst.breakdown.total)
  // "Two one-way rides" price, derived from the estimates above (never invented): shown only when the round trip is cheaper.
  const twoWay = oneWayEst ? oneWayEst.breakdown.total * 2 : null
  const saving = twoWay !== null && roundTripEst && twoWay > roundTripEst.breakdown.total ? twoWay - roundTripEst.breakdown.total : null

  function chooseOneWay() {
    setRideType('one_way', true)
    router.push('/booking/fare')
  }

  function chooseRoundTrip() {
    setRideType('round_trip', true)
    router.push('/booking/round-trip')
  }

  const chosenEst = choice === 'one_way' ? oneWayEst : roundTripEst
  const ctaLabel = chosenEst && !loading ? `See rides from ${rupees(chosenEst.breakdown.total)}` : 'See rides'

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" label="Go back" onPress={() => goBack(router)} />
        <Text style={styles.title}>Choose your trip</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.routeCard}>
          <View style={styles.rail}>
            <View style={styles.dotPickup} />
            <View style={styles.dash} />
            <View style={styles.dotDrop} />
          </View>
          <View style={styles.routeText}>
            <Text style={styles.routeLine} numberOfLines={1}>{pickup?.address ?? 'Pickup'}</Text>
            <Text style={[styles.routeLine, { marginTop: 12 }]} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
          </View>
          {distanceKm !== null && durationMin !== null ? (
            <View style={styles.routeMeta}>
              <Text style={styles.metaKm}>{`${distanceKm.toFixed(1)} km`}</Text>
              <Text style={styles.metaMin}>{`about ${Math.round(durationMin)} min`}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Select trip type</Text>

        <TypeCard
          on={choice === 'one_way'}
          onPress={() => setChoice('one_way')}
          icon="arrow-right"
          title="One way"
          sub="A to B at one fixed fare"
          badge={cheaperOneWay}
          loading={loading}
          est={oneWayEst}
          unit="one way"
          chips={[{ label: 'Fixed fare' }, { label: 'Pay on arrival' }]}
        />
        <View style={{ height: 18 }} />
        <TypeCard
          on={choice === 'round_trip'}
          onPress={() => setChoice('round_trip')}
          icon="repeat"
          title="Round trip"
          sub="Driver waits and brings you back"
          badge={!!roundTripEst && !cheaperOneWay}
          loading={loading}
          est={roundTripEst}
          unit={`from · ${ROUND_TRIP_MIN_HOURS}h min`}
          struck={saving !== null && twoWay !== null ? rupees(twoWay) : null}
          chips={[
            ...(saving !== null ? [{ label: `Save ${rupees(saving)}`, teal: true }] : []),
            { label: `Min ${ROUND_TRIP_MIN_HOURS} hr trip` },
            { label: 'Same driver' },
          ]}
        />

        {/* Only what is true: a one-way fare is fixed at booking; a round trip's booked fare is fixed, and extra km beyond the quoted route plus time past the booked hours (after a short grace) are added at settlement. */}
        <View style={styles.lockRow}>
          <Feather name="lock" size={16} color={h.tealText} />
          <Text style={styles.lockText}>
            {choice === 'one_way'
              ? 'Your fare is locked when you book.'
              : 'Your fare is locked when you book. Extra km beyond your route and time past your booked hours are added after the trip.'}
          </Text>
        </View>
      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(246,251,251,0)', h.canvas]} style={styles.fade} />
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Button variant="cta" label={ctaLabel} onPress={choice === 'one_way' ? chooseOneWay : chooseRoundTrip} />
      </View>
    </View>
  )
}

function TypeCard({ on, onPress, icon, title, sub, badge, loading, est, unit, struck, chips }: {
  on: boolean
  onPress: () => void
  icon: React.ComponentProps<typeof Feather>['name']
  title: string
  sub: string
  badge: boolean
  loading: boolean
  est: FareEstimate | null
  unit: string
  struck?: string | null
  chips: { label: string; teal?: boolean }[]
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${title}, ${sub}`}
      style={({ pressed }) => [styles.card, on ? styles.cardOn : null, pressed ? styles.pressed : null]}
    >
      {badge ? (
        <LinearGradient colors={['#F6DC9A', '#D6A552']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
          <Ionicons name="star" size={12} color={h.goldInk} />
          <Text style={styles.badgeText}>Best fare</Text>
        </LinearGradient>
      ) : null}
      <View style={styles.cardTop}>
        <View style={[styles.iconBox, on ? { backgroundColor: h.tealCta } : null]}>
          <Feather name={icon} size={23} color={on ? '#fff' : h.ivory} />
          {on ? <View style={styles.tick}><Feather name="check" size={10} color="#fff" /></View> : null}
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSub}>{sub}</Text>
        </View>
        <View style={styles.fareCol}>
          {loading ? (
            <View style={styles.skeleton} />
          ) : est ? (
            <>
              {struck ? <Text style={styles.struck}>{struck}</Text> : null}
              <Text style={styles.fare}>{rupees(est.breakdown.total)}</Text>
              <Text style={styles.unit}>{unit}</Text>
            </>
          ) : (
            <Text style={styles.unavailable}>Fare unavailable</Text>
          )}
        </View>
      </View>
      <View style={styles.chips}>
        {chips.map((c) => <Chip key={c.label} label={c.label} tone={c.teal ? 'teal' : 'neutral'} />)}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginHorizontal: 4 },
  lockText: { flex: 1, fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory, flex: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 150 },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.surface, borderRadius: 20, borderWidth: 1, borderColor: h.line07, boxShadow: shadow.sm, paddingVertical: 14, paddingHorizontal: 16 },
  rail: { alignItems: 'center', gap: 3 },
  dotPickup: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.16)' },
  dash: { height: 14, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  dotDrop: { width: 9, height: 9, borderRadius: 2.5, backgroundColor: h.ivory },
  routeText: { flex: 1, minWidth: 0 },
  routeLine: { fontFamily: font.sb, fontSize: 13.5, color: h.ivory },
  routeMeta: { alignItems: 'flex-end' },
  metaKm: { fontFamily: font.xb, fontSize: 14, color: h.ivory, fontVariant: ['tabular-nums'] },
  metaMin: { fontFamily: font.r, fontSize: 12, color: h.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  sectionLabel: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginHorizontal: 2, marginTop: 26, marginBottom: 14 },
  card: { padding: 16, backgroundColor: h.surface, borderRadius: 22, borderWidth: 1.5, borderColor: h.line10, boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  cardOn: { backgroundColor: '#F3FAFB', borderColor: h.tealCta, boxShadow: '0 0 0 4px rgba(14,143,163,0.10), 0 2px 8px rgba(20,23,26,0.06)' },
  pressed: { transform: [{ scale: 0.985 }] },
  badge: { position: 'absolute', top: -12, right: 18, height: 24, paddingLeft: 8, paddingRight: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5, boxShadow: '0 6px 14px rgba(214,165,82,0.38)' },
  badgeText: { fontFamily: font.xb, fontSize: 12, color: h.goldInk },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBox: { width: 48, height: 48, borderRadius: 15, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', right: -5, top: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: h.tealCta, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: font.b, fontSize: 16.5, color: h.ivory, marginBottom: 3 },
  cardSub: { fontFamily: font.r, fontSize: 12.5, color: h.muted },
  fareCol: { alignItems: 'flex-end' },
  struck: { fontFamily: font.r, fontSize: 12, color: h.faint, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'], marginBottom: 1 },
  fare: { fontFamily: font.xb, fontSize: 21, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: font.m, fontSize: 11.5, color: h.label, marginTop: 2 },
  unavailable: { fontFamily: font.m, fontSize: 13, color: h.faint },
  skeleton: { width: 80, height: 28, borderRadius: 8, backgroundColor: h.chip },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: h.line07 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18 },
})
