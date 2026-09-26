import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import type { FareEstimate } from '@ocar/mobile-shared'
import { fetchFareEstimate } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'

// Representative category for the headline estimate, same convention as
// web's trip-type/page.tsx -- actual vehicle is chosen on the next screen.
const ESTIMATE_CATEGORY_ID = 2
const ROUND_TRIP_MIN_HOURS = 4

// Matches web's /trip-type (apps/user/app/(main)/trip-type/page.tsx): shown
// when the destination is outstation and the rider never declared a ride
// type (search bar, saved places, recent trips, popular routes) -- lets them
// pick One Way vs Round Trip with a real fare comparison instead of the app
// silently guessing.
export default function TripTypeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const setRideType = useBookingDraftStore((s) => s.setRideType)

  const [oneWayEst, setOneWayEst] = useState<FareEstimate | null>(null)
  const [roundTripEst, setRoundTripEst] = useState<FareEstimate | null>(null)
  const [loading, setLoading] = useState(true)

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

  function chooseOneWay() {
    setRideType('one_way', true)
    router.push('/booking/fare')
  }

  function chooseRoundTrip() {
    setRideType('round_trip', true)
    router.push('/booking/round-trip')
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressedScale : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
        <Text style={styles.headerLabel}>This trip goes outside the city</Text>
      </View>

      <View style={styles.routeCard}>
        <Feather name="map-pin" size={13} color={colors.ink600} />
        <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
      </View>
      {distanceKm !== null && durationMin !== null ? (
        <Text style={styles.routeMeta}>{`${Math.round(distanceKm)} km · ${Math.round(durationMin)} min drive`}</Text>
      ) : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Pressable onPress={chooseOneWay} style={({ pressed }) => [styles.card, pressed ? styles.pressedScale : null]}>
          {cheaperOneWay ? (
            <View style={styles.bestFareBadge}>
              <Feather name="zap" size={10} color={colors.success} />
              <Text style={styles.bestFareText}>BEST FARE</Text>
            </View>
          ) : null}
          <View style={styles.cardHeader}>
            <View style={styles.iconWrap}>
              <Feather name="navigation" size={18} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>One Way</Text>
              <Text style={styles.cardSub}>Fastest way to get there</Text>
            </View>
          </View>
          <View style={styles.fareRow}>
            {loading ? (
              <View style={styles.fareSkeleton} />
            ) : oneWayEst ? (
              <>
                <Text style={styles.fareAmount}>₹{Math.round(oneWayEst.breakdown.total)}</Text>
                <Text style={styles.fareUnit}>one way</Text>
              </>
            ) : (
              <Text style={styles.fareUnavailable}>Fare unavailable</Text>
            )}
          </View>
        </Pressable>

        <Pressable onPress={chooseRoundTrip} style={({ pressed }) => [styles.card, pressed ? styles.pressedScale : null]}>
          {roundTripEst && !cheaperOneWay ? (
            <View style={styles.bestFareBadge}>
              <Feather name="zap" size={10} color={colors.success} />
              <Text style={styles.bestFareText}>BEST FARE</Text>
            </View>
          ) : null}
          <View style={styles.cardHeader}>
            <View style={styles.iconWrap}>
              <Feather name="repeat" size={18} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.cardTitle}>Round Trip</Text>
              <Text style={styles.cardSub}>Driver waits and brings you back</Text>
            </View>
          </View>
          <View style={styles.fareRow}>
            {loading ? (
              <View style={styles.fareSkeleton} />
            ) : roundTripEst ? (
              <>
                <Text style={styles.fareAmount}>₹{Math.round(roundTripEst.breakdown.total)}</Text>
                <Text style={styles.fareUnit}>{`from · ${ROUND_TRIP_MIN_HOURS}h min`}</Text>
              </>
            ) : (
              <Text style={styles.fareUnavailable}>Fare unavailable</Text>
            )}
          </View>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  backButton: { width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(20,23,26,0.08)',
    boxShadow: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  headerLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold, flex: 1 },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.lg, marginTop: spacing.md },
  routeText: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
  routeMeta: { ...typography.caption, color: colors.ink400, marginHorizontal: spacing.lg, marginTop: spacing.xs },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.borderLight, padding: spacing.md + 4 },
  bestFareBadge: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, backgroundColor: colors.successLight, borderRadius: radii.full, paddingHorizontal: spacing.xs + 2, paddingVertical: 4, marginBottom: spacing.xs },
  bestFareText: { ...typography.caption, color: colors.success, fontFamily: fonts.bold, fontSize: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  iconWrap: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  cardSub: { ...typography.caption, color: colors.ink400 },
  fareRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  fareAmount: { ...typography.headline, color: colors.ink900, fontFamily: fonts.bold },
  fareUnit: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold },
  fareUnavailable: { ...typography.body, color: colors.ink400 },
  fareSkeleton: { width: 80, height: 28, borderRadius: 8, backgroundColor: colors.surface2 },
})
