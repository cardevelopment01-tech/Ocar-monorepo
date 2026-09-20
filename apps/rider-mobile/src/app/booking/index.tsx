import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { PlaceRow } from '@/features/booking/components/PlaceRow'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { fetchClassifyTrip, fetchNearestCityId, fetchPlaceDetail, fetchRoute, fetchSavedPlaces, type SavedPlace } from '@/features/booking/api'
import { useAutocomplete } from '@/features/booking/hooks/useAutocomplete'
import { useBookingDraftStore, type BookingPlace } from '@/features/booking/store'
import type { RideType } from '@/features/booking/api'
import { useLocationStore } from '@/store/useLocationStore'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'
import { RedirectToast } from '@/features/booking/components/RedirectToast'

type ActiveField = 'pickup' | 'drop'

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
  const setPickup = useBookingDraftStore((s) => s.setPickup)
  const setDrop = useBookingDraftStore((s) => s.setDrop)
  const setRoute = useBookingDraftStore((s) => s.setRoute)
  const rideType = useBookingDraftStore((s) => s.rideType)
  const rideTypeDeclared = useBookingDraftStore((s) => s.rideTypeDeclared)
  const setRideType = useBookingDraftStore((s) => s.setRideType)
  const riderName = useBookingDraftStore((s) => s.riderName)
  const riderPhone = useBookingDraftStore((s) => s.riderPhone)
  const setRider = useBookingDraftStore((s) => s.setRider)
  const clearRider = useBookingDraftStore((s) => s.clearRider)
  const resetDraft = useBookingDraftStore((s) => s.reset)
  const bookingForOther = riderName !== '' && riderPhone !== ''
  const [riderSheetOpen, setRiderSheetOpen] = useState(false)

  const location = useLocationStore()
  const recents = useRecentSearchesStore((s) => s.recents)
  const addRecent = useRecentSearchesStore((s) => s.addRecent)

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([])
  // Supplementary quick-picks -- a failed fetch must never block search, just
  // show fewer rows (same tolerance as the recent-searches/pickup-GPS paths).
  useEffect(() => { fetchSavedPlaces().then(setSavedPlaces).catch(() => {}) }, [])

  // Pickup is always current location by default (per the search-flow redesign
  // this replaced) -- filled the instant useLocationStore resolves, which is
  // usually already in flight (or done) by the time this screen mounts, since
  // root layout kicks it off at app open. Tapping FROM still lets the rider
  // override it, same as web.
  useEffect(() => {
    if (pickup || !location.ready || location.permissionDenied || location.lat === null) return
    setPickup({ address: location.address || 'Current Location', lat: location.lat, lng: location.lng! })
  }, [pickup, location.ready, location.permissionDenied, location.lat, location.lng, location.address, setPickup])

  // Which field is actively showing a TextInput right now -- null means both
  // rows show their confirmed/placeholder text. Distinct from "which field was
  // last touched": after committing a place, editing ends (null), rather than
  // leaving that row stuck rendering an now-empty input over its real value.
  const [editingField, setEditingField] = useState<ActiveField | null>('drop')
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
  const enteredDeclaredRef = useRef<{ rideType: RideType; declared: boolean } | null>(null)
  if (enteredDeclaredRef.current === null) enteredDeclaredRef.current = { rideType, declared: rideTypeDeclared }

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
      setRideType(entry.rideType, entry.declared)
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
    setContinuing(true)
    setContinueError(null)
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
      const isInCity = classification?.scope === 'in_city'
      const cityLabel = classification?.scope === 'in_city' ? classification.cityName : 'the city'

      function redirectWithToast(path: '/booking/rental' | '/booking/fare' | '/booking/trip-type', message: string, resolvedRideType?: 'one_way' | 'rental') {
        if (resolvedRideType) setRideType(resolvedRideType, true)
        setContinuing(false)
        setRedirectToast(message)
        if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = setTimeout(() => router.push(path), 1500)
      }

      if (!rideTypeDeclared) {
        if (isInCity) redirectWithToast('/booking/rental', `That's inside ${cityLabel}, switching to City Rides`, 'rental')
        else { setContinuing(false); router.push('/booking/trip-type') }
        return
      }

      if ((rideType === 'one_way' || rideType === 'round_trip') && isInCity) {
        redirectWithToast('/booking/rental', `That's inside ${cityLabel}, switching to City Rides`, 'rental')
        return
      }
      if (rideType === 'rental' && !isInCity) {
        redirectWithToast('/booking/fare', `That's outside ${cityLabel}, switching to One Way`, 'one_way')
        return
      }

      setContinuing(false)
      router.push(
        rideType === 'round_trip' ? '/booking/round-trip' : rideType === 'rental' ? '/booking/rental' : '/booking/fare'
      )
    } catch {
      setContinueError("Couldn't work out that route — try again")
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

  const pickupLabel = !location.ready && !pickup
    ? 'Finding your location…'
    : pickup?.address || 'Set pickup location'
  const canContinue = !!pickup && !!drop

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Fixed header: back button, title, route card, "Select on map" pill --
          mirrors web's own flex-shrink-0 header (never part of the scroll). */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { resetDraft(); router.back() }}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressedScale : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Plan your trip</Text>
        <Pressable
          onPress={() => setRiderSheetOpen(true)}
          style={styles.riderPill}
          accessibilityRole="button"
          accessibilityLabel="Who's travelling"
        >
          <Feather name="user" size={11} color={colors.primaryDark} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <View style={styles.headerBody}>
        {/* Fixed-height route card -- fields only ever show their own text or an
            inline TextInput, never a results list, so this card's height never
            jumps around while typing (the instability the redesign fixes). */}
        <View style={styles.routeCard}>
          <View style={styles.connector}>
            <View style={styles.dotPickup} />
            <View style={styles.dashedLine} />
            <View style={styles.dotDrop} />
          </View>
          <View style={styles.fieldsColumn}>
            <Pressable onPress={() => openField('pickup')} style={styles.fieldRow}>
              {editingField === 'pickup' ? (
                <View style={styles.fieldInputRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Enter pickup location"
                    placeholderTextColor={colors.ink400}
                    selectionColor={colors.primary}
                    cursorColor={colors.primary}
                    autoFocus
                    style={styles.fieldInput}
                  />
                  {query.length > 0 ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.clearBtn}>
                      <Feather name="x" size={13} color={colors.ink400} />
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={[styles.fieldText, !pickup ? styles.fieldPlaceholder : null]} numberOfLines={1}>
                  {pickupLabel}
                </Text>
              )}
            </Pressable>
            <Pressable onPress={() => openField('drop')} style={styles.fieldRowLast}>
              {editingField === 'drop' ? (
                <View style={styles.fieldInputRow}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Enter destination"
                    placeholderTextColor={colors.ink400}
                    selectionColor={colors.primary}
                    cursorColor={colors.primary}
                    autoFocus
                    style={styles.fieldInput}
                  />
                  {query.length > 0 ? (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.clearBtn}>
                      <Feather name="x" size={13} color={colors.ink400} />
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={[styles.fieldText, !drop ? styles.fieldPlaceholder : null]} numberOfLines={1}>
                  {drop?.address ?? 'Enter destination'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={openMapPicker}
          style={({ pressed }) => [styles.mapPill, pressed ? styles.pressedScale : null]}
          accessibilityRole="button"
          accessibilityLabel="Select location on map"
        >
          <Feather name="map" size={14} color={colors.primary} />
          <Text style={styles.mapPillText}>Select on map</Text>
        </Pressable>
      </View>

      {/* Scrollable middle: results only. Header above and footer below never move. */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
        {showSuggestions ? (
          loading ? (
            <View style={styles.hintRow}>
              <ActivityIndicator size="small" color={colors.primary} />
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
            results.map((r, i) => (
              <PlaceRow
                key={r.placeId}
                icon="map-pin"
                label={r.description.split(',')[0] ?? r.description}
                address={r.description}
                onPress={() => void handleSelectSuggestion(r.placeId, r.description)}
                last={i === results.length - 1}
              />
            ))
          )
        ) : (
          <>
            {recents.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>RECENT</Text>
                {recents.map((r, i) => (
                  <PlaceRow
                    key={`${r.address}-${i}`}
                    icon="clock"
                    label={r.address.split(',')[0] ?? r.address}
                    address={r.address}
                    onPress={() => void commitPlace(r)}
                    last={i === recents.length - 1}
                  />
                ))}
              </View>
            ) : null}
            {savedPlaces.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>FAVOURITES</Text>
                {savedPlaces.map((p, i) => (
                  <PlaceRow
                    key={p.id}
                    icon={SAVED_ICON[p.kind]}
                    label={p.label}
                    address={p.address}
                    onPress={() => void commitPlace({ address: p.address, lat: p.lat, lng: p.lng })}
                    last={i === savedPlaces.length - 1}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>POPULAR</Text>
              {POPULAR.map((p, i) => (
                <PlaceRow
                  key={p.label}
                  icon={p.icon}
                  label={p.label}
                  address={p.address}
                  onPress={() => void commitPlace({ address: p.address, lat: p.lat, lng: p.lng })}
                  last={i === POPULAR.length - 1}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Fixed footer: Continue never drifts up/down as the results area above
          changes height -- the exact instability this redesign fixes. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {continueError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {continueError}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void handleContinue()}
          disabled={!canContinue || continuing}
          style={({ pressed }) => [
            styles.continueBtn,
            !canContinue || continuing ? styles.disabled : null,
            pressed && canContinue && !continuing ? styles.pressedScale : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue to fare estimate"
        >
          {continuing ? <ActivityIndicator color={colors.inkInverse} /> : <Text style={styles.continueText}>Continue</Text>}
        </Pressable>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  headerBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedScale: { transform: [{ scale: 0.97 }] },
  title: { ...typography.title, color: colors.ink900, fontWeight: '700', flex: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface2, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, maxWidth: 110 },
  riderPillText: { ...typography.caption, color: colors.ink900, fontWeight: '700' },
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
  fieldRow: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.borderLight, justifyContent: 'center', minHeight: 44 },
  fieldRowLast: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 2, justifyContent: 'center', minHeight: 44 },
  fieldInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  fieldInput: { ...typography.body, color: colors.ink900, padding: 0, flex: 1 },
  clearBtn: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  fieldText: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  fieldPlaceholder: { color: colors.ink400, fontWeight: '400' },
  mapPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mapPillText: { ...typography.caption, color: colors.ink600, fontWeight: '700' },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  hint: { ...typography.body, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.lg },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  errorText: { ...typography.body, color: colors.error, flex: 1 },
  retryText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  section: { marginBottom: spacing.sm },
  sectionLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.xs },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.bg },
  continueBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  disabled: { opacity: 0.5 },
  continueText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
})
