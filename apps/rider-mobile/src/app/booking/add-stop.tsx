import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { formatEstimatedRoadKm } from '@ocar/shared'
import { Text, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { fetchPlaceDetail, fetchSavedPlaces, type SavedPlace } from '@/features/booking/api'
import { MAX_STOPS } from '@/features/booking/constants'
import { useAutocomplete } from '@/features/booking/hooks/useAutocomplete'
import { useBookingDraftStore } from '@/features/booking/store'
import { useRecentSearchesStore } from '@/store/useRecentSearchesStore'

// Add a stop (design: RentalAddStop.dc.html). Used by the rental and round-trip flows alike: search, recents, popular
// places and saved Home / Work, all adding through the booking store's own addStop.
// Matches web's AddStopSheet (apps/user/components/route/AddStopSheet.tsx), adapted to a full screen.
const POPULAR = [
  { label: 'Cuttack City', address: 'Cuttack, Odisha', lat: 20.4625, lng: 85.883 },
  { label: 'Puri Railway Station', address: 'Puri, Odisha', lat: 19.8014, lng: 85.8142 },
  { label: 'Bhubaneswar Airport', address: 'Bhubaneswar Airport', lat: 20.2444, lng: 85.8178 },
  { label: 'KIIT University', address: 'Patia, Bhubaneswar', lat: 20.356, lng: 85.8181 },
  { label: 'Jagannath Temple, Puri', address: 'Grand Road, Puri', lat: 19.8048, lng: 85.818 },
]

type IconName = React.ComponentProps<typeof Feather>['name']
const SAVED_ICON: Record<SavedPlace['kind'], IconName> = { home: 'home', work: 'briefcase', other: 'map-pin' }

function Row({ icon, hit, name, sub, away, onPress, disabled }: { icon: IconName; hit?: string; name: string; sub: string; away?: string | undefined; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${sub}`}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null, disabled ? styles.rowOff : null]}
    >
      <View style={styles.rowIcon}><Feather name={icon} size={20} color={h.ivory} /></View>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {hit ? <Text style={styles.rowHit}>{hit}</Text> : null}
          {hit ? name.slice(hit.length) : name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      {away ? <Text style={styles.rowAway}>{away}</Text> : null}
    </Pressable>
  )
}

export default function AddStopScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const stopCount = useBookingDraftStore((s) => s.stops.length)
  const addStop = useBookingDraftStore((s) => s.addStop)
  const recents = useRecentSearchesStore((s) => s.recents)
  const full = stopCount >= MAX_STOPS

  const [query, setQuery] = useState('')
  const bias = pickup ? { lat: pickup.lat, lng: pickup.lng } : {}
  const { results, loading, error, retry } = useAutocomplete(query, bias)
  const [resolving, setResolving] = useState(false)
  const showSuggestions = query.trim().length >= 2

  // Supplementary quick picks: a failed fetch just shows fewer chips.
  const [saved, setSaved] = useState<SavedPlace[]>([])
  useEffect(() => { fetchSavedPlaces().then(setSaved).catch(() => {}) }, [])
  const quick = saved.filter((p) => p.kind !== 'other')

  async function pick(placeId: string, description: string) {
    setResolving(true)
    try {
      const d = await fetchPlaceDetail(placeId)
      addStop({ address: d.address || description, lat: d.lat, lng: d.lng })
      goBack(router)
    } catch {
      setResolving(false)
    }
  }

  function addKnown(p: { address: string; lat: number; lng: number }) {
    addStop({ address: p.address, lat: p.lat, lng: p.lng })
    goBack(router)
  }

  const q = query.trim()
  const counter = `Stop ${Math.min(stopCount + 1, MAX_STOPS)} of ${MAX_STOPS}`
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" label="Cancel" onPress={() => goBack(router)} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Add a stop</Text>
          <Text style={styles.subtitle}>Between pickup and drop</Text>
        </View>
        <View style={[styles.count, full ? styles.countFull : null]} accessibilityLabel={counter}>
          <Text style={[styles.countText, full ? styles.countTextFull : null]}>{counter}</Text>
        </View>
      </View>

      <View style={styles.search}>
        <Feather name="search" size={18} color={h.label} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a stop"
          placeholderTextColor={h.faint}
          selectionColor={h.tealCta}
          cursorColor={h.tealCta}
          autoFocus
          style={styles.searchInput}
        />
        {resolving ? <ActivityIndicator size="small" color={h.tealCta} /> : null}
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={6} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
            <Feather name="x" size={14} color="#3C4247" />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {full ? <Text style={styles.note}>{`You have added the maximum of ${MAX_STOPS} stops. Remove one to add another.`}</Text> : null}
        {showSuggestions ? (
          <>
            <Text style={styles.sectionFirst}>Results</Text>
            {loading && results.length === 0 ? (
              <View style={styles.hintRow}>
                <ActivityIndicator size="small" color={h.tealCta} />
                <Text style={styles.hint}>Searching…</Text>
              </View>
            ) : error ? (
              <View style={styles.errorRow}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={retry} hitSlop={8} accessibilityRole="button"><Text style={styles.retryText}>Retry</Text></Pressable>
              </View>
            ) : results.length === 0 ? (
              <Text style={styles.hint}>Nothing found. Try a different search.</Text>
            ) : (
              results.map((r) => {
                const name = r.description.split(',')[0] ?? r.description
                const hit = name.toLowerCase().startsWith(q.toLowerCase()) ? name.slice(0, q.length) : undefined
                return (
                  <Row
                    key={r.placeId}
                    icon="map-pin"
                    {...(hit ? { hit } : {})}
                    name={name}
                    sub={r.description}
                    away={r.distanceMetres !== undefined ? formatEstimatedRoadKm(r.distanceMetres) : undefined}
                    disabled={full}
                    onPress={() => void pick(r.placeId, r.description)}
                  />
                )
              })
            )}
          </>
        ) : (
          <>
            {quick.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} style={styles.chipsScroll}>
                {quick.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => addKnown({ address: p.address, lat: p.lat, lng: p.lng })}
                    disabled={full}
                    accessibilityRole="button"
                    accessibilityLabel={p.label}
                    style={({ pressed }) => [styles.chip, pressed ? styles.rowPressed : null, full ? styles.rowOff : null]}
                  >
                    <Feather name={SAVED_ICON[p.kind]} size={17} color={h.ivory} />
                    <Text style={styles.chipText}>{p.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {recents.length > 0 ? (
              <>
                <Text style={quick.length > 0 ? styles.section : styles.sectionFirst}>Recent</Text>
                {recents.map((r) => (
                  <Row key={`${r.lat}-${r.lng}`} icon="clock" name={r.address.split(',')[0] ?? r.address} sub={r.address} disabled={full} onPress={() => addKnown(r)} />
                ))}
              </>
            ) : null}

            <Text style={quick.length > 0 || recents.length > 0 ? styles.section : styles.sectionFirst}>Popular</Text>
            {POPULAR.map((p) => (
              <Row key={p.label} icon="map-pin" name={p.label} sub={p.address} disabled={full} onPress={() => addKnown(p)} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 13, color: h.muted, marginTop: 1 },
  count: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: h.tealWash, justifyContent: 'center' },
  countFull: { backgroundColor: '#FBF1D9' },
  countText: { fontFamily: font.b, fontSize: 13, color: h.tealText, fontVariant: ['tabular-nums'] },
  countTextFull: { color: '#7A5410' },

  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, marginTop: 18, marginHorizontal: 18, paddingLeft: 16, paddingRight: 8, borderRadius: 16, backgroundColor: h.surface, borderWidth: 1.5, borderColor: h.tealCta, boxShadow: '0 0 0 4px rgba(14,143,163,0.09)' },
  searchInput: { flex: 1, padding: 0, fontFamily: font.sb, fontSize: 15, color: h.ivory },
  clear: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },

  body: { flex: 1, marginTop: 6 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 12 },
  chipsScroll: { flexGrow: 0 },
  chips: { gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 12, paddingRight: 16, borderRadius: 22, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08 },
  chipText: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  section: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginTop: 24, marginBottom: 2, marginHorizontal: 2 },
  sectionFirst: { fontFamily: font.sb, fontSize: 14, color: h.ivory, marginBottom: 2, marginHorizontal: 2 },
  note: { fontFamily: font.m, fontSize: 13, lineHeight: 19, color: h.muted, marginBottom: 12, marginHorizontal: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: h.line07 },
  rowPressed: { opacity: 0.7 },
  rowOff: { opacity: 0.4 },
  rowIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  rowHit: { fontFamily: font.xb, color: h.tealText },
  rowSub: { fontFamily: font.r, fontSize: 13, color: h.muted, marginTop: 2 },
  rowAway: { fontFamily: font.sb, fontSize: 12.5, color: h.label, flexShrink: 0, fontVariant: ['tabular-nums'] },

  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  hint: { fontFamily: font.r, fontSize: 14.5, color: h.faint, textAlign: 'center', paddingVertical: 24 },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 },
  errorText: { fontFamily: font.r, fontSize: 14.5, color: h.danger, flex: 1 },
  retryText: { fontFamily: font.b, fontSize: 14.5, color: h.tealText },
})
