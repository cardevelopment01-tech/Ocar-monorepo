import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Button, colors, getCurrentOrLastKnownPosition, spacing, typography } from '@ocar/mobile-shared'
import { PlaceAutocompleteField } from '@/features/booking/components/PlaceAutocompleteField'
import { fetchNearestCityId, fetchReverseGeocode, fetchRoute } from '@/features/booking/api'
import { useBookingDraftStore } from '@/features/booking/store'

export default function BookingPickersScreen() {
  const router = useRouter()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const setPickup = useBookingDraftStore((s) => s.setPickup)
  const setDrop = useBookingDraftStore((s) => s.setDrop)
  const setRoute = useBookingDraftStore((s) => s.setRoute)

  const [locating, setLocating] = useState(true)
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const requestedDefaultRef = useRef(false)

  useEffect(() => {
    if (pickup || requestedDefaultRef.current) return
    requestedDefaultRef.current = true
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          setLocating(false)
          return
        }
        const position = await getCurrentOrLastKnownPosition()
        const detail = await fetchReverseGeocode(position.coords.latitude, position.coords.longitude)
        setPickup(detail)
      } catch {
        // Current-location default pin is a convenience -- if it fails, the rider
        // can still search for a pickup manually, so no error state is shown here.
      } finally {
        setLocating(false)
      }
    })()
  }, [pickup, setPickup])

  async function handleContinue() {
    if (!pickup || !drop || continuing) return
    setContinuing(true)
    setContinueError(null)
    try {
      const [route, cityId] = await Promise.all([
        fetchRoute(pickup.lat, pickup.lng, drop.lat, drop.lng),
        fetchNearestCityId(pickup.lat, pickup.lng),
      ])
      setRoute(route.distanceKm, route.durationMin, cityId)
      router.push('/booking/fare')
    } catch {
      setContinueError("Couldn't work out that route — try again")
    } finally {
      setContinuing(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <Text style={styles.title}>Plan your trip</Text>
      </View>

      <View style={styles.routeCard}>
        <View style={styles.connector}>
          <View style={styles.dotPickup} />
          <View style={styles.dashedLine} />
          <View style={styles.dotDrop} />
        </View>
        <View style={styles.fieldsColumn}>
          <View style={styles.fieldRow}>
            <PlaceAutocompleteField
              label="Pickup"
              placeholder={locating ? 'Finding your location…' : 'Enter pickup location'}
              accessibilityHint="Search for a pickup location"
              bias={pickup ? { lat: pickup.lat, lng: pickup.lng } : {}}
              value={pickup}
              onSelect={setPickup}
              bare
            />
          </View>
          <View style={styles.fieldRowLast}>
            <PlaceAutocompleteField
              label="Drop"
              placeholder="Enter destination"
              accessibilityHint="Search for a destination"
              bias={pickup ? { lat: pickup.lat, lng: pickup.lng } : {}}
              value={drop}
              onSelect={setDrop}
              bare
            />
          </View>
        </View>
      </View>

      {continueError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {continueError}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Button
          label="Continue"
          onPress={handleContinue}
          loading={continuing}
          disabled={!pickup || !drop}
          accessibilityLabel="Continue to fare estimate"
        />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['2xl'] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, color: colors.ink900, fontWeight: '700' },
  routeCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  connector: { width: 40, alignItems: 'center', paddingVertical: spacing.md },
  dotPickup: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  dashedLine: { flex: 1, width: 1, minHeight: 24, borderLeftWidth: 1, borderLeftColor: colors.border, borderStyle: 'dashed', marginVertical: 4 },
  dotDrop: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.warning },
  fieldsColumn: { flex: 1 },
  fieldRow: { paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  fieldRowLast: { paddingHorizontal: spacing.sm },
  error: { ...typography.body, color: colors.error },
  footer: { marginTop: spacing.md },
})
