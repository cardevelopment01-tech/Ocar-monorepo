import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
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
      <Text style={styles.title}>Where to?</Text>

      <PlaceAutocompleteField
        label="Pickup"
        placeholder={locating ? 'Finding your location…' : 'Enter pickup location'}
        accessibilityHint="Search for a pickup location"
        bias={pickup ? { lat: pickup.lat, lng: pickup.lng } : {}}
        value={pickup}
        onSelect={setPickup}
      />

      <PlaceAutocompleteField
        label="Drop"
        placeholder="Enter destination"
        accessibilityHint="Search for a destination"
        bias={pickup ? { lat: pickup.lat, lng: pickup.lng } : {}}
        value={drop}
        onSelect={setDrop}
      />

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
  title: { ...typography.headline, color: colors.ink900 },
  error: { ...typography.body, color: colors.error },
  footer: { marginTop: spacing.md },
})
