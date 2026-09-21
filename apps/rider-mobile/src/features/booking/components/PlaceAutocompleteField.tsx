import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Input, colors, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
import { useAutocomplete } from '../hooks/useAutocomplete'
import type { BookingPlace } from '../store'
import { fetchPlaceDetail } from '../api'

export type PlaceAutocompleteFieldProps = {
  label: string
  placeholder: string
  accessibilityHint: string
  bias: { lat?: number; lng?: number }
  value: BookingPlace | null
  onSelect: (place: BookingPlace) => void
  // Renders without a label or border, for composing inside a card that
  // draws its own chrome (e.g. the pickup/drop dot-and-line connector) --
  // matches the real web app's unified from/to card
  // (apps/user/app/(main)/search/page.tsx), which has no per-field label
  // or border either.
  bare?: boolean
}

export function PlaceAutocompleteField({
  label,
  placeholder,
  accessibilityHint,
  bias,
  value,
  onSelect,
  bare = false,
}: PlaceAutocompleteFieldProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [resolving, setResolving] = useState(false)
  const { results, loading, error, retry } = useAutocomplete(query, bias)

  const showDropdown = focused && (query.trim().length >= 2)

  async function handleSelect(placeId: string, description: string) {
    setResolving(true)
    try {
      const detail = await fetchPlaceDetail(placeId)
      onSelect({ address: detail.address || description, lat: detail.lat, lng: detail.lng })
      setQuery('')
      setFocused(false)
    } catch {
      // Leave the dropdown open and the input editable, per the Error &
      // Rescue Registry's "input stays editable" rule -- not a raw error.
    } finally {
      setResolving(false)
    }
  }

  return (
    <View style={styles.container}>
      <Input
        {...(bare ? {} : { label })}
        value={focused ? query : (value?.address ?? query)}
        onChangeText={(text) => {
          setQuery(text)
          if (!focused) setFocused(true)
        }}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        accessibilityRole="search"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        allowFontScaling
        style={bare ? styles.bareInput : undefined}
      />
      {showDropdown ? (
        <View style={styles.dropdown}>
          {loading ? (
            <View style={styles.rowsSkeleton}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.skeletonRow} />
              ))}
            </View>
          ) : error ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {error}
              </Text>
              <Pressable
                onPress={retry}
                accessibilityRole="button"
                accessibilityLabel="Retry search"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No results</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {results.map((item) => (
                <Pressable
                  key={item.placeId}
                  style={styles.resultRow}
                  onPress={() => handleSelect(item.placeId, item.description)}
                  accessibilityRole="button"
                  accessibilityLabel={item.description}
                >
                  <Text style={styles.resultText} numberOfLines={2}>
                    {item.description}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {resolving ? (
            <View style={styles.resolvingOverlay}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  bareInput: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
  },
  dropdown: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 240,
    overflow: 'hidden',
    ...shadows.card,
  },
  rowsSkeleton: { padding: spacing.sm, gap: spacing.sm },
  skeletonRow: { height: 18, borderRadius: radii.sm, backgroundColor: colors.surface3 },
  errorRow: { padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorText: { ...typography.body, color: colors.error, flex: 1 },
  retryText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  emptyRow: { padding: spacing.md },
  emptyText: { ...typography.body, color: colors.ink400 },
  resultRow: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  resultText: { ...typography.body, color: colors.ink900 },
  resolvingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
