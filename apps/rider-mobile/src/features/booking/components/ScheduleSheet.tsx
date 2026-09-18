import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

export type ScheduleSheetProps = {
  visible: boolean
  onClose: () => void
  onChange: (iso: string | null) => void
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const TIME_FMT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }

export function formatPickupTime(d: Date): string {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const time = d.toLocaleString('en-IN', TIME_FMT).replace('AM', 'am').replace('PM', 'pm')
  if (isSameDay(d, now)) return `Today, ${time}`
  if (isSameDay(d, tomorrow)) return `Tomorrow, ${time}`
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}, ${time}`
}

function atHour(daysFromNow: number, hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, 0, 0, 0)
  return d
}

// Quick-pick equivalent of web's SchedulePickerSheet calendar UI (native has no
// bundled date/time picker dependency yet -- see CLAUDE.md's dependency policy --
// so this sticks to the same fixed set of near-future slots Uber/Ola use instead
// of adding a calendar library for one screen). Respects the same
// MIN_ADVANCE_MINUTES(60)/MAX_ADVANCE_DAYS(7) window as web's advance-booking-limits.
const OPTIONS: { label: string; date: () => Date }[] = [
  { label: 'In 1 hour', date: () => new Date(Date.now() + 60 * 60_000) },
  { label: 'In 2 hours', date: () => new Date(Date.now() + 2 * 60 * 60_000) },
  { label: 'Tomorrow, 9:00 am', date: () => atHour(1, 9) },
  { label: 'Tomorrow, 6:00 pm', date: () => atHour(1, 18) },
  { label: 'In 2 days, 9:00 am', date: () => atHour(2, 9) },
]

export function ScheduleSheet({ visible, onClose, onChange }: ScheduleSheetProps) {
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>When do you need pickup?</Text>

        <Pressable onPress={() => { onChange(null); onClose() }} style={styles.row} accessibilityRole="button">
          <View style={styles.iconWrap}>
            <Feather name="zap" size={15} color={colors.primary} />
          </View>
          <Text style={styles.rowText}>Now</Text>
        </Pressable>

        {OPTIONS.map((opt) => (
          <Pressable
            key={opt.label}
            onPress={() => { onChange(opt.date().toISOString()); onClose() }}
            style={styles.row}
            accessibilityRole="button"
          >
            <View style={styles.iconWrap}>
              <Feather name="clock" size={15} color={colors.primary} />
            </View>
            <Text style={styles.rowText}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.48)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, gap: spacing.xs },
  handle: { width: 36, height: 4, borderRadius: radii.full, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '700', marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  rowText: { ...typography.body, color: colors.ink900, fontWeight: '600' },
})
