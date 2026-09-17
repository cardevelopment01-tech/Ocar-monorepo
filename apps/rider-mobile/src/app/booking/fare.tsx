import { useRef, useState } from 'react'
import axios from 'axios'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, ErrorState, colors, spacing, typography, mapBookingErrorCode } from '@ocar/mobile-shared'
import { CategoryCard } from '@/features/booking/components/CategoryCard'
import { useFareEstimates } from '@/features/booking/hooks/useFareEstimates'
import { useBookingDraftStore } from '@/features/booking/store'
import { createBooking } from '@/features/booking/api'
import { socket } from '@/services/socket'

export default function BookingFareScreen() {
  const router = useRouter()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const selectedCategoryId = useBookingDraftStore((s) => s.selectedCategoryId)
  const setSelectedCategoryId = useBookingDraftStore((s) => s.setSelectedCategoryId)

  const { categories, estimates, loading, error, retry } = useFareEstimates(distanceKm, durationMin, originCityId)

  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const bookInFlightRef = useRef(false)

  const effectiveSelected = selectedCategoryId ?? categories[0]?.id ?? null
  const selectedFare = effectiveSelected != null ? estimates[effectiveSelected]?.breakdown.total : undefined

  async function handleBook() {
    if (!pickup || !drop || effectiveSelected == null || bookInFlightRef.current) return
    bookInFlightRef.current = true
    setBooking(true)
    setBookError(null)
    try {
      const input: Parameters<typeof createBooking>[0] = {
        categoryId: effectiveSelected,
        rideType: 'one_way',
        originLat: pickup.lat,
        originLng: pickup.lng,
        destinationLat: drop.lat,
        destinationLng: drop.lng,
        distanceKm: distanceKm ?? 0,
        durationMin: durationMin ?? 0,
      }
      if (pickup.address) input.originAddress = pickup.address
      if (drop.address) input.destinationAddress = drop.address
      if (originCityId !== null) input.originCityId = originCityId

      const result = await createBooking(input)

      // Join the ride room synchronously, right after the response resolves and
      // before any navigation/setState -- closes the race where the backend
      // could emit an early ride:status_update (e.g. instant auto-assignment)
      // before a listener exists. /ride/[id] (features/ride-tracking's
      // useRideTracking, owned by a different engineer this phase, already
      // implements the "searching for driver" state, the durable
      // reconnect-and-rejoin subscription via its own useRoomJoin() call, and
      // GET /rides/:id status polling -- this screen's job ends at the booking
      // call plus this one pre-navigation join, not a second parallel
      // "searching" screen.
      socket.emit('join:ride', result.rideId)

      router.replace(`/ride/${result.rideId}`)
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      setBookError(code ? mapBookingErrorCode(code) : 'Something went wrong, please try again')
    } finally {
      setBooking(false)
      bookInFlightRef.current = false
    }
  }

  if (error && categories.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState message={error} onRetry={retry} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
        <View>
          <Text style={styles.title}>Choose a ride</Text>
          {distanceKm != null && durationMin != null ? (
            <Text style={styles.subtitle}>{`${distanceKm.toFixed(1)} km · ${Math.round(durationMin)} min`}</Text>
          ) : null}
        </View>
      </View>

      {loading && categories.length === 0 ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard} />
          ))}
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CategoryCard
              category={item}
              fareTotal={estimates[item.id]?.breakdown.total ?? null}
              loading={loading && estimates[item.id] === undefined}
              selected={effectiveSelected === item.id}
              onPress={() => setSelectedCategoryId(item.id)}
            />
          )}
        />
      )}

      {bookError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {bookError}
        </Text>
      ) : null}

      <Button
        label={selectedFare != null ? `Book · ₹${Math.round(selectedFare)}` : 'Book'}
        onPress={handleBook}
        loading={booking}
        disabled={effectiveSelected == null || selectedFare == null}
        accessibilityLabel="Book this ride"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.headline, color: colors.ink900 },
  subtitle: { ...typography.label, color: colors.ink600 },
  list: { paddingVertical: spacing.sm },
  skeletonCard: { height: 72, borderRadius: 16, backgroundColor: colors.surface3, marginBottom: spacing.sm },
  error: { ...typography.body, color: colors.error },
})
