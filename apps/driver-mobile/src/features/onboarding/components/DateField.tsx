import { useState } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Feather } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import { colors, radii, spacing, typography, fonts, Text } from '@ocar/mobile-shared'
import { Field } from './FormPrimitives'

export type DateFieldProps = {
  label: string
  value: string // YYYY-MM-DD
  onChange: (v: string) => void
  minDate?: string
  maxDate?: string
  placeholder: string
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// exactOptionalPropertyTypes: DateTimePicker's minimumDate/maximumDate are typed
// `Date | undefined` in its own props but not marked optional, so passing an
// explicit `undefined` value is rejected -- omit the key entirely instead.
function rangeProps(minDate?: string, maxDate?: string): { minimumDate?: Date; maximumDate?: Date } {
  const props: { minimumDate?: Date; maximumDate?: Date } = {}
  if (minDate) props.minimumDate = new Date(minDate)
  if (maxDate) props.maximumDate = new Date(maxDate)
  return props
}

export function DateField({ label, value, onChange, minDate, maxDate, placeholder }: DateFieldProps) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Date>(value ? new Date(value) : new Date())

  function openPicker() {
    setDraft(value ? new Date(value) : new Date())
    setOpen(true)
  }

  // Android's native dialog is self-contained (opens/closes itself, no Modal
  // needed); iOS's inline/spinner picker needs to live inside our own Modal
  // with an explicit Done button, since it never dismisses itself.
  if (Platform.OS === 'android') {
    return (
      <Field label={label}>
        <Pressable onPress={openPicker} style={({ pressed }) => [styles.btn, pressed ? styles.pressedScale : null]}>
          <Text style={[styles.text, !value ? styles.placeholder : null]}>{value || placeholder}</Text>
          <Feather name="calendar" size={16} color={colors.ink400} />
        </Pressable>
        {open ? (
          <DateTimePicker
            value={draft}
            mode="date"
            display="default"
            {...rangeProps(minDate, maxDate)}
            onChange={(event, date) => {
              setOpen(false)
              if (event.type === 'set' && date) onChange(toISODate(date))
            }}
          />
        ) : null}
      </Field>
    )
  }

  return (
    <Field label={label}>
      <Pressable onPress={openPicker} style={({ pressed }) => [styles.btn, pressed ? styles.pressedScale : null]}>
        <Text style={[styles.text, !value ? styles.placeholder : null]}>{value || placeholder}</Text>
        <Feather name="calendar" size={16} color={colors.ink400} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm) }]}>
            <BlurView intensity={60} tint="light" blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
            <View style={styles.sheetTopEdge} />
            <View style={styles.handle} />
            <DateTimePicker
              value={draft}
              mode="date"
              display="spinner"
              {...rangeProps(minDate, maxDate)}
              onChange={(_event, date) => date && setDraft(date)}
            />
            <Pressable onPress={() => { onChange(toISODate(draft)); setOpen(false) }} style={({ pressed }) => [styles.doneBtn, pressed ? styles.pressedScale : null]}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Field>
  )
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 6, minHeight: 52 },
  text: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  placeholder: { color: colors.ink400, fontFamily: fonts.regular },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  // Opaque, not translucent -- same fix as FormPrimitives.tsx's PickerField
  // sheet: BlurView with no blurMethod renders fully transparent on Android,
  // so 0.75-alpha white was the only real layer, letting content underneath
  // ghost through.
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, overflow: 'hidden' },
  sheetTopEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.sm },
  doneBtn: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 6, alignItems: 'center', marginTop: spacing.sm },
  doneText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
