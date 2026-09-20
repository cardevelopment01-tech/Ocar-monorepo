import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import { colors, radii, shadows, spacing, typography } from '@ocar/mobile-shared'

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  )
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return <Text style={styles.fieldError}>{message}</Text>
}

export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.ink400}
      selectionColor={colors.primary}
      cursorColor={colors.primary}
      {...props}
      style={[styles.input, props.style]}
    />
  )
}

export type ChipOption = { value: string; label: string }

export function ChipGroup({ options, value, multiValue, onChange, columns }: { options: ChipOption[]; value?: string | null; multiValue?: string[]; onChange: (v: string) => void; columns?: number }) {
  return (
    <View style={[styles.chipRow, columns ? { flexWrap: 'nowrap' } : null]}>
      {options.map((opt) => {
        const active = multiValue ? multiValue.includes(opt.value) : value === opt.value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.chip,
              columns ? { flex: 1 } : null,
              active ? styles.chipActive : null,
              pressed ? styles.pressedScale : null,
            ]}
          >
            {active ? <Feather name="check" size={12} color={colors.primary} style={{ marginRight: 4 }} /> : null}
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Stepper({ value, min, max, unit, onChange }: { value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepperCard}>
      <Text style={styles.stepperValue}>{value}</Text>
      <Text style={styles.stepperUnit}>{value === 1 ? unit : `${unit}s`}</Text>
      <View style={styles.stepperBtnRow}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          hitSlop={8}
          style={({ pressed }) => [styles.stepperBtn, value <= min ? styles.stepperBtnDisabled : null, pressed ? styles.pressedScale : null]}
        >
          <Feather name="minus" size={14} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          hitSlop={8}
          style={({ pressed }) => [styles.stepperBtn, value >= max ? styles.stepperBtnDisabled : null, pressed ? styles.pressedScale : null]}
        >
          <Feather name="plus" size={14} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  )
}

export type PickerOption = { value: string | number; label: string }

export function PickerField({
  label, value, options, onSelect, placeholder, disabled, loading, searchable,
}: {
  label: string
  value: string | number | null
  options: PickerOption[]
  onSelect: (value: string | number) => void
  placeholder: string
  disabled?: boolean
  loading?: boolean
  searchable?: boolean
}) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((o) => o.value === value)
  const filtered = searchable && query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  return (
    <Field label={label}>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={({ pressed }) => [styles.pickerBtn, disabled ? styles.pickerBtnDisabled : null, pressed ? styles.pressedScale : null]}
      >
        <Text style={[styles.pickerText, !selected ? styles.pickerPlaceholder : null]}>
          {loading ? 'Loading…' : selected?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.ink400} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm) }]}>
            <BlurView intensity={60} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.sheetTopEdge} />
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{label}</Text>
            {searchable ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.ink400}
                style={styles.searchInput}
                autoFocus
              />
            ) : null}
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {filtered.map((opt) => (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => { onSelect(opt.value); setOpen(false); setQuery('') }}
                  style={({ pressed }) => [styles.optionRow, pressed ? styles.optionRowPressed : null]}
                >
                  <Text style={styles.optionText}>{opt.label}</Text>
                  {opt.value === value ? <Feather name="check" size={16} color={colors.primary} /> : null}
                </Pressable>
              ))}
              {filtered.length === 0 ? <Text style={styles.emptyText}>No results</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Field>
  )
}

const styles = StyleSheet.create({
  fieldWrap: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.ink600, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldHint: { ...typography.caption, color: colors.ink400 },
  fieldError: { ...typography.caption, color: colors.error, fontWeight: '600' },
  // Explicit border, not shadow-only -- a live device showed the multiline
  // Residential Address field (same `input` style as every other text field)
  // rendering with no visible boundary at all, while shadows.card's
  // elevation-based shadow apparently DID render for sibling single-line
  // fields on the same screen. Rather than chase why Android's shadow
  // compositing differs for a multiline TextInput, give every input the same
  // explicit border the surrounding `card` sections already use -- a real
  // border can't silently fail to render the way a shadow effect can.
  input: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6, ...shadows.card },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  pressedScale: { transform: [{ scale: 0.97 }] },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, borderRadius: radii.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 44, justifyContent: 'center' },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  chipText: { ...typography.caption, color: colors.ink600, fontWeight: '700' },
  chipTextActive: { color: colors.primary },
  stepperCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.xl, paddingVertical: spacing.md, ...shadows.card },
  // No fontFamily was set at all here (silently fell back to the OS default
  // font), and '800' was dead weight on top of that -- 700 is the heaviest
  // weight useAppFonts loads.
  stepperValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, fontWeight: '700', color: colors.ink900 },
  stepperUnit: { ...typography.caption, color: colors.ink400, fontWeight: '700', textTransform: 'uppercase', marginBottom: spacing.sm },
  stepperBtnRow: { flexDirection: 'row', gap: spacing.md },
  stepperBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  stepperBtnDisabled: { opacity: 0.3 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6, minHeight: 52, ...shadows.card },
  pickerBtnDisabled: { opacity: 0.5 },
  pickerText: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  pickerPlaceholder: { color: colors.ink400, fontWeight: '400' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  // Opaque, not translucent -- BlurView here had no blurMethod set, which on
  // Android renders fully transparent (not even a tint), leaving 0.75 alpha
  // white as the only real layer -- confirmed on a live device letting the
  // page underneath (e.g. the Continue button, other field values) visibly
  // ghost through the sheet. blurMethod is now set above; this base stays
  // opaque regardless, since it's the only guaranteed layer on Android.
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, maxHeight: '75%', overflow: 'hidden' },
  sheetTopEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink900, fontWeight: '700', marginBottom: spacing.sm },
  searchInput: { ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionRowPressed: { backgroundColor: colors.surface2 },
  optionText: { ...typography.body, color: colors.ink900 },
  emptyText: { ...typography.body, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.lg },
})
