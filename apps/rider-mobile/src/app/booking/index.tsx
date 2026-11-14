import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { formatEstimatedRoadKm } from '@ocar/shared'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Button, spacing, h, font, pillTextFor, getApiErrorMessage, haversineMetres, ageMs, track } from '@ocar/mobile-shared'

// Same threshold as the API (MIN_TRIP_DISTANCE_METRES): closer than this is the same place, not a trip.
const SAME_PLACE_METRES = 100
import { PlaceRow } from '@/features/booking/components/PlaceRow'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { fetchClassifyTrip, fetchNearestCityId, fetchPlaceDetail, fetchRoute, fetchSavedPlaces, type SavedPlace } from '@/features/booking/api'
import { useAutocomplete } from '@/features/booking/hooks/useAutocomplete'
import { useBookingDraftStore, type BookingPlace } from '@/features/booking/store'
import type { RideType } from '@/features/booking/api'
import { resolveInCityRoute, type TripMode } from '@/features/booking/cityRideRoute'
import { useApproximateLocation, useFreshness, useLocationStore, useLocationTracking } from '@/store/useLocationStore'
import { PreciseLocationNotice } from '@/features/home/PreciseLocationNotice'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'
import { RedirectToast } from '@/features/booking/components/RedirectToast'
import { sectionLabel } from '@/theme/homeTokens'
import { IconButton } from '@/components/ui'

type ActiveField = 'pickup' | 'drop'

// Road-distance ESTIMATE from pickup (straight line scaled up, shown as "~10.4 km"; see @ocar/shared roadEstimate) --
// undefined pickup means nothing to show yet.
function distanceFromPickup(pickup: { lat: number; lng: number } | null, lat: number, lng: number): string | undefined {
  if (!pickup) return undefined
  const R = 6_371_000
  const dLat = (lat - pickup.lat) * Math.PI / 180
  const dLng = (lng - pickup.lng) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(pickup.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  const metres = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return formatEstimatedRoadKm(metres)
}

const SAVED_ICON: Record<SavedPlace['kind'], React.ComponentProps<typeof Feather>['name']> = {
  home: 'home',
  work: 'briefcase',
  other: 'map-pin',
}

// Same curated fallback list as web's own POPULAR constant
// (apps/user/app/(main)/search/page.tsx) -- shown once neither recents nor
// favourites have anything, so the results area is never completely empty.
const POPULAR: { icon: React.ComponentProps<typeof Feather>['name']; label: string; address: string; lat: number; lng: number }[] = [
  { icon: 'navigation', label: 'Bhubaneswar Airport', address: 'Bhubaneswar Airport, Bhubaneswar', lat: 20.2444, lng: 85.8178 },
  { icon: 'map-pin', label: 'Bhubaneswar Railway Stn', address: 'Bhubaneswar Junction', lat: 20.2663, lng: 85.8424 },
  { icon: 'plus-square', label: 'AIIMS Bhubaneswar', address: 'AIIMS, Sijua, Bhubaneswar', lat: 20.1823, lng: 85.7698 },
  { icon: 'shopping-bag', label: 'Esplanade One', address: 'Rasulgarh, Bhubaneswar', lat: 20.2877, lng: 85.8508 },
  { icon: 'book-open', label: 'KIIT University', address: 'Patia, Bhubaneswar', lat: 20.356, lng: 85.8181 },
  { icon: 'map-pin', label: 'Puri Railway Station', address: 'Puri, Odisha', lat: 19.8014, lng: 85.8142 },
]

export default function BookingPickersScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const pickupAuto = useBookingDraftStore((s) => s.pickupAuto)
  const focused = useIsFocused()
  const approximate = useApproximateLocation()
  useLocationTracking(true, true) // placing a pickup: GPS-grade accuracy while this screen is on show
  const setPickup = useBookingDraftStore((s) => s.setPickup)
  const clearPickup = useBookingDraftStore((s) => s.clearPickup)
  const setDrop = useBookingDraftStore((s) => s.setDrop)
  const setRoute = useBookingDraftStore((s) => s.setRoute)
  const rideType = useBookingDraftStore((s) => s.rideType)
  const rideTypeDeclared = useBookingDraftStore((s) => s.rideTypeDeclared)
  const setRideType = useBookingDraftStore((s) => s.setRideType)
  const tripMode = useBookingDraftStore((s) => s.tripMode)
  const riderName = useBookingDraftStore((s) => s.riderName)
  const riderPhone = useBookingDraftStore((s) => s.riderPhone)
  const setRider = useBookingDraftStore((s) => s.setRider)
  const clearRider = useBookingDraftStore((s) => s.clearRider)
  const resetDraft = useBookingDraftStore((s) => s.reset)
  const bookingForOther = riderName !== '' && riderPhone !== ''
  const [riderSheetOpen, setRiderSheetOpen] = useState(false)

  const locLat = useLocationStore((s) => s.lat)
  const locLng = useLocationStore((s) => s.lng)
  const locAddress = useLocationStore((s) => s.address)
  const freshness = useFreshness()
  const recents = useRecentSearchesStore((s) => s.recents)
  const addRecent = useRecentSearchesStore((s) => s.addRecent)

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  // Supplementary quick-picks -- a failed fetch must never block search, just
  // show fewer rows (same tolerance as the recent-searches/pickup-GPS paths).
  useEffect(() => { fetchSavedPlaces().then(setSavedPlaces).catch(() => {}) }, [])

  // Pickup defaults to the current location, but only from a fresh fix (GPS this launch, or under 2 minutes
  // old). The saved location seeds the home map only: it must never become a booking pickup, since a stale
  // spot would be quoted and dispatched. Tapping FROM still lets the rider override it, same as web.

  // Which field is actively showing a TextInput right now -- null means both
  // rows show their confirmed/placeholder text. Distinct from "which field was
  // last touched": after committing a place, editing ends (null), rather than
  // leaving that row stuck rendering an now-empty input over its real value.
  const [editingField, setEditingField] = useState<ActiveField | null>('drop')

  // An auto-filled pickup left in the draft from earlier is only as good as the fix it came from: once the location is no
  // longer live (the rider moved on, or GPS dropped) it is cleared, so a stale spot can never be quoted or dispatched.
  useEffect(() => {
    if (focused && pickup && pickupAuto && freshness !== 'live') clearPickup()
  }, [focused, pickup, pickupAuto, freshness, clearPickup])

  // The auto-filled pickup also follows the live fix (the rider walked, or the first fix was rough) until they choose a
  // place themselves (and not while they are editing it: a new pickup object closes the editor); one they chose is never moved.
  useEffect(() => {
    // An approximate location (1-2 km off) must not become the pickup: the rider sets it on the map instead.
    if (freshness !== 'live' || locLat === null || locLng === null || !focused || approximate || editingField === 'pickup') return
    if (pickup && (!pickupAuto || drop)) return // a chosen pickup never moves; and once a destination is set the quote is being built
    if (pickup && haversineMetres([pickup.lat, pickup.lng], [locLat, locLng]) < 30 && (pickup.address === (locAddress || 'Current Location') || !locAddress)) return
    if (!pickup) track('location_pickup_autofill', { age_s: Math.round(ageMs(useLocationStore.getState().fixedAt ?? 0, Date.now()) / 1000), source: useLocationStore.getState().source ?? 'none' })
    setPickup({ address: locAddress || 'Current Location', lat: locLat, lng: locLng }, true)
  }, [pickup, pickupAuto, drop, focused, approximate, editingField, freshness, locLat, locLng, locAddress, setPickup])
  const [query, setQuery] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [redirectToast, setRedirectToast] = useState<string | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current) }, [])

  // A successful redirect (e.g. undeclared + in-city -> rental) never reset
  // redirectToast back to null -- it just pushed the next screen, leaving the
  // message sitting in this screen's state. expo-router keeps this instance
  // mounted underneath, so backing out of that pushed screen re-showed the
  // stale "switching to X" toast immediately, before the rider had done
  // anything new. Clearing on focus (the actual moment this screen becomes
  // visible again) closes that gap directly instead of hoping every mutation
  // path remembers to clear it.
  useFocusEffect(
    useCallback(() => {
      if (redirectTimerRef.current) { clearTimeout(redirectTimerRef.current); redirectTimerRef.current = null }
      setRedirectToast(null)
    }, [])
  )

  // A redirect (e.g. undeclared + in-city -> rental) calls setRideType(...,
  // true), which permanently marks the draft as "declared" in the store.
  // expo-router keeps this screen instance mounted across back-navigation,
  // so picking a DIFFERENT destination afterwards inherited that leftover
  // auto-picked mode instead of classifying fresh. Captured once on entry so
  // a fresh destination pick can restore exactly what this screen started
  // with -- reset from inside commitPlace itself (a synchronous event
  // handler), not a useEffect keyed on `drop`: that effect and the
  // pickup+drop auto-continue effect both fire in the same commit, and
  // zustand's setRideType() doesn't retroactively update the closure
  // handleContinue already captured for *this* render, so auto-continue
  // could still see the pre-reset rideType/declared. Resetting before
  // setDrop() runs means the render setDrop triggers already reads fresh.
  const enteredDeclaredRef = useRef<{ rideType: RideType; declared: boolean; tripMode: TripMode } | null>(null)
  if (enteredDeclaredRef.current === null) enteredDeclaredRef.current = { rideType, declared: rideTypeDeclared, tripMode }

  // Closes editing whenever a field's value changes from ANY source, not just
  // this screen's own commitPlace -- e.g. map-picker (a separate screen) sets
  // `drop` directly on the shared store and navigates back here, which would
  // otherwise leave this row stuck rendering a stale, now-empty TextInput over
  // the real confirmed value (the exact bug commitPlace's own reset already
  // fixes for in-screen selections).
  useEffect(() => {
    if (pickup) setEditingField((f) => (f === 'pickup' ? null : f))
  }, [pickup])
  useEffect(() => {
    if (drop) setEditingField((f) => (f === 'drop' ? null : f))
  }, [drop])

  const bias = useMemo(
    () => (pickup ? { lat: pickup.lat, lng: pickup.lng } : {}),
    [pickup]
  )
  const { results, loading, error, retry } = useAutocomplete(query, bias)
  const showSuggestions = editingField !== null && query.trim().length >= 2

  function openField(field: ActiveField) {
    setEditingField(field)
    setQuery('')
  }

  async function commitPlace(place: BookingPlace) {
    // A deliberate pick always clears the auto-trigger guard below, even if
    // it resolves to the exact same coordinates as last time (e.g. picking
    // "Puri" again after backing out of the trip-type screen) -- the guard's
    // key is the pickup+drop pair, which is unchanged in that case, so
    // without this the auto-continue effect silently no-ops until the rider
    // notices and taps Continue manually.
    autoTriggeredRef.current = null
    if (editingField === 'pickup') {
      setPickup(place)
      // Nothing left to edit if drop is already set; otherwise move straight
      // into destination entry so the whole flow can complete in one pass.
      setEditingField(drop ? null : 'drop')
    } else {
      const entry = enteredDeclaredRef.current!
      setRideType(entry.rideType, entry.declared, entry.tripMode)
      if (redirectTimerRef.current) { clearTimeout(redirectTimerRef.current); redirectTimerRef.current = null }
      setRedirectToast(null)
      setDrop(place)
      addRecent(place)
      setEditingField(null)
    }
    setQuery('')
  }

  async function handleSelectSuggestion(placeId: string, description: string) {
    try {
      const detail = await fetchPlaceDetail(placeId)
      await commitPlace({ address: detail.address || description, lat: detail.lat, lng: detail.lng })
    } catch {
      // Leave the field editable -- the rider can just try another result.
    }
  }

  // Matches web's search/page.tsx navigateToRide: classifies the route
  // in-city vs outstation and either follows the rider's declared ride type
  // (redirecting if it can't actually serve this destination -- round trips
  // and rentals can't cross cities, one_way/rental can't stay in one) or,
  // when no ride type was declared (search bar/saved places/recent/popular),
  // auto-routes: in-city -> rental (City Rides), outstation -> trip-type
  // chooser.
  async function handleContinue() {
    if (!pickup || !drop || continuing) return
    setContinueError(null)
    // A one-way or round trip from a place to itself is a 0 km trip at the minimum fare, not a booking. (A city
    // rental can start and end at the same place, so it is allowed through.)
    if (rideTypeDeclared && rideType !== 'rental' && haversineMetres([pickup.lat, pickup.lng], [drop.lat, drop.lng]) < SAME_PLACE_METRES) {
      setContinueError('Pickup and drop are the same place. Choose a different drop-off.')
      return
    }
    setContinuing(true)
    // Defensive: a fresh Continue always starts clean, even if the drop-change
    // effect above didn't catch this particular path (e.g. re-tapping Continue
    // after a redirect's own timer already fired).
    if (redirectTimerRef.current) { clearTimeout(redirectTimerRef.current); redirectTimerRef.current = null }
    setRedirectToast(null)
    try {
      const [route, cityId, classification] = await Promise.all([
        fetchRoute(pickup.lat, pickup.lng, drop.lat, drop.lng),
        fetchNearestCityId(pickup.lat, pickup.lng),
        // Classification failure must not block booking -- fall back to the
        // safe "outstation" default (same default web's search page uses).
        fetchClassifyTrip(pickup.lat, pickup.lng, drop.lat, drop.lng),
      ])
      setRoute(route.distanceKm, route.durationMin, cityId, route.routePoints)
      // Where this trip goes next, by the rules in cityRideRoute.ts (Outstation, City Ride, Rental). Inside one city boundary it is a
      // city ride when the server says City ride is on, and exactly what the app did before (Rental) otherwise.
      const next = resolveInCityRoute({ rideTypeDeclared, rideType, tripMode, classification })
      // A route that becomes a city ride (it was undeclared, or an in-city one-way) is a one-way: pickup and drop cannot be the same
      // place. (A rental can start and end at the same place, which is why the check at the top skips undeclared trips.)
      if (next.tripMode === 'city' && haversineMetres([pickup.lat, pickup.lng], [drop.lat, drop.lng]) < SAME_PLACE_METRES) {
        setContinuing(false)
        setContinueError('Pickup and drop are the same place. Choose a different drop-off.')
        return
      }
      const cityLabel = classification?.scope === 'in_city' ? classification.cityName : 'the city'
      const toastText = {
        to_city: `That's inside ${cityLabel}, switching to City Ride`,
        to_rental: `That's inside ${cityLabel}, switching to Rental`,
        to_outstation: `That's outside ${cityLabel}, switching to Outstation`,
      } as const

      if (next.toast) {
        setRideType(next.rideType, next.rideTypeDeclared, next.tripMode)
        setContinuing(false)
        setRedirectToast(toastText[next.toast])
        if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = setTimeout(() => router.push(next.path), 1500)
        return
      }

      setContinuing(false)
      router.push(next.path)
    } catch (err) {
      setContinueError(getApiErrorMessage(err, "Couldn't work out that route. Please try again."))
      setContinuing(false)
    }
  }

  function openMapPicker() {
    router.push({ pathname: '/booking/map-picker', params: { field: editingField ?? 'drop' } })
  }

  // Auto-proceeds the instant both ends of the trip are known -- picking a
  // destination (the common last step) fires this immediately with a loader
  // on the Continue button, instead of making the rider tap Continue manually
  // after already telling the app where they're going. Guarded per unique
  // pickup+drop pair so a failed auto-attempt's manual retry tap doesn't
  // immediately re-trigger itself in a loop.
  const autoTriggeredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pickup || !drop) return
    const key = `${pickup.lat},${pickup.lng}|${drop.lat},${drop.lng}`
    if (autoTriggeredRef.current === key) return
    autoTriggeredRef.current = key
    void handleContinue()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleContinue closes over pickup/drop/rideType already in this render; including it would refire every render
  }, [pickup, drop])

  // Same wording as the home pill (pillTextFor), so both screens flip together at the 8 s fix cap.
  const pickupLabel = pickup ? pickup.address || 'Set pickup location' : approximate ? 'Set pickup location' : pillTextFor(freshness, '').text
  const canContinue = !!pickup && !!drop

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Fixed header: back button, title, route card, "Select on map" pill --
          mirrors web's own flex-shrink-0 header (never part of the scroll). */}
      <View style={styles.header}>
        <IconButton icon="arrow-left" label="Go back" onPress={() => { resetDraft(); goBack(router) }} />
        <Text style={styles.title}>Plan your trip</Text>
        <Pressable
          onPress={() => setRiderSheetOpen(true)}
          style={styles.riderPill}
          accessibilityRole="button"
          accessibilityLabel="Who's travelling"
        >
          <Feather name="user" size={16} color={h.ivory} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <PreciseLocationNotice />

      <View style={styles.headerBody}>
        {/* Fixed-height route card -- fields only ever show their own text or an
            inline TextInput, never a results list, so this card's height never
            jumps around while typing. The teal ring shows while a field is being edited. */}
        <View style={[styles.routeCard, editingField !== null ? styles.routeCardActive : null]}>
          <Pressable onPress={() => openField('pickup')} style={styles.fieldRow}>
            <View style={styles.dotSlot}><View style={styles.dotPickup} /></View>
            <View style={styles.fieldCol}>
              <Text style={styles.fieldLabel}>Pickup</Text>
              {editingField === 'pickup' ? (
                <View style={styles.fieldInputRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Enter pickup location"
                    placeholderTextColor={h.faint}
                    selectionColor={h.teal}
                    cursorColor={h.teal}
                    autoFocus
                    style={styles.fieldInput}
                  />
                  {query.length > 0 ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.clearBtn}>
                      <Feather name="x" size={14} color={h.faint} />
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={[styles.fieldText, !pickup ? styles.fieldPlaceholder : null]} numberOfLines={1}>
                  {pickupLabel}
                </Text>
              )}
            </View>
          </Pressable>
          <View style={styles.fieldDivider} />
          <Pressable onPress={() => openField('drop')} style={styles.fieldRow}>
            <View style={styles.dotSlot}><View style={styles.dotDrop} /></View>
            <View style={styles.fieldCol}>
              <Text style={[styles.fieldLabel, { color: h.tealText }]}>Drop</Text>
              {editingField === 'drop' ? (
                <View style={styles.fieldInputRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Enter destination"
                    placeholderTextColor={h.faint}
                    selectionColor={h.teal}
                    cursorColor={h.teal}
                    autoFocus
                    style={styles.fieldInput}
                  />
                  {query.length > 0 ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.clearBtn}>
                      <Feather name="x" size={14} color={h.faint} />
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={[styles.fieldText, !drop ? styles.fieldPlaceholder : null]} numberOfLines={1}>
                  {drop?.address ?? 'Enter destination'}
                </Text>
              )}
            </View>
          </Pressable>
          <View style={styles.dashed} pointerEvents="none" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
          <Pressable onPress={openMapPicker} style={({ pressed }) => [styles.chip, pressed ? styles.pressedScale : null]} accessibilityRole="button" accessibilityLabel="Select location on map">
            <Feather name="map" size={17} color={h.tealText} />
            <Text style={styles.chipText}>Select on map</Text>
          </Pressable>
          {/* Same commitPlace path as the Favourites rows below; just a shortcut for the two saved kinds. */}
          {savedPlaces.filter((p) => p.kind !== 'other').map((p) => (
            <Pressable key={p.id} onPress={() => void commitPlace({ address: p.address, lat: p.lat, lng: p.lng })} style={({ pressed }) => [styles.chip, pressed ? styles.pressedScale : null]} accessibilityRole="button" accessibilityLabel={p.label}>
              <Feather name={SAVED_ICON[p.kind]} size={17} color={h.ivory} />
              <Text style={styles.chipText}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Scrollable middle: results only. Header above and footer below never move. */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {showSuggestions ? (
          loading && results.length === 0 ? (
            <View style={styles.hintRow}>
              <ActivityIndicator size="small" color={h.teal} />
              <Text style={styles.hint}>Searching…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={retry} hitSlop={8}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : results.length === 0 ? (
            <Text style={styles.hint}>Nothing found. Try a different search.</Text>
          ) : (
            <View style={styles.group}>
            {results.map((r, i) => (
              <PlaceRow
                key={r.placeId}
                icon="map-pin"
                label={r.description.split(',')[0] ?? r.description}
                address={r.description}
                onPress={() => void handleSelectSuggestion(r.placeId, r.description)}
                last={i === results.length - 1}
                distance={editingField === 'drop' && r.distanceMetres !== undefined ? formatEstimatedRoadKm(r.distanceMetres) : undefined}
              />
            ))}
            </View>
          )
        ) : (
          <>
            {recents.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Recent</Text>
                <View style={styles.group}>
                {recents.map((r, i) => (
                  <PlaceRow
                    key={`${r.address}-${i}`}
                    icon="clock"
                    label={r.address.split(',')[0] ?? r.address}
                    address={r.address}
                    onPress={() => void commitPlace(r)}
                    last={i === recents.length - 1}
                    distance={editingField === 'drop' ? distanceFromPickup(pickup, r.lat, r.lng) : undefined}
                  />
                ))}
                </View>
              </View>
            ) : null}
            {savedPlaces.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Favourites</Text>
                <View style={styles.group}>
                {savedPlaces.map((p, i) => (
                  <PlaceRow
                    key={p.id}
                    icon={SAVED_ICON[p.kind]}
                    label={p.label}
                    address={p.address}
                    onPress={() => void commitPlace({ address: p.address, lat: p.lat, lng: p.lng })}
                    last={i === savedPlaces.length - 1}
                    distance={editingField === 'drop' ? distanceFromPickup(pickup, p.lat, p.lng) : undefined}
                  />
                ))}
                </View>
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Popular</Text>
              <View style={styles.group}>
              {POPULAR.map((p, i) => (
                <PlaceRow
                  key={p.label}
                  icon={p.icon}
                  tone="teal"
                  label={p.label}
                  address={p.address}
                  onPress={() => void commitPlace({ address: p.address, lat: p.lat, lng: p.lng })}
                  last={i === POPULAR.length - 1}
                  distance={editingField === 'drop' ? distanceFromPickup(pickup, p.lat, p.lng) : undefined}
                />
              ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Fixed footer: Continue never drifts up/down as the results area above
          changes height -- the exact instability this redesign fixes. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(246,251,251,0)', h.canvas]} style={styles.fade} />
        {continueError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {continueError}
          </Text>
        ) : null}
        <Button
          variant="cta"
          label="Continue"
          onPress={() => void handleContinue()}
          loading={continuing}
          disabled={!canContinue}
          accessibilityLabel="Continue to fare estimate"
        />
      </View>

      <RiderSheet
        visible={riderSheetOpen}
        onClose={() => setRiderSheetOpen(false)}
        riderName={riderName}
        riderPhone={riderPhone}
        onCommit={(name, phone) => { setRider(name, phone); setRiderSheetOpen(false) }}
        onClearToMyself={() => { clearRider(); setRiderSheetOpen(false) }}
      />

      <RedirectToast message={redirectToast} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12 },
  headerBody: { paddingHorizontal: 18, paddingTop: 22, gap: 14 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory, flex: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08, maxWidth: 150 },
  riderPillText: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flexShrink: 1 },
  routeCard: { backgroundColor: h.surface, borderRadius: 20, borderWidth: 1.5, borderColor: h.line10, boxShadow: '0 2px 8px rgba(20,23,26,0.06)', paddingVertical: 4 },
  routeCardActive: { borderColor: h.tealCta, boxShadow: '0 0 0 4px rgba(14,143,163,0.10), 0 2px 8px rgba(20,23,26,0.06)' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingLeft: 18, paddingRight: 18, minHeight: 62 },
  dotSlot: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dotPickup: { width: 12, height: 12, borderRadius: 6, backgroundColor: h.teal, boxShadow: '0 0 0 4px rgba(14,143,163,0.16)' },
  dotDrop: { width: 10, height: 10, borderRadius: 3, backgroundColor: h.ivory },
  fieldCol: { flex: 1, minWidth: 0 },
  fieldLabel: { fontFamily: font.sb, fontSize: 11.5, color: h.label, marginBottom: 2 },
  fieldDivider: { height: 1, backgroundColor: h.line07, marginLeft: 44 },
  dashed: { position: 'absolute', left: 23, top: 44, height: 46, borderLeftWidth: 1.5, borderLeftColor: '#B3C0C3', borderStyle: 'dashed' },
  fieldInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  fieldInput: { fontFamily: font.sb, fontSize: 15, color: h.ivory, padding: 0, flex: 1 },
  clearBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  fieldText: { fontFamily: font.sb, fontSize: 15, color: h.ivory },
  fieldPlaceholder: { color: h.faint, fontFamily: font.r },
  chips: { gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10 },
  chipText: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 },
  group: { backgroundColor: h.surface, borderRadius: 20, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05)', overflow: 'hidden' },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  hint: { fontFamily: font.m, fontSize: 14, color: h.muted, textAlign: 'center', paddingVertical: spacing.lg },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  errorText: { fontFamily: font.m, fontSize: 14, color: h.danger, flex: 1 },
  retryText: { fontFamily: font.b, fontSize: 13, color: h.tealText },
  section: { marginBottom: 14 },
  sectionLabel: { ...sectionLabel, marginHorizontal: 2, marginTop: 14, marginBottom: 10 },
  error: { fontFamily: font.m, fontSize: 14, color: h.danger, marginBottom: spacing.xs },
  fade: { position: 'absolute', left: 0, right: 0, top: -40, height: 40 },
  footer: { paddingHorizontal: 18, paddingTop: 10, backgroundColor: h.canvas },
})
