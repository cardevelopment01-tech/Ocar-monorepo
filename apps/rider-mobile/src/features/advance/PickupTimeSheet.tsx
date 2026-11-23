import { useEffect, useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Feather } from '@expo/vector-icons'
import { SlideModal, font, h } from '@ocar/mobile-shared'
import { formatPickupTime } from '@/lib/formatPickupTime'
import { pickupBounds, pickupProblem, termsLines, type AdvanceTerms } from './advanceModel'

type Props = {
  visible: boolean
  title: string
  confirmLabel: string
  terms: AdvanceTerms
  /** The time to start from (a booked ride's current pickup, or null for "an hour or so from now"). */
  initial: string | null
  /** A failure from the server, shown under the picker. */
  error?: string | null
  busy?: boolean
  onClose: () => void
  onConfirm: (iso: string) => void
}

// One picker for booking and for changing a booked time. Native date and time pickers (Android: system dialogs, iOS: inline), clamped to the
// bookable window, with the consequences written underneath: when the search starts, that the fare can move a little, and any late-cancel fee.
export function PickupTimeSheet({ visible, title, confirmLabel, terms, initial, error, busy, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets()
  const [value, setValue] = useState<Date>(() => new Date())
  const [androidMode, setAndroidMode] = useState<'date' | 'time' | null>(null)
  const bounds = useMemo(() => pickupBounds(terms), [terms, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return
    const start = initial ? new Date(initial) : new Date(Date.now() + 2 * 3_600_000)
    // Round up to the next quarter hour and keep inside the window.
    start.setSeconds(0, 0)
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15)
    setValue(start.getTime() < bounds.min.getTime() ? bounds.min : start)
    setAndroidMode(null)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const problem = pickupProblem(value, terms)
  const unchanged = initial !== null && Math.abs(new Date(initial).getTime() - value.getTime()) < 60_000
  const canConfirm = !problem && !unchanged && !busy

  function onChange(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') {
      const was = androidMode
      setAndroidMode(null)
      if (e.type !== 'set' || !d) return
      if (was === 'date') {
        // Keep the chosen time of day, change only the date.
        const next = new Date(value); next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); setValue(next)
      } else {
        const next = new Date(value); next.setHours(d.getHours(), d.getMinutes(), 0, 0); setValue(next)
      }
      return
    }
    if (d) setValue(d)
  }

  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 6 }]}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">{title}</Text>

        {Platform.OS === 'ios' ? (
          <DateTimePicker value={value} mode="datetime" display="inline" minimumDate={bounds.min} maximumDate={bounds.max} minuteInterval={5} onChange={onChange} accentColor={h.teal} locale="en-IN" />
        ) : (
          <View style={styles.androidRow}>
            <Pressable onPress={() => setAndroidMode('date')} style={({ pressed }) => [styles.pickBtn, pressed ? styles.pressed : null]} accessibilityRole="button" accessibilityLabel="Change date">
              <Feather name="calendar" size={16} color={h.teal} />
              <Text style={styles.pickText}>{value.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            </Pressable>
            <Pressable onPress={() => setAndroidMode('time')} style={({ pressed }) => [styles.pickBtn, pressed ? styles.pressed : null]} accessibilityRole="button" accessibilityLabel="Change time">
              <Feather name="clock" size={16} color={h.teal} />
              <Text style={styles.pickText}>{value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ').toLowerCase()}</Text>
            </Pressable>
          </View>
        )}
        {Platform.OS === 'android' && androidMode ? (
          <DateTimePicker value={value} mode={androidMode} {...(androidMode === 'date' ? { minimumDate: bounds.min, maximumDate: bounds.max } : {})} onChange={onChange} />
        ) : null}

        <Text style={styles.chosen} accessibilityLiveRegion="polite">{problem ?? `Pickup ${formatPickupTime(value)}`}</Text>

        <View style={styles.notes}>
          {termsLines(terms, problem ? undefined : value.toISOString()).map((line, i) => (
            <View key={i} style={styles.noteRow}>
              <View style={styles.dot} />
              <Text style={styles.noteText}>{line}</Text>
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

        <Pressable
          onPress={() => canConfirm && onConfirm(value.toISOString())}
          disabled={!canConfirm}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canConfirm }}
          style={({ pressed }) => [styles.cta, !canConfirm ? styles.ctaOff : null, pressed && canConfirm ? styles.pressed : null]}
        >
          <Text style={styles.ctaText}>{busy ? 'Saving…' : unchanged ? 'Pick a different time' : confirmLabel}</Text>
        </Pressable>
        <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" style={styles.cancelLink} hitSlop={8}>
          <Text style={styles.cancelText}>Not now</Text>
        </Pressable>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent' },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 14, paddingHorizontal: 20, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 16 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory, marginBottom: 10 },
  androidRow: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  pickBtn: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 18, backgroundColor: h.chip },
  pickText: { fontFamily: font.sb, fontSize: 15, color: h.ivory },
  chosen: { fontFamily: font.b, fontSize: 16, color: h.ivory, marginTop: 6, marginBottom: 10 },
  notes: { gap: 8, marginBottom: 14 },
  noteRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: h.teal, marginTop: 8 },
  noteText: { flex: 1, fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: h.muted },
  error: { fontFamily: font.m, fontSize: 13, color: h.danger, marginBottom: 10 },
  cta: { height: 56, borderRadius: 18, backgroundColor: h.tealCta, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: h.tealSoft },
  ctaText: { fontFamily: font.b, fontSize: 15.5, color: '#FFFFFF' },
  cancelLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  cancelText: { fontFamily: font.sb, fontSize: 14, color: h.muted },
  pressed: { transform: [{ scale: 0.97 }] },
})
