import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Input, Text, colors, fonts, mapSaveError, radii, spacing, typography } from '@ocar/mobile-shared'
import { ScreenHeader } from '@/features/profile/ScreenHeader'
import { createSavedPlace, deleteSavedPlace, updateSavedPlace } from '@/features/profile/api'
import { fetchSavedPlaces, type SavedPlace } from '@/features/booking/api'
import { PlaceAutocompleteField } from '@/features/booking/components/PlaceAutocompleteField'
import type { BookingPlace } from '@/features/booking/store'

type Kind = SavedPlace['kind']
type Editing = { kind: Kind; existing: SavedPlace | null }

const ICON: Record<Kind, React.ComponentProps<typeof Feather>['name']> = { home: 'home', work: 'briefcase', other: 'map-pin' }
// Same default the booking home map uses when there's no GPS fix yet (Bhubaneswar).
const BIAS = { lat: 20.2961, lng: 85.8245 }

export default function SavedPlacesScreen() {
  const insets = useSafeAreaInsets()
  const [places, setPlaces] = useState<SavedPlace[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [picked, setPicked] = useState<BookingPlace | null>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function load() {
    setFailed(false)
    fetchSavedPlaces().then(setPlaces).catch(() => setFailed(true)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const home = places.find((p) => p.kind === 'home') ?? null
  const work = places.find((p) => p.kind === 'work') ?? null
  const others = places.filter((p) => p.kind === 'other')

  function open(kind: Kind, existing: SavedPlace | null) {
    setEditing({ kind, existing })
    setPicked(existing ? { address: existing.address, lat: existing.lat, lng: existing.lng } : null)
    setLabel(existing?.kind === 'other' ? existing.label : '')
    setErr('')
  }

  async function save() {
    if (!editing || !picked) return
    setSaving(true)
    setErr('')
    try {
      const base = { address: picked.address, lat: picked.lat, lng: picked.lng }
      const withLabel = editing.kind === 'other' ? { ...base, label: label.trim() } : base
      if (editing.existing) await updateSavedPlace(editing.existing.id, withLabel)
      else await createSavedPlace({ kind: editing.kind, ...withLabel })
      setEditing(null)
      load()
    } catch (e) {
      setErr(mapSaveError(e))
    } finally {
      setSaving(false)
    }
  }

  function confirmRemove(p: SavedPlace) {
    Alert.alert(`Remove ${p.label}?`, p.address, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setPlaces((prev) => prev.filter((x) => x.id !== p.id))
          deleteSavedPlace(p.id).catch(load)
        },
      },
    ])
  }

  if (editing) {
    const title = editing.kind === 'other' ? (editing.existing ? 'Edit place' : 'Add a place') : `${editing.kind === 'home' ? 'Home' : 'Work'} address`
    const canSave = !!picked && (editing.kind !== 'other' || label.trim().length > 0) && !saving
    return (
      <View style={styles.container}>
        <ScreenHeader title={title} onBack={() => setEditing(null)} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {editing.kind === 'other' ? (
            <Input label="Name" value={label} onChangeText={setLabel} placeholder="e.g. Gym, Parents' house" maxLength={60} />
          ) : null}
          <PlaceAutocompleteField
            label="Address"
            placeholder="Search for an address"
            accessibilityHint="Type at least two characters to search"
            bias={BIAS}
            value={picked}
            onSelect={setPicked}
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button label="Save place" onPress={save} loading={saving} disabled={!canSave} />
        </ScrollView>
      </View>
    )
  }

  const renderRow = (kind: Kind, title: string, p: SavedPlace | null) => (
    <Pressable key={p?.id ?? kind} onPress={() => open(kind, p)} style={styles.row} accessibilityRole="button">
      <View style={styles.icon}><Feather name={ICON[kind]} size={16} color={p ? colors.primary : colors.ink400} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{p ? p.address : `Add your ${title.toLowerCase()} address`}</Text>
      </View>
      {p ? (
        <Pressable onPress={() => confirmRemove(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${p.label}`}>
          <Feather name="trash-2" size={17} color={colors.ink400} />
        </Pressable>
      ) : (
        <Feather name="plus" size={16} color={colors.primary} />
      )}
    </Pressable>
  )

  return (
    <View style={styles.container}>
      <ScreenHeader title="Saved places" />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : failed ? (
        <Pressable onPress={() => { setLoading(true); load() }}>
          <Text style={styles.retry}>Couldn't load your places. Tap to retry.</Text>
        </Pressable>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.card}>
            {renderRow('home', 'Home', home)}
            <View style={styles.divider} />
            {renderRow('work', 'Work', work)}
            {others.map((p) => (
              <View key={p.id}>
                <View style={styles.divider} />
                {renderRow('other', p.label, p)}
              </View>
            ))}
          </View>
          <Button label="Add a place" variant="ghost" icon="plus" onPress={() => open('other', null)} />
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  divider: { height: 1, backgroundColor: colors.borderLight },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  rowSub: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  err: { ...typography.caption, color: colors.error },
  retry: { ...typography.body, color: colors.primary, textAlign: 'center', marginTop: spacing.xl },
})
