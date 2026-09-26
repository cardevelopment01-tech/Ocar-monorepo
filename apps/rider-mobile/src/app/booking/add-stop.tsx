import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import { PlaceRow } from '@/features/booking/components/PlaceRow'
import { fetchPlaceDetail } from '@/features/booking/api'
import { useAutocomplete } from '@/features/booking/hooks/useAutocomplete'
import { useBookingDraftStore } from '@/features/booking/store'
import { sectionLabel } from '@/theme/homeTokens'

// Matches web's AddStopSheet (apps/user/components/route/AddStopSheet.tsx) --
// adapted to a full screen (this app's search/map-picker already use the
// full-screen pattern instead of web's in-context bottom sheet) rather than a
// literal port of the sheet chrome.
const POPULAR = [
  { label: 'Cuttack City', address: 'Cuttack, Odisha', lat: 20.4625, lng: 85.883 },
  { label: 'Puri Railway Station', address: 'Puri, Odisha', lat: 19.8014, lng: 85.8142 },
  { label: 'Bhubaneswar Airport', address: 'Bhubaneswar Airport', lat: 20.2444, lng: 85.8178 },
  { label: 'KIIT University', address: 'Patia, Bhubaneswar', lat: 20.356, lng: 85.8181 },
  { label: 'Jagannath Temple, Puri', address: 'Grand Road, Puri', lat: 19.8048, lng: 85.818 },
]

export default function AddStopScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const addStop = useBookingDraftStore((s) => s.addStop)

  const [query, setQuery] = useState('')
  const bias = pickup ? { lat: pickup.lat, lng: pickup.lng } : {}
  const { results, loading, error, retry } = useAutocomplete(query, bias)
  const [resolving, setResolving] = useState(false)
  const showSuggestions = query.trim().length >= 2

  async function pick(placeId: string, description: string) {
    setResolving(true)
    try {
      const d = await fetchPlaceDetail(placeId)
      addStop({ address: d.address || description, lat: d.lat, lng: d.lng })
      router.back()
    } catch {
      setResolving(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
          <Feather name="arrow-left" size={17} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Add a stop</Text>
      </View>

      <View style={styles.searchBar}>
        <Feather name="search" size={15} color={colors.ink400} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a stop"
          placeholderTextColor={colors.ink400}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          autoFocus
          style={styles.searchInput}
        />
        {resolving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

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
                onPress={() => void pick(r.placeId, r.description)}
                last={i === results.length - 1}
              />
            ))
          )
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>POPULAR</Text>
            {POPULAR.map((p, i) => (
              <PlaceRow
                key={p.label}
                icon="map-pin"
                label={p.label}
                address={p.address}
                onPress={() => { addStop({ address: p.address, lat: p.lat, lng: p.lng }); router.back() }}
                last={i === POPULAR.length - 1}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  backButton: { width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(20,23,26,0.08)',
    boxShadow: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)', alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  searchInput: { ...typography.body, color: colors.ink900, flex: 1, padding: 0 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  hint: { ...typography.body, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.lg },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  errorText: { ...typography.body, color: colors.error, flex: 1 },
  retryText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  section: { marginBottom: spacing.sm },
  sectionLabel: { ...sectionLabel, marginBottom: spacing.xs },
})
